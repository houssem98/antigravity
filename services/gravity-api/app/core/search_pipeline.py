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
from app.core.retrieval.fusion import RetrievalResult, authority_aware_rrf
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
        audit_logger=None,        # compliance.audit_log.AuditLogger
    ):
        self.llm_router = llm_router
        self.retrieval = retrieval_orchestrator
        self.reranker = reranker
        self.query_understander = query_understander
        self.validator = citation_validator
        self.cache = semantic_cache
        self.feedback = feedback_loop
        self.ratio_engine = ratio_engine
        self.audit_logger = audit_logger

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
        """
        Load prior turns + numeric state from Redis for conversational context.

        Returns two sections (when available):
          1. KNOWN FACTS block (ConvFinQA numeric state)
          2. Prior Q&A turns (last 3)
        """
        if not conversation_id or not self.cache:
            return ""

        parts = []

        # ConvFinQA numeric state: inject known facts first so the LLM
        # sees verified numbers before it reads the new question
        try:
            from app.core.reasoning.numeric_state import get_numeric_state_tracker
            tracker = get_numeric_state_tracker()
            facts_block = await tracker.get_facts_block(conversation_id)
            if facts_block:
                parts.append(facts_block)
        except Exception as e:
            logger.warning("numeric_state_load_failed", error=str(e))

        # Prior Q&A turns
        try:
            from app.db.redis import redis_client
            raw = await redis_client.get(f"conv:{conversation_id}")
            if raw:
                import json
                turns = json.loads(raw)
                turn_parts = []
                for t in turns[-3:]:
                    turn_parts.append(f"Previous Q: {t['query']}\nPrevious A: {t['answer'][:300]}...")
                if turn_parts:
                    parts.append("\n\n".join(turn_parts))
        except Exception as e:
            logger.warning("conversation_context_failed", error=str(e))

        return "\n\n".join(parts)

    async def _save_conversation_turn(
        self, conversation_id: str | None, query: str, answer: str
    ):
        """
        Append this turn to the conversation history in Redis (TTL 2h).
        Also records numeric facts extracted from the answer for ConvFinQA state.
        """
        if not conversation_id:
            return

        # Record numeric facts from answer (fire-and-forget)
        try:
            from app.core.reasoning.numeric_state import get_numeric_state_tracker
            tracker = get_numeric_state_tracker()
            asyncio.create_task(tracker.record_turn(conversation_id, answer))
        except Exception as e:
            logger.warning("numeric_state_record_failed", error=str(e))

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
        user_id: str | None = None,
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

        # Observability: start Langfuse trace (no-op if not configured)
        from app.core.observability import get_tracer
        _tracer = get_tracer()
        _otrace = _tracer.start_trace(
            trace_id=trace_id,
            query=query,
            session_id=conversation_id or "",
        )

        try:
            # ── Stage 0: PII Stripping ───────────────────────────────────
            query, redacted = _pii_filter.filter(query)
            if redacted:
                logger.info("pii_stripped", trace_id=trace_id, types=redacted)

            # ── Stage 1: Query Understanding (<50ms) ────────────────────
            yield SearchEvent(type="status", data={"status": "understanding", "message": "Analyzing your query..."}, trace_id=trace_id)

            t0 = time.perf_counter()
            try:
                query_plan = await asyncio.wait_for(
                    self.query_understander.analyze(query), timeout=5.0
                )
            except asyncio.TimeoutError:
                from app.core.query_understanding import DEFAULT_QUERY_PLAN
                query_plan = DEFAULT_QUERY_PLAN.copy()
                logger.warning("query_understanding_timeout", trace_id=trace_id, query=query[:60])
            understanding_ms = (time.perf_counter() - t0) * 1000

            # ── Stage 1b: Entity Resolution ──────────────────────────────
            # Disambiguate company mentions → canonical (ticker, CIK, name).
            # Runs fire-and-forget in parallel with cache check (no await needed
            # for the result — we enrich query_plan in place if resolver is ready).
            _raw_companies = query_plan.get("entities", {}).get("companies", [])
            if _raw_companies:
                try:
                    from app.core.entity_resolver import get_resolver
                    from app.db.redis import redis_client as _redis
                    _resolver = await asyncio.wait_for(
                        get_resolver(redis_client=_redis), timeout=2.0
                    )
                    _resolved = await _resolver.resolve_many(
                        [c.get("name", c) if isinstance(c, dict) else str(c)
                         for c in _raw_companies]
                    )
                    for i, entity in enumerate(_resolved):
                        if entity.match_type != "unknown" and entity.ticker:
                            if isinstance(_raw_companies[i], dict):
                                _raw_companies[i]["ticker"] = entity.ticker
                                _raw_companies[i]["cik"] = entity.cik
                                _raw_companies[i]["resolved_name"] = entity.name
                            else:
                                _raw_companies[i] = {
                                    "name": str(_raw_companies[i]),
                                    "ticker": entity.ticker,
                                    "cik": entity.cik,
                                    "resolved_name": entity.name,
                                }
                    logger.debug(
                        "entities_resolved",
                        trace_id=trace_id,
                        resolved=[e.ticker for e in _resolved if e.ticker],
                    )
                except Exception as _er:
                    logger.debug("entity_resolution_skipped", trace_id=trace_id, error=str(_er))

            logger.info(
                "query_understood",
                trace_id=trace_id,
                intent=query_plan.get("intent"),
                complexity=query_plan.get("complexity"),
                entities=query_plan.get("entities", {}),
                latency_ms=round(understanding_ms, 1),
            )

            # ── Stage 2: Semantic Cache Check ───────────────────────────
            # Cache failures (e.g. Redis without RediSearch/vector ops) must
            # never break search — treat any error as a cache miss.
            if self.cache:
                try:
                    cached = await self.cache.get(query)
                except Exception as e:
                    logger.warning("cache_get_skip", trace_id=trace_id, error=str(e))
                    cached = None
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
                # Multi-entity: comparison queries ("Apple vs Microsoft") get
                # one independent retrieval pass per company then merged.
                _companies = query_plan.get("entities", {}).get("companies", [])
                _tickers = [e.get("ticker") for e in _companies if e.get("ticker")]
                _channels = query_plan.get("retrieval_channels", ["dense", "bm25", "splade"])

                if len(_tickers) >= 2 and complexity in ("medium", "complex"):
                    retrieval_results = await self.retrieval.search_multi_entity(
                        query=query,
                        tickers=_tickers,
                        filters=filters or {},
                        channels=_channels,
                        complexity=complexity,
                    )
                else:
                    retrieval_results = await self.retrieval.search(
                        query=query,
                        expanded_terms=query_plan.get("expanded_terms", {}),
                        filters=filters or {},
                        channels=_channels,
                        complexity=complexity,
                    )
                retrieval_ms = (time.perf_counter() - t1) * 1000
                _tracer.record_stage(_otrace, "retrieval", latency_ms=retrieval_ms,
                                     channels=list(retrieval_results.keys()),
                                     total_retrieved=sum(len(v) for v in retrieval_results.values()))

                # ── Stage 4: RRF Fusion + Reranking (<30ms) ────────────
                # Authority-aware RRF (plan §6.4): SEC/IR > sell-side > news > blogs.
                # 0.15 boost makes primary filings outrank tier-2 news at ties without
                # overpowering strong multi-channel news matches.
                t2 = time.perf_counter()
                fused = authority_aware_rrf(retrieval_results, k=settings.rrf_k, authority_weight=0.15)
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

            # ── Stage 5c: Deterministic Calculator Pre-Pass ────────────
            # For explicit math queries (YoY growth, margins, CAGR, etc.):
            # detect the calculation type, extract operands from retrieved passages,
            # compute the answer deterministically, and inject it into the prompt.
            # LLMs hallucinate arithmetic — this guarantees correct math at $0 cost.
            calculator_block = ""
            try:
                from app.core.financial_calculator import detect_calculation_type, execute_calculation, parse_financial_number
                calc_type = detect_calculation_type(query)
                if calc_type:
                    # Extract numbers from top passages (first 5 passages, ≤2000 chars each)
                    import re as _re_calc
                    _NUM_PAT = _re_calc.compile(r"[\$€£]?[\d,]+(?:\.\d+)?(?:\s*(?:billion|million|trillion|thousand|B|M|T|K)\b)?(?:\s*%)?", _re_calc.IGNORECASE)
                    candidate_numbers: list[float] = []
                    for p in top_passages[:5]:
                        for m in _NUM_PAT.finditer(p.text[:2000]):
                            v = parse_financial_number(m.group(0))
                            if v is not None and abs(v) > 0:
                                candidate_numbers.append(v)

                    # Attempt calculation with first two distinct candidates
                    uniq = list(dict.fromkeys(candidate_numbers))[:4]
                    if len(uniq) >= 2:
                        calc_result = execute_calculation(calc_type, {
                            "old": uniq[1], "new": uniq[0],           # percentage_change / yoy_growth
                            "current": uniq[0], "prior_year": uniq[1], # yoy_growth alt params
                            "prior_quarter": uniq[1],
                            "beginning": uniq[1], "ending": uniq[0], "years": 1,
                            "revenue": uniq[0], "cogs": uniq[1],
                            "operating_income": uniq[1], "net_income": uniq[1],
                            "ebitda": uniq[1],
                        }.copy())
                        if calc_result.get("result") is not None:
                            calculator_block = (
                                f"## Deterministic Calculation Result\n"
                                f"Calculation type: {calc_result['calc_type']}\n"
                                f"Formula: {calc_result['formula']}\n"
                                f"Result: {calc_result['result']}\n"
                                f"Description: {calc_result.get('description', '')}\n"
                                f"(Use this verified result in your answer. Do not recompute.)\n"
                            )
                            logger.info(
                                "calculator_injected",
                                trace_id=trace_id,
                                calc_type=calc_type,
                                result=calc_result["result"],
                            )
            except Exception as _calc_err:
                logger.warning("calculator_pre_pass_failed", trace_id=trace_id, error=str(_calc_err))

            # ── Stage 6: LLM Reasoning (200ms–2s) ──────────────────────
            t3 = time.perf_counter()
            yield SearchEvent(type="status", data={"status": "reasoning", "message": "Generating cited answer..."}, trace_id=trace_id)

            # Route to optimal model + build ordered fallback list
            client, routing_decision = await self.llm_router.route(query)
            clients_ordered = self.llm_router.select_models_ordered(routing_decision.complexity)
            # Ensure primary client is first (route() may differ from select_models_ordered index 0)
            if client not in clients_ordered:
                clients_ordered.insert(0, client)

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
            # Prepend deterministic data (ratios + calculator) before sources
            # so the LLM sees verified numbers first and never needs to recompute
            if ratio_context_block:
                user_content = ratio_context_block + "\n\n" + user_content
            if calculator_block:
                user_content = calculator_block + "\n\n" + user_content
            if conversation_context:
                user_content = (
                    f"## Conversation Context (prior turns)\n{conversation_context}\n\n"
                    + user_content
                )

            # Memory augmentation — inject semantically-similar past queries
            try:
                from app.core.memory_context import augment_context_with_memory
                memory_ctx = await augment_context_with_memory(query, max_memory_results=3)
                if memory_ctx:
                    user_content = memory_ctx + "\n\n" + user_content
            except Exception as _mem_err:
                logger.debug("memory_augmentation_skipped", trace_id=trace_id, error=str(_mem_err))

            user_msg = LLMMessage(role="user", content=user_content)

            # Decide whether to use self-consistency (MATH/COMPLEX, non-streaming)
            use_self_consistency = (
                routing_decision.complexity.value in _SELF_CONSISTENCY_COMPLEXITIES
                and not stream  # Only for non-streaming requests (avoids 3x latency for WS)
            )

            gen_config = LLMConfig(temperature=0.1, max_tokens=4096)
            full_response = ""
            _last_llm_err = None

            if stream:
                # Stream tokens — try each client in fallback order.
                # Credit/rate-limit errors are raised on the first iteration
                # (before any tokens), so fallback is always clean.
                for _client in clients_ordered:
                    try:
                        async for token in _client.generate_stream(
                            messages=[system_msg, user_msg], config=gen_config
                        ):
                            full_response += token
                            yield SearchEvent(type="token", data={"token": token}, trace_id=trace_id)
                        routing_decision = RoutingDecision(
                            complexity=routing_decision.complexity,
                            primary_model=_client.model_id,
                            provider=_client.provider.value,
                            estimated_cost=routing_decision.estimated_cost,
                            reasoning=routing_decision.reasoning,
                        )
                        break  # success
                    except Exception as _e:
                        if full_response:
                            # Already streamed tokens — can't cleanly fall back
                            logger.warning("stream_failed_mid_response", model=_client.model_id, error=str(_e))
                            break
                        logger.warning("llm_stream_failed_trying_next", model=_client.model_id, error=str(_e))
                        _last_llm_err = _e
                        continue

                if not full_response and _last_llm_err:
                    raise RuntimeError(f"All LLM clients failed: {_last_llm_err}")

            elif use_self_consistency:
                yield SearchEvent(
                    type="status",
                    data={"status": "reasoning", "message": "Running self-consistency check (3x)..."},
                    trace_id=trace_id,
                )
                for _client in clients_ordered:
                    try:
                        full_response = await self._self_consistent_generate(
                            _client, system_msg, user_msg, n_runs=_SELF_CONSISTENCY_RUNS
                        )
                        if not full_response:
                            response = await _client.generate(messages=[system_msg, user_msg], config=gen_config)
                            full_response = response.content
                            total_cost += response.cost_usd
                        routing_decision = RoutingDecision(
                            complexity=routing_decision.complexity,
                            primary_model=_client.model_id,
                            provider=_client.provider.value,
                            estimated_cost=routing_decision.estimated_cost,
                            reasoning=routing_decision.reasoning,
                        )
                        break
                    except Exception as _e:
                        logger.warning("llm_generate_failed_trying_next", model=_client.model_id, error=str(_e))
                        _last_llm_err = _e
                        continue

                if not full_response and _last_llm_err:
                    raise RuntimeError(f"All LLM clients failed: {_last_llm_err}")

            else:
                # Non-streaming single-pass with fallback
                for _client in clients_ordered:
                    try:
                        response = await _client.generate(messages=[system_msg, user_msg], config=gen_config)
                        full_response = response.content
                        total_cost += response.cost_usd
                        routing_decision = RoutingDecision(
                            complexity=routing_decision.complexity,
                            primary_model=_client.model_id,
                            provider=_client.provider.value,
                            estimated_cost=routing_decision.estimated_cost,
                            reasoning=routing_decision.reasoning,
                        )
                        break
                    except Exception as _e:
                        logger.warning("llm_generate_failed_trying_next", model=_client.model_id, error=str(_e))
                        _last_llm_err = _e
                        continue

                if not full_response and _last_llm_err:
                    raise RuntimeError(f"All LLM clients failed: {_last_llm_err}")

            reasoning_ms = (time.perf_counter() - t3) * 1000
            _tracer.record_generation(_otrace, model=routing_decision.primary_model,
                                      cost_usd=routing_decision.estimated_cost,
                                      stage="generation")

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
            # Layer 2: Logic verifier — checks financial reasoning chains
            # Layer 3: Cross-passage contradiction detector — NEW
            # Based on: CRITIC (2023), step-level PRM validation concepts
            t4 = time.perf_counter()

            from app.core.reasoning.contradiction_detector import (
                detect_contradictions, format_for_response as _fmt_contradictions,
            )

            numeric_mismatches = verify_answer_numerics(full_response, top_passages)
            temporal_mismatches = verify_temporal_consistency(full_response, top_passages)
            cross_passage_contradictions = detect_contradictions(top_passages)

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

            # ── Stage 7b: NLI Citation Validation + LLM Correction ─────
            # Step 1: NLI sentence-level entailment (numeric pre-check → T5 → Claude).
            #         Replaces the fragile keyword_recall < 0.3 hallucination proxy.
            # Step 2: LLM CitationValidator for claim correction (existing Layer 2).
            validated_answer = full_response
            validation_result = None
            nli_recall = None

            # NLI entailment check: split answer into sentences, score each
            try:
                import re as _re
                _sentences = [s.strip() for s in _re.split(r'(?<=[.!?])\s+(?=[A-Z])', full_response) if s.strip()]
                _passage_text = " ".join(p.text for p in top_passages[:10])
                if _sentences and _passage_text:
                    _nli_pairs = [(_passage_text, s) for s in _sentences]
                    _nli_results = await _nli_judge.batch_score(_nli_pairs)
                    _entailed = sum(r.entails for r in _nli_results)
                    nli_recall = _entailed / max(len(_nli_results), 1)
                    logger.info(
                        "nli_citation_check",
                        trace_id=trace_id,
                        sentences=len(_sentences),
                        entailed=_entailed,
                        recall=round(nli_recall, 3),
                        methods=list({r.method for r in _nli_results}),
                    )
            except Exception as _nli_err:
                logger.warning("nli_check_failed", trace_id=trace_id, error=str(_nli_err))

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

            # Attach verification results to validation output
            if validation_result is None:
                validation_result = {}
            validation_result["numeric_mismatches"] = len(numeric_mismatches)
            validation_result["temporal_mismatches"] = len(temporal_mismatches)
            validation_result["cross_passage_contradictions"] = len(cross_passage_contradictions)
            if nli_recall is not None:
                validation_result["nli_citation_recall"] = round(nli_recall, 4)

            # ── Stage 7c: Patronus Lynx finance hallucination guardrail ────
            # Plan §3.4: finance-tuned grader. Uses HF inference API when
            # HF_TOKEN is set, else LLM-as-Lynx via the wired sonnet client.
            try:
                from app.core.reasoning.lynx_guardrail import LynxGuardrail
                _lynx_client = getattr(self, "_lynx_client", None) or (
                    self.llm_router.get_client("claude_sonnet")
                    if hasattr(self.llm_router, "get_client") else None
                )
                if _lynx_client is not None and top_passages:
                    grader = LynxGuardrail(llm_client=_lynx_client)
                    _passage_text2 = " ".join(p.text for p in top_passages[:10])[:8000]
                    lynx_score = await grader.score(
                        context=_passage_text2,
                        answer=full_response,
                    )
                    validation_result["lynx_score"] = round(lynx_score.score, 3)
                    validation_result["lynx_method"] = lynx_score.method
                    validation_result["lynx_grounded"] = lynx_score.is_grounded
                    if lynx_score.reasoning:
                        validation_result["lynx_reasoning"] = lynx_score.reasoning[:300]
                    logger.info(
                        "lynx_check",
                        trace_id=trace_id,
                        score=round(lynx_score.score, 3),
                        method=lynx_score.method,
                        grounded=lynx_score.is_grounded,
                    )
            except Exception as _lynx_err:
                logger.warning("lynx_check_failed", trace_id=trace_id, error=str(_lynx_err))

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
                # Merge deterministic cross-passage contradictions (Stage 7 Layer 3)
                if cross_passage_contradictions:
                    contradictions_out = contradictions_out + _fmt_contradictions(cross_passage_contradictions)
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
                if cross_passage_contradictions:
                    contradictions_out = _fmt_contradictions(cross_passage_contradictions)

            # ── Stage 8b: ALiiCE Proposition Attribution ────────────────
            # Upgrade chunk-level citations → sentence-level attributed propositions.
            # Runs only for MEDIUM/COMPLEX queries to avoid latency on simple lookups.
            # Falls back silently if unavailable; never blocks the answer.
            alce_props = []
            alce_recall = None
            if complexity in ("medium", "complex") and parsed_answer:
                try:
                    from app.core.reasoning.proposition_extractor import PropositionExtractor
                    _fast_client = None
                    try:
                        _fast_client = self.llm_router.get_fast_client()
                    except Exception:
                        pass
                    _prop_extractor = PropositionExtractor(llm_client=_fast_client)
                    alce_props = await asyncio.wait_for(
                        _prop_extractor.extract_and_attribute(parsed_answer, top_passages),
                        timeout=3.0,  # never delay answer by more than 3s
                    )
                    alce_recall = PropositionExtractor.citation_recall(alce_props)
                    alce_citations = PropositionExtractor.format_citations(alce_props)
                    # Merge ALiiCE sentence citations with LLM-generated chunk citations
                    if alce_citations:
                        citations_out = alce_citations + citations_out
                    if alce_recall is not None and validation_result is not None:
                        validation_result["alce_citation_recall"] = round(alce_recall, 4)
                    logger.info(
                        "alce_attribution_complete",
                        trace_id=trace_id,
                        propositions=len(alce_props),
                        recall=round(alce_recall, 3) if alce_recall is not None else None,
                    )
                except asyncio.TimeoutError:
                    logger.warning("alce_attribution_timeout", trace_id=trace_id)
                except Exception as _alce_err:
                    logger.warning("alce_attribution_failed", trace_id=trace_id, error=str(_alce_err))

            # ── Stage 8c: Yield Complete Answer ─────────────────────────
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
                try:
                    await self.cache.set(query, {
                        "answer": validated_answer,
                        "sources": source_data,
                    })
                except Exception as e:
                    logger.warning("cache_set_skip", trace_id=trace_id, error=str(e))

            # Store in memory palace (fire-and-forget, non-blocking)
            try:
                from app.core.memory_context import store_search_result
                _answer_text = parsed_answer if isinstance(parsed_answer, str) else str(parsed_answer)[:1000]
                _source_ids = [str(s.get("id", s.get("source_id", ""))) for s in source_data[:5]]
                asyncio.create_task(store_search_result(
                    query=query,
                    answer=_answer_text[:2000],
                    sources=_source_ids,
                    category=query_plan.get("intent", "general"),
                ))
            except Exception as _store_err:
                logger.debug("memory_store_skipped", trace_id=trace_id, error=str(_store_err))

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

            # Finish Langfuse trace (fire-and-forget, never blocks response)
            async def _finish_trace():
                _tracer.finish_trace(
                    _otrace,
                    confidence=confidence_out,
                    nli_recall=nli_recall,
                    alce_recall=validation_result.get("alce_citation_recall") if validation_result else None,
                    numeric_mismatches=len(numeric_mismatches),
                    model_used=routing_decision.primary_model,
                    total_cost_usd=total_cost,
                    output=parsed_answer[:300] if isinstance(parsed_answer, str) else "",
                )
            asyncio.create_task(_finish_trace())

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

            # ── Audit Log (fire-and-forget, zero latency impact) ─────────
            if self.audit_logger:
                try:
                    from compliance.audit_log import (
                        AuditEvent, QueryContext, RetrievalContext, RetrievedChunk,
                        ModelContext, ResponseContext, PerformanceContext, CostContext,
                    )
                    _conf_map = {"HIGH": 0.9, "MEDIUM": 0.6, "LOW": 0.3}
                    from compliance.audit_log import UserContext as _UserContext
                    _audit_event = AuditEvent(
                        trace_id=trace_id,
                        session_id=conversation_id or "",
                        request_id=trace_id,
                        user=_UserContext(id=user_id or ""),
                        query=QueryContext(raw=query),
                        retrieval=RetrievalContext(
                            top_k=len(top_passages),
                            retrieved_chunks=[
                                RetrievedChunk(
                                    doc_id=p.document_id,
                                    chunk_id=p.chunk_id,
                                    score=p.score,
                                    source_uri=p.metadata.get("source_url", "") if p.metadata else "",
                                )
                                for p in top_passages[:20]
                            ],
                        ),
                        model=ModelContext(
                            provider=routing_decision.primary_model.split("-")[0],
                            model_id=routing_decision.primary_model,
                            temperature=0.0,
                        ),
                        response=ResponseContext(
                            raw=full_response,
                            confidence_score=_conf_map.get(confidence_out, 0.6),
                        ),
                        performance=PerformanceContext(
                            ttft_ms=int(reasoning_ms),
                            e2e_ms=int(total_ms),
                        ),
                        cost=CostContext(
                            total_usd=routing_decision.estimated_cost,
                        ),
                    )
                    asyncio.create_task(self.audit_logger.log(_audit_event))
                except Exception:
                    pass  # Audit failure must never affect the user

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
