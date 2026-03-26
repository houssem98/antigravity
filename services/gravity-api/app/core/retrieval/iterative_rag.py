"""
Gravity Search — CoRAG: Chain-of-Retrieval Augmented Generation
Based on: "Chain-of-Retrieval Augmented Generation" (arXiv 2501.14342, Jan 2025)
and IRCoT (Interleaved Retrieval + Chain-of-Thought).

Key idea: Instead of one-shot retrieval → generate, we interleave retrieval steps
with reasoning steps. Each reasoning step can discover what's missing and trigger
a new targeted retrieval query. This is critical for multi-hop financial queries
like "Compare TSMC CapEx guidance with Samsung's, and explain the divergence."

Gains vs. single-pass RAG: +15-25% on multi-hop QA (HotpotQA 94.5% with GPT-4o-mini)

How it works:
  Step 1: Retrieve on original query → reason over results → identify gaps
  Step 2: Generate follow-up retrieval query based on gaps → retrieve → reason
  Step 3: Repeat until sufficient coverage or max_steps reached
  Step 4: Return all collected passages for final synthesis

Integration: Used in fast-path pipeline for MEDIUM/COMPLEX queries before
the main LLM generation step, instead of single-pass retrieval.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import AsyncIterator

import structlog

from app.core.retrieval.fusion import RetrievalResult, reciprocal_rank_fusion
from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage

logger = structlog.get_logger()

# Maximum retrieval iterations (beyond first pass)
_MAX_STEPS = 3
# Minimum new unique passages required to continue iterating
_MIN_NEW_PASSAGES = 2
# Fast model for gap detection (cheap, Haiku-level)
_GAP_DETECTION_SYSTEM = """You are a financial research gap detector.
Given a query and retrieved passages, identify what key information is STILL MISSING
to fully answer the query. Be specific and concise.

Respond with JSON only:
{
  "gaps": ["specific missing fact 1", "specific missing fact 2"],
  "follow_up_queries": ["targeted retrieval query 1", "targeted retrieval query 2"],
  "is_sufficient": true/false
}

Rules:
- If all key information is present, set is_sufficient=true and leave gaps empty.
- follow_up_queries must be specific enough to find the missing data.
- Focus on financial metrics, dates, company names that are absent.
- Max 2 follow-up queries per step.
"""


@dataclass
class IterativeRAGResult:
    """Aggregated output from iterative retrieval."""
    all_passages: list[RetrievalResult] = field(default_factory=list)
    retrieval_steps: int = 0
    gaps_found: list[str] = field(default_factory=list)
    total_latency_ms: float = 0.0
    cost_usd: float = 0.0


class IterativeRAG:
    """
    CoRAG-style iterative retrieval.

    Interleaves retrieval and reasoning steps to close information gaps.
    Designed for MEDIUM and COMPLEX queries in the fast-path pipeline.

    Usage:
        irag = IterativeRAG(llm_client, retrieval_orchestrator, reranker)
        result = await irag.retrieve(query, query_plan, filters)
        # result.all_passages contains deduplicated passages from all steps
    """

    def __init__(
        self,
        llm: BaseLLMClient,
        retrieval_orchestrator,
        reranker,
        max_steps: int = _MAX_STEPS,
    ):
        self.llm = llm
        self.retrieval = retrieval_orchestrator
        self.reranker = reranker
        self.max_steps = max_steps

    async def retrieve(
        self,
        query: str,
        query_plan: dict,
        filters: dict | None = None,
        channels: list[str] | None = None,
    ) -> IterativeRAGResult:
        """
        Run iterative retrieval until sufficient coverage or max_steps reached.

        Args:
            query: Original user query
            query_plan: Output from QueryUnderstanding
            filters: Retrieval filters (tickers, date_range, etc.)
            channels: Which retrieval channels to use

        Returns:
            IterativeRAGResult with all deduplicated passages from all steps
        """
        t0 = time.perf_counter()
        result = IterativeRAGResult()
        seen_chunk_ids: set[str] = set()
        channels = channels or query_plan.get("retrieval_channels", ["dense", "bm25"])

        # Step 1: Initial retrieval on original query
        step_passages = await self._run_retrieval(
            query=query,
            filters=filters or {},
            channels=channels,
            expanded_terms=query_plan.get("expanded_terms", {}),
        )
        new_passages = self._add_unique(step_passages, seen_chunk_ids, result.all_passages)
        result.retrieval_steps = 1

        logger.info(
            "iterative_rag_step",
            step=1,
            query=query[:80],
            new_passages=len(new_passages),
        )

        # Steps 2-N: Gap-driven follow-up retrieval
        current_query = query
        for step in range(2, self.max_steps + 1):
            if len(result.all_passages) == 0:
                break

            # Detect gaps using fast LLM
            gap_result = await self._detect_gaps(
                original_query=query,
                current_query=current_query,
                passages=result.all_passages[:10],  # Top 10 suffice for gap detection
            )
            result.cost_usd += gap_result["cost_usd"]

            if gap_result["is_sufficient"]:
                logger.info("iterative_rag_sufficient", step=step)
                break

            result.gaps_found.extend(gap_result["gaps"])
            follow_up_queries = gap_result["follow_up_queries"]

            if not follow_up_queries:
                break

            # Retrieve for each follow-up query in parallel
            step_results = await asyncio.gather(
                *[
                    self._run_retrieval(
                        query=fq,
                        filters=filters or {},
                        channels=channels,
                        expanded_terms={},
                    )
                    for fq in follow_up_queries
                ],
                return_exceptions=True,
            )

            total_new = 0
            for step_result in step_results:
                if isinstance(step_result, Exception):
                    logger.warning("iterative_rag_step_error", error=str(step_result))
                    continue
                new = self._add_unique(step_result, seen_chunk_ids, result.all_passages)
                total_new += len(new)

            result.retrieval_steps = step
            current_query = follow_up_queries[0] if follow_up_queries else query

            logger.info(
                "iterative_rag_step",
                step=step,
                follow_up_queries=follow_up_queries,
                new_passages=total_new,
            )

            # Stop if no new information found
            if total_new < _MIN_NEW_PASSAGES:
                logger.info("iterative_rag_no_new_info", step=step)
                break

        result.total_latency_ms = (time.perf_counter() - t0) * 1000

        logger.info(
            "iterative_rag_complete",
            total_passages=len(result.all_passages),
            steps=result.retrieval_steps,
            gaps=len(result.gaps_found),
            latency_ms=round(result.total_latency_ms, 1),
            cost_usd=round(result.cost_usd, 6),
        )

        return result

    async def _run_retrieval(
        self,
        query: str,
        filters: dict,
        channels: list[str],
        expanded_terms: dict,
    ) -> list[RetrievalResult]:
        """Run retrieval + RRF fusion + reranking for a single query."""
        from app.config import settings

        raw_results = await self.retrieval.search(
            query=query,
            expanded_terms=expanded_terms,
            filters=filters,
            channels=channels,
        )

        fused = reciprocal_rank_fusion(raw_results, k=settings.rrf_k)

        if self.reranker and fused:
            reranked = await self.reranker.rerank(
                query=query,
                passages=fused[:settings.rerank_top_k],
            )
            return reranked[:settings.max_context_passages]

        return fused[:settings.max_context_passages]

    async def _detect_gaps(
        self,
        original_query: str,
        current_query: str,
        passages: list[RetrievalResult],
    ) -> dict:
        """Use fast LLM to identify what's still missing."""
        passages_text = "\n\n".join(
            f"[Source {i+1}] {p.document_title} — {p.section}\n{p.text[:300]}"
            for i, p in enumerate(passages)
        )

        user_content = (
            f"Original query: {original_query}\n\n"
            f"Retrieved passages:\n{passages_text}\n\n"
            "What key information is still missing to fully answer the query?"
        )

        try:
            response = await self.llm.generate(
                messages=[
                    LLMMessage(role="system", content=_GAP_DETECTION_SYSTEM),
                    LLMMessage(role="user", content=user_content),
                ],
                config=LLMConfig(temperature=0.0, max_tokens=400, json_mode=True),
            )

            import json
            parsed = json.loads(response.content)
            return {
                "gaps": parsed.get("gaps", []),
                "follow_up_queries": parsed.get("follow_up_queries", [])[:2],
                "is_sufficient": parsed.get("is_sufficient", False),
                "cost_usd": response.cost_usd,
            }
        except Exception as e:
            logger.warning("iterative_rag_gap_detection_failed", error=str(e))
            return {"gaps": [], "follow_up_queries": [], "is_sufficient": True, "cost_usd": 0.0}

    @staticmethod
    def _add_unique(
        new_passages: list[RetrievalResult],
        seen_ids: set[str],
        target: list[RetrievalResult],
    ) -> list[RetrievalResult]:
        """Add passages not already seen, return list of actually-new passages."""
        added = []
        for p in new_passages:
            if p.chunk_id not in seen_ids:
                seen_ids.add(p.chunk_id)
                target.append(p)
                added.append(p)
        return added
