"""
MemPalace integration for gravity-api.

Provides semantic search over:
- Query/answer pairs (conversation memory)
- Codebase (architecture + patterns)
- Search results (past relevant findings)

Usage:
    from app.memory.mempalace_client import MemPalaceClient
    palace = MemPalaceClient()
    results = await palace.search("how does RAG fusion work", limit=3)
"""

import asyncio
import os
from pathlib import Path
from typing import Optional

try:
    from mempalace import Palace
except ImportError:
    Palace = None


class MemPalaceClient:
    """Async wrapper around MemPalace for gravity-api context retrieval."""

    def __init__(self, palace_path: Optional[str] = None):
        if Palace is None:
            raise ImportError("mempalace not installed. pip install mempalace")

        self.palace_path = Path(palace_path or os.environ.get(
            "MEMPALACE_PATH",
            Path.home() / ".mempalace" / "antigravity"
        ))
        self.palace = Palace(self.palace_path)

    async def search(
        self,
        query: str,
        limit: int = 5,
        wing: Optional[str] = None,
        room: Optional[str] = None,
    ) -> list[dict]:
        """
        Semantic search across the palace.

        Args:
            query: Search query
            limit: Max results
            wing: Filter by wing (e.g., 'gravity-api', 'market-ui')
            room: Filter by room (e.g., 'rag-pipeline', 'retrieval')

        Returns:
            List of {text, metadata, score} dicts
        """
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None,
            lambda: self.palace.search(
                query=query,
                limit=limit,
                filters={"wing": wing} if wing else {},
            ),
        )
        return results or []

    async def store_query(
        self,
        query: str,
        answer: str,
        sources: list[str],
        category: Optional[str] = None,
    ) -> None:
        """Store query/answer pair in palace for future context."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: self.palace.add(
                text=f"Q: {query}\n\nA: {answer}\n\nSources: {', '.join(sources)}",
                metadata={
                    "type": "query_answer",
                    "wing": "gravity-api",
                    "room": category or "general",
                    "query": query,
                },
            ),
        )

    def is_initialized(self) -> bool:
        """Check if palace is initialized."""
        return self.palace_path.exists()

    @staticmethod
    def initialize_palace(palace_path: Optional[str] = None) -> None:
        """Initialize palace and mine antigravity codebase."""
        if Palace is None:
            raise ImportError("mempalace not installed")

        palace = Palace(palace_path or Path.home() / ".mempalace" / "antigravity")
        # Initialization happens on first write
        print(f"Palace initialized at: {palace.path}")
