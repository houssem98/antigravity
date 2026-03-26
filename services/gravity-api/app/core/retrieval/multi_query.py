"""
Multi-Query Retrieval
=====================
Generate N rephrasings of the user query, retrieve independently for each,
then merge with deduplication before RRF fusion.

Why it works:
  A single phrasing is sensitive to exact word choice.  "CapEx guidance"
  misses documents indexed as "capital expenditure forecast".  Generating
  variants covers the vocabulary distribution and yields +10–20% recall.

Reference: RAG-Fusion (Rackauckas, 2023); Multi-Query Retriever (LangChain).

Usage:
    mq = MultiQueryRetriever(llm_client=gemini_flash, dense_search=dense_search)
    results = await mq.search(query="What was TSMC CapEx FY2025?", filters=filters)
"""

from __future__ import annotations

import asyncio
import structlog

from app.llm.base import LLMConfig, LLMMessage
from app.core.retrieval.fusion import RetrievalResult

logger = structlog.get_logger()

_VARIANT_PROMPT = """\
You are an expert financial research assistant helping improve document retrieval.

Generate {n} alternative phrasings of the following financial query.
Each variant should:
- Use different financial terminology (synonyms, abbreviations, acronyms)
- Keep the same meaning and time period
- Be a complete, standalone query

Output ONLY a JSON array of strings. No explanation.

Original query: {query}

Variants:"""


class MultiQueryRetriever:
    """
    Expand a single query into N variants, retrieve independently, merge results.
    """

    def __init__(self, llm_client, dense_search, n_variants: int = 4):
        self.llm = llm_client
        self.dense = dense_search
        self.n = n_variants

    async def _generate_variants(self, query: str) -> list[str]:
        """Generate N alternative phrasings of the query."""
        try:
            import json
            response = await self.llm.generate(
                messages=[LLMMessage(
                    role="user",
                    content=_VARIANT_PROMPT.format(n=self.n, query=query),
                )],
                config=LLMConfig(temperature=0.4, max_tokens=300, json_mode=True),
            )
            variants = json.loads(response.content)
            if isinstance(variants, list):
                # Include the original query too
                all_queries = [query] + [str(v) for v in variants[:self.n]]
                logger.debug("multi_query_variants", count=len(all_queries))
                return all_queries
        except Exception as e:
            logger.warning("multi_query_variant_failed", error=str(e))
        return [query]

    async def search(
        self,
        query: str,
        filters: dict | None = None,
        top_k_per_variant: int = 20,
    ) -> list[RetrievalResult]:
        """
        Retrieve across all query variants and merge with deduplication.

        Returns a merged list of unique RetrievalResult objects, keeping the
        highest score for each chunk_id across all variants.
        """
        variants = await self._generate_variants(query)

        # Search all variants in parallel
        tasks = [
            self.dense.search(query=v, filters=filters, top_k=top_k_per_variant, use_hyde=True)
            for v in variants
        ]
        all_results: list[list[RetrievalResult]] = await asyncio.gather(*tasks, return_exceptions=True)

        # Deduplicate: keep highest-score version of each chunk_id
        seen: dict[str, RetrievalResult] = {}
        for batch in all_results:
            if isinstance(batch, Exception):
                continue
            for result in batch:
                cid = result.chunk_id
                if cid not in seen or result.score > seen[cid].score:
                    seen[cid] = result

        merged = list(seen.values())
        # Sort by original score descending
        merged.sort(key=lambda r: r.score, reverse=True)

        logger.info(
            "multi_query_merged",
            variants=len(variants),
            total_retrieved=sum(len(b) for b in all_results if not isinstance(b, Exception)),
            unique_chunks=len(merged),
        )
        return merged
