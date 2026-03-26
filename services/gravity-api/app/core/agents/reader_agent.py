"""
Gravity Search — Reader Agent
Retrieves and reads sources for each sub-task in parallel.

Uses the existing RetrievalOrchestrator (dense/BM25/SPLADE/graph/structured)
and CohereReranker — no new retrieval infra needed.

Key enhancement over single-pass: runs one retrieval per sub-task, so a
"Compare NVIDIA vs AMD" query retrieves for each company independently.
"""

from __future__ import annotations

import asyncio
import time
import structlog

from app.core.agents.agent_base import BaseAgent, AgentContext, SubTask
from app.core.retrieval.fusion import RetrievalResult, reciprocal_rank_fusion
from app.config import settings

logger = structlog.get_logger()


class ReaderAgent(BaseAgent):
    """Retrieves relevant passages for each sub-task."""

    name = "Reader"

    def __init__(self, retrieval_orchestrator, reranker):
        self.retrieval = retrieval_orchestrator
        self.reranker = reranker

    async def execute(self, ctx: AgentContext) -> AgentContext:
        """Run retrieval for all sub-tasks in parallel."""
        t0 = time.perf_counter()

        # Only retrieve for sub-tasks we haven't retrieved yet
        tasks_to_process = [
            st for st in ctx.sub_tasks
            if st.id not in ctx.retrieved_passages
        ]

        if not tasks_to_process:
            ctx.add_trace(self.name, "skip", "All sub-tasks already have passages")
            return ctx

        # Run all retrievals in parallel
        results = await asyncio.gather(
            *[self._retrieve_for_subtask(ctx, st) for st in tasks_to_process],
            return_exceptions=True,
        )

        # Collect results
        total_passages = 0
        for st, result in zip(tasks_to_process, results):
            if isinstance(result, Exception):
                logger.warning("reader_subtask_failed", subtask=st.id, error=str(result))
                ctx.retrieved_passages[st.id] = []
            else:
                ctx.retrieved_passages[st.id] = result
                total_passages += len(result)

        elapsed = (time.perf_counter() - t0) * 1000
        ctx.add_trace(
            self.name, "retrieved",
            f"{total_passages} passages for {len(tasks_to_process)} sub-tasks",
            duration_ms=elapsed,
        )
        return ctx

    async def _retrieve_for_subtask(
        self, ctx: AgentContext, sub_task: SubTask
    ) -> list[RetrievalResult]:
        """
        Retrieve and rerank passages for a single sub-task.
        Includes fallback retrieval strategy if primary returns 0 passages.
        Based on: Agentic RAG (arXiv 2602.03442) — fallback channel rotation.
        """

        # Build filters from sub-task targets
        filters: dict = {}
        if sub_task.target_companies:
            filters["tickers"] = sub_task.target_companies

        # Determine which channels to use
        if sub_task.retrieval_strategy == "all":
            channels = ctx.query_plan.get("retrieval_channels", ["dense", "bm25", "splade"])
        else:
            channels = [sub_task.retrieval_strategy]
            # Always include dense as baseline
            if "dense" not in channels:
                channels.append("dense")

        # Primary retrieval attempt
        result = await self._run_single_retrieval(
            query=sub_task.question,
            filters=filters,
            channels=channels,
            expanded_terms=ctx.query_plan.get("expanded_terms", {}),
        )

        # ── Fallback: if primary returned nothing, rotate through strategies ──
        # Research: Agentic RAG + CoRAG — retry with different channel if empty
        if len(result) == 0 and sub_task.priority == 1:
            logger.info(
                "reader_fallback_triggered",
                subtask_id=sub_task.id,
                original_strategy=sub_task.retrieval_strategy,
            )

            # Fallback strategy rotation: structured → bm25 → dense+graph → all
            _FALLBACK_CHAINS: dict[str, list[list[str]]] = {
                "dense":      [["bm25", "dense"], ["structured"], ["dense", "bm25", "splade"]],
                "bm25":       [["dense", "bm25"], ["structured"], ["dense", "bm25", "splade"]],
                "structured": [["dense", "bm25"], ["splade", "dense"], ["dense", "bm25", "splade"]],
                "graph":      [["dense", "bm25"], ["splade"], ["dense", "bm25", "splade"]],
                "splade":     [["dense", "bm25"], ["structured"], ["dense", "bm25", "splade"]],
                "all":        [["bm25"], ["structured"], ["dense"]],
            }
            fallback_chains = _FALLBACK_CHAINS.get(
                sub_task.retrieval_strategy, [["dense", "bm25"], ["bm25", "splade"]]
            )

            for fallback_channels in fallback_chains:
                result = await self._run_single_retrieval(
                    query=sub_task.question,
                    filters=filters,
                    channels=fallback_channels,
                    expanded_terms=ctx.query_plan.get("expanded_terms", {}),
                )
                if result:
                    logger.info(
                        "reader_fallback_succeeded",
                        subtask_id=sub_task.id,
                        fallback_channels=fallback_channels,
                        passages_found=len(result),
                    )
                    break

            # Last resort: broaden filters (remove ticker constraint)
            if len(result) == 0 and filters:
                logger.info(
                    "reader_fallback_broad_search",
                    subtask_id=sub_task.id,
                )
                result = await self._run_single_retrieval(
                    query=sub_task.question,
                    filters={},  # Remove all filters
                    channels=["dense", "bm25"],
                    expanded_terms=ctx.query_plan.get("expanded_terms", {}),
                )

        return result

    async def _run_single_retrieval(
        self,
        query: str,
        filters: dict,
        channels: list[str],
        expanded_terms: dict,
    ) -> list[RetrievalResult]:
        """Execute retrieval + fusion + reranking for one query/channel set."""
        retrieval_results = await self.retrieval.search(
            query=query,
            expanded_terms=expanded_terms,
            filters=filters,
            channels=channels,
        )

        fused = reciprocal_rank_fusion(retrieval_results, k=settings.rrf_k)

        if self.reranker and len(fused) > 0:
            reranked = await self.reranker.rerank(
                query=query,
                passages=fused[:settings.rerank_top_k],
            )
        else:
            reranked = fused

        return reranked[:settings.max_context_passages]
