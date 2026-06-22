# Antigravity — Roadmap to 10 Million Documents (Agentic RAG at Scale)

**Goal:** scale the agentic RAG system to **10,000,000 source documents** —
SEC filings, earnings-call transcripts, news, and broker reports — while keeping
answers analyst-grade, every claim cited, and p95 first-token < 1s.

**The hard number:** 10M docs × ~40 chunks/doc ≈ **400M vectors** + 400M BM25 docs
+ a multi-hundred-million-edge knowledge graph. Everything below is sized to that.

---

## 0. Scale math (size everything from here)

| Quantity | Estimate | Notes |
|---|---|---|
| Source documents | 10,000,000 | filings + transcripts + news + broker |
| Avg chunks/doc | ~40 | filings high (100+), news low (5–10) |
| **Total chunks/vectors** | **~400,000,000** | the dominant number |
| Vector dim | 1,024 (voyage-finance-2) | |
| Raw vector bytes (fp32) | 400M × 1024 × 4 = **1.6 TB** | before quantization |
| Quantized (int8) | ~0.4 TB | 4× shrink, scalar quantization |
| Quantized (binary + rerank) | ~50 GB | 32× shrink, rerank top-k in fp32 |
| Payload/metadata | ~0.5–1 TB | ticker, dates, section, source text |
| ES BM25 index | ~1–2 TB | inverted index + stored fields |
| Postgres (XBRL facts/struct) | ~0.5 TB | financial_statements, ratings, targets |
| Neo4j graph | 100M+ nodes, 500M+ edges | entities, events, filings |
| Object store (raw docs) | ~5–15 TB | original PDFs/HTML, cold |

**Takeaway:** at 400M vectors, naive in-memory fp32 is impossible. Quantization +
sharding + tiered storage are mandatory, not optional.

---

## 1. The four bottlenecks at 10M scale

1. **Ingestion throughput** — must sustain ~10M docs without taking a year.
2. **Embedding cost + rate** — 400M chunks to embed (and re-embed on model upgrade).
3. **Vector index size/latency** — 400M vectors searched in < 50ms.
4. **Retrieval quality at scale** — recall doesn't collapse as corpus grows 1000×.

Each addressed below.

---

## 2. Ingestion at scale (throughput is everything)

### Throughput target
To load 10M docs in **30 days**: ~333K docs/day ≈ **~4 docs/sec sustained**.
To backfill in **7 days**: ~16 docs/sec. Each doc = fetch → parse → chunk → embed → index.

### Architecture (Kafka-backed, already scaffolded in docker-compose)
```
Sources ─► Kafka: gravity.raw-documents
              │  (partitioned, 6+ partitions, replication)
              ▼
   processing workers (N replicas)  ── text extract, section detect, NER
              │
              ▼  Kafka: gravity.processed-documents
              ▼
   indexing workers (M replicas)    ── chunk, embed (batched), fan-out write
              │
   ┌──────────┼───────────┬───────────┐
   ▼          ▼           ▼           ▼
 Qdrant     Elastic     Neo4j      Postgres
 (vectors)  (BM25)      (graph)    (XBRL/struct)
              │
              ▼  gravity.dead-letter (poison docs, replay)
```

### Scaling levers
- **Horizontal workers:** autoscale processing + indexing pods on queue depth.
- **Idempotency + dedup:** Redis `seen:<content-hash>` so re-runs skip — resume-safe.
- **Batched embedding:** 128–256 chunks/Voyage call; never 1-at-a-time.
- **Backpressure:** queue depth gates fetch rate; respect EDGAR 10 req/s, news license QPS.
- **Dead-letter + replay:** poison docs don't stall the pipeline.
- **Bulk vs stream:** historical backfill = big parallel batch job; live = 60s poll/webhook.
- **Per-source rate budgets:** EDGAR, transcript API, news wire each have own limiter.

---

## 3. Embeddings at 400M chunks (the cost/throughput crux)

| Approach | Pro | Con |
|---|---|---|
| Hosted Voyage | best finance quality | per-token cost × 400M, RPM caps |
| **Self-hosted GPU embedder** | flat GPU cost, high throughput | ops + quality work |
| Hybrid | Voyage for queries, self-host for bulk | best $/quality |

**Plan:**
1. **Self-host the bulk embedder on GPU** (text-embeddings-inference, like the SPLADE
   service already in compose). A single A100 embeds millions/day.
2. Keep voyage-finance-2 for **query-time** embedding (low volume, high quality).
3. Later finetune a domain embedder; **re-embedding 400M vectors is a planned event** —
   build a versioned re-index pipeline (`embedding_version` on every vector).
4. **SPLADE learned-sparse** runs in the same GPU tier for the sparse channel.

> Re-embedding the whole corpus must be a one-command, resumable, zero-downtime
> blue/green re-index. Design for it now — you *will* upgrade the embedder.

---

## 4. Vector store at 400M vectors (Qdrant)

- **Quantization:** scalar int8 by default (4× smaller, ~no recall loss); binary
  quantization + fp32 rerank for the hot tier (32× smaller).
- **On-disk vectors + mmap:** `on_disk: true`; keep HNSW graph in RAM, vectors on NVMe.
- **Sharding + replication:** Qdrant distributed mode; shard by collection, replicate
  for HA. Size shards to ~50–100M vectors each → 4–8 shards.
- **Payload indexing:** index `ticker`, `filing_type`, `filing_date`, `section` so
  filtered search (e.g. ticker=NVDA, section=risk) is fast — critical at scale.
- **Time partitioning:** hot (last 2y) vs cold collections; most queries hit hot.
- **HNSW tuning:** `m`, `ef_construct`, `ef_search` tuned per recall/latency budget.

**Sizing:** int8 + on-disk → ~0.4 TB vectors fits a few large NVMe nodes. Binary hot
tier (~50 GB) stays in RAM for sub-50ms ANN, fp32 rerank from disk on top-k.

---

## 5. Retrieval quality that survives 1000× growth

Recall degrades as corpus grows unless you fight it:

- **Hard pre-filtering** by entity/date/source *before* ANN — shrinks the candidate
  space from 400M to thousands. The single biggest scale lever.
- **Hierarchical retrieval (RAPTOR):** route to document/theme summaries first, then
  drill into chunks — avoids scanning 400M leaves.
- **Multi-stage:** cheap recall (BM25 + ANN, top-1000) → Cohere/Voyage rerank (top-30)
  → optional ColBERT late-interaction for precision.
- **RRF fusion (k=60)** across dense + BM25 + SPLADE + graph + SQL — already wired.
- **Per-intent routing:** "what's the price target" → broker structured table, not ANN.
- **Semantic cache (Redis):** at scale, cache hit-rate is a cost/latency multiplier.

---

## 6. The agentic layer (unchanged by scale, enabled by it)

Multi-agent loop — the reasoning quality that makes 400M vectors *useful*:

```
Planner ─► decompose + pick channels/filters (filters = scale survival)
  ├─ Retriever agents (parallel, pre-filtered per channel)
  ├─ Extractor (structured facts: numbers, dates, ratings, targets)
  ├─ Calculator (tool-use math — DCF, margins, YoY; never LLM arithmetic)
  ├─ Critic (every claim ↔ a cited source)
  ├─ Verifier (citation gate: no uncited number ships)
  └─ Writer (compose, stream, cite)
        ▲ loop if quality < threshold (bounded iterations)
```
- **Contradiction detection** across filing vs call vs broker vs news.
- **Budget-aware LLM routing** (Gemini → Sonnet → Opus → reasoning) with per-step caps.

---

## 7. Storage tiering (don't pay RAM prices for cold data)

| Tier | Holds | Store |
|---|---|---|
| Hot | last ~2y, binary-quantized vectors, HNSW graph | RAM/NVMe |
| Warm | full int8 vectors, ES, Postgres | NVMe / managed |
| Cold | raw PDFs/HTML, old chunks | S3/object store |
| Archive | superseded embedding versions | object store, lifecycle |

---

## 8. Cost drivers at 10M docs (one-time backfill)

| Item | Driver | Lever |
|---|---|---|
| Embedding 400M chunks | per-token or GPU-hours | self-host GPU embedder |
| Vector storage | 400M × dim | quantization + on-disk |
| ES storage | inverted index | tiered, ILM rollover |
| LLM answer tokens | per query, not corpus | router + semantic cache |
| Data licensing | news/broker volume | own normalization, license raw |

Corpus size drives **storage + one-time embedding**; query volume drives **LLM cost**.
Keep them separate in the budget model.

---

## 9. Phased plan

| Phase | Docs | Focus | Exit criteria |
|---|---|---|---|
| P0 (now) | ~10K | unblock | WS fixed ✅; FAANG backfill; eval harness |
| P1 | 100K | 5 channels honest | Redis/ES/Neo4j live; Kafka workers; dedup; top-500 tickers |
| P2 | 1M | throughput | self-host GPU embedder; batched embed; quantization; sharding |
| P3 | 5M | quality at scale | RAPTOR; pre-filter routing; semantic cache; multi-source |
| P4 | 10M | productionize | distributed Qdrant; tiered storage; blue/green re-index; SLA |

---

## 10. Immediate next 30 days

1. ✅ **Quick Answer WebSocket fixed** — *done*.
2. 🔄 **Backfill data** — FAANG bulk SEC ingest running; extend to top-500 tickers.
3. **Provision dormant DBs** — Upstash Redis, Elastic Cloud, Neo4j Aura → Fly secrets.
4. **Stand up Kafka ingestion workers** (compose already defines them) for throughput.
5. **Add `embedding_version` + content-hash dedup** to every vector — enables resume + re-index.
6. **Eval harness in CI** — FinanceBench sample on each deploy; track recall as corpus grows.

---

## 11. Why this is the hard part

At 10M docs the challenge isn't the LLM — it's **feeding it the right 30 chunks out of
400M in under 50ms, every claim traceable.** That is won by: aggressive pre-filtering,
quantization + sharding, hierarchical retrieval, a resumable high-throughput ingestion
pipeline, and a verification-gated agentic loop. The model is the easy part; the
**retrieval substrate at scale** is the moat.
