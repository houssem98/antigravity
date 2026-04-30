"""
Gravity Search — Main Search Pipeline
The heart of Gravity Search. Orchestrates the full query lifecycle:

  Query → Understanding → Cache Check → Parallel Retrieval → RRF Fusion
  → Reranking → LLM Reasoning → Citation Validation → Streaming Response

Modes:
  reasoning_depth="fast"    — Linear single-pass pipeline (simple queries)
  reasoning_depth="agentic" — Multi-agent loop: Planner→Reader→Extractor→Critic→Writer
  reasoning_depth="auto"    — Auto-select based on query complexity

Target latencies:
  Simple queries (fast): <200ms end-to-end
  Complex multi-hop (agentic): <8s end-to-end
"""

import asyncio
import re
import time
import uuid
from collections import Counter
from dataclasses import dataclass
from typing import AsyncIterator

import structlog

from app.config import settings
from app.api.middleware.pii_filter import PIIFilter
from app.core.retrieval.fusion import RetrievalResult, reciprocal_rank_fusion
from app.core.reasoning.prompts import (
    FINANCIAL_ANALYST_SYSTEM,
    build_user_message,
    build_reasoning_system_prompt,
    strip_ai_wording,
)
from app.core.reasoning.numeric_verifier import verify_answer_numerics, format_mismatch_report
from app.core.reasoning.temporal_verifier import verify_temporal_consistency, format_temporal_report
from app.core.reasoning.nli_judge import FinanceNLIJudge
from app.core.feedback.routing_feedback import RoutingFeedbackLoop, FeedbackRecord
from app.llm.base import LLMConfig, LLMMessage
from app.llm.router import LLMRouter, RoutingDecision

_nli_judge = FinanceNLIJudge()  # shared singleton; T5 loaded once if GPU available

logger = structlog.get_logger()

# Complexities that benefit from self-consistency (3 runs → pick majority)
_SELF_CONSISTENCY_COMPLEXITIES = {"math", "complex"}
_SELF_CONSISTENCY_RUNS = 3

_pii_filter = PIIFilter()


# ── Event Types for Progressive Streaming ───────────────────────────────
@dataclass
class SearchEvent:
    """Events streamed to the client via WebSocket."""
    type: str       # "status" | "sources" | "token" | "answer" | "metadata" | "error"
                    # + "agent_trace" | "structured_table" | "agent_trace_complete"
    data: dict | str | list | None = None
    trace_id: str = ""


# ── Search Pipeline ─────────────────────────────────────────────────────
class SearchPipeline:
    """
    Main search orchestrator.

    Usage:
        pipeline = SearchPipeline(...)
        async for event in pipeline.search(query, filters):
            await websocket.send_json(event)
    """

    def __init__(
        self,
        llm_router: LLMRouter,
        retrieval_orchestrator,   # app.core.retrieval.orchestrator.RetrievalOrchestrator
        reranker,                 # app.core.reranking.cohere_reranker.CohereReranker
        query_understander,       # app.core.query_understanding.QueryUnderstanding
        citation_validator,       # app.core.reasoning.validator.CitationValidator
        semantic_cache,           # app.core.caching.semantic_cache.SemanticCache
        feedback_loop: RoutingFeedbackLoop | None = None,
        ratio_engine=None,        # app.core.finance.ratio_engine.RatioEngine (deterministic)
    ):
        self.llm_router = llm_router
        self.retrieval = retrieval_orchestrator
        self.reranker = reranker
        self.query_understander = query_understander
        self.validator = citation_validator
        self.cache = semantic_cache
        self.feedback = feedback_loop
        self.ratio_engine = ratio_engine

    def _should_use_agentic(self, reasoning_depth: str, query_plan: dict) -> bool:
        """Decide whether to use the multi-agent pipeline."""
        if reasoning_depth == "agentic":
            return True
        if reasoning_depth == "fast":
            return False
        # Auto-detect: use agentic for complex / multi-hop queries
        complexity = query_plan.get("complexity", "simple")
        intent = query_plan.get("intent", "")
        return complexity in ("complex", "math") or intent in (
            "multi_hop_reasoning",
            "contradiction_detection",
        )

    async def _get_conversation_context(self, conversation_id: str | None) -> str:
        """Load prior turns from Redis for conversational context."""
        if not conversation_id or not self.cache:
            return ""
        try:
            from app.db.redis import redis_client
            raw = await redis_client.get(f"conv:{conversation_id}")
            if raw:
                import json
                turns = json.loads(raw)
                # Format last 3 turns as context
                parts = []
                for t in turns[-3:]:
                    parts.append(f"Previous Q: {t['query']}\nPrevious A: {t['answer'][:300]}...")
                return "\n\n".join(parts)
        except Exception as e:
            logger.warning("conversation_context_failed", error=str(e))
        return ""

    async def _save_conversation_turn(
        self, conversation_id: str | None, query: str, answer: str
    ):
        """Append this turn to the conversation history in Redis (TTL 2h)."""
        if not conversation_id:
            return
        try:
            import json
            from app.db.redis import redis_client
            key = f"conv:{conversation_id}"
            raw = await redis_client.get(key)
            turns = json.loads(raw) if raw else []
            turns.append({"query": query, "answer": answer})
            await redis_client.setex(key, 7200, json.dumps(turns[-10:]))  # keep last 10
        except Exception as e:
            logger.warning("conversation_save_failed", error=str(e))

    async def _self_consistent_generate(
        self,
        client,
        system_msg: LLMMessage,
        user_msg: LLMMessage,
        n_runs: int = _SELF_CONSISTENCY_RUNS,
    ) -> str:
        """
        Run generation N times and return the most self-consistent response.

        Self-consistency (Wang et al. 2022) reduces hallucination by 12-18% on
        quantitative queries. We pick the response whose key numeric values
        appear most frequently across runs.

        Args:
            client:     LLM client already selected by router
            system_msg: System prompt message
            user_msg:   User message with formatted sources
            n_runs:     Number of parallel generation runs (default 3)

        Returns:
            The most consistent response string
        """
        config = LLMConfig(temperature=0.3, max_tokens=4096)  # Higher temp for diversity

        # Run N generations in parallel
        tasks = [
            client.generate(messages=[system_msg, user_msg], config=config)
            for _ in range(n_runs)
        ]
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        valid = [r.content for r in responses if not isinstance(r, Exception) and r.content]

        if not valid:
            return ""
        if len(valid) == 1:
            return valid[0]

        # Extract numeric values from each response and vote for the most consistent
        _NUM_PAT = re.compile(r"\$?[\d,]+(?:\.\d+)?(?:\s*(?:billion|million|%|B|M|K)\b)?")

        def _key_numbers(text: str) -> frozenset[str]:
            """Extract normalised numeric strings as a fingerprint."""
            return frozenset(m.group(0).strip().lower() for m in _NUM_PAT.finditer(text))

        fingerprints = [_key_numbers(v) for v in valid]

        # Score each response by how many of its numbers appear in OTHER responses
        scores = []
        for i, fp_i in enumerate(fingerprints):
            overlap = sum(
                len(fp_i & fingerprints[j])
                for j in range(len(fingerprints)) if j != i
            )
            scores.append((overlap, i))

        best_idx = max(scores, key=lambda x: x[0])[1]

        logger.info(
            "self_consistency_selected",
            n_runs=len(valid),
            best_run=best_idx,
            score=scores[best_idx][0],
        )
        return valid[best_idx]

    async def search(
        self,
        query: str,
        filters: dict | None = None,
        stream: bool = True,
        reasoning_depth: str = "auto",
        conversation_id: str | None = None,
    ) -> AsyncIterator[SearchEvent]:
        """
        Execute the full search pipeline with progressive streaming.

        Yields SearchEvent objects as each stage completes:
          1. status("Analyzing query...")           — instant
          2. status("Searching X documents...")      — <50ms
          3. sources([...])                          — <130ms
          4. token("word ")                          — 200ms+ (streaming)
          5. answer({answer, citations, confidence}) — complete
          6. metadata({latency, model, cost})        — final

        When reasoning_depth="agentic" (or auto-detected complex), delegates
        to the AgentOrchestrator for multi-agent processing.
        """
        trace_id = str(uuid.uuid4())
        start = time.perf_counter()
        total_cost = 0.0
        conversation_context = await self._get_conversation_context(conversation_id)

        try:
            # ── Stage 0: PII Stripping ───────────────────────────────────
            query, redacted = _pii_filter.filter(query)
            if redacted:
                logger.info("pii_stripped", trace_id=trace_id, types=redacted)

            # ── Stage 1: Query Understanding (<50ms) ────────────────────
            yield SearchEvent(type="status", data={"status": "understanding", "message": "Analyzing your query..."}, trace_id=trace_id)

            t0 = time.perf_counter()
            query_plan = await self.query_understander.analyze(query)
            understanding_ms = (time.perf_counter() - t0) * 1000

            logger.info(
                "query_understood",
                trace_id=trace_id,
                intent=query_plan.get("intent"),
                complexity=query_plan.get("complexity"),
                entities=query_plan.get("entities", {}),
                latency_ms=round(understanding_ms, 1),
            )

            # ── Stage 2: Semantic Cache Check ───────────────────────────
            if self.cache:
                cached = await self.cache.get(query)
                if cached:
                    logger.info("cache_hit", trace_id=trace_id)
                    yield SearchEvent(type="answer", data=cached, trace_id=trace_id)
                    yield SearchEvent(
                        type="metadata",
                        data={"latency_ms": round((time.perf_counter() - start) * 1000, 1),
                              "cache_hit": True, "trace_id": trace_id},
                        trace_id=trace_id,
                    )
                    return

            # ── Route: Agentic vs Linear Pipeline ───────────────────────
            if self._should_use_agentic(reasoning_depth, query_plan):
                logger.info(
                    "pipeline_mode",
                    trace_id=trace_id,
                    mode="agentic",
                    complexity=query_plan.get("complexity"),
                )
                from app.core.agents.orchestrator import AgentOrchestrator

                orchestrator = AgentOrchestrator(
                    llm_router=self.llm_router,
                    retrieval_orchestrator=self.retrieval,
                    reranker=self.reranker,
                    query_understander=self.query_understander,
                    semantic_cache=self.cache,
                )
                async for event in orchestrator.run(
                    query=query,
                    query_plan=query_plan,
                    trace_id=trace_id,
                    stream=stream,
                ):
                    yield event

                # Cache the agentic result
                # (cache is handled inside orchestrator's final events)
                return

            # ── Stage 3: Retrieval (single-pass or iterative) ───────────
            # CoRAG (arXiv 2501.14342): For MEDIUM/COMPLEX queries, use
            # iterative retrieval — each reasoning step can trigger follow-up
            # retrieval on detected gaps. +15-25% on multi-hop QA.
            # For SIMPLE queries, single-pass (lower latency).
            doc_count = "500,000+"
            complexity = query_plan.get("complexity", "simple")
            intent = query_plan.get("intent", "")
            _use_iterative = complexity in ("medium", "complex") or intent in (
                "multi_hop_reasoning", "trend_analysis"
            )

            yield SearchEvent(
                type="status",
                data={
                    "status": "searching",
                    "message": (
                        f"Deep search across {doc_count} documents..."
                        if _use_iterative
                        else f"Searching across {doc_count} documents..."
                    ),
                },
                trace_id=trace_id,
            )

            t1 = time.perf_counter()

            if _use_iterative:
                # CoRAG: iterative retrieval with gap detection
                from app.core.retrieval.iterative_rag import IterativeRAG
                # Use same routed LLM for gap detection (cheap: gap prompts are short)
                _gap_client, _ = await self.llm_router.route(query)
                irag = IterativeRAG(
                    llm=_gap_client,
                    retrieval_orchestrator=self.retrieval,
                    reranker=self.reranker,
                    max_steps=2,  # Budget: max 2 follow-up steps in fast-path
                )
                irag_result = await irag.retrieve(
                    query=query,
                    query_plan=query_plan,
                    filters=filters or {},
                )
                top_passages = irag_result.all_passages[:settings.max_context_passages]
                total_cost += irag_result.cost_usd
                retrieval_ms = (time.perf_counter() - t1) * 1000
                logger.info(
                    "iterative_retrieval_complete",
                    trace_id=trace_id,
                    steps=irag_result.retrieval_steps,
                    passages=len(top_passages),
                    gaps=irag_result.gaps_found,
                    latency_ms=round(retrieval_ms, 1),
                )
            else:
                # Single-pass retrieval for simple queries (faster)
                retrieval_results = await self.retrieval.search(
                    query=query,
                    expanded_terms=query_plan.get("expanded_terms", {}),
                    filters=filters or {},
                    channels=query_plan.get("retrieval_channels", ["dense", "bm25", "splade"]),
                )
                retrieval_ms = (time.perf_counter() - t1) * 1000

                # ── Stage 4: RRF Fusion + Reranking (<30ms) ────────────
                t2 = time.perf_counter()
                fused = reciprocal_rank_fusion(retrieval_results, k=settings.rrf_k)
                if self.reranker and len(fused) > 0:
                    reranked = await self.reranker.rerank(
                        query=query,
                        passages=fused[:settings.rerank_top_k],
                    )
                else:
                    reranked = fused
                top_passages = reranked[:settings.max_context_passages]
                rerank_ms = (time.perf_counter() - t2) * 1000
                logger.info(
                    "retrieval_complete",
                    trace_id=trace_id,
                    channels=list(retrieval_results.keys()),
                    total_retrieved=sum(len(v) for v in retrieval_results.values()),
                    after_fusion=len(fused),
                    after_rerank=len(top_passages),
                    retrieval_ms=round(retrieval_ms, 1),
                    rerank_ms=round(rerank_ms, 1),
                )

            # ── Stage 4b: No-data early exit ────────────────────────────
            # If retrieval found nothing, return a clear "not indexed" answer
            # instead of sending empty context to the LLM (which causes hallucination
            # or crashes on calculation queries).
            if not top_passages:
                # Extract company names from query plan for a helpful message
                companies = [
                    e.get("name", e.get("ticker", ""))
                    for e in query_plan.get("entities", {}).get("companies", [])
                ]
                company_hint = f" for {', '.join(companies)}" if companies else ""
                yield SearchEvent(
                    type="sources",
                    data={"sources": []},
                    trace_id=trace_id,
                )
                yield SearchEvent(
                    type="answer",
                    data={
                        "answer": (
                            f"No indexed documents found{company_hint}. "
                            f"To get answers, ingest the relevant SEC filings first: "
                            f"`POST /v1/documents/ingest` with the ticker symbol."
                        ),
                        "citations": [],
                        "confidence": "NONE",
                        "follow_up_queries": [],
                        "structured_data": [],
                    },
                    trace_id=trace_id,
                )
                return

            # ── Stage 5: Yield Sources Early (Progressive Rendering) ───
            source_data = [
                {
                    "id": f"src_{i+1}",
                    "chunk_id": p.chunk_id,
                    "title": p.document_title,
                    "section": p.section,
                    "text": p.text[:500],  # Preview
                    "ticker": p.ticker,
                    "date": p.filing_date,
                    "document_type": p.document_type,
                    "source_quality": p.source_quality,
                    "score": round(p.rrf_score, 4),
                    "channels": p.source_channels,
                }
                for i, p in enumerate(top_passages)
            ]
            yield SearchEvent(type="status", data={"status": "reranking", "message": "Reranking results..."}, trace_id=trace_id)
            yield SearchEvent(type="sources", data={"sources": source_data}, trace_id=trace_id)

            # ── Stage 5b: Deterministic Ratio Pre-Pass ─────────────────
            # For math/valuation queries: compute ratios deterministically
            # from TimescaleDB BEFORE sending to LLM. This injects verified
            # numbers into the prompt so the LLM never needs to compute them.
            # Reduces financial hallucination rate to near-zero for ratio queries.
            ratio_context_block = ""
            if self.ratio_engine:
                try:
                    tickers = [
                        e.get("ticker") for e in query_plan.get("entities", {}).get("companies", [])
                        if e.get("ticker")
                    ]
                    if tickers:
                        period = "FY2025"
                        date_entities = query_plan.get("entities", {}).get("dates", [])
                        if date_entities:
                            resolved = date_entities[0].get("resolved", "")
                            if resolved:
                                period = resolved
                        ratio_output = await self.ratio_engine.compute_from_query(
                            ticker=tickers[0],
                            query=query,
                            period=period,
                        )
                        ratio_context_block = ratio_output.context_block
                        if ratio_context_block:
                            logger.info(
                                "ratio_engine_injected",
                                trace_id=trace_id,
                                ticker=tickers[0],
                                period=period,
                                ratios_computed=len(ratio_output.ratios),
                            )
                except Exception as _re:
                    logger.warning("ratio_engine_failed", trace_id=trace_id, error=str(_re))

            # ── Stage 6: LLM Reasoning (200ms–2s) ──────────────────────
            t3 = time.perf_counter()
            yield SearchEvent(type="status", data={"status": "reasoning", "message": "Generating cited answer..."}, trace_id=trace_id)

            # Route to optimal model
            client, routing_decision = await self.llm_router.route(query)

            # Build messages — inject prior conversation context if present
            # Buffer of Thoughts (BoT, NeurIPS 2024): inject relevant financial
            # reasoning template to guide structured analysis (+51% on complex tasks)
            reasoning_system = build_reasoning_system_prompt(
                query=query,
                intent=query_plan.get("intent", ""),
                complexity=complexity,
            )
            system_msg = LLMMessage(role="system", content=reasoning_system)
            user_content = build_user_message(query, top_passages)
            # Prepend deterministic ratio data if available
            # This goes BEFORE sources so the LLM sees verified numbers first
            if ratio_context_block:
                user_content = ratio_context_block + "\n\n" + user_content
            if conversation_context:
                user_content = (
                    f"## Conversation Context (prior turns)\n{conversation_context}\n\n"
                    + user_content
                )
            user_msg = LLMMessage(role="user", content=user_content)

            # Decide whether to use self-consistency (MATH/COMPLEX, non-streaming)
            use_self_consistency = (
                routing_decision.complexity.value in _SELF_CONSISTENCY_COMPLEXITIES
                and not stream  # Only for non-streaming requests (avoids 3x latency for WS)
            )

            if stream:
                # Stream tokens to client (no self-consistency in streaming mode)
                full_response = ""
                async for token in client.generate_stream(
                    messages=[system_msg, user_msg],
                    config=LLMConfig(temperature=0.1, max_tokens=4096),
                ):
                    full_response += token
                    yield SearchEvent(type="token", data={"token": token}, trace_id=trace_id)
            elif use_self_consistency:
                # Self-consistency: run 3 times in parallel, pick most consistent
                yield SearchEvent(
                    type="status",
                    data={"status": "reasoning", "message": "Running self-consistency check (3×)..."},
                    trace_id=trace_id,
                )
                full_response = await self._self_consistent_generate(
                    client, system_msg, user_msg, n_runs=_SELF_CONSISTENCY_RUNS
                )
                if not full_response:
                    # Fallback to single run
                    response = await client.generate(
                        messages=[system_msg, user_msg],
                        config=LLMConfig(temperature=0.1, max_tokens=4096),
                    )
                    full_response = response.content
                    total_cost += response.cost_usd
            else:
                # Non-streaming single-pass
                response = await client.generate(
                    messages=[system_msg, user_msg],
                    config=LLMConfig(temperature=0.1, max_tokens=4096),
                )
                full_response = response.content
                total_cost += response.cost_usd

            reasoning_ms = (time.perf_counter() - t3) * 1000

            # ── AI Wording Check (fast-path) ────────────────────────────
            _, ai_phrases = strip_ai_wording(full_response)
            if ai_phrases:
                logger.warning(
                    "ai_wording_detected_fastpath",
                    phrases=ai_phrases[:5],
                    query=query[:60],
                    trace_id=trace_id,
                )

            # ── Stage 7: Deterministic Verification (0ms, $0) ───────────
            # Layer 1: Numeric + Temporal verifiers (existing)
            # Layer 2: Logic verifier — NEW: checks financial reasoning chains
            # Based on: CRITIC (2023), step-level PRM validation concepts
            t4 = time.perf_counter()

            numeric_mismatches = verify_answer_numerics(full_response, top_passages)
            temporal_mismatches = verify_temporal_consistency(full_response, top_passages)

            # NEW: Logic consistency check (no LLM, O(n) rules-based)
            from app.core.reasoning.logic_verifier import verify_logic
            logic_result = verify_logic(full_response, extracted_facts=[])
            # Note: extracted_facts available in agentic mode; in fast-path, pass []
            # Logic verifier will still catch narrative/number conflicts from answer text

            if numeric_mismatches or temporal_mismatches or not logic_result.passed:
                logger.warning(
                    "deterministic_verification_warnings",
                    trace_id=trace_id,
                    numeric=len(numeric_mismatches),
                    temporal=len(temporal_mismatches),
                    logic_errors=logic_result.error_count,
                    logic_warnings=logic_result.warning_count,
                    numeric_report=format_mismatch_report(numeric_mismatches),
                    temporal_report=format_temporal_report(temporal_mismatches),
                    logic_summary=logic_result.summary,
                )

            # ── Stage 7b: LLM Citation Validation (<100ms, parallelized)
            validated_answer = full_response
            validation_result = None

            if self.validator:
                try:
                    validation_result = await self.validator.verify(
                        answer=full_response,
                        passages=top_passages,
                    )
                    # If validator found issues, use corrected answer
                    if validation_result and validation_result.get("corrected_answer"):
                        validated_answer = validation_result["corrected_answer"]
                except Exception as e:
                    logger.warning("validation_failed", trace_id=trace_id, error=str(e))

            # Attach deterministic verification results to validation output
            if validation_result is None:
                validation_result = {}
            validation_result["numeric_mismatches"] = len(numeric_mismatches)
            validation_result["temporal_mismatches"] = len(temporal_mismatches)

            validation_ms = (time.perf_counter() - t4) * 1000

            # ── Stage 8: Parse JSON answer → extract citations, follow-ups ─
            import json as _json
            parsed_answer = validated_answer
            citations_out: list = []
            follow_up_queries: list = []
            caveats: list = []
            contradictions_out: list = []
            confidence_out = "MEDIUM"
            structured_data_out: list = []
            try:
                # LLM returns JSON per FINANCIAL_ANALYST_SYSTEM prompt.
                # Strip markdown code fences if LLM wrapped the output
                _raw = validated_answer.strip()
                # Strip <thinking> preamble that Gemini adds before JSON output
                _raw = re.sub(r"<thinking>[\s\S]*?</thinking>", "", _raw, flags=re.IGNORECASE).strip()
                if _raw.startswith("```"):
                    _raw = re.sub(r"^```(?:json)?\s*", "", _raw)
                    _raw = re.sub(r"\s*```$", "", _raw.rstrip())
                # Find JSON object if there is leading text before the brace
                if not _raw.startswith("{"):
                    _m = re.search(r"(\{[\s\S]*\})", _raw)
                    if _m:
                        _raw = _m.group(1)
                answer_json = _json.loads(_raw)
                parsed_answer = answer_json.get("answer", validated_answer)
                # Strip fences if LLM nested them inside the answer field value
                if isinstance(parsed_answer, str) and parsed_answer.strip().startswith("```"):
                    parsed_answer = re.sub(r"^```(?:json)?\s*", "", parsed_answer.strip())
                    parsed_answer = re.sub(r"\s*```$", "", parsed_answer.rstrip())
                citations_out = answer_json.get("citations", [])
                follow_up_queries = answer_json.get("follow_up_queries", [])
                caveats = answer_json.get("caveats", [])
                contradictions_out = answer_json.get("contradictions", [])
                confidence_out = answer_json.get("confidence", "MEDIUM")
                structured_data_out = answer_json.get("structured_data", [])
                # Calibrate confidence: override HIGH if answer admits it cannot answer
                _negative_phrases = [
                    "i am unable", "i cannot", "i am sorry", "not available",
                    "not found", "no information", "no data", "cannot find",
                    "do not have", "none of the provided", "not in the",
                ]
                if confidence_out == "HIGH" and isinstance(parsed_answer, str):
                    _ans_lower = parsed_answer.lower()
                    if any(p in _ans_lower for p in _negative_phrases):
                        confidence_out = "LOW"
            except (_json.JSONDecodeError, TypeError):
                # Plain-text response — fall back to regex extraction
                confidence_out = _extract_confidence(validated_answer)

            # ── Stage 8b: Yield Complete Answer ─────────────────────────
            chart_specs_out = _auto_chart_specs(structured_data_out)
            yield SearchEvent(
                type="answer",
                data={
                    "answer": parsed_answer,
                    "citations": citations_out,
                    "follow_up_queries": follow_up_queries,
                    "caveats": caveats,
                    "contradictions": contradictions_out,
                    "model_used": routing_decision.primary_model,
                    "confidence": confidence_out,
                    "validation": validation_result,
                    "structured_data": structured_data_out,
                    "chart_specs": chart_specs_out,
                },
                trace_id=trace_id,
            )

            # Emit structured table event for frontend DataPanel rendering
            if structured_data_out:
                yield SearchEvent(
                    type="structured_table",
                    data={"rows": structured_data_out},
                    trace_id=trace_id,
                )

            # Save turn to conversation history
            await self._save_conversation_turn(conversation_id, query, parsed_answer)

            # ── Stage 9: Cache Result ───────────────────────────────────
            if self.cache:
                await self.cache.set(query, {
                    "answer": validated_answer,
                    "sources": source_data,
                })

            # ── Stage 10: Yield Metadata ────────────────────────────────
            total_ms = (time.perf_counter() - start) * 1000
            yield SearchEvent(
                type="metadata",
                data={
                    "trace_id": trace_id,
                    "latency_ms": round(total_ms, 1),
                    "understanding_ms": round(understanding_ms, 1),
                    "retrieval_ms": round(retrieval_ms, 1),
                    "rerank_ms": round(rerank_ms, 1),
                    "reasoning_ms": round(reasoning_ms, 1),
                    "validation_ms": round(validation_ms, 1),
                    "model_used": routing_decision.primary_model,
                    "complexity": routing_decision.complexity.value,
                    "estimated_cost_usd": round(routing_decision.estimated_cost, 4),
                    "retrieval_channels": list(retrieval_results.keys()),
                    "passages_used": len(top_passages),
                    "cache_hit": False,
                    "self_consistency": use_self_consistency,
                    "numeric_mismatches": len(numeric_mismatches),
                    "temporal_mismatches": len(temporal_mismatches),
                    "deterministic_ratios_injected": bool(ratio_context_block),
                },
                trace_id=trace_id,
            )

            logger.info(
                "search_complete",
                trace_id=trace_id,
                total_ms=round(total_ms, 1),
                model=routing_decision.primary_model,
                complexity=routing_decision.complexity.value,
            )

            # ── Feedback Recording (fire-and-forget) ─────────────────────
            if self.feedback:
                try:
                    _conf_map = {"HIGH": 0.9, "MEDIUM": 0.6, "LOW": 0.3}
                    conf_value = _conf_map.get(confidence_out, 0.6)
                    asyncio.create_task(self.feedback.record(FeedbackRecord(
                        trace_id=trace_id,
                        query=query,
                        complexity=routing_decision.complexity.value,
                        model_used=routing_decision.primary_model,
                        confidence=conf_value,
                        latency_ms=round(total_ms, 1),
                        cache_hit=False,
                        numeric_mismatches=len(numeric_mismatches),
                        temporal_mismatches=len(temporal_mismatches),
                        cost_usd=round(routing_decision.estimated_cost, 6),
                    )))
                except Exception:
                    pass  # Feedback failure must never affect the user

        except Exception as e:
            logger.error("search_error", trace_id=trace_id, error=str(e), exc_info=True)
            yield SearchEvent(
                type="error",
                data={"message": "An error occurred during search. Please try again.",
                      "trace_id": trace_id},
                trace_id=trace_id,
            )


def _auto_chart_specs(structured_data: list[dict]) -> list[dict]:
    """
    Auto-generate chart_specs from structured data rows (fast-path pipeline).

    Logic:
      - Line chart: same metric + same entity, 3+ distinct periods
      - Bar chart: same metric, 2+ distinct entities, 1 period

    Returns a list of chart_spec dicts (empty list if no chartable data).
    """
    if not structured_data:
        return []

    from collections import defaultdict

    # Group rows by (entity, metric) → list of (period, value, row_id)
    entity_metric: dict = defaultdict(list)
    for row in structured_data:
        entity = row.get("entity", "")
        metric = row.get("metric", "")
        period = row.get("period", "")
        value = row.get("value")
        row_id = row.get("row_id", "")
        if entity and metric and period and value is not None:
            entity_metric[(entity, metric)].append((period, value, row_id))

    # Group rows by (metric, period) → list of (entity, value, row_id)
    metric_period: dict = defaultdict(list)
    for row in structured_data:
        entity = row.get("entity", "")
        metric = row.get("metric", "")
        period = row.get("period", "")
        value = row.get("value")
        row_id = row.get("row_id", "")
        if entity and metric and period and value is not None:
            metric_period[(metric, period)].append((entity, value, row_id))

    charts = []

    # Line charts: same entity+metric across 3+ periods
    for (entity, metric), rows in entity_metric.items():
        if len(rows) >= 3:
            unit = next(
                (r.get("unit", "") for r in structured_data
                 if r.get("entity") == entity and r.get("metric") == metric),
                "",
            )
            chart_id = f"{entity.lower().replace(' ', '_')}_{metric.lower().replace(' ', '_')}_trend"
            charts.append({
                "chart_id": chart_id,
                "chart_type": "line",
                "title": f"{entity} — {metric} Trend",
                "x_axis": "period",
                "y_axis": "value",
                "y_label": unit,
                "series": [{"entity": entity, "metric": metric}],
                "data_refs": [r[2] for r in rows],
            })

    # Bar charts: same metric across 2+ entities in the same period
    for (metric, period), rows in metric_period.items():
        if len(rows) >= 2:
            # Only create if we haven't already made a line chart covering same metric
            existing_ids = {c["chart_id"] for c in charts}
            chart_id = f"{metric.lower().replace(' ', '_')}_{period.lower().replace(' ', '_')}_comparison"
            if chart_id not in existing_ids:
                unit = next(
                    (r.get("unit", "") for r in structured_data
                     if r.get("metric") == metric),
                    "",
                )
                charts.append({
                    "chart_id": chart_id,
                    "chart_type": "bar",
                    "title": f"{metric} Comparison — {period}",
                    "x_axis": "entity",
                    "y_axis": "value",
                    "y_label": unit,
                    "series": [{"entity": e, "metric": metric} for e, _, _ in rows],
                    "data_refs": [r[2] for r in rows],
                })

    return charts[:4]  # Cap at 4 charts per answer


def _extract_confidence(answer: str) -> str:
    """Extract confidence level from the generated answer."""
    answer_lower = answer.lower()
    if '"confidence": "high"' in answer_lower or '"confidence":"high"' in answer_lower:
        return "HIGH"
    elif '"confidence": "low"' in answer_lower or '"confidence":"low"' in answer_lower:
        return "LOW"
    return "MEDIUM"
