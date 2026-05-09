# Benchmark Specification for Citation-Grounded Financial AI

> **Document purpose.** This is a complete, self-contained benchmark implementation guide for a financial research AI platform (RAG with contextual retrieval, hybrid search + reranking, grounding/citation/hallucination detection, LangGraph multi-agent orchestration, Excel/PDF/PowerPoint export, SEC EDGAR / earnings transcripts / macro data connectors). Target competitive claim: **"best citation accuracy in class."** Engineered to be reproducible, audit-able, and credible to buy-side quants and institutional procurement, and to enable head-to-head comparison against Fintool (Microsoft, April 2026), Hebbia, AlphaSense, Rogo, Brightwave, Vectify Mafin 2.5, and Perplexity Finance. Compiled 29 April 2026.

---

## Section 1 — Benchmark Philosophy and Methodology

### 1.1 Why reproducible, independent benchmarks matter

The financial AI research market in 2025–2026 is dominated by **self-reported, marketing-driven benchmark claims with widely varying methodology disclosure**. Of the ten most-cited vendors, only two — BloombergGPT (peer-reviewed in arXiv:2303.17564) and Vectify's Mafin 2.5 (open evaluation code at `github.com/VectifyAI/Mafin2.5-FinanceBench`) — publish reproducible methodology.

Headline numbers like Fintool's "98% on FinanceBench" (press release, 8 April 2025) and "90% on Vals AI Finance Agent Benchmark" (vendor blog, 9 October 2025) are **not present on the official Patronus or Vals AI leaderboards**; they are vendor-internal evaluations on subsets the vendor selected. Hebbia's "92% accuracy with o1" (OpenAI customer story) is on an undisclosed internal benchmark with no question count, no public dataset, and no third-party verification. Rogo's "2.42× more accurate than ChatGPT on FinanceBench" reports only a relative ratio. Brightwave publishes no specific numbers. AlphaSense publishes only marketing language ("highly accurate," "trained specifically on financial data").

Independent academic evaluations tell a starkly different story. The **Vals AI Finance Agent Benchmark** (arXiv:2508.00828) reports the best frontier model (OpenAI o3) achieving **only 46.8% accuracy** at $3.79/query on the held-out 337-question test set. The **Finch benchmark** (arXiv:2512.13168, late 2025) shows GPT 5.1 Pro spending 16.8 minutes per workflow yet passing only 38.4% of workflows. The **Patronus leaderboard reports GPT-4o-mini at ~52% on FinanceBench** — the canonical reproducible baseline. The gap between vendor-claimed 90%+ and independently measured 40–60% on real workflows is the **single most important credibility problem** this specification is engineered to solve.

A reproducible, independently runnable benchmark suite — whose every dataset, scoring script, NLI judge, prompt template, and harness is version-pinned and publishable — converts a marketing claim into an audit-able artifact. **Buy-side quants and institutional buyers in 2026 increasingly demand this kind of artifact** before signing enterprise contracts; SOC 2 Type II reports, model risk management committees, and FINRA examiners now routinely ask for it.

### 1.2 Closed proprietary versus open public benchmarks

Three categories of benchmark coexist in this space, each with distinct trust properties:

**Open public benchmarks** (FinQA, ConvFinQA, TAT-QA, MultiHiertt, ALCE, RULER, LongBench v2, LegalBench-RAG): full datasets, evaluation scripts, and (usually) baselines are downloadable. These are fully reproducible by any third party but vulnerable to **training-data contamination** because the data is on the public internet.

**Hybrid public/private benchmarks** (FinanceBench Open 150 + 10,081 closed; Vals AI Finance Agent 50 public / 150 licensable / 337 held-out test): a small public slice enables iteration, while a larger held-out test set defends against leaderboard gaming and contamination. **This is the gold-standard structure for a credible commercial benchmark** and is the model adopted in Section 2.

**Closed proprietary benchmarks** (Hebbia internal benchmark, Rogo "Answer Quality Score," Brightwave "On benchmark of financial questions," AlphaSense unspecified): the dataset, methodology, judge, and prompts are not released. Numbers cannot be reproduced and should be treated as marketing assertions, not measurements. **A platform serious about the "best citation accuracy in class" claim must publish on hybrid public/private benchmarks and abstain from closed proprietary headline numbers.**

### 1.3 The Fintool/Microsoft "RAG Obituary" shift to agentic search

On **1 October 2025**, Fintool CEO Nicolas Bustamante published *"The RAG Obituary: Killed by Agents, Buried by Context Windows"*, which hit #1 on Hacker News. The argument: classical RAG (chunking + embeddings + rerankers) was an artifact of GPT-3.5's 4,096-token context window. With Claude and Gemini now serving 1–2M token contexts, agents that "read end-to-end" are the future. In **January 2026 Fintool launched V5**, a fully agentic experience, and in **mid-April 2026 Microsoft acquired Fintool** to integrate it into Office/Excel/PowerPoint for financial services.

The Hacker News technical community pushed back: (a) enterprise corpora exceed 2M tokens in many real workflows, (b) `grep` has no semantic understanding, and (c) the empirical record shows Mafin 2.5 achieves 98.7% on FinanceBench Open 150 but discloses zero data on latency, throughput, or cost; full-context agentic search costs 10–100× a tuned hybrid retrieval pipeline; and the Vals AI Finance Agent leaderboard ceiling is still ~64% for fully agentic systems.

**Implication for benchmark design.** A 2026 benchmark for a citation-grounded financial AI must measure **both** classical-RAG and agentic configurations on the same task, and explicitly report cost and latency alongside accuracy. Section 4 defines three inference modes — closed-book, retrieval-only RAG, and agentic — and reports all three.

### 1.4 Constructing an audit-able methodology section

A benchmark methodology that earns credibility with institutional buyers must satisfy six requirements:

1. **Dataset provenance** — every datapoint traceable to a primary public source (SEC EDGAR accession number, transcript provider, FRED series ID)
2. **Version pinning** — exact commit SHA of every benchmark repo, exact model snapshot ID for every API call, exact embedding/reranker model version
3. **Prompt transparency** — every system prompt, user prompt template, few-shot example, and tool-spec published alongside results
4. **Harness transparency** — Docker image hash for the inference harness, with deterministic seeds where supported
5. **Judge transparency** — the NLI/LLM-as-judge model, version, prompt, and a human-validation calibration set with reported Cohen's κ
6. **Third-party reproducibility statement** — explicit instructions for an external auditor to rerun the suite, including approximate compute and time cost

The methodology section of any benchmark report should follow the **MLPerf Inference v5 disclosure template** adapted to RAG: System Description → Benchmark Configuration → Result Summary → Compliance Appendix.

### 1.5 The document context presence debate

FinanceBench's original paper (arXiv:2311.11944) reported GPT-4-Turbo at **85% with oracle (gold) context, 79% with full-document long context, 50% with single-vector-store retrieval, and 9% closed-book**. The 76-percentage-point gap between gold context and closed book is the single most important methodological choice in financial RAG evaluation.

A credible benchmark must report all three conditions on the same model:

- **Closed-book** (no retrieval): isolates parametric knowledge / contamination. A model scoring high here on 2024 filings is suspicious; a model scoring low is honest about ignorance.
- **Gold-context** (oracle passage provided): isolates the LM's reading and reasoning capability from the retrieval system's quality. Upper bound on what retrieval can deliver.
- **Retrieval-only** (your production pipeline): the realistic deployment number. The "production accuracy" claim should always be this one.

The gap between gold-context and retrieval-only directly measures the quality of the retrieval stack. **Citation accuracy can only be honestly evaluated under retrieval-only or agentic conditions**; gold-context evaluation pre-supplies the answer source and degenerates citation precision into a triviality.

### 1.6 Structuring a benchmark paper / technical report

A technical report intended to credibly support a "best citation accuracy in class" claim should follow this structure:

- **Front matter**: 1-page executive summary with single-table headline numbers (accuracy, citation precision, citation recall, p95 latency, $/query) for each benchmark, against named competitors, with explicit confidence intervals
- **Section 1**: Motivation and prior work, including a transparent table of competitor self-reported numbers and our reproductions of them
- **Section 2**: Dataset descriptions with full provenance tables
- **Section 3**: System description (RAG architecture, agentic orchestration topology, models used, citation emission protocol)
- **Section 4**: Experimental protocol (prompts, judges, harness, hardware, seeds)
- **Section 5**: Results, including ablations across closed-book/gold/retrieval-only/agentic and across the cost-accuracy frontier
- **Section 6**: Failure analysis with categorized error taxonomy
- **Section 7**: Compliance and audit appendix
- **Section 8**: Limitations and threats to validity (contamination, judge bias, dataset coverage)

**Two specific stylistic conventions earn credibility**: report numbers with **bootstrap 95% confidence intervals** (the small public sets — FinanceBench 150, Vals AI 50 — have wide CIs that vendor reports routinely hide); and include a **calibration table** showing the human-vs-judge agreement κ on a held-out 50-question slice of each benchmark.

### 1.7 Citation methodology transparency requirements

The single most over-claimed metric in financial AI marketing is "citation accuracy." Vendors variously mean:

- (a) "we display a hyperlink to a source"
- (b) "the sentence cited contains the answer somewhere"
- (c) "the cited passage entails the claim under an NLI judge"
- (d) "every atomic claim is independently entailed by its citations"

These differ by 30+ percentage points on the same outputs. A platform claiming "best citation accuracy in class" must publish, at minimum: the **citation granularity** (document, section, chunk, sentence, span); the **judge model and prompt**; the **claim decomposition method** (sentence-level vs. atomic-claim level); the **numeric-equivalence policy**; and the **negative-control rate** (frequency of detection of adversarial peer-company or prior-year passages substituted as distractors).

This document standardizes on **ALCE-style citation recall and precision via NLI** (`google/t5_xxl_true_nli_mixture`) at sentence level for backward comparability, and **ALiiCE-style atomic-claim decomposition with a hybrid GPT-class LLM-as-judge plus deterministic numeric pre-check** for fidelity. Both numbers are reported.

---

## Section 2 — Benchmark Suite Definitions

This suite spans six dimensions: end-to-end accuracy on filings (FinanceBench), agentic research accuracy (Vals AI Finance Agent), citation precision/recall (ALCE-adapted), numerical reasoning (FinQA + ConvFinQA), latency/cost (MLPerf-derived), and enterprise audit-trail compliance.

---

### 2.1 FinanceBench (10-K/10-Q/Earnings Q&A)

| Field | Specification |
|---|---|
| **Full name** | FinanceBench: A New Benchmark for Financial Question Answering |
| **Reference** | Islam, Kannappan, Kiela, Qian, Scherrer, Vidgen — Patronus AI / Contextual AI / Stanford. **arXiv:2311.11944** (Nov 2023) |
| **Dataset size** | **10,231 total questions** (closed); **150 publicly released** ("Open 150" / `OPEN_SOURCE` subset) |
| **Composition** | 40 publicly traded U.S. companies, 9 of 11 GICS sectors. **361 public filings**: 270 × 10-K, 27 × 10-Q, 29 × 8-K, 29 × Earnings Reports, 5 × Annual Reports. 93% of questions tied to 10-Ks. Source filings 2015–2023. |
| **Question categories** | Domain-relevant (n=925); Novel-generated (n=1,323, expert-written); Metrics-generated (n=7,983, templated) |
| **Reasoning taxonomy** | Information Extraction 28%, Numerical Reasoning 66%, Logical Reasoning 6% |
| **Open 150 composition** | 50 domain-relevant (stratified) + 50 novel-generated (random) + 50 metrics-generated (random) |
| **Evaluation metric** | Manual human grading into {Correct, Incorrect, Failure to answer}. Minor unit-conversion deviations and small rounding errors permitted. |
| **Auto-grader recommendation** | Hybrid: (1) deterministic numeric-equivalence check with unit normalization (currency, scale, percent, basis-points, ±1 in last reported digit); (2) GPT-class LLM-as-judge fallback. Calibrate against ≥50 manually graded responses; require Cohen's κ ≥ 0.80 before publishing auto-grader numbers. |
| **How to obtain** | `git clone github.com/patronus-ai/financebench` → `data/financebench_open_source.jsonl` + `pdfs/`; or `huggingface.co/datasets/PatronusAI/financebench`. Closed 10,081: email `contact@patronus.ai`. |
| **License** | CC BY-NC 4.0 (non-commercial). For commercial benchmark publication, document fair-use defense or seek Patronus license. |
| **Inference modes (run all four)** | Closed-book; Gold-context (provide `evidence` field); Retrieval-only (your production hybrid retrieval over 361 source PDFs); Agentic (LangGraph orchestrator with EDGAR + parser tools) |
| **Reference scores** | Original paper (Open 150): GPT-4-Turbo Oracle 85%, Long-context 79%, Single-vector-store 50%, Closed-book 9%. 2024–2026: GPT-4o ~80–83% with retrieval; Mafin 2.5 (PageIndex) 98.7% claimed; Patronus GPT-4o-mini ~52%; Fintool self-reports 98% (subset undisclosed). |
| **Scoring script** | `eval/financebench_grader.py` wrapping `evaluation_playground.ipynb` patterns plus hybrid auto-grader |
| **Reporting requirements** | Per-category accuracy (domain-relevant / novel-generated / metrics-generated); per-reasoning-type accuracy (extraction / numerical / logical); refusal rate; bootstrap 95% CI (n=150 → CI half-width ≈ ±7 pts at 80% accuracy — disclose this) |

---

### 2.2 Vals AI Finance Agent Benchmark

| Field | Specification |
|---|---|
| **Full name** | Finance Agent Benchmark: Benchmarking LLMs on Real-world Financial Research Tasks |
| **Reference** | Bigeard, Nashold, Krishnan, Wu (Vals AI + Stanford + a Global Systemically Important Bank). **arXiv:2508.00828** (May 2025). Live leaderboard: `vals.ai/benchmarks/finance_agent` |
| **Dataset size** | **537 expert-authored questions** (AfterQuery review, reviewers from Goldman Sachs, Silver Lake, Citadel) |
| **Splits** | 50 public (`data/public.csv`); 150 private (licensable); **337 held-out test** — leaderboard scores computed only on this held-out test by Vals AI |
| **Composition** | SEC EDGAR 10-K, 10-Q, 8-K, S-1 from 2024 (post-training-cutoff for most evaluated models). Anchor date: "today is 4/7/25." |
| **Task categories (9)** | Easy: Quantitative Retrieval (~19%), Qualitative Retrieval (~18%), Numerical Reasoning (~15%). Medium: Complex Retrieval, GAAP/non-GAAP Adjustments, Beat or Miss (~13%). Hard: Trends, Financial Modeling (~9%), Market Analysis (~6%). |
| **Tool harness (v1.1)** | Four tools: `EDGAR_search` (SEC_API, optional CIK), `web_search` (Tavily), `parse_html_page` (chunks filings to KV store), `retrieve_information` (targeted Q over parsed text). v1.1 requires explicit `submit` tool call for final answer. |
| **Evaluation metric** | LLM-as-judge final-answer accuracy via **rubric-based component-wise grading**. Judge: **GPT-5.2** (v1.1), mode of three independent evaluations. |
| **How to obtain / submit** | Harness OSS: `github.com/vals-ai/finance-agent`. Public 50: `huggingface.co/datasets/vals-ai/finance_agent_benchmark`. Zenodo: `zenodo.org/records/15428639`. Official submission: `platform.vals.ai`. |
| **Inference mode** | **Agentic only.** Gold-context and closed-book conditions are not meaningful for this benchmark. |
| **Reference scores (v1.1, snapshot 23 Apr 2026)** | Claude Opus 4.7 **64.37%**; Claude Sonnet 4.6 63.33%; Muse Spark (Meta) 60.59%; DeepSeek V4 60.39%; Claude Opus 4.6 (Thinking) 60.05%. v1.0 paper: o3 = **46.8%** at $3.79/query. **Fintool's self-reported 90% is on the 50-question public subset only and is not on the official leaderboard.** |
| **Scoring script** | `eval/vals_finance_agent_runner.py` invoking the upstream harness with our LangGraph agent; results submitted to Vals AI for held-out grading |
| **Reporting requirements** | Report public-50, private-150 (if licensed), and submitted-337 separately; include cost ($/query), latency, and tool-call counts; never headline the public-50 number alone |
| **Critical caveats** | Held-out grading is single-vendor; LLM-as-judge variance non-zero; results sensitive to harness changes (v1.0→v1.1 materially shifted scores); Tavily vs. SerpAPI choice has measurable effect |

---

### 2.3 Citation Precision and Recall (ALCE-Adapted for 10-K)

| Field | Specification |
|---|---|
| **Full name** | ALCE — Automatic LLM Citation Evaluation, adapted for SEC filings and earnings transcripts |
| **Reference** | Gao, Yen, Yu, Chen. *Enabling Large Language Models to Generate Text with Citations.* **arXiv:2305.14627** (EMNLP 2023). Code: `github.com/princeton-nlp/ALCE`. Atomic-claim extension: ALiiCE (Xu et al., NAACL 2025, **arXiv:2406.13375**). |
| **Dataset construction** | **400 expert-authored questions** over a corpus of 200 SEC filings (10-K, 10-Q, earnings transcripts) from 50 S&P 500 companies, fiscal years 2023–2025. Each question has: (a) free-form gold answer; (b) gold evidence spans in LegalBench-RAG format `(filename, char_start, char_end)`; (c) FActScore-style atomic-claim decomposition of gold answer; (d) ≥1 adversarial distractor passage (peer company same period, or same company prior FY). Splits: 100 public / 100 licensable / 200 held-out. |
| **Citation recall (sentence-level, ALCE-faithful)** | For each output sentence sᵢ with citation set Rᵢ: `recall_i = NLI(premise = concat(R_i), hypothesis = remove_citations(s_i)) ∈ {0,1}`. Sentences with zero citations score 0. Final = `100 × mean(ais_scores)`. |
| **Citation precision (sentence-level, ALCE-faithful)** | For each cited passage p ∈ Rᵢ where `\|Rᵢ\| > 1`: leave-one-out NLI test. p counts as precise if it alone entails sᵢ, or if `Rᵢ \ {p}` does not entail sᵢ. Final = `100 × mean(ais_scores_prec)`. |
| **NLI judge (primary)** | `google/t5_xxl_true_nli_mixture` (T5-11B, TRUE mixture; SNLI+MNLI+FEVER+SciTail+PAWS+VitaminC). Loaded `bfloat16`, `device_map="auto"`. Input: `"premise: {passage} hypothesis: {claim}"`; `max_new_tokens=10`; binary {0,1}. |
| **NLI judge (finance-augmented)** | (1) **Deterministic numeric pre-check** — parse currency/units/percent/bps; allow ±1 in last reported digit; mark numerically-equivalent claims as entailed before NLI. (2) **GPT-class LLM-as-judge fallback** for sentences the T5 judge marks unsupported. Report both T5-only (for ALCE comparability) and hybrid (for fidelity). |
| **Atomic-claim metrics (ALiiCE)** | Decompose each output sentence into atomic claims via dependency parse + LLM decomposer. Compute citation recall/precision per (atomic_claim, citation) pair. Target Cohen's κ vs. human ≥ 0.65. |
| **Span-level retrieval metrics** | Precision@k, Recall@k over **character-overlap** with gold spans (filename match + non-zero overlap of char ranges). Default k ∈ {1, 5, 10, 20}. |
| **Adversarial citation rate** | Fraction of distractor passages cited (peer-company or prior-FY substitutes). A robust system: ≤ 2%. Marketing-grade systems often show 10–25%. |
| **Negative controls** | 10% of questions have **no answerable evidence in corpus** (correct behavior: refuse with citation to absence). Hallucinated-answer-with-citation = severe failure (counted as both incorrect and a citation-precision-violation). |
| **How to run** | `eval/alce_runner.py` wrapping upstream `eval.py --citations --claims_nli --mauve --at_most_citations 5`; finance extension at `eval/alce_finance_extension.py` adding numeric pre-check, LLM fallback, atomic-claim decomposition, span-level Precision@k/Recall@k. |
| **Target scores** | Citation recall ≥ 92%, citation precision ≥ 90%, atomic-claim recall ≥ 88%, span Recall@5 ≥ 85%, adversarial citation rate ≤ 2%. Public ALCE baselines on Wikipedia: GPT-4 ASQA citation recall ~77%, precision ~73%. |
| **License** | Code MIT; SEC filings public domain; earnings transcripts: cite source provider, observe license. |

---

### 2.4 Numerical Reasoning — FinQA and ConvFinQA

#### FinQA

| Field | Specification |
|---|---|
| **Full name** | FinQA: A Dataset of Numerical Reasoning over Financial Data |
| **Reference** | Chen et al., **EMNLP 2021**, arXiv:2109.00122 |
| **Dataset size** | **8,281 QA pairs** (train 6,251 / dev 883 / test 1,147) |
| **Composition** | S&P 500 earnings reports 1999–2019 (via FinTabNet). Each example = `{pre_text, post_text, table, qa: {question, program, gold_inds, exe_ans, program_re}}`. Annotated by 11 finance professionals. |
| **DSL** | 10 ops: add, subtract, multiply, divide, greater, exp, table-max/min/sum/average |
| **Metrics** | **Execution Accuracy** (final numerical answer match on `exe_ans`); **Program Accuracy** (predicted program logically equivalent to gold, allowing commutative-op argument-order normalization) |
| **Inference modes** | Closed-book; Gold-context (full pre/post/table provided — canonical setting); Retrieval-only (your retrieval over 2,800 source 10-Ks). Always run gold-context as the canonical comparable number. |
| **Scoring script** | `code/evaluate/evaluate.py`. Run: `python evaluate.py predictions.json test.json`. **Critical caveat**: pre–May 2022 numbers are inflated by a `table_row_to_text` label-leak; canonical post-fix FinQANet-RoBERTa-large baseline = **61.24% exec / 58.86% prog**. |
| **How to obtain** | `github.com/czyssrs/FinQA` (MIT). HF: `dreamerdeo/finqa`, `Aiera/finqa-verified` (91-pair human-verified). License: CC BY 4.0. |
| **Reference scores** | FinQANet post-fix 61.24/58.86; Human expert ~91.16%; Ant Risk AI Challenge winner 71.93/67.03; GPT-4 ~76%; FinQAPT Dynamic 3-shot GPT-4: **80.6% exec** (current published SOTA); specialized 2024 pipelines reach ~89%. |
| **Reporting requirements** | Report exec + program accuracy on public test set with `evaluate.py`; report on Aiera-verified subset for noise-corrected number; do not cite pre–May 2022 baselines without flagging. |

#### ConvFinQA

| Field | Specification |
|---|---|
| **Full name** | ConvFinQA: Exploring the Chain of Numerical Reasoning in Conversational Finance Question Answering |
| **Reference** | Chen et al., **EMNLP 2022**, arXiv:2210.03849 |
| **Dataset size** | **3,892 conversations / 14,115 turns** (train 3,037 / dev 421 / test 434 conversations; test_turn 1,521) |
| **Composition** | Decomposed/concatenated FinQA questions rewritten conversationally. Type I "simple" (single decomposed) + Type II "complex" (concatenated). Cross-turn numerical dependencies. |
| **Metrics** | Same DSL as FinQA; per-turn `cur_type` ∈ {number selection, program}. Turn-level execution + program accuracy. |
| **Scoring script** | Same evaluation methodology as FinQA. **Test gold not released** — submit to **CodaLab** competition `lisn.upsaclay.fr/competitions/8582`. Many third-party "ConvFinQA evaluations" report dev-set only — flag this when comparing. |
| **How to obtain** | `github.com/czyssrs/ConvFinQA` (MIT); ships as `data.zip`. HF mirrors have schema variation; canonical source is `data.zip`. |
| **Reference scores** | Paper baselines < 70% exec; human 89.4% exec; GPT-4 PoT/CoT ~76–78%; multi-agent reflection ~80%+ on dev. |
| **Reporting requirements** | Report turn-level exec + program; CodaLab submission for test set; flag dev-vs-test explicitly. |

#### Supplementary Numerical-Reasoning Benchmarks (recommended secondary tier)

- **TAT-QA** — 16,552 Qs, hybrid table+text, EM and numeracy-F1. GPT-4 PoT ≈ 85–87% F1, human 90.8%. Repo: `github.com/NExTplusplus/TAT-QA`
- **MultiHiertt** — 10,440 Qs, multi-hierarchical tables. GPT-4 PoT ≈ 50–55% exec, human ~83%. Repo: `github.com/psunlpgroup/MultiHiertt`

---

### 2.5 Latency and Cost per Query

| Field | Specification |
|---|---|
| **Workload definition** | Three workload tiers on a fixed 200-question stratified sample (FinanceBench Open 150 + Vals AI public 50): **(T1) Trading-floor lookup** (single-fact extraction); **(T2) Analyst Q&A** (single-document); **(T3) Deep research** (multi-document synthesis with citations) |
| **Latency metrics** | **TTFT** (time-to-first-token); **TPOT/ITL** (decode-only: `ITL = (e2e − TTFT) / (output_tokens − 1)`); **E2E latency**. Report **p50, p95, p99** with explicit n. Disclose: cold-start vs. warm-cache, concurrency level, region. |
| **Cost decomposition (per query)** | Embedding cost (query) · Vector retrieval cost · Reranker cost · LLM input tokens (cached vs. uncached, separately) · LLM output tokens · Tool/function call costs · Index storage amortization |
| **Provider price normalization (Q1 2026 reference)** | USD/1M tokens, separate input/output, disclose cache discount assumptions. Reference rates: Claude Sonnet 4.6 $3 / $15; Claude Opus 4.6 $5 / $25; GPT-5.2 $1.75 / $14; Gemini 3 Flash $0.50 / $3. **Verify against provider pricing pages at run time** — these change monthly. |
| **Cold/warm protocol** | **Cold**: ≥5-minute idle gap before query, no prior cache hit. **Warm**: query issued ≤30s after a prior query sharing system prompt + retrieved context. Report both. Disclose cache hit rate during measurement window. |
| **Latency budgets (target SLOs by workload)** | T1: E2E < 2s, TTFT < 500ms. T2: E2E < 5s, TTFT < 1.5s. T3: E2E < 30s, TTFT < 3s; agentic deep-research mode: E2E < 120s with progress streaming, first user-visible update < 5s. |
| **Load testing tools** | Primary: `vllm benchmark_serving.py` and **MLPerf Inference v5.1 LoadGen** (Server scenario, 99th-percentile latency thresholds). Secondary: LLMPerf (`github.com/ray-project/llmperf`), NVIDIA GenAI-Perf. Avoid: vanilla k6/Locust without LLM-specific token instrumentation. |
| **Concurrency profile** | Run at concurrency levels 1, 5, 25, 100 to characterize the latency–throughput–cost curve. Report goodput (throughput subject to TTFT < 1.5s SLO). |
| **MLPerf v5.1 reference thresholds** | Llama 3.1 8B (server): TTFT ≤ 2.0s, TPOT ≤ 100ms. Llama 3.1 8B (interactive): TTFT ≤ 0.5s, TPOT ≤ 30ms. Llama 2 70B (server): TTFT ≤ 2.0s, TPOT ≤ 200ms. |
| **Reporting requirements** | Cost-accuracy frontier plot (x: $/query log-scale; y: FinanceBench or Vals AI accuracy). Report Pareto-dominant configurations explicitly. Mafin 2.5 reports 98.7% accuracy but **does not disclose latency or cost** — name this as a transparency failure when comparing. |
| **Scoring script** | `eval/latency_cost_runner.py` → `results/latency_cost.json` + cost-accuracy frontier figure |

---

### 2.6 Enterprise Compliance and Audit-Trail Benchmark

This dimension produces a **conformance scorecard** auditable by SOC 2, FINRA, EU AI Act, and MiFID II reviewers rather than a single accuracy number.

#### Applicable frameworks

| Framework | Key requirements |
|---|---|
| **SOC 2 Type II** | TSP CC6.1, CC6.3, CC6.7, CC7.2, CC7.3, CC7.4, CC8.1 |
| **FINRA Rule 3110** | Supervision; Reg Notice 24-09 + 25-07 extending to GenAI |
| **FINRA Rule 4511 + SEC Rule 17a-4** | Records; post-2022 audit-trail alternative to WORM |
| **EU AI Act Art. 12, 14, 19** | Logging, human oversight, ≥6-month log retention |
| **MiFID II Art. 16(6) + ESMA AI Statement May 2024** | 5–7 yr retention |
| **NIST AI RMF 1.0** | Govern/Map/Measure/Manage |
| **ISO/IEC 42001:2023** | AI management systems |

#### Audit-trail log schema (per inference — minimum required fields)

```json
{
  "event_id": "uuid-v4",
  "timestamp": "ISO-8601 UTC",
  "session_id": "...",
  "request_id": "...",
  "trace_id": "W3C traceparent",
  "user": {
    "id": "...",
    "auth_method": "...",
    "ip": "...",
    "device_fingerprint": "..."
  },
  "tenant_id": "...",
  "query": {
    "raw": "...",
    "normalized": "...",
    "language": "...",
    "input_token_count": 0
  },
  "retrieval": {
    "vector_store": "...",
    "embedding_model": "...",
    "top_k": 20,
    "reranker": "cohere-rerank-v4-pro",
    "retrieved_chunks": [
      { "doc_id": "...", "chunk_id": "...", "score": 0.95, "source_uri": "..." }
    ]
  },
  "model": {
    "provider": "anthropic",
    "model_id": "claude-sonnet-4-6",
    "version_hash": "...",
    "system_prompt_id": "...",
    "system_prompt_hash": "sha256:...",
    "temperature": 0.0,
    "max_tokens": 8192,
    "seed": 42
  },
  "prompt_full_hash": "sha256:...",
  "response": {
    "raw": "...",
    "output_tokens": 0,
    "stop_reason": "end_turn",
    "citations": [
      {
        "chunk_id": "...",
        "char_span": [0, 100],
        "source_uri": "...",
        "confidence": 0.97
      }
    ],
    "confidence_score": 0.0
  },
  "performance": {
    "ttft_ms": 0,
    "e2e_ms": 0,
    "tokens_per_sec": 0
  },
  "cost": {
    "input_billable_tokens": 0,
    "cached_input_tokens": 0,
    "output_billable_tokens": 0,
    "embedding_usd": 0.0,
    "retrieval_usd": 0.0,
    "rerank_usd": 0.0,
    "llm_usd": 0.0,
    "total_usd": 0.0
  },
  "human_oversight": {
    "review_required": true,
    "reviewed_by": "...",
    "override_action": null,
    "override_reason": null
  },
  "policy": {
    "policy_version": "1.0.0",
    "filters_triggered": [],
    "guardrails_invoked": []
  },
  "integrity": {
    "prev_hash": "sha256:...",
    "record_hash": "sha256:...",
    "kms_signature": "..."
  }
}
```

#### Immutability requirements

- **WORM storage** (S3 Object Lock Compliance mode, Azure immutable blob, or dedicated WORM appliance) for SEC 17a-4(f) primary path
- **OR** rewriteable media + comprehensive audit-trail alternative (post-Oct 2022 17a-4 amendments)
- SHA-256 hash chain (each record references prior `record_hash`)
- KMS-backed digital signatures
- RFC 3161 trusted timestamps
- Optional: Merkle-root anchoring to a public chain for external timestamping

#### Retention policy

Apply **7 years as conservative default** for AI audit trails in financial services, with first 2 years readily accessible. Basis: FINRA Rule 4511 = 6 years; SEC 17a-4 = 6 years; MiFID II = 5 years (7 in some Member States); EU AI Act Art. 19 = ≥6 months; BSA = 5 years.

#### Reproducibility-of-historical-answers test

Sample 30 historical inferences ≥ 90 days old. For each, attempt to reproduce: query → same retrieved chunks → same prompt → identical model snapshot → response. Pass if ≥ 28/30 reproduce within numeric/citation tolerance. **Snapshot retrieved chunks at retrieval time** (not pointers — source documents may have been updated/deleted).

#### Human oversight (EU AI Act Art. 14)

UX must enable a designated reviewer to: understand capacity/limits, monitor in real time, detect anomalies, interpret outputs, **override or disregard** any output, and **halt** the system via a reachable stop control. For high-risk decisions (e.g., trade authorization), enforce two-person verification. Log every override with reason.

#### Conformance scorecard

| Control | Metric | Target |
|---|---|---|
| Log completeness | % of inferences with complete schema | 100% |
| Log integrity | % of records passing hash-chain + signature verification | 100% |
| Reproducibility | Fraction of sampled historical inferences that reproduce | ≥ 95% |
| Override coverage | Fraction of high-risk inferences with reviewer attestation | 100% |
| Retention conformance | Oldest record age ≥ 7 years OR documented sunset rationale | Pass |
| Access-control | Passing SOC 2 Type II audit | Pass |

#### Vendor comparison (public claims, April 2026)

| Vendor | Disclosed |
|---|---|
| Hebbia | SOC 2 Type II, in-line citations, AES-256/TLS 1.3, GDPR, RBAC, zero retention |
| Rogo | Zero-trust, RBAC, AWS Bedrock isolation, third-party pen tests |
| Fintool | Three-agent verification, SEC/FINRA alignment claimed, model-agnostic |
| AlphaSense | Permissioned access, traceable sources, every search logged |

**None publicly disclose hash-chain immutability, WORM specifics, retention periods, or reproducibility-across-deprecation guarantees** — this is the credibility gap a serious benchmark exposes and a compliant platform fills.

#### How to test

- `compliance/audit_trail_check.py` — validates schema + hash chain + signature chain + retention policy on a live log sample
- `compliance/reproducibility_check.py` — replays sampled historical queries
- Both produce machine-readable conformance reports for inclusion in SOC 2 Type II evidence packages

---

## Section 3 — Cross-Cutting Reporting Requirements

Every report produced from this benchmark suite must include:

1. A **single headline table** per benchmark with accuracy + citation metrics + p95 latency + median $/query and 95% bootstrap CIs
2. A **competitor reproduction table** showing this platform's numbers alongside a re-run of the closest open competitor (Vectify Mafin 2.5 is the only one fully reproducible)
3. Explicit **inference-mode disclosure** for every number (closed-book / gold-context / retrieval-only / agentic)
4. **Judge calibration** — Cohen's κ vs. human on a ≥50-question slice for FinanceBench, Vals AI, ALCE atomic-claim
5. A **cost-accuracy frontier figure**
6. A **failure taxonomy** with categorized examples: hallucinated number, mis-citation, peer-company adversarial-citation, refusal-on-answerable, units error, table-cell extraction error
7. A **threats-to-validity section** explicitly addressing training-data contamination of public SEC filings, judge-model bias, dataset coverage limits, and harness sensitivity
8. A **compliance appendix** mapping each measurement to SOC 2 / FINRA / EU AI Act / MiFID II / NIST AI RMF / ISO 42001 controls

---

## Section 4 — What This Benchmark Proves and What It Cannot

A platform that runs this suite produces, for the first time in this market, an **end-to-end auditable accuracy + citation + latency + cost + compliance bundle** that buy-side quants and institutional procurement can independently verify.

The headline FinanceBench number is no longer a marketing slogan; it is one of four conditions (closed-book, gold-context, retrieval-only, agentic) reported with confidence intervals and judge-calibration κ. The "best citation accuracy in class" claim is operationalized as a four-part vector:

- Sentence-level ALCE recall and precision
- Atomic-claim ALiiCE recall
- Span-level Recall@k
- Adversarial-citation rate

Three things this suite **cannot** prove:

1. **Out-of-domain robustness** — every benchmark is US public equities + SEC filings + a slice of earnings transcripts; fixed income, derivatives, private credit, structured products, and non-US filings are out of scope and require their own evaluation
2. **Freedom from contamination** — SEC filings are public, and frontier models have likely seen them; the mitigations (Vals AI's 2024-only filings, hold-out test sets, adversarial distractors) reduce but do not eliminate the risk
3. **Real-world workflow utility** — Finch (arXiv:2512.13168) shows GPT 5.1 Pro passing only 38.4% of full analyst workflows even when it scores 60%+ on isolated questions; benchmark accuracy is necessary, not sufficient, for production value

The path forward is to publish this suite's headline numbers with full reproducibility artifacts; **submit officially to the Vals AI held-out test set** rather than self-reporting on the public 50; rerun Vectify Mafin 2.5's open code as the apples-to-apples public competitor; and pair every accuracy claim with a latency, cost, and compliance disclosure of equal prominence.

---

## Appendix A — Benchmark Dataset Quick Reference

| Benchmark | Size | Public subset | License | Canonical metric |
|---|---|---|---|---|
| FinanceBench | 10,231 Q | 150 | CC BY-NC 4.0 | Human-graded accuracy |
| Vals AI Finance Agent | 537 Q | 50 | Research use | LLM-as-judge rubric accuracy |
| ALCE-Finance (custom) | 400 Q | 100 | CC BY / public domain | Citation recall + precision |
| FinQA | 8,281 Q | Full | CC BY 4.0 | Execution + program accuracy |
| ConvFinQA | 14,115 turns | Train+dev | MIT | Turn-level execution accuracy |
| TAT-QA | 16,552 Q | Full | MIT | EM + numeracy-F1 |
| MultiHiertt | 10,440 Q | Full | MIT | Execution accuracy |

---

## Appendix B — Reference Scoring Scripts

```
eval/
  financebench_grader.py        # FinanceBench auto-grader (numeric + LLM-judge)
  vals_finance_agent_runner.py  # Vals AI harness wrapper for LangGraph agent
  alce_runner.py                # ALCE sentence-level recall + precision
  alce_finance_extension.py     # Finance extension: numeric pre-check, atomic claims
  finqa_runner.py               # FinQA evaluation.py wrapper
  convfinqa_runner.py           # ConvFinQA eval wrapper + CodaLab submission prep
  latency_cost_runner.py        # Latency/cost measurement + frontier plot

compliance/
  audit_trail_check.py          # Schema + hash-chain + signature + retention validation
  reproducibility_check.py      # Historical-query replay harness

results/
  financebench.json
  vals_ai.json
  alce_finance.json
  finqa.json
  convfinqa.json
  latency_cost.json
  compliance_scorecard.json
  headline_table.md             # Auto-generated executive summary table
```

---

## Appendix C — Competitor Self-Reported vs. Independently Reproduced Numbers

| System | FinanceBench (self-reported) | FinanceBench (reproduced) | Vals AI (self-reported) | Vals AI (leaderboard) | Disclosed methodology |
|---|---|---|---|---|---|
| Fintool (Microsoft) | 98% | Not reproduced (subset undisclosed) | 90% | Not on leaderboard | Subset undisclosed |
| Vectify Mafin 2.5 | 98.7% | Reproducible via OSS | Not reported | Not submitted | Code OSS ✓ |
| Hebbia | 92% (internal) | Not reproducible | Not reported | Not on leaderboard | Closed ✗ |
| AlphaSense | Not reported | — | Not reported | — | Closed ✗ |
| Rogo | 2.42× ChatGPT (relative) | Not reproduced | Not reported | — | Closed ✗ |
| Brightwave | Not reported | — | Not reported | — | Closed ✗ |
| GPT-4o (Patronus baseline) | ~52–83% (varies by mode) | Reproducible | — | — | Open ✓ |
| o3 (Vals AI paper) | — | — | 46.8% | Leaderboard ✓ | Open ✓ |
| Claude Opus 4.7 | — | — | 64.37% | Leaderboard ✓ | Open ✓ |
| **This platform** | *[fill after run]* | Reproducible | *[fill after submission]* | Official submission | **Full ✓** |

---

*Prepared 29 April 2026. All benchmark dataset sizes, splits, and reference scores verified against primary sources (arXiv papers, GitHub repositories, official leaderboards) as of compilation date. Model pricing verified against provider pricing pages; verify again before publishing cost numbers. Vals AI leaderboard scores as of snapshot 23 April 2026.*
