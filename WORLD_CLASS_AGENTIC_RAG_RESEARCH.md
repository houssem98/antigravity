# Building World-Class Agentic RAG for Financial Documents

**Scope:** SEC filings, earnings-call transcripts, news, broker/sell-side research.
**Method:** synthesized from current SOTA systems and primary sources (June 2026).
**Bottom line:** the winning design is **two-level retrieval** (corpus → document) +
**contextual chunking** + **agentic tool-use reasoning** + **verification gate**.
Vector search alone tops out ~19–56% on FinanceBench; the systems below hit **87–98.7%**.

---

## 0. The evidence (what actually works, with numbers)

| System / method | FinanceBench acc. | Key idea | Source |
|---|---|---|---|
| Vector RAG (2023 baseline) | **19%** | naive embed + similarity | [Dewey](https://meetdewey.com/blog/financebench-eval) |
| LiveAI multi-agent | 56% | multi-agent over filings | [Pathway](https://pathway.com/blog/ai-for-sec-filings) |
| Full-context GPT-4-Turbo | 78% | stuff whole doc in context | [Dewey](https://meetdewey.com/blog/financebench-eval) |
| Dewey + Claude Opus 4.6 | **87.3%** | agentic iterative search + enrichment | [Dewey](https://meetdewey.com/blog/financebench-eval) |
| LinqAlpha | 97.2% | specialized financial agent | [Dewey](https://meetdewey.com/blog/financebench-eval) |
| **Mafin 2.5 (PageIndex)** | **98.7% (SOTA)** | vectorless tree-reasoning RAG | [PageIndex](https://pageindex.ai/blog/pageindex-intro) |

**The pattern:** accuracy climbs as you move from *similarity matching* → *reasoning over
structure* → *agentic computation with verification*. The LLM was never the bottleneck;
**retrieval relevance + numerical execution** were.

---

## 1. Why naive vector RAG fails on financial documents

From [Anthropic](https://www.anthropic.com/news/contextual-retrieval),
[PageIndex](https://github.com/VectifyAI/PageIndex), and
[Dewey](https://meetdewey.com/blog/financebench-eval):

1. **Similarity ≠ relevance.** 10-K pages are dense, tabular, near-identical to an
   embedding model — similarity search "fails catastrophically" telling them apart.
2. **Chunking fragments context.** Fixed chunks break tables, sentences, cross-section logic.
3. **In-document references die.** "See Appendix G", "as discussed in Note 14" — vector
   search can't *follow* a pointer; reasoning can.
4. **Multi-step numeric questions** need figures from several sections + correct math —
   one semantic hit returns incomplete context.
5. **No chat context.** Each query treated independently; follow-ups lose the thread.
6. **Cross-period gaps.** Quarterly docs score 60% vs 92% annual when prior periods
   aren't co-indexed for comparison.

---

## 2. The four building blocks (researched tools + methods)

### 2.1 Contextual Retrieval — *the cheapest big win* (Anthropic, Sep 2024)
Before embedding/indexing a chunk, prepend an LLM-generated **context blurb** describing
where it sits in the parent document ("This is from NVIDIA's FY2026 Q3 10-Q, Data Center
revenue table, comparing YoY…").

- Contextual **Embeddings**: −35% retrieval failure
- Contextual Embeddings + Contextual **BM25**: −49% (5.7% → 2.9%)
- \+ **Reranking**: up to **−67%** retrieval failure

> Antigravity already chunks-with-metadata-prefix. Upgrade that prefix from static
> metadata to an **LLM-generated contextual sentence** per chunk. Big, cheap accuracy gain.
> Source: [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)

### 2.2 PageIndex — *vectorless tree reasoning* (98.7% SOTA)
Build a **hierarchical TOC tree** per document (sections → subsections, each node = title,
node_id, page range, LLM summary, children). At query time the LLM **navigates the tree**
instead of doing ANN:

```
Read TOC → Select Section → Extract Info → Sufficiency Check → Answer
```
JSON node:
```json
{ "title": "Data Center Revenue", "node_id": "0042",
  "start_index": 31, "end_index": 34,
  "summary": "Q3 FY2026 data center segment results...",
  "nodes": [ ... ] }
```
Wins: no chunking artifacts, natural section boundaries preserved, **traceable** (returns
explicit page/section refs), follows in-doc references, handles chat context. Optimal for
**long professional docs (10-K, 10-Q, broker PDFs)**. Has a "PageIndex File System" for
tree-level reasoning across millions of docs.
Source: [github.com/VectifyAI/PageIndex](https://github.com/VectifyAI/PageIndex)

### 2.3 turbovec / TurboQuant — *vector search at 10M-doc scale*
When you *do* need vectors (broad semantic recall over news + cross-doc), turbovec is the
substrate: Rust + TurboQuant quantization, **no training phase**.

- **16× compression** (1536-dim fp32 → 384 bytes at 2-bit)
- **10M docs: 31 GB fp32 → 4 GB** quantized
- Beats FAISS IndexPQFastScan by **12–20%** speed; +0.4–3.4 pts R@1 recall
- SIMD kernels (NEON/AVX-512), **filtered search inside the kernel** (allowlist)
- Drop-in for LangChain / LlamaIndex / Haystack

> Use as the dense channel's quantized backend, or to make on-box vector search feasible at
> 400M-vector scale. Filtered-search-in-kernel matches our "pre-filter before ANN" need.
> Source: [github.com/RyanCodrai/turbovec](https://github.com/RyanCodrai/turbovec)

### 2.4 QuantMind — *multi-source knowledge extraction pattern*
Two-stage framework: **(1) Knowledge Extraction** — collect from many sources, parse
PDF/HTML/tables/figures, auto-categorize, dedup, quality-control; **(2) Intelligent
Retrieval** — DeepResearch (multi-hop), RAG, and structured Data-MCP access, plus a
semantic **knowledge graph** and domain finetuning.
Source: [github.com/LLMQuant/quant-mind](https://github.com/LLMQuant/quant-mind)

---

## 3. The synthesized world-class architecture

Combine all four into **two-level retrieval driven by an agentic loop**:

```
                          ┌──────────────────────────────────────────┐
  Query ─► Planner ──────►│ LEVEL 1 — Corpus routing                  │
   (entities, dates,      │  metadata filter + dense(turbovec) + BM25 │
    intent, channels)     │  → shortlist the RIGHT documents          │
                          └───────────────┬──────────────────────────┘
                                          │ (10–30 candidate docs)
                          ┌───────────────▼──────────────────────────┐
                          │ LEVEL 2 — In-document reasoning           │
                          │  PageIndex tree navigation per doc        │
                          │  (Read TOC→Select→Extract→Sufficiency)    │
                          └───────────────┬──────────────────────────┘
                                          │ relevant sections + cites
        ┌─────────────────────────────────┼─────────────────────────────┐
        ▼                ▼                 ▼               ▼              ▼
   Relevance        Extractor         Calculator       Critic        Verifier
   filter (yes/no)  (figures,         (TOOL-USE math:  (claim ↔       (citation
   per chunk        ratings, dates)   DCF, YoY, margin) source)       gate)
        └─────────────────────────────────┬─────────────────────────────┘
                                          ▼
                                   Writer (stream + cite)
                              ▲ loop/replan if quality < threshold
                              └ fallback: switch filing type (10-Q→8-K→call)
```

**Why this beats any single technique:**
- **Level 1** uses cheap dense+sparse (contextual, quantized) to find the right *documents*
  — survives 10M-doc scale via metadata pre-filter + turbovec.
- **Level 2** uses PageIndex reasoning to find the right *passages within* a document —
  the 98.7% trick, no chunking artifacts, traceable.
- **Tool-use math** fixes the binding constraint Dewey found: numerical execution, not
  retrieval, decides the hard questions. Opus got perfect arithmetic *only when it computed*.
- **Verification gate** = no uncited number ships → trust as a feature.
- **Fallback/corrective loop** (Captide): reformulate, switch source, scan more.

---

## 4. Per-channel treatment (the 4 source types)

| Channel | Ingest | Retrieval winner | Special handling |
|---|---|---|---|
| **SEC filings** | EDGAR text **+ XBRL facts** into SQL | PageIndex tree per filing | numbers queryable, not re-extracted; section-aware (MD&A/Risk/Notes); co-index prior periods (fixes 60%→92% quarterly gap) |
| **Earnings calls** | transcript + speaker diarization | contextual chunks + dense | split prepared vs **Q&A** (weight analyst Q&A for guidance); tag forward-looking; later audio sentiment |
| **News** | licensed wire, dedup, entity-link | dense (turbovec) + recency decay | event extraction → KG with timestamps; source-credibility weighting |
| **Broker research** | entitled PDFs + expert notes | PageIndex tree + structured extract | pull **price targets / ratings / estimate revisions** into SQL rows; strict per-user entitlement gating |

**Cross-channel reconciliation** (the moat): when call guidance contradicts 10-Q risk
factors or a broker downgrade, **surface the conflict with citations** — route to an
Opus-class model for contradiction detection.

---

## 5. How this maps onto the existing Antigravity codebase

Good news: the skeleton already matches. Concrete upgrades:

| Existing | File | Upgrade |
|---|---|---|
| 10-stage search pipeline | `app/core/search_pipeline.py` | insert Level-2 PageIndex step after corpus retrieval |
| 5 retrieval channels + RRF | `app/core/retrieval/` | add contextual-chunk index; back dense with turbovec quantization |
| Chunker (metadata prefix) | `app/ingestion/processing/` | replace static prefix with **LLM contextual blurb** (Anthropic method) |
| Agent orchestrator | `app/core/agents/orchestrator.py` | add Calculator(tool-use), Critic, **Verifier gate**, fallback-switch-source |
| Reranker | `app/core/retrieval/cohere_reranker.py` | keep — reranking is the last −67% failure lever |
| LLM router | `app/llm/router.py` | route numeric-heavy → Opus/reasoning (Dewey: model > search budget) |
| XBRL → SQL | `app/ingestion/indexing/structured_indexer.py` | parse XBRL facts so figures are SQL-queryable |
| KG | Neo4j (provision) | events/entities/contradictions with timestamps |

---

## 6. Build order (highest accuracy-per-effort first)

1. **Contextual chunking** (Anthropic) — cheapest −49% retrieval failure. Touch the chunker only.
2. **Reranking on** (already wired Cohere) — pushes to −67%. Verify it runs.
3. **Tool-use Calculator + Verifier gate** — fixes the numeric binding constraint + trust.
4. **PageIndex Level-2** — per-document tree reasoning → the 98.7% lever for long filings.
5. **turbovec dense backend** — makes 400M-vector scale affordable (10M docs → ~4GB).
6. **XBRL→SQL + co-index prior periods** — fixes quarterly cross-period gap.
7. **KG contradiction detection** — cross-source reconciliation, the differentiator.

---

## 7. Sources

- [PageIndex intro (Mafin 2.5, 98.7% FinanceBench)](https://pageindex.ai/blog/pageindex-intro)
- [PageIndex GitHub (VectifyAI)](https://github.com/VectifyAI/PageIndex)
- [turbovec GitHub (RyanCodrai / TurboQuant)](https://github.com/RyanCodrai/turbovec)
- [QuantMind GitHub (LLMQuant)](https://github.com/LLMQuant/quant-mind)
- [Anthropic — Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
- [Dewey — Agentic RAG FinanceBench eval (87.3% Opus, 97.2% LinqAlpha)](https://meetdewey.com/blog/financebench-eval)
- [Captide — Agentic RAG on SEC EDGAR](https://www.captide.ai/insights/how-to-do-agentic-rag-on-sec-edgar-filings)
- [Pathway — LiveAI for SEC filings](https://pathway.com/blog/ai-for-sec-filings)
- [IntuitionLabs — LLMs for financial document analysis](https://intuitionlabs.ai/articles/llm-financial-document-analysis)
