"""
Gravity Search — Application Configuration
Reads from .env via pydantic-settings. Every config value has a sensible default.
"""

from enum import Enum
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(str, Enum):
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── App ──────────────────────────────────────────────────────────────
    app_env: Environment = Environment.DEVELOPMENT
    app_name: str = "Gravity Search"
    app_version: str = "0.1.0"
    log_level: str = "DEBUG"
    cors_origins: str = "http://localhost:3000"
    api_port: int = 8000

    # ── LLM API Keys ────────────────────────────────────────────────────
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    google_api_key: str = ""
    deepseek_api_key: str = ""
    groq_api_key: str = ""
    voyage_api_key: str = ""
    cohere_api_key: str = ""
    jina_api_key: str = ""              # JINA_API_KEY — jina-embeddings-v3 (1024d)
    openrouter_api_key: str = ""        # OPENROUTER_API_KEY — Hermes + OSS models
    together_api_key: str = ""          # TOGETHER_API_KEY — Hermes hosted

    # ── Hermes Integration (Phase 0 feature flags) ───────────────────────
    # Master kill switch. False = Hermes route disabled, all queries use existing pipeline.
    hermes_enabled: bool = False
    # 0-100. Percent of qualifying queries to route to Hermes. 0 = off, 100 = all qualifying.
    hermes_route_percentage: int = 0
    # Query complexity tiers eligible for Hermes routing.
    # Allowed values: "simple", "summarization", "factual"
    hermes_route_for: str = "simple,summarization"
    hermes_model: str = "nousresearch/hermes-4-70b"
    hermes_base_url: str = "https://openrouter.ai/api/v1"

    # ── Model Defaults ──────────────────────────────────────────────────
    default_reasoning_model: str = "claude-sonnet-4-5-20250929"
    default_fast_model: str = "gemini-2.5-flash"
    default_math_model: str = "gpt-5.2"
    default_validation_model: str = "gemini-3-pro"
    default_embedding_model: str = "voyage-finance-2"
    default_reranker: str = "cohere-rerank-v3.5"

    # ── Database URLs ───────────────────────────────────────────────────
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str = ""  # required for Qdrant Cloud
    qdrant_collection: str = "gravity_chunks"
    elasticsearch_url: str = "http://localhost:9200"
    elasticsearch_index: str = "gravity_chunks"
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "gravitysearch"
    postgres_url: str = "postgresql+psycopg://postgres:gravitysearch@localhost:5432/gravity"
    redis_url: str = "redis://localhost:6379"
    kafka_bootstrap_servers: str = "localhost:9092"

    # ── Search Config ───────────────────────────────────────────────────
    dense_search_top_k: int = 50
    sparse_search_top_k: int = 50
    rrf_k: int = 60
    rerank_top_k: int = 30
    max_context_passages: int = 15

    # ── On-demand ingestion (corpus-miss → index the company live) ──────
    on_demand_ingest_enabled: bool = True       # master switch
    on_demand_ingest_timeout_s: int = 75        # per-ticker budget inside a query
    on_demand_ingest_filing_types: str = "10-K,10-Q,8-K"
    on_demand_ingest_max_filings: int = 6       # most-recent filings per type
    on_demand_index_settle_s: int = 3           # wait for ES/Qdrant to make new chunks searchable before retry

    # ── Cache Config ────────────────────────────────────────────────────
    semantic_cache_ttl: int = 3600
    semantic_cache_threshold: float = 0.95

    # ── Embedding Config ────────────────────────────────────────────────
    embedding_batch_size: int = 128
    embedding_dimensions: int = 1024  # voyage-finance-2

    # ── Chunking Config ─────────────────────────────────────────────────
    chunk_section_max_tokens: int = 2048
    chunk_paragraph_max_tokens: int = 512
    chunk_paragraph_overlap: float = 0.20  # 20% overlap
    chunk_sentence_max_tokens: int = 150

    # ── RAPTOR Summary Tree Config (FinRAG paper) ───────────────────────
    raptor_enabled: bool = True         # Feature flag for RAPTOR tree indexing
    raptor_cluster_threshold: float = 0.85  # Cosine similarity for clustering
    raptor_summary_max_tokens: int = 256    # Max tokens for generated summaries

    # ── LLM provider gating ─────────────────────────────────────────────
    # Anthropic key is configured but may have $0 credit. Keep it OUT of the
    # router pool until credit exists, else the router can pick a dead Claude
    # model and the whole search fails. Flip to true (ANTHROPIC_ENABLED=true)
    # once billing is funded.
    anthropic_enabled: bool = False

    # ── EDGAR live polling (daily-fresh corpus) ─────────────────────────
    edgar_polling_enabled: bool = False   # EDGAR_POLLING_ENABLED — auto-ingest new filings
    edgar_watchlist: str = ""             # EDGAR_WATCHLIST — comma-sep tickers; empty = all (firehose)
    edgar_filing_types: str = "10-K,10-Q,8-K"  # forms to poll

    @property
    def edgar_watchlist_set(self) -> set[str]:
        """Uppercased ticker watchlist; empty set = ingest every company."""
        return {t.strip().upper() for t in self.edgar_watchlist.split(",") if t.strip()}

    # ── Earnings transcript sources
    alpha_vantage_api_key: str = ""     # ALPHA_VANTAGE_API_KEY
    quartr_api_key: str = ""            # QUARTR_API_KEY — paid; 14,500+ companies

    # ── PageIndex (VectifyAI) — hierarchical tree-based SEC filing retrieval
    pageindex_api_key: str = ""
    pageindex_workspace: str = "gravity"
    pageindex_base_url: str = "https://api.pageindex.ai"
    pageindex_model: str = "claude-sonnet-4-6"        # LLM for tree navigation
    pageindex_retrieve_model: str = "claude-haiku-4-5-20251001"  # cheap model for passage fetch
    pageindex_enabled: bool = False    # set True when PAGEINDEX_API_KEY is present
    pageindex_top_k: int = 10          # max pages to fetch per document per query

    # ── TurboQuant — compressed in-memory ANN index (7.8× storage reduction)
    turbo_quant_enabled: bool = False  # set True to activate compressed ANN channel
    turbo_quant_bits: int = 4          # quantization bits (2–8; 4 = best quality/size trade-off)
    turbo_quant_index_path: str = "data/turbo_quant.idx"  # disk snapshot path
    turbo_quant_top_k: int = 50

    # ── MCP Financial Data Connectors ────────────────────────────────────
    mcp_enabled: bool = False           # set True when any MCP API key is present
    mcp_timeout_s: float = 15.0         # per-server timeout (seconds)
    mcp_max_tools_per_server: int = 3   # max tool calls per MCP provider per query

    # ── Multi-tenant isolation ───────────────────────────────────────────
    # When True, per-org Qdrant collections are used: {org_id}_gravity_chunks
    # Org ID flows from JWT claims (x-org-id header / sub claim prefix).
    multi_tenant_qdrant: bool = False

    # ── Filing webhooks ──────────────────────────────────────────────────
    # Comma-separated list of URLs to POST when a new filing is indexed.
    # Payload: {"event": "filing.indexed", "filing": {...}}
    filing_webhook_urls: str = ""
    filing_webhook_secret: str = ""  # HMAC-SHA256 signing key (optional)

    @property
    def filing_webhook_url_list(self) -> list[str]:
        return [u.strip() for u in self.filing_webhook_urls.split(",") if u.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]

    @property
    def is_production(self) -> bool:
        return self.app_env == Environment.PRODUCTION


settings = Settings()
