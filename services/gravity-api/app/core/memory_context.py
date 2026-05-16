"""
Memory-augmented search context builder.

Injects previous query/answer pairs + codebase patterns into search context
for improved LLM routing and answer generation.

Usage in search_pipeline.py:
    from app.core.memory_context import augment_context_with_memory

    context = await augment_context_with_memory(
        query=user_query,
        max_memory_results=3
    )
    # Inject into system prompt
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


async def augment_context_with_memory(
    query: str,
    max_memory_results: int = 3,
) -> str:
    """
    Augment search context with semantic matches from memory palace.

    Returns formatted context string ready for injection into system prompt.
    Gracefully degrades if palace unavailable.
    """
    try:
        from app.memory.mempalace_client import MemPalaceClient

        palace = MemPalaceClient()
        if not palace.is_initialized():
            logger.debug("Palace not initialized, skipping memory augmentation")
            return ""

        # Search for similar past queries
        results = await palace.search(
            query=query,
            limit=max_memory_results,
            wing="gravity-api",
        )

        if not results:
            return ""

        # Format as context block
        context_lines = ["## Past Similar Queries"]
        for result in results:
            context_lines.append(f"- {result.get('text', '')[:200]}...")

        return "\n".join(context_lines)

    except Exception as e:
        logger.debug(f"Memory augmentation failed (graceful): {e}")
        return ""


async def store_search_result(
    query: str,
    answer: str,
    sources: list[str],
    category: Optional[str] = None,
) -> None:
    """Store query/answer pair for future context retrieval."""
    try:
        from app.memory.mempalace_client import MemPalaceClient

        palace = MemPalaceClient()
        await palace.store_query(
            query=query,
            answer=answer,
            sources=sources,
            category=category or "general",
        )
        logger.debug(f"Stored query in memory: {query[:50]}...")

    except Exception as e:
        logger.debug(f"Memory storage failed (non-blocking): {e}")
