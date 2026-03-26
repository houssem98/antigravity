"""
PageIndex Indexer — Redis Storage for Document Tree Structures
==============================================================
Stores and loads PageIndex objects in Redis for fast retrieval.
TTL: 24 hours (documents don't change; re-built on ingest).
"""

import json
import structlog
from app.ingestion.processing.page_index import PageIndex

logger = structlog.get_logger()

_REDIS_PREFIX = "page_index:"
_DEFAULT_TTL = 86400  # 24 hours


class PageIndexIndexer:
    """Store and load PageIndex objects via Redis."""

    def __init__(self, redis_client):
        self.redis = redis_client

    async def store(self, document_id: str, index: PageIndex, ttl: int = _DEFAULT_TTL) -> bool:
        """Serialize and store a PageIndex in Redis."""
        try:
            key = f"{_REDIS_PREFIX}{document_id}"
            data = json.dumps(index.to_dict(), ensure_ascii=False)
            await self.redis.setex(key, ttl, data)
            logger.info("page_index_stored", document_id=document_id, nodes=len(index.nodes))
            return True
        except Exception as e:
            logger.warning("page_index_store_failed", document_id=document_id, error=str(e))
            return False

    async def load(self, document_id: str) -> PageIndex | None:
        """Load a PageIndex from Redis. Returns None if not found."""
        try:
            key = f"{_REDIS_PREFIX}{document_id}"
            raw = await self.redis.get(key)
            if not raw:
                return None
            data = json.loads(raw)
            return PageIndex.from_dict(data)
        except Exception as e:
            logger.warning("page_index_load_failed", document_id=document_id, error=str(e))
            return None

    async def delete(self, document_id: str) -> bool:
        """Remove a PageIndex from Redis (called on re-ingest)."""
        try:
            key = f"{_REDIS_PREFIX}{document_id}"
            await self.redis.delete(key)
            return True
        except Exception as e:
            logger.warning("page_index_delete_failed", document_id=document_id, error=str(e))
            return False

    async def get_navigation_path(self, document_id: str, query: str) -> list[str]:
        """
        Return ordered section titles most relevant to query.
        Uses keyword-based heuristic on section titles (no LLM, <1ms).

        Returns list of section titles, ranked by query relevance.
        """
        index = await self.load(document_id)
        if not index:
            return []

        node_ids = index.navigate_to_answer(query)
        return [index.nodes[nid].title for nid in node_ids if nid in index.nodes]

    async def get_context_for_chunk(
        self,
        document_id: str,
        chunk_id: str,
        expand: bool = True,
    ) -> dict:
        """
        Given a chunk_id from retrieval, return expanded context from PageIndex.

        Returns:
            {
                "breadcrumb_path": "10-K > Item 7 MD&A > Revenue > Para 3",
                "context_texts": ["parent section text...", "chunk text...", "sibling text..."],
                "section_title": "Item 7 MD&A",
                "page_range": "pp. 34-36",
            }
        """
        index = await self.load(document_id)
        if not index:
            return {"breadcrumb_path": "", "context_texts": [], "section_title": "", "page_range": ""}

        # Find node by chunk_id
        node = index.get_node_by_chunk_id(chunk_id)
        if not node:
            return {"breadcrumb_path": "", "context_texts": [], "section_title": "", "page_range": ""}

        context_nodes = index.get_context_window(node.node_id, expand=expand)
        context_texts = [n.text for n in context_nodes if n.text]

        # Find section ancestor
        section_title = ""
        current = node
        while current:
            if current.node_type == "section":
                section_title = current.title
                break
            if current.parent_id:
                current = index.nodes.get(current.parent_id)
            else:
                break

        # Page range from context nodes
        pages = [n.page_start for n in context_nodes if n.page_start is not None]
        page_range = ""
        if pages:
            min_p, max_p = min(pages), max(pages)
            page_range = f"p. {min_p}" if min_p == max_p else f"pp. {min_p}–{max_p}"

        return {
            "breadcrumb_path": node.path,
            "context_texts": context_texts,
            "section_title": section_title,
            "page_range": page_range,
        }
