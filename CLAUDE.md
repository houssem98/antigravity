# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Start everything
```bash
make dev          # All 4 services with hot reload (concurrently)
make infra        # Docker Compose up (Postgres/TimescaleDB, Redis, Qdrant, ES, Neo4j)
make down         # Stop all Docker services
make seed         # Seed Gravity API with sample SEC filings
make health       # Ping all service endpoints
make install      # npm install + pip install -r requirements.txt
make build        # Production builds for all apps
make test         # pytest + vitest
make clean        # Remove node_modules, .venv, dist
```

On Windows without make: `.\scripts\dev.ps1`

### Individual services
```bash
# Python API (from services/gravity-api/)
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# TypeScript market server
npm -w market-server run dev

# Next.js gravity-ui
npm -w gravity-ui run dev

# Vite market-ui
npm -w market-ui run dev
```

### Python environment
```bash
cd services/gravity-api
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

### Run a single Python test
```bash
cd services/gravity-api
python -m pytest test_ws.py -v
```

### Lint / typecheck
```bash
npm run lint          # all JS workspaces
npm run typecheck     # all JS workspaces
```

## Service URLs

| Service | Port | Notes |
|---------|------|-------|
| Gravity API (FastAPI) | 8000 | `/docs` for Swagger (dev only) |
| Market Server (Express) | 3001 | `/api/health` |
| Gravity UI (Next.js) | 3000 | Search interface |
| Market UI (Vite) | 5173 | AlphaSense-style research UI |

## Architecture

### Monorepo Layout
```
antigravity/
├── apps/gravity-ui/        Next.js 15 — conversational search interface
├── apps/market-ui/         Vite + React — AlphaSense-style research platform
├── services/gravity-api/   FastAPI (Python) — core search + ingestion engine
├── services/market-server/ Express (TypeScript) — market data + deep research API
├── packages/shared-types/  Shared TypeScript interfaces
└── infra/docker-compose.yml  All 5 databases
```

### How the Four Services Connect

```
Browser
  │
  ├── gravity-ui (Next.js :3000)
  │     ↕ WebSocket + REST → gravity-api :8000
  │
  └── market-ui (Vite :5173)
        ↕ REST → market-server :3001
              ↕ REST → gravity-api :8000  (gravityClient.ts)
```

### Gravity API — Search Pipeline (`app/core/search_pipeline.py`)

Every search request flows through this 10-stage pipeline, streaming events to the client via WebSocket as each stage completes:

```
Query
  → [1] Query Understanding     (Gemini/Claude; <50ms)
  → [2] Semantic Cache Check    (Redis cosine similarity >0.95 = cache hit)
  → [3] Parallel Retrieval      (asyncio.gather across all channels; <80ms)
        ├── Dense (Qdrant + voyage-finance-2)
        ├── Sparse BM25 (Elasticsearch)
        ├── SPLADE learned sparse (Qdrant sparse vectors)
        ├── Knowledge Graph (Neo4j Cypher)
        └── Structured SQL (TimescaleDB)
  → [4] RRF Fusion + Reranking  (Cohere rerank-v3.5; <30ms)
  → [5] Yield sources early     (progressive rendering)
  → [6] LLM Router → Generation (streams tokens via WebSocket)
  → [7] Citation Validation     (parallel; <100ms)
  → [8] Yield complete answer
  → [9] Cache result
  → [10] Yield metadata
```

**Two modes** (`reasoning_depth` param):
- `"fast"` — linear single-pass (simple queries, <200ms target)
- `"agentic"` — delegates to `app/core/agents/orchestrator.py`: Planner → Reader → Extractor → Critic → Writer agents in a loop (complex queries, <8s target)
- `"auto"` — auto-selects based on complexity score from query understanding

### LLM Router (`app/llm/router.py`)

Routes to the optimal model based on complexity + intent:
- Gemini 2.5 Flash — simple factual (70% of queries)
- Claude Sonnet 4.5 — multi-hop synthesis (20%)
- Claude Opus 4.6 — contradiction detection, investment thesis (8%)
- GPT-5.2 Thinking / DeepSeek — math-heavy / DCF (2%)

All LLM clients implement the same `BaseLLMClient` interface (`app/llm/base.py`), making the router model-agnostic.

### Retrieval Layer (`app/core/retrieval/`)

Each channel (`dense_search.py`, `sparse_search.py`, `splade_search.py`, `graph_search.py`, `structured_search.py`) returns a list of `RetrievalResult` objects. `fusion.py` combines them with RRF (k=60). `cohere_reranker.py` / `voyage_reranker.py` apply cross-encoder reranking on the top-30.

### Ingestion Pipeline (`app/ingestion/`)

```
Sources (sec_edgar.py, earnings.py, news.py, user_upload.py)
  → pipeline.py
  → processing/ (document_processor → section_detector → chunker → metadata_extractor → entity_extractor)
  → indexing/ (vector_indexer → keyword_indexer → graph_indexer → structured_indexer)
```

Chunks are prefixed with metadata before embedding (ticker, company, filing type, date, section) to improve retrieval precision.

SEC EDGAR source polls every 60 seconds using edgartools + raw fallback. Redis deduplication prevents reprocessing.

### Embeddings (`app/embeddings/`)

- `voyage_embedder.py` — primary: voyage-finance-2 (1,024 dims, finance-domain)
- `splade_encoder.py` — sparse token-weight vectors for SPLADE channel
- `local_embedder.py` — fallback self-hosted embedder

### WebSocket Streaming (`apps/gravity-ui/`)

`src/lib/ws.ts` — creates an EventSource/WebSocket session, calls the gravity-api `/v1/search/ws` endpoint, and fires typed callbacks (`onStatus`, `onSources`, `onToken`, `onAnswer`, `onMetadata`, `onAgentTrace`).

`src/hooks/useSearch.ts` — orchestrates a search session, populates Zustand stores (`searchStore`, `uiStore`).

`src/stores/searchStore.ts` — Zustand store holding the current query, status, sources, answer, citations, structured data, and agent trace log.

### Market UI (`apps/market-ui/`)

Full AlphaSense-style research platform with pages: Dashboard, Company, Documents, Search, History, Settings, Auth, Landing. Uses Supabase for auth/storage. The `deepResearchService.ts` runs deep research workflows; `gravityClient.ts` (market-server) proxies gravity-api calls.

### Key Configuration

All gravity-api settings in `app/config.py` (Pydantic Settings). Key env vars in `antigravity/.env` (copy from `.env.example`):
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
- `VOYAGE_API_KEY`, `COHERE_API_KEY`
- `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`, `ELASTICSEARCH_URL`, `NEO4J_URI`
- `CLERK_SECRET_KEY` (for gravity-ui auth)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (for market-ui)
