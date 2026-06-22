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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->