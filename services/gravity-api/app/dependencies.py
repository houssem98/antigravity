"""
Gravity Search — Dependency Injection
Wires all components together. Called by API routes to get the initialized search pipeline.
Uses lazy initialization so services only start when first needed.
"""

import structlog
from functools import lru_cache

logger = structlog.get_logger()

_search_pipeline = None
_feedback_loop = None


@lru_cache()
def get_embedder():
    from app.config import settings
    if settings.voyage_api_key:
        from app.embeddings.voyage_embedder import VoyageEmbedder
        return VoyageEmbedder()
    else:
        from app.embeddings.local_embedder import LocalEmbedder
        logger.warning("using_local_embedder", reason="no VOYAGE_API_KEY")
        return LocalEmbedder()


@lru_cache()
def get_splade_encoder():
    from app.embeddings.splade_encoder import SpladeEncoder
    return SpladeEncoder()


@lru_cache()
def get_llm_router():
    from app.llm.router import LLMRouter
    return LLMRouter()


@lru_cache()
def get_reranker():
    from app.config import settings
    if settings.cohere_api_key:
        from app.core.reranking.cohere_reranker import CohereReranker
        return CohereReranker()
    logger.warning("no_reranker", reason="no COHERE_API_KEY")
    return None


def get_search_pipeline():
    """Get (or lazily create) the fully wired search pipeline."""
    global _search_pipeline

    if _search_pipeline is not None:
        return _search_pipeline

    logger.info("initializing_search_pipeline")

    router = get_llm_router()
    embedder = get_embedder()
    splade = get_splade_encoder()

    # Retrieval channels
    from app.core.retrieval.dense_search import DenseSearch
    from app.core.retrieval.sparse_search import SparseSearch
    from app.core.retrieval.splade_search import SpladeSearch
    from app.core.retrieval.graph_search import GraphSearch
    from app.core.retrieval.structured_search import StructuredSearch
    from app.core.retrieval.orchestrator import RetrievalOrchestrator

    dense = DenseSearch(embedder=embedder)
    sparse = SparseSearch()
    splade_search = SpladeSearch(splade_encoder=splade)
    graph = GraphSearch()

    # Structured search uses Gemini Flash for NL-to-SQL
    structured = None
    try:
        fast_client = router.get_fast_client()
        structured = StructuredSearch(llm_client=fast_client)
    except Exception:
        logger.warning("structured_search_unavailable")

    orchestrator = RetrievalOrchestrator(
        dense_search=dense,
        sparse_search=sparse,
        splade_search=splade_search,
        graph_search=graph,
        structured_search=structured,
    )

    # Reranker
    reranker = get_reranker()

    # Query understanding (Gemini Flash)
    from app.core.query_understanding import QueryUnderstanding
    try:
        fast_client = router.get_fast_client()
        query_understander = QueryUnderstanding(llm_client=fast_client)
    except Exception:
        query_understander = QueryUnderstanding(llm_client=None)

    # Citation validator (Gemini Pro)
    from app.core.reasoning.validator import CitationValidator
    validator = None
    try:
        gemini_pro = router.get_client("gemini_pro")
        validator = CitationValidator(llm_client=gemini_pro)
    except Exception:
        logger.warning("citation_validator_unavailable")

    # Semantic cache
    from app.core.caching.semantic_cache import SemanticCache
    cache = SemanticCache(embedder=embedder)

    # Feedback loop (optional — requires DB + Redis)
    feedback_loop = get_feedback_loop()

    # Deterministic ratio engine — bypasses LLM for financial ratio queries
    ratio_engine = None
    try:
        from app.db.postgres import get_db_pool
        from app.core.finance.ratio_engine import RatioEngine
        ratio_engine = RatioEngine(db_pool=get_db_pool())
        logger.info("ratio_engine_ready")
    except Exception as e:
        logger.warning("ratio_engine_unavailable", error=str(e))

    # Assemble the pipeline
    from app.core.search_pipeline import SearchPipeline
    _search_pipeline = SearchPipeline(
        llm_router=router,
        retrieval_orchestrator=orchestrator,
        reranker=reranker,
        query_understander=query_understander,
        citation_validator=validator,
        semantic_cache=cache,
        feedback_loop=feedback_loop,
        ratio_engine=ratio_engine,
    )

    logger.info("search_pipeline_ready")
    return _search_pipeline


def get_feedback_loop():
    """Get (or lazily create) the routing feedback loop."""
    global _feedback_loop
    if _feedback_loop is not None:
        return _feedback_loop

    try:
        from app.db.postgres import get_db_pool
        from app.db.redis import redis_client
        from app.core.feedback.routing_feedback import RoutingFeedbackLoop
        db_pool = get_db_pool()
        _feedback_loop = RoutingFeedbackLoop(db_pool=db_pool, redis_client=redis_client)
        logger.info("feedback_loop_ready")
    except Exception as e:
        logger.warning("feedback_loop_unavailable", error=str(e))
        _feedback_loop = None

    return _feedback_loop
