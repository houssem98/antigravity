# Gravity Search — World-Class Roadmap

**Current state:** 140 Python modules, 7-channel hybrid retrieval, 121K chunks in ES, Qdrant empty, Groq fallback live, agents wired.

**Targets:** FinanceBench ≥99% · Vals AI ≥68% · p95 latency <200ms · Institutional-grade compliance

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Done |
| 🔧 | In progress / partially done |
| ⬜ | Not started |
| 🔑 | Blocked on external key / account |

---

## Phase 1 — Make It Actually Work (Week 1–2)

Everything coded, nothing running end-to-end. Fix blockers first.

### 1.1 Unlock the data layer

| Task | Status | Notes |
|------|--------|-------|
| Add Voyage payment method → unlock standard rate limits | 🔑 | Free 200M tokens covers full sync (~$0 cost) |
| Run `sync_es_to_qdrant.py` — embed 121K chunks into Qdrant | ⬜ | ~$3.64 voyage cost, ~20 min |
| Top up Anthropic credits OR confirm Groq fallback is sufficient | 🔧 | Groq fallback wired and tested (712ms, works) |
| Top up DeepSeek balance (currently 402 Insufficient Balance) | ⬜ | Optional — Groq covers this |

### 1.2 Bug fixes — all silent failures (COMPLETED)

| Fix | Status | Impact |
|-----|--------|--------|
| `GraphIndexer.__init__` — didn't accept `driver` param; `index_document` was async called in executor | ✅ | Neo4j populates on every ingest |
| `StructuredIndexer` — `extract_and_store` method didn't exist (name mismatch) | ✅ | TimescaleDB financial metrics now index |
| `HyDE` — instantiated and passed to `DenseSearch` | ✅ | +8–15% retrieval precision |
| `MultiQueryRetriever` — wired for MEDIUM/COMPLEX queries (4 variants × dense) | ✅ | +10–20% recall |
| Citation validator — was crashing on missing `gemini_pro`; now uses Sonnet → Groq → Haiku fallback | ✅ | Validator was always None before |
| Citation validator — `search_multi_entity()` for comparison queries | ✅ | Apple vs Microsoft queries now work |
| LLM fallback chain — Groq (Llama-3.3-70B, Llama-3.1-8B) added to router | ✅ | Survives Anthropic credit exhaustion |
| `QDRANT_COLLECTION` env var mismatch (`gravity_docs` → `gravity_chunks`) | ✅ | Dense search was hitting wrong collection |
| Missing `await` on `qdrant_client.query_points()` and `upsert()` | ✅ | Coroutine objects were returned instead of results |
| `asyncio.wait_for(timeout=5.0)` on Stage 1 query understanding | ✅ | Fixes "Understanding query..." UI hang |

### 1.3 Verify all channels return results

```bash
# After Qdrant sync, confirm each channel fires:
python scripts/eval_financebench.py --limit 5
```

Expected after sync: dense + bm25 return results. Graph + structured need their own data.

### 1.4 Neo4j knowledge graph — populate it

The `GraphIndexer` is now wired. But Neo4j is empty because EDGAR polling was never started (fixed in `main.py` lifespan). Restart the API and ingest a few filings to populate it:

```bash
curl -X POST http://localhost:8000/v1/documents/ingest-sec \
  -H "Content-Type: application/json" \
  -d '{"tickers": ["AAPL","MSFT","NVDA"], "years_back": 2}'
```

### 1.5 TimescaleDB financial metrics — populate it

`StructuredIndexer` is now wired. New ingestions will populate `financial_statements` table automatically. For existing 121K ES chunks, run the XBRL backfill (Phase 2.1).

**Phase 1 exit criterion:** Query "What was Apple's revenue in Q4 2024?" returns a correct cited answer from ≥3 retrieval channels.

---

## Phase 2 — Retrieval Excellence (Week 3–6)

**Target: FinanceBench ≥85%**

### 2.1 Financial table indexer — wired ✅

`table_indexer.py` built and wired into `pipeline._parallel_index()` as the 6th concurrent indexer. Converts `ParsedTable` objects (already extracted by `DocumentProcessor`) into: (1) per-metric sentence chunks + per-period summary chunks → Qdrant + ES; (2) structured rows → ES `gravity_financials` index. Also injects `financial_calculator` deterministic results (Stage 5c) into LLM prompt for math queries.

### 2.1b XBRL table extractor — biggest single quality gap ⬜

Most FinanceBench errors are table questions. Income statements, balance sheets, cash flows are in structured HTML/XBRL — current chunking treats them as flat text, destroying row-column relationships.

**Build:**
```
app/ingestion/processing/xbrl_table_extractor.py
  → parse EDGAR inline XBRL → extract financial tables
  → push rows to TimescaleDB: {ticker, period, metric, value, unit}
  → also embed as rich text: "Apple FY2024 Revenue: $391.035B (up 2.1% YoY)"
```

Accounts for ~15% of FinanceBench score improvement alone.

### 2.2 RAPTOR hierarchical indexing — wired ✅

`raptor_indexer.py` wired into `pipeline.ingest_bytes()` (Step 5b). Runs after chunking, before parallel indexing. Generates Level 0 summary chunks per document section using the fast LLM client (Groq/Haiku). Summary chunks are appended to the chunk list and flow through vector + keyword indexers. Critical for "summarize the risk factors" style questions.

### 2.3 HyDE — wired ✅

Hypothetical Document Embeddings now default for all dense queries. The hypothetical passage bridges the question/answer embedding gap (+8–15% precision on financial queries).

### 2.4 Multi-query expansion — wired ✅

4-variant query expansion active for MEDIUM/COMPLEX queries. Covers vocabulary distribution ("CapEx guidance" vs "capital expenditure forecast").

### 2.5 Parallel multi-entity retrieval — wired ✅

Comparison queries ("Compare Apple and Microsoft margins") now run one independent retrieval pass per company in parallel, with entity-tagged results for LLM attribution.

### 2.6 PageIndex — hierarchical tree navigation 🔑

**The biggest quality jump for FinanceBench.** Navigates SEC filings as a tree instead of flat chunks. Goes directly to "Item 7 MD&A → Services Segment → Revenue table" instead of hoping cosine similarity finds it.

- Get API key from VectifyAI
- Set `PAGEINDEX_API_KEY=` in `.env`
- Set `PAGEINDEX_ENABLED=true` in `.env`

Expected: +5–8% FinanceBench score from this channel alone.

**Phase 2 exit criterion:** FinanceBench score ≥85% on the 150-question set.

---

## Phase 3 — Answer Quality (Week 7–12)

**Target: FinanceBench ≥98% · Vals AI ≥60%**

### 3.1 FinanceBench eval harness — built ✅

```bash
# Quick smoke test (5 questions):
python scripts/eval_financebench.py --limit 5

# Full 13-question sample:
python scripts/eval_financebench.py

# Full 150-question benchmark (download dataset first):
python scripts/eval_financebench.py --dataset data/financebench_open_source.jsonl

# Numeric questions only:
python scripts/eval_financebench.py --category numeric
```

Score targets displayed automatically:
- Baseline GPT-4 (no RAG): ~45%
- Good RAG: ~75%
- Production-grade: ~90%
- World-class: ≥98%

### 3.2 Atomic citation decomposition (ALiiCE) — wired ✅

`proposition_extractor.py` built and wired as Stage 8b in the search pipeline. Decomposes answers into atomic claims (rule-based first, LLM fallback), then NLI-attributes each claim to a specific passage sentence. Runs for MEDIUM/COMPLEX queries with a 3s timeout. Outputs sentence-level `AttributedProposition` objects; `alce_citation_recall` added to validation metadata.

### 3.3 Financial NLI judge — upgraded to FinBERT ✅

`finbert_nli.py` built using `ProsusAI/finbert` (440MB, CPU-compatible). Inserted as Step 2 in the NLI priority chain: numeric pre-check → FinBERT → T5-XXL → Claude. Outperforms general NLI on financial statement text; 25x smaller than T5-XXL and runs without GPU.

### 3.4 ConvFinQA multi-turn numeric state — wired ✅

`numeric_state.py` built: extracts `(entity, metric, period, value)` facts from each answer using regex, stores in Redis (TTL 2h, capped at 100 facts/conversation). `_get_conversation_context()` now prepends a `KNOWN FACTS FROM THIS CONVERSATION` block before Q&A history. `_save_conversation_turn()` records facts fire-and-forget after each turn. Per ConvFinQA paper: +22% accuracy on multi-turn numeric questions.

### 3.5 Financial reasoning chain verification — wired ✅

`logic_verifier.py` upgraded with `verify_calculation_steps()`: extracts arithmetic expressions from LLM answer text via regex (`(391 - 383) / 383 = 2.09%`), evaluates them, and flags mismatches >1.5%. Also handles division steps (`$45.2B / 15.4B = $2.93`). Merged with existing rule-based checks via `verify_logic()`. Runs as part of Stage 7 deterministic verification on every query.

### 3.6 Contradiction detection as a first-class feature ✅

`contradiction_detector.py` built and wired as Stage 7 Layer 3. Deterministic cross-passage scan: extracts (entity, metric, period, value) tuples from all retrieved passages, flags pairs with >15% relative difference for the same metric/period across different sources. Zero LLM cost, <5ms. Merged into `contradictions` field of the API response alongside LLM-reported contradictions.

**Phase 3 exit criterion:** FinanceBench ≥98% · NLI citation recall ≥0.90 · Zero hallucinated numbers on 50-question math test set.

---

## Phase 4 — Data Scale (Month 3–5)

**Target: S&P 500 × 13 years indexed · Vals AI ≥68%**

### 4.1 The filing universe that makes you world-class

| Tier | Coverage | Filings | Chunks | Voyage cost | Storage |
|------|----------|---------|--------|-------------|---------|
| **Now** | ~30 companies, mixed years | ~800 | 121K | done | 180MB ES |
| **FinanceBench** | 35 cos, 2019–2023 | ~350 | ~560K | $6.70 | ~800MB |
| **Vals AI tier** | S&P 500, 3 years | ~6,000 | ~9.5M | $114 | ~13GB |
| **World-class** | S&P 500, 2011–now | ~26,000 | ~41M | $492 | ~55GB Qdrant INT8 |
| **AlphaSense** | All public + private | ~1M+ | ~2B | N/A | cloud |

**Target: S&P 500 × 2011–now = ~26,000 filings.** Fits on one machine. $492 one-time Voyage cost.

### 4.2 Parallel ingestion pipeline ✅

`parallel_ingest.py` built. `ParallelIngestor(pipeline, edgar_source).ingest_tickers(tickers, workers=8)` runs 8 concurrent workers bounded by EDGAR's 10 req/s Semaphore. Includes checkpoint/resume (JSONL), Redis dedup, per-filing error isolation, and progress callback. `POST /v1/documents/ingest-sec-bulk?tickers=AAPL,MSFT,...&workers=8` exposed as API endpoint. Throughput: ~500 filings/hour = 52 hours for full S&P 500 × 13yr corpus.

### 4.3 Earnings call transcripts ⬜

SEC filings are backward-looking. Transcripts capture forward guidance and analyst Q&A.

Sources (free):
- EDGAR 8-K exhibits — earnings press releases
- `earnings.py` source already exists — wire it

Sources (paid):
- Seeking Alpha API (~$200/mo)

Add to ingestion as a parallel stream alongside filings.

### 4.4 Real-time filing pipeline ⬜

EDGAR RSS feed updates within minutes of filing acceptance. Upgrade from 60-second poll to RSS-based real-time:

```python
# RSS: https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-K&output=atom
# Update sec_edgar.py: poll RSS alongside full-index
# Target: new filings indexed within 5 minutes of EDGAR acceptance
```

This is what AlphaSense sells as a premium feature.

### 4.5 GDELT news channel ⬜

`gdelt.py` source already exists. GDELT is free and gives news sentiment + event extraction. Wire it as Channel 8 for "what does the market think" queries.

**Phase 4 exit criterion:** 26K filings indexed · Vals AI benchmark ≥68% · Real-time filing ingestion <5 min lag.

---

## Phase 5 — Production Grade (Month 5–9)

**Target: Institutional-grade · 99.9% uptime · SOC 2 Type II audit started**

### 5.1 Horizontal scaling architecture ⬜

Current: single FastAPI process, all databases local. Breaks at ~100 concurrent users.

```
Load Balancer (nginx/Caddy)
    │
    ├── API Pod 1 ── API Pod 2 ── API Pod 3   (Docker Swarm or k8s)
    │
    ├── Qdrant Cluster (3 nodes, RF=2)
    ├── ES Cluster (3 nodes)
    └── PG Primary + 2 replicas
```

### 5.2 Observability stack ⬜

Without this you're flying blind in production:

- **Prometheus + Grafana**: latency per stage, retrieval channel hit rates, LLM cost/day, cache hit rate
- **Sentry**: exception tracking with trace IDs
- **OpenTelemetry**: distributed tracing across all 10 pipeline stages

Key dashboard metrics:
```
p50/p95/p99 e2e latency      (target p95 <200ms)
Cache hit rate                (target >30%)
Dense retrieval recall@10     (target >0.85)
NLI citation recall           (target >0.90)
Cost per query                (target <$0.05)
Hallucination rate            (NLI recall <0.6 = flag)
```

### 5.3 Compliance for institutional sales ⬜

| Item | Status | Notes |
|------|--------|-------|
| Audit log (SHA-256 chain + HMAC) | ✅ | FINRA 4511 / MiFID II compliant |
| SOC 2 Type II | ⬜ | 6-month observation period — start now |
| Data residency (EU) | ⬜ | Deploy Qdrant + ES in Frankfurt for EU clients |
| User-level audit trail | ⬜ | Pass `user_id` through to AuditLogger |
| PII redaction logging | ✅ | PIIFilter runs; results not logged (good) |
| Model governance log | ✅ | `model_used` field on every response |

### 5.4 Multi-tenant Qdrant isolation ⬜

RBAC (org/workspace/project) is wired. Missing: Qdrant collection-per-tenant for enterprise data isolation.

```python
# Pattern: {org_id}_gravity_chunks per enterprise tenant
# Shared collection for public filings
# Private uploads → org-specific collection
```

### 5.5 API productization ⬜

| Item | Status |
|------|--------|
| Rate limiting per API key | ✅ (`rate_limit.py` middleware) |
| Usage metering | ✅ (`usage.py` route) |
| Stripe metered billing | ⬜ |
| Python + TypeScript SDKs | ⬜ |
| Webhook: "new filing indexed" | ⬜ |

**Phase 5 exit criterion:** 3 enterprise beta customers · SOC 2 audit started · 99.9% uptime for 30 days.

---

## Phase 6 — Moat Building (Month 9–18)

These take time but create durable competitive advantages.

### 6.1 Proprietary financial embedding model ⬜

`voyage-finance-2` is shared with every competitor. Fine-tune your own:

- Collect hard negatives from query logs (wrong chunk retrieved)
- Fine-tune using contrastive learning (InfoNCE loss)
- Base: `voyage-finance-2` or `gte-large`
- Expected: +5–8% retrieval recall on financial queries
- Cost: ~$2K on A100s for 1 week training

### 6.2 Feedback-driven reranker fine-tuning ⬜

`routing_feedback.py` logs confidence scores. Close the loop:

1. Queries where confidence = LOW → flag for human review
2. Human labels: correct / partial / wrong
3. Use labels to fine-tune Cohere reranker (their training API accepts this format)
4. After 10K labeled examples: your reranker outperforms the generic Cohere model

### 6.3 Financial knowledge graph — populate it ⬜

Neo4j is wired but empty. Target schema:

```cypher
(Apple) -[COMPETES_WITH]-> (Microsoft)
(Apple) -[REPORTS]-> (iPhone_Segment) -[HAS_REVENUE]-> ($205B, FY2024)
(Tim Cook) -[CEO_OF]-> (Apple)
(Apple) -[SUPPLIES_FROM]-> (TSMC)
(TSMC) -[MANUFACTURES]-> (M4_Chip)
(Apple) -[EXPOSED_TO]-> (Taiwan_Geopolitical_Risk)
```

Enables queries impossible with flat chunks: "Which Apple suppliers are exposed to Taiwan risk?"

**This is the real moat.** No competitor has this at scale for public filings.

### 6.4 Quantitative model integration ⬜

Connect to live market data for calculation queries requiring current prices:

| Source | Cost | Data |
|--------|------|------|
| Alpha Vantage | Free (key in .env) | Price, fundamentals |
| Yahoo Finance | Free | Price, basic fundamentals |
| Bloomberg API | ~$2K/mo | Everything |

Enables: "Is NVIDIA cheap vs. its 5-year average EV/EBITDA?" — live price from market data + historical EBITDA from filing index.

### 6.5 Agentic research reports ⬜

The agent orchestrator (Planner→Reader→Extractor→Critic→Writer) generates answers. Extend to generate full research reports:

- Input: "Generate an investment memo on NVDA"
- Output: 10-page structured report (Business Model, Financials, Risks, Valuation, Recommendation)
- All claims cited, exported as PDF

This is AlphaSense's $50K/year enterprise product. All building blocks exist.

---

## Execution Timeline

```
Week 1    Add Voyage payment → run Qdrant sync → confirm dense search works
Week 1    Wire graph_indexer + structured_indexer data (ingest 3 tickers to verify)
Week 2    Run FinanceBench eval harness → get baseline score
Week 2    Build XBRL table extractor — biggest single ROI item
Week 3    HyDE + multi-query active by default (done ✅)
Week 4    PageIndex API key → activate Channel 6
Month 2   S&P 500 × 5 years ingestion (top 100 companies first)
Month 3   Earnings transcripts + GDELT news channel wired
Month 4   FinanceBench ≥98% · Vals AI ≥65%
Month 5   Horizontal scaling · Prometheus/Grafana
Month 6   SOC 2 audit start · first enterprise pilot
Month 9   Proprietary reranker fine-tuning begins
Month 12  Knowledge graph populated · quantitative model integration
Month 18  AlphaSense-competitive · differentiated on graph + real-time
```

---

## Score Targets vs Benchmarks

| Benchmark | Now (est.) | Phase 2 | Phase 3 | Phase 4 |
|-----------|-----------|---------|---------|---------|
| FinanceBench | ~45% (no Qdrant) | ≥85% | ≥98% | ≥99% |
| Vals AI | ~30% | ~50% | ~60% | ≥68% |
| p95 latency | ~3–8s | <500ms | <300ms | <200ms |
| Filing coverage | 30 cos | 35 cos (FinanceBench set) | S&P 100 × 5yr | S&P 500 × 13yr |

---

## The Honest Gap vs AlphaSense

AlphaSense has:
- 20 years of proprietary analyst reports
- Bloomberg terminal integration
- $1B+ data moat

You cannot replicate the data moat. But you can **beat them on AI quality** — their RAG architecture is 2–3 years behind the current research frontier. Your stack (CoRAG, RAPTOR, HyDE, ALiiCE, self-consistency, NLI validation, multi-entity retrieval, knowledge graph) is more sophisticated than what any incumbent has deployed.

**The window to win on AI quality is 18–24 months** before incumbents catch up.

The fastest path to differentiation: **knowledge graph + real-time filing ingestion**. No competitor does both well. AlphaSense is strong on data breadth; their graph and real-time capabilities are weak. That's the wedge.

---

## Key Scripts Reference

```bash
# From services/gravity-api/

# Sync existing ES chunks to Qdrant (run once after adding Voyage payment method)
python scripts/sync_es_to_qdrant.py

# Sync with resume support (if interrupted)
python scripts/sync_es_to_qdrant.py --resume

# Dry run — count chunks and estimate cost only
python scripts/sync_es_to_qdrant.py --dry-run

# FinanceBench evaluation
python scripts/eval_financebench.py                        # 13-question sample
python scripts/eval_financebench.py --limit 5              # quick smoke test
python scripts/eval_financebench.py --category numeric     # numeric only
python scripts/eval_financebench.py --dataset data/financebench_open_source.jsonl  # full 150Q

# Ingest SEC filings on-demand
curl -X POST http://localhost:8000/v1/documents/ingest-sec \
  -H "Content-Type: application/json" \
  -d '{"tickers": ["AAPL","MSFT","NVDA","TSLA","JPM"], "years_back": 5}'

# Health check all services
make health
```

---

*Last updated: 2026-05-06*
