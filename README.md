# Antigravity

> **Unified Market Intelligence & Gravity Search Platform**

A monorepo containing the full Antigravity platform — combining a high-performance hybrid search engine (Gravity) with an AlphaSense-style market intelligence UI.

## Architecture

```
antigravity/
├── apps/
│   ├── gravity-ui/          Next.js frontend — search interface
│   └── market-ui/           Vite + React — AlphaSense-style research UI
├── services/
│   ├── gravity-api/         FastAPI (Python) — multi-model hybrid search backend
│   └── market-server/       Express + TS — research & market data API
├── packages/
│   └── shared-types/        Shared TypeScript interfaces
├── infra/
│   └── docker-compose.yml   PostgreSQL, Redis, Qdrant, Elasticsearch, Neo4j
├── scripts/                 PowerShell dev/seed/health scripts
├── Makefile                 make dev | make infra | make test | make build
└── package.json             npm workspaces root
```

## Quick Start

### Prerequisites

- **Node.js** ≥ 20 + **npm** ≥ 10
- **Python** ≥ 3.11
- **Docker** + **Docker Compose**
- **Make** (via choco install make on Windows)

### 1. Clone & configure

```bash
git clone <repo-url> antigravity
cd antigravity
cp .env.example .env
# Fill in your API keys in .env
```

### 2. Install dependencies

```bash
make install
# Or manually:
npm install                                         # all JS workspaces
cd services/gravity-api && python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

### 3. Start infrastructure

```bash
make infra
# Starts: PostgreSQL, Redis, Qdrant, Elasticsearch, Neo4j
```

### 4. Start all services

```bash
make dev
# Or on Windows PowerShell:
.\scripts\dev.ps1
```

| Service        | Port | URL                            |
|----------------|------|--------------------------------|
| Gravity API    | 8000 | http://localhost:8000/docs      |
| Market Server  | 3001 | http://localhost:3001/api/health|
| Gravity UI     | 3000 | http://localhost:3000           |
| Market UI      | 5173 | http://localhost:5173           |

### 5. Seed data

```bash
make seed
```

### 6. Health check

```bash
make health
# Or:
.\scripts\health-check.ps1
```

## Makefile Commands

| Command       | Description                                    |
|---------------|------------------------------------------------|
| `make dev`    | Start all 4 services with hot reload           |
| `make infra`  | Docker Compose up (all databases)              |
| `make down`   | Docker Compose down                            |
| `make seed`   | Seed Gravity API with sample SEC filings       |
| `make test`   | Run pytest + vitest                            |
| `make build`  | Production builds for all apps                 |
| `make health` | Ping all endpoints                             |
| `make clean`  | Remove node_modules, .venv, dist               |
| `make install`| Install all JS + Python dependencies           |

## Tech Stack

| Layer       | Technology                                       |
|-------------|--------------------------------------------------|
| Search      | Qdrant (dense) · Elasticsearch (BM25/SPLADE) · Neo4j (graph) |
| LLM         | Claude · GPT · Gemini · Cohere reranker          |
| Backend     | FastAPI (Python) · Express (TypeScript)           |
| Frontend    | Next.js · Vite + React · TailwindCSS · shadcn/ui |
| Database    | PostgreSQL + TimescaleDB · Redis (cache)          |
| Cloud       | Supabase (auth + storage)                        |
| Infra       | Docker Compose · npm workspaces                  |
