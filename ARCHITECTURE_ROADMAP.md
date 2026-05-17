# The Antigravity "Path to Perfection" Roadmap

Based on the honest teardown of the current architecture, here is the strategic roadmap to transform Antigravity from a "world-class prototype" into an **indestructible, production-grade enterprise product.** 

The theme of this roadmap is **Subtraction and Consolidation**. We are not adding new AI features; we are ripping out complexity so the Ferrari engine can actually drive on the street.

---

## Phase 1: Unify the Brain (Backend Consolidation)
**Goal:** Eliminate the split-brain architecture. Stop writing AI logic twice.

Right now, `market-server` (TypeScript) and `gravity-api` (Python) are duplicating effort. Both are running LLM orchestration, research pipelines, and interacting with databases.

*   **Step 1: Lobotomize the TypeScript Server.** `market-server` should become a "BFF" (Backend-for-Frontend). It should *only* handle WebSockets (live stock data), user authentication middleware, and routing. 
*   **Step 2: Move all AI to Python.** Migrate the `deepResearchService.ts` entirely into `gravity-api` using the existing multi-agent pipeline (`orchestrator.py`).
*   **Step 3: Internal gRPC/REST.** Standardize the communication so TypeScript just sends `POST /v1/research { query: "..." }` and Python handles 100% of the heavy lifting.

**Impact:** Codebase shrinks by 20%. Race conditions disappear. You only have to maintain prompts in one language.

---

## Phase 2: The Infrastructure Diet (Database Consolidation)
**Goal:** Go from 5 stateful databases to 2.

Right now, you are running Postgres, Qdrant, Elasticsearch, Neo4j, and Redis. This is a DevOps nightmare for a small team.

*   **Step 1: Migrate Dense Vectors to Postgres.** Replace Qdrant with `pgvector` inside Postgres. It handles 100M+ vectors easily with HNSW indexing, and it means your relational data and vector data live in the same transaction space.
*   **Step 2: Migrate Sparse Vectors to Postgres.** Replace Elasticsearch BM25 with Postgres Full-Text Search (using `tsvector` and `pg_trgm`). 
*   **Step 3: Re-evaluate Graph.** Neo4j is powerful, but do you *really* need it yet? If your graph is just tracking SEC insider transactions and company relationships, Postgres with recursive CTEs (or Apache AGE) can handle it. If Neo4j must stay, make it managed (AuraDB).
*   **Final Stack:** Postgres (Source of Truth, Dense Search, Sparse Search) + Redis (Cache/Rate Limiting). 

**Impact:** Infrastructure costs drop by 60%. Backup and restore becomes a single command. The system stops breaking because a database ran out of RAM.

---

## Phase 3: Bulletproof Resilience (Graceful Degradation)
**Goal:** The system must never return a generic 500 Error.

Right now, the 9-channel RRF retrieval relies on "happy paths". If an external MCP provider is down, or the graph database stutters, the whole pipeline is at risk.

*   **Step 1: Circuit Breakers.** Implement rigorous circuit breakers (e.g., using Python's `tenacity` library). If the FactSet MCP API times out after 3 seconds, the system should catch the error, drop the MCP channel from fusion, and proceed with the remaining 8 channels.
*   **Step 2: Multi-LLM Fallback.** You already have a great start with the Multi-LLM Router. Expand this so if DeepSeek throws a 429 Too Many Requests, it instantly swaps to Claude Haiku or Llama-3 on Groq without the user ever noticing.
*   **Step 3: Query Routing Strictness.** Stop running a massive 9-channel search for simple questions like "What is AAPL's ticker?". Implement a fast-path classifier that routes simple queries to a 50ms SQL lookup, reserving the heavy RAG machinery *only* for deep research.

**Impact:** Uptime reaches 99.9%. Users stop seeing timeouts.

---

## Phase 4: Perceived Performance (UX Polish)
**Goal:** Mask the 30-second AI generation time.

Even a perfectly optimized AI agent pipeline takes time. 30 seconds feels like an eternity if the UI is just a spinning wheel.

*   **Step 1: Server-Sent Events (SSE).** Convert all REST endpoints that trigger research to use SSE streaming.
*   **Step 2: Stream the "Chain of Thought".** Expose the internal state of the `orchestrator.py` to the UI. The user should see:
    *   *✓ Classifying query intent...*
    *   *✓ Querying SEC EDGAR...*
    *   *✓ Retrieving FactSet fundamentals...*
    *   *✓ Critic Agent reviewing draft...*
*   **Step 3: Streaming Markdown.** Stream the final report token-by-token directly into the UI so the user can start reading immediately, long before the report is finished saving to the database.

**Impact:** A 30-second wait feels like a 3-second wait because the user is actively watching the AI "work". The platform suddenly feels like a premium, AlphaSense-tier product.

---

## Summary
If you execute this roadmap, you will transition from a highly impressive AI experiment into a hardened, enterprise SaaS application that a bank would actually trust to put on their network. 

**Order of operations:** Do Phase 1 (Code Unification) first. Then Phase 4 (UX Streaming) for quick wins. Save Phase 2 (Database migration) for when you are preparing for your Series A or enterprise scaling.
