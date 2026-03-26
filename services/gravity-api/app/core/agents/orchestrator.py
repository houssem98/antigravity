"""
Gravity Search — Agent Orchestrator
Central coordinator that runs the Planner → Reader → Extractor → Critic → Writer loop.

Flow:
  1. Planner decomposes query → N sub-tasks
  2. Reader retrieves passages for each sub-task (parallel)
  3. Extractor pulls structured facts
  4. Critic evaluates quality
  5. If quality < threshold AND retries remain → Planner._replan() → back to 2
  6. Writer synthesizes final answer
  7. Yields SearchEvent at each stage for progress streaming
"""

from __future__ import annotations

import time
from dataclasses import asdict
from typing import AsyncIterator

import structlog

from app.core.agents.agent_base import AgentContext
from app.core.agents.planner_agent import PlannerAgent
from app.core.agents.reader_agent import ReaderAgent
from app.core.agents.extractor_agent import ExtractorAgent
from app.core.agents.critic_agent import CriticAgent
from app.core.agents.verifier_agent import VerifierAgent
from app.core.agents.writer_agent import WriterAgent
from app.core.search_pipeline import SearchEvent
from app.llm.base import BaseLLMClient
from app.llm.router import LLMRouter

logger = structlog.get_logger()


class AgentOrchestrator:
    """
    Runs the full multi-agent pipeline:
      Planner → Reader → Extractor → Critic [→ loop] → Writer

    Yields SearchEvent objects for real-time streaming to the client.
    """

    def __init__(
        self,
        llm_router: LLMRouter,
        retrieval_orchestrator,
        reranker,
        query_understander,
        semantic_cache,
    ):
        self.llm_router = llm_router
        self.retrieval = retrieval_orchestrator
        self.reranker = reranker
        self.query_understander = query_understander
        self.cache = semantic_cache

    async def run(
        self,
        query: str,
        query_plan: dict,
        trace_id: str,
        stream: bool = True,
    ) -> AsyncIterator[SearchEvent]:
        """
        Execute the full agent pipeline, yielding events at each stage.

        Args:
            query: The original user query
            query_plan: Output from QueryUnderstanding.analyze()
            trace_id: Unique trace ID for this search
            stream: If True, stream Writer output token-by-token
        """
        start = time.perf_counter()

        # Get an LLM client for the agents
        client, routing = await self.llm_router.route(query)

        # Initialize shared context
        ctx = AgentContext(
            query=query,
            query_plan=query_plan,
            trace_id=trace_id,
        )

        # Create agents
        planner = PlannerAgent(llm=client)
        reader = ReaderAgent(
            retrieval_orchestrator=self.retrieval,
            reranker=self.reranker,
        )
        extractor = ExtractorAgent(llm=client)
        critic = CriticAgent(llm=client)
        verifier = VerifierAgent(llm=client)
        writer = WriterAgent(llm=client)

        # ── Agent Loop ──────────────────────────────────────────────────

        while True:
            iteration = ctx.iteration

            # 1. Planner
            yield SearchEvent(
                type="agent_trace",
                data={
                    "agent": "Planner",
                    "action": "replanning" if iteration > 0 else "decomposing",
                    "detail": f"Iteration {iteration + 1}",
                    "iteration": iteration,
                },
                trace_id=trace_id,
            )
            yield SearchEvent(
                type="status",
                data={
                    "status": "planning",
                    "message": (
                        "Refining research plan..."
                        if iteration > 0
                        else "Decomposing query into sub-tasks..."
                    ),
                },
                trace_id=trace_id,
            )
            ctx = await planner.execute(ctx)

            # 2. Reader (parallel retrieval)
            yield SearchEvent(
                type="agent_trace",
                data={
                    "agent": "Reader",
                    "action": "retrieving",
                    "detail": f"{len(ctx.sub_tasks)} sub-tasks",
                    "iteration": iteration,
                },
                trace_id=trace_id,
            )
            yield SearchEvent(
                type="status",
                data={
                    "status": "searching",
                    "message": f"Retrieving sources for {len(ctx.sub_tasks)} sub-tasks...",
                },
                trace_id=trace_id,
            )
            ctx = await reader.execute(ctx)

            # Yield sources early for progressive rendering
            source_data = self._build_source_data(ctx)
            if source_data:
                yield SearchEvent(
                    type="sources",
                    data={"sources": source_data},
                    trace_id=trace_id,
                )

            # 3. Extractor
            yield SearchEvent(
                type="agent_trace",
                data={
                    "agent": "Extractor",
                    "action": "extracting",
                    "detail": f"Processing passages from {len(ctx.sub_tasks)} sub-tasks",
                    "iteration": iteration,
                },
                trace_id=trace_id,
            )
            yield SearchEvent(
                type="status",
                data={
                    "status": "extracting",
                    "message": "Extracting structured data from sources...",
                },
                trace_id=trace_id,
            )
            ctx = await extractor.execute(ctx)

            # Snapshot fact fingerprint for dead-end detection (before Critic evaluates)
            # Research: CoRAG — "stop if iteration N = iteration N-1 facts"
            ctx._prev_fact_fingerprint = frozenset(  # type: ignore[attr-defined]
                (f.get("metric", ""), str(f.get("value", "")), f.get("period", ""))
                for f in ctx.extracted_facts
            )

            # 4. Critic
            yield SearchEvent(
                type="agent_trace",
                data={
                    "agent": "Critic",
                    "action": "evaluating",
                    "detail": f"{len(ctx.extracted_facts)} facts to evaluate",
                    "iteration": iteration,
                },
                trace_id=trace_id,
            )
            yield SearchEvent(
                type="status",
                data={
                    "status": "evaluating",
                    "message": "Evaluating research quality...",
                },
                trace_id=trace_id,
            )
            ctx = await critic.execute(ctx)

            # Yield critic result
            if ctx.critic_feedback:
                yield SearchEvent(
                    type="agent_trace",
                    data={
                        "agent": "Critic",
                        "action": "verdict",
                        "detail": (
                            f"Quality: {ctx.critic_feedback.quality_score:.2f} — "
                            f"{'✅ Sufficient' if ctx.critic_feedback.is_sufficient else '🔄 Retry'}"
                        ),
                        "iteration": iteration,
                        "quality_score": ctx.critic_feedback.quality_score,
                    },
                    trace_id=trace_id,
                )

            # Check loop condition
            if ctx.critic_feedback and ctx.critic_feedback.is_sufficient:
                break

            # Prepare for next iteration
            ctx.iteration += 1

        # ── 5. Verifier (Fin-R1 arithmetic check) ───────────────────────

        if ctx.extracted_facts:
            yield SearchEvent(
                type="agent_trace",
                data={
                    "agent": "Verifier",
                    "action": "verifying",
                    "detail": f"Cross-checking {sum(1 for f in ctx.extracted_facts if f.get('value'))} numerical claims",
                    "iteration": ctx.iteration,
                },
                trace_id=trace_id,
            )
            yield SearchEvent(
                type="status",
                data={
                    "status": "verifying",
                    "message": "Verifying numerical accuracy...",
                },
                trace_id=trace_id,
            )
            ctx = await verifier.execute(ctx)

            # Yield verification result
            if ctx.verification_results:
                yield SearchEvent(
                    type="agent_trace",
                    data={
                        "agent": "Verifier",
                        "action": "verdict",
                        "detail": (
                            f"Checked: {ctx.verification_results.get('total_checked', 0)} facts | "
                            f"Verified: {ctx.verification_results.get('verified_count', 0)} | "
                            f"Warnings: {ctx.verification_results.get('warning_count', 0)}"
                        ),
                        "iteration": ctx.iteration,
                    },
                    trace_id=trace_id,
                )

        # ── 5. Writer ───────────────────────────────────────────────────

        yield SearchEvent(
            type="agent_trace",
            data={
                "agent": "Writer",
                "action": "synthesizing",
                "detail": f"{len(ctx.extracted_facts)} facts → final answer",
                "iteration": ctx.iteration,
            },
            trace_id=trace_id,
        )
        yield SearchEvent(
            type="status",
            data={
                "status": "reasoning",
                "message": "Synthesizing final answer...",
            },
            trace_id=trace_id,
        )

        if stream:
            # Stream tokens
            async for token in writer.execute_streaming(ctx):
                yield SearchEvent(
                    type="token",
                    data={"token": token},
                    trace_id=trace_id,
                )
        else:
            ctx = await writer.execute(ctx)

        # ── Final Events ────────────────────────────────────────────────

        # Complete answer
        yield SearchEvent(
            type="answer",
            data={
                "answer": ctx.final_answer,
                "model_used": routing.primary_model,
                "confidence": ctx.critic_feedback.quality_score if ctx.critic_feedback else 0.5,
                "structured_data": ctx.structured_data,
                "citations": ctx.final_citations,
                "chart_specs": getattr(ctx, "chart_specs", []),
            },
            trace_id=trace_id,
        )

        # Structured table data
        if ctx.structured_data:
            yield SearchEvent(
                type="structured_table",
                data={"rows": ctx.structured_data},
                trace_id=trace_id,
            )

        # Full agent trace
        yield SearchEvent(
            type="agent_trace_complete",
            data={
                "trace_log": [
                    {
                        "agent": t.agent,
                        "action": t.action,
                        "detail": t.detail,
                        "duration_ms": t.duration_ms,
                        "iteration": t.iteration,
                    }
                    for t in ctx.trace_log
                ],
                "total_iterations": ctx.iteration + 1,
                "total_cost_usd": round(ctx.total_cost_usd, 6),
            },
            trace_id=trace_id,
        )

        # Metadata
        total_ms = (time.perf_counter() - start) * 1000
        yield SearchEvent(
            type="metadata",
            data={
                "trace_id": trace_id,
                "latency_ms": round(total_ms, 1),
                "model_used": routing.primary_model,
                "complexity": routing.complexity.value,
                "estimated_cost_usd": round(ctx.total_cost_usd, 6),
                "retrieval_channels": list(
                    set(
                        ch
                        for passages in ctx.retrieved_passages.values()
                        for p in passages
                        for ch in (p.source_channels if hasattr(p, "source_channels") else [])
                    )
                ),
                "passages_used": sum(len(v) for v in ctx.retrieved_passages.values()),
                "sub_tasks": len(ctx.sub_tasks),
                "iterations": ctx.iteration + 1,
                "facts_extracted": len(ctx.extracted_facts),
                "cache_hit": False,
                "pipeline_mode": "agentic",
            },
            trace_id=trace_id,
        )

    def _build_source_data(self, ctx: AgentContext) -> list[dict]:
        """Build source data for progressive rendering."""
        sources = []
        src_idx = 1
        seen_chunks = set()
        for st in ctx.sub_tasks:
            for p in ctx.retrieved_passages.get(st.id, []):
                if p.chunk_id in seen_chunks:
                    continue
                seen_chunks.add(p.chunk_id)
                sources.append({
                    "id": f"src_{src_idx}",
                    "chunk_id": p.chunk_id,
                    "title": p.document_title,
                    "section": p.section,
                    "text": p.text[:500],
                    "ticker": p.ticker,
                    "date": p.filing_date,
                    "score": round(p.rrf_score, 4) if hasattr(p, "rrf_score") else 0,
                    "channels": p.source_channels if hasattr(p, "source_channels") else [],
                    "sub_task": st.question,
                })
                src_idx += 1
        return sources
