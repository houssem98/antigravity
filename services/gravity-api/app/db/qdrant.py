"""
Gravity Search — Qdrant Vector Database Client
Real AsyncQdrantClient with graceful fallback for development.
"""

import structlog
from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models

from app.config import settings

logger = structlog.get_logger()

DENSE_VECTOR_NAME = "dense"
SPARSE_VECTOR_NAME = "sparse"


# ── Mock Fallbacks ──────────────────────────────────────────────────────────

class _MockQdrantResult:
    """Mock for search/upsert results. Mirrors QueryResponse shape (.points list)."""
    def __init__(self, items=None):
        self.items = items or []
        self.points = self.items  # query_points() callers read .points
    def __iter__(self):
        return iter(self.items)
    def __len__(self):
        return len(self.items)


class _MockQdrantClient:
    """Mimics AsyncQdrantClient when Qdrant is down."""
    async def query_points(self, *args, **kwargs):
        return _MockQdrantResult()
        
    async def upsert(self, *args, **kwargs):
        return _MockQdrantResult()
        
    async def get_collections(self, *args, **kwargs):
        return models.CollectionsResponse(collections=[])
        
    async def get_collection(self, *args, **kwargs):
        raise ValueError("Mock collection not found")

    async def collection_exists(self, *args, **kwargs):
        return False
        
    async def create_collection(self, *args, **kwargs):
        return True
        
    async def create_payload_index(self, *args, **kwargs):
        return True


# ── Lazy Client ─────────────────────────────────────────────────────────────

class QdrantLazyClient:
    """
    Lazy wrapper for AsyncQdrantClient.
    Connects on first use. Falls back to mock if Qdrant isn't running.
    """
    def __init__(self):
        self._client: AsyncQdrantClient | _MockQdrantClient | None = None
        self._is_mock = False
        
    async def _connect(self):
        if self._client is not None:
            return

        try:
            kwargs = {"url": settings.qdrant_url, "timeout": 5}
            if settings.qdrant_api_key:
                kwargs["api_key"] = settings.qdrant_api_key
            client = AsyncQdrantClient(**kwargs)
            # Use get_collections to test the connection eagerly
            await client.get_collections()
            self._client = client
            self._is_mock = False
            logger.info("qdrant_connected", url=settings.qdrant_url)
        except Exception as e:
            logger.warning("qdrant_unavailable_using_mock", url=settings.qdrant_url, error=str(e))
            self._client = _MockQdrantClient()
            self._is_mock = True

    @property
    async def client(self):
        if self._client is None:
            await self._connect()
        return self._client

    @property
    def is_connected(self) -> bool:
        """True if using real connection."""
        return not self._is_mock

    # ── Forwarded Methods ───────────────────────────────────────────────────

    async def query_points(self, *args, **kwargs):
        client = await self.client
        return await client.query_points(*args, **kwargs)

    async def upsert(self, *args, **kwargs):
        client = await self.client
        return await client.upsert(*args, **kwargs)

    async def get_collections(self, *args, **kwargs):
        client = await self.client
        return await client.get_collections(*args, **kwargs)

    async def collection_exists(self, collection_name: str, **kwargs):
        client = await self.client
        return await client.collection_exists(collection_name)
        
    async def create_collection(self, *args, **kwargs):
        client = await self.client
        return await client.create_collection(*args, **kwargs)

    async def create_payload_index(self, *args, **kwargs):
        client = await self.client
        return await client.create_payload_index(*args, **kwargs)


# Module singleton
qdrant_client = QdrantLazyClient()


def collection_for_org(org_id: str | None) -> str:
    """
    Return the Qdrant collection name for a given org.

    Multi-tenant mode (MULTI_TENANT_QDRANT=true): {org_id}_gravity_chunks
    Single-tenant / no org: settings.qdrant_collection (default "gravity_chunks")

    Org IDs are validated to prevent path-traversal: only [a-z0-9_-] allowed.
    """
    if not settings.multi_tenant_qdrant or not org_id:
        return settings.qdrant_collection
    import re
    safe = re.sub(r"[^a-z0-9_-]", "_", org_id.lower())[:64]
    return f"{safe}_gravity_chunks"


async def ensure_collection(collection_name: str | None = None):
    """Create the Qdrant collection if it doesn't exist."""
    collection_name = collection_name or settings.qdrant_collection
    
    # Check if we're actually connected or just mocking
    client = await qdrant_client.client
    if qdrant_client.is_connected is False:
        logger.info("qdrant_collection_skip", reason="using mock client")
        return

    exists = await qdrant_client.collection_exists(collection_name=collection_name)
    if exists:
        logger.debug("qdrant_collection_exists", collection=collection_name)
        return

    try:
        # Create collection with named vectors for Hybrid Search + INT8 scalar quantization
        # INT8 gives 4× memory reduction with ~1% quality loss — essential for 10M+ SEC chunks
        await qdrant_client.create_collection(
            collection_name=collection_name,
            vectors_config={
                DENSE_VECTOR_NAME: models.VectorParams(
                    size=settings.embedding_dimensions,  # default 1024
                    distance=models.Distance.COSINE,
                ),
            },
            sparse_vectors_config={
                SPARSE_VECTOR_NAME: models.SparseVectorParams(
                    modifier=models.Modifier.IDF,
                ),
            },
            quantization_config=models.ScalarQuantization(
                scalar=models.ScalarQuantizationConfig(
                    type=models.ScalarType.INT8,
                    quantile=0.99,
                    always_ram=True,
                ),
            ),
        )
        
        # Create payload indexes for fast filtering
        # `entitlements` is critical — every search query filters by it (plan §6.11).
        for field in ["ticker", "company_name", "filing_type", "document_id", "entitlements"]:
            await qdrant_client.create_payload_index(
                collection_name=collection_name,
                field_name=field,
                field_schema=models.PayloadSchemaType.KEYWORD,
            )
            
        logger.info("qdrant_collection_created", collection=collection_name)
    except Exception as e:
        logger.error("qdrant_collection_creation_failed", error=str(e))
