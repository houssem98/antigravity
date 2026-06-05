# Antigravity — Model Strategy (which model for which feature)

**Principle:** best tool per task, with automatic failover so no single provider
outage stops the product. Grounded in June 2026 benchmarks (sources at bottom).

---

## 1. Embeddings — why Gemini

Embeddings are the one component that was a **single point of failure** (Voyage
only). Now a failover chain. Model choice is data-backed, not just price:

- **Gemini-embedding-001 = #1 MTEB English (68.32)** — best retrieval quality of
  any API embedding model in 2026.
- **Free** on the `GOOGLE_API_KEY` already configured.
- 1024-dim (Matryoshka) → drop-in with the existing Qdrant collection.
- Voyage-finance-2 still wins on *finance-domain specifically* (+4–6 pts), but it
  is paid/blocked — and the **Cohere reranker already closes most of that gap.**

**Failover chain** (`get_embedder()` → `FallbackEmbedder`):
```
voyage (finance-tuned, if credit) → openai-3-large (1024) → gemini-001 (free) → local bge-m3 (offline)
```
Per-provider circuit breaker; last-good tried first; all output 1024-dim.

---

## 2. Per-feature model map

| Feature | Primary | Fallback | Why |
|---|---|---|---|
| **Embeddings** | gemini-embedding-001 | voyage → openai → local | #1 MTEB, free |
| **Reranking** | Cohere rerank-v3.5 | voyage rerank | have key; recovers finance edge |
| Query understanding | Gemini Flash | Groq / Haiku | cheap, fast, 70% of load |
| Contextual blurbs (ingest) | Gemini Flash | DeepSeek | high-volume, cheap |
| RAPTOR summaries (ingest) | Gemini Flash | DeepSeek | high-volume, cheap |
| Main answer (≈70%) | Gemini Flash/Pro | Sonnet | cheap, good enough |
| Multi-hop synthesis (≈20%) | Claude Sonnet 4.x | GPT-5 | strong reasoning |
| **Math / DCF (binding constraint)** | GPT-5 **or** Claude Opus 4.6 | the other | top FinanceReasoning; via tool-use |
| **Contradiction / thesis (≈8%)** | **LLM Council** | Opus solo | max accuracy, high stakes |

---

## 3. LLM benchmark facts that drive the map (June 2026)

FinanceReasoning (238 hard quantitative questions):
- **GPT-5: 88.23%** (SOTA accuracy)
- **Claude Opus 4.6: 87.82%** — near-top **and most token-efficient** (132K tokens)
- DeepSeek-R1: **62.18% while burning 1.25M tokens** — worst efficiency
- Gemini 2.5 Flash: 65.55% (fine for *simple* queries, not hard math)

**Implication:** route hard numeric/thesis work to GPT-5 / Opus 4.6. Use Flash for
the cheap 70%. **Do not** route hard reasoning to DeepSeek.

---

## 4. ⚠️ On DeepSeek (correcting "it's cheaper")

DeepSeek is cheap *per token* but **token-inefficient and weaker on hard finance**
— it can cost *more* in total tokens than Opus while scoring 25 pts lower. Correct
use: a cheap fallback for **simple generation only**. Never the math/thesis path.

It also **cannot do embeddings** — that gap is filled by Gemini/OpenAI, not DeepSeek.

---

## 5. LLM Council (Karpathy) — for the hardest ~8%

For contradiction detection and investment thesis, one model is risky. The council
(`app/core/agents/llm_council.py`) runs:

```
Stage 1  all members answer in parallel        (GPT-5, Claude Opus 4.6, Gemini 3 Pro)
Stage 2  anonymized peer-ranking               (no self-bias)
Stage 3  chairman synthesizes final answer     (chairman = Claude Opus 4.6)
```

- **Cost:** ~N+1 model calls → **gate to the ~8%** of queries that justify it
  (complexity score from query understanding).
- **Graceful degrade:** <2 live members → single chairman call.
- **Integration:** plug into the orchestrator's Critic/Verifier stage; emit the
  member answers + rankings to the agent-trace UI for transparency.

---

## 6. Resilience summary (no single point of failure)

| Layer | Failover |
|---|---|
| LLM generation | Router: Gemini → Sonnet → Opus → DeepSeek/Groq |
| **Embeddings** | **FallbackEmbedder: voyage → openai → gemini → local** ✅ new |
| Rerank | Cohere → Voyage → (skip; RRF still ranks) |
| Retrieval channels | ES/Neo4j/SPLADE down → channel skipped, RRF fuses the rest |
| Cache/rate-limit | Redis down → in-memory fallback |

The product answers as long as **one** embedder and **one** LLM are alive.

---

## Sources
- [Embedding leaderboard MTEB April 2026](https://awesomeagents.ai/leaderboards/embedding-model-leaderboard-mteb-april-2026/)
- [Best embedding models for RAG 2026 — Milvus](https://milvus.io/blog/choose-embedding-model-rag-2026.md)
- [Benchmark of 38 LLMs in Finance (FinanceReasoning)](https://aimultiple.com/finance-llm)
- [LLM Council — karpathy/llm-council](https://github.com/karpathy/llm-council)
