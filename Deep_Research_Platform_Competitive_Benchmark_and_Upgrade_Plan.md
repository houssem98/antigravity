# Building a World-Class Deep Research Platform for Finance: Competitive Benchmark and File-Level Upgrade Plan

*A two-part engagement report synthesizing the competitive landscape, the state of the art in agentic RAG for finance, and a concrete file-by-file upgrade roadmap for your current codebase.*

---

# PART 1 — COMPETITIVE BENCHMARK AND LANDSCAPE

## 1. Executive landscape: three archetypes are consolidating

The GenAI financial research category is converging on three archetypes that you must position against:

1. **Incumbent data vendors layering AI on top of proprietary data** — S&P Capital IQ Pro (ChatIQ + Document Intelligence 2.0, Oct 2025), Bloomberg Terminal AI features (AI Earnings Summaries, Document Insights, ASKB agent network), FactSet Mercury, LSEG/Refinitiv with Claude skills.
2. **Data infrastructure for other people's LLMs** — Kensho LLM-Ready API, Daloopa MCP, Quartr API. These are the *real long-term competitors*, because they can disintermediate you by pushing MCP servers directly into Claude/ChatGPT/Gemini.
3. **AI-native research products** — AlphaSense (with Tegus), Hebbia, Rogo, Brightwave, Finster, Linq, Fintool (now acquired by Microsoft), Perplexity Finance.

Architectures across all three archetypes are converging on: multi-agent orchestration (planner → retriever → reader → reasoner → writer → verifier), grid-style or report-style outputs with inline citations, multi-model routing, and deep connectors into customer document stores. The real moats are no longer model choice — they are **content access, entity resolution, and citation discipline**.

---

## 2. Flagship competitor profiles

### 2.1 AlphaSense — the content-moat leader

AlphaSense is the gravity well of the category. Founded 2011 by Jack Kokko (ex-Morgan Stanley), valued at **$4B in June 2024** after a $650M round co-led by Viking Global and BDT & MSD (with J.P. Morgan Growth Equity, SoftBank Vision Fund 2, Blue Owl participating), **ARR crossed $200M in April 2024** and the combined post-Tegus effective ARR was reported at ~$292M. The company serves **6,000–6,500 enterprise customers** including 88% of the S&P 100, 80% of top asset managers, 75% of top hedge funds, and 80% of top consultancies. Average ARR per customer grew from $28K to $66K in under three years.

The **Tegus acquisition (June 2024, ~$930M)** was transformational and represented a ~70% markdown from Tegus's $3B 2021 valuation. It brought ~100,000 expert call transcripts (now **150,000+**), the **Canalyst** library of professionally built models on ~4,000 public companies, **BamSEC** (a fast SEC filing navigator), and AskTegus. Expert Insights is now positioned as the largest investor-led expert transcript library anywhere.

The product surface is wide:

- **Smart Synonyms** (pre-LLM era) auto-expands financial queries across proprietary synonym libraries — AlphaSense's original moat.
- **Smart Summaries** built verticalized LLMs on top of that ontology.
- **Generative Search** (2024, upgraded October 2025) provides multi-agent NL Q&A across 500M+ premium docs with sentence-level citations; AlphaSense disclosed that it is "used monthly by 75% of users."
- **Generative Grid** (March 2025) is the direct Hebbia-Matrix analogue — rows = documents, columns = prompts, cells = cited answers — working across 300M+ docs plus user-uploaded content.
- **Deep Research** (June 10, 2025) takes 10–30 minutes per query and executes a five-step agent: Planning → Searching & Iterating → Reasoning → Drafting → Citing. Access to **500M+ premium paywalled documents** is the differentiator vs. OpenAI/Gemini/Perplexity Deep Research.
- **Workflow Agents** (fall 2025) added pre-built patterns (Channel Check, Company Profiles, SWOT).
- **Financial Data** (Oct 2025) blends structured quantitative data into the chat interface.

The content universe is the defensive moat: SEC and global filings from 68,000+ organizations; **Wall Street Insights® broker research** from 1,500–1,700+ providers (direct partnerships with Morgan Stanley, Goldman Sachs, Citi, J.P. Morgan, BofA, Barclays, Deutsche Bank, Evercore ISI, HSBC, Bernstein, Cowen, CFRA, UBS — ~10,000+ reports); live transcripts for 5,000+ companies; Tegus Expert Insights; trade journals, press releases, IR presentations, ESG reports; Enterprise Intelligence connectors to SharePoint, OneDrive, Box, Egnyte, Google Drive, Dropbox, S3, Microsoft 365.

Enterprise posture is mature: SOC 2 Type II, ISO/IEC 27001, HIPAA support, AES-256 encryption, **BYOK** and **BYOB** (Bring Your Own Bucket), **Private Cloud** deployment in customer AWS or GCP, EU data residency, SAML 2.0 SSO, SCIM provisioning. Pricing runs **$10K–$20K per seat** (up to $25K for fully loaded Enterprise tiers), with typical enterprise contracts at $50K–$1M+ and a ~48% YoY enterprise price increase per SpendHound.

**Strengths**: unmatched premium content moat; 88% S&P 100 penetration; multi-persona (finance, corporate, consulting, life sciences); mature NLP stack predating the LLM era. **Weaknesses**: Generative Grid and Deep Research are catch-up products launched after Hebbia Matrix (2022); UI complexity; Tegus integration risk; less technically differentiated on pure agent orchestration.

### 2.2 Hebbia — the technical-architecture leader

Hebbia, founded August 2020 by George Sivulka (sole founder, ex-Stanford PhD), raised **$130M Series B in July 2024 at a $700M valuation** led by Andreessen Horowitz (with Index Ventures, GV, Peter Thiel, Eric Schmidt, Jerry Yang); total raised is ~$161M. Reported ARR was **$13M at Series B (profitable)** — a 54× ARR multiple reflecting strategic bets on its engineering, not its revenue. Hebbia says it has ~30–40% of the top 50 asset managers by AUM on the platform with **$15T+ cumulative AUM**, including Centerview, Charlesbank, American Industrial Partners, Oak Hill, Towerbrook, Crestline, BlackRock, KKR, Carlyle, Fenwick, Fisher Phillips, and the US Air Force/DoD. In 2025 Hebbia acquired **FlashDocs** for generative slide-deck creation.

**Matrix** is the original grid-based research surface launched in 2022 — rows are documents, columns are natural-language prompts, cells are cited answers. Hebbia processed over **1 billion pages** (up from 47M a year earlier), a 21× growth, and Sivulka has publicly called it "the interface to AGI." Sivulka's positioning: "Chat is a weak UI for serious work."

Hebbia's proprietary architecture is **ISD — Iterative Source Decomposition** (the task brief's "ISO" is a misnomer; Hebbia's engineering blog consistently calls it ISD). ISD iteratively decomposes a query into sub-queries that search and analyze documents line-by-line while preserving layout, chronology, and formatting. Crucially, Hebbia **decouples document retrieval from document understanding** — retrieval is secondary to "pristine question understanding and answering." On a rigorous internal benchmark, **Hebbia with o1 hits 92% accuracy vs. 68% for vanilla RAG**. The Agent 2.0 architecture uses seven specialized agents: Orchestrator, Planning, Retrieval, Document Analysis (Read), Context Distillation (compresses context >90%), Reasoning, and Output (Writer). Their **Maximizer** engine dynamically allocates token capacity across providers, handling billions of tokens/day. Hebbia uses o1/o3-mini for reasoning, GPT-4o/GPT-5 for general processing, smaller models for targeted tasks, and Claude Sonnet for meta-prompting and technical/legal analysis. Hebbia drives ~2% of OpenAI's daily volume.

Premium-data partners are integrated natively (PitchBook, S&P Capital IQ, FactSet, Preqin via BlackRock Aladdin, Fitch Solutions, Third Bridge). MCP support is present but Hebbia has been explicit that MCP is insufficient for complex queries and custom indexing beats it. Enterprise: SOC 2 Type II, zero-training policy, SharePoint ACL mirroring, customer model selection per task. Pricing: **Lite ~$3,000–$3,500/user/year**, **Professional ~$10,000/user/year**, with full enterprise bundles approaching Bloomberg Terminal pricing (~$20K+/user/year).

**Strengths**: engineering-led architecture with genuine innovation; grid-first UX invented the paradigm; model-agnostic orchestration; profitability at Series B; elite customer roster. **Weaknesses**: no proprietary content (customers bring sources); thin revenue base vs. valuation; vertical concentration in finance and law; rate-limit dependence on OpenAI/Anthropic; commoditization risk as AlphaSense, Rogo, Glean, and Harvey close in.

### 2.3 Rogo — the sell-side specialist

Rogo (rogo.ai), founded 2021 by Gabriel Stengel (ex-Lazard), John Willett, and Tumas Rackaitis, has raised **~$75M–$165M cumulatively** depending on source: $18.5M Series A (Oct 2024, Khosla/Rabois), **$50M Series B in April 2025 at $350M post-money** (Thrive Capital, JPM Growth Equity, Tiger Global), and a later round led by Sequoia (Oct 2025). Public customer references include Moelis, Nomura, Lazard (pilot), Tiger Global, GTCR — and J.P. Morgan is both investor and customer. The product is specifically a "junior analyst co-pilot" for investment banking, PE, hedge funds, and asset managers: company profiling, meeting prep, comps, precedent transactions, and drafting of pitchbooks, IMs, and Excel models. Architecture: orchestration over OpenAI (GPT-4o for chat, o1-mini for context/search structuring, o1 for evals/synthetic data), hosted on Google Cloud. 2025 milestones: LSEG Workspace partnership (Aug 2025), GPT-5 upgrade, London office (Jan 2026), Crunchbase/PitchBook integration.

**Strengths**: deepest IB-workflow specialization; ex-banker credibility. **Weaknesses**: heavy OpenAI dependence; bespoke deployments slow scaling; faces internal bank tools (JPM LLM Suite) and AlphaSense.

### 2.4 Brightwave, Finster, Linq, Fintool, FinChat — the specialist tier

- **Brightwave** (Mike Conover, ex-Databricks Dolly creator) raised **$21M total** ($6M seed + $15M Series A Oct 2024 from Decibel, OMERS Ventures, Point72 Ventures). Positions as "partner in thought" with proprietary knowledge graph over hundreds of millions of documents and long-form sourced analysis. Customers hold **$120B+ AUM** (self-reported).
- **Finster AI** (finster.ai, founded 2023 by Siddhant Jayakumar ex-Google DeepMind, London). **$15M Series A Oct 2025** from Peak XV and FinTech Collective; cumulative funding $31.8–43.3M. EMEA/APAC coverage edge; 1M+ documents across 8,000+ companies. JPM "In-Residence" affiliation claimed but unverified in primary sources.
- **Linq/LinqAlpha** (linqalpha.com) raised $6.6M (2024). Multi-agent platform for buy-side, particularly strong on Asian markets and non-English earnings transcription. OpenBB Workspace integration.
- **Fintool** (fintool.com) — YC W23, founded by Nicolas Bustamante (prior exit: Doctrine). **Acquired by Microsoft in 2025/26** and folded into Office/Excel. Published "The RAG Obituary" blog shifting to agentic search. Self-reports 98% FinanceBench and 90% on Finance Agent Benchmark.
- **FinChat / Fiscal.ai** (Braden Dennis, Canadian Investor Podcast). Retail/prosumer; 300K+ users; $13M total funding via TinySeed. Segment/KPI data for ~2,000 companies is a genuine differentiator. Pricing: Plus $24/mo, Pro $64/mo.

### 2.5 BloombergGPT — effectively dormant, but Terminal AI is alive

BloombergGPT (50B-parameter decoder, **arXiv 2303.17564**, March 2023) trained on a 700B-token corpus (363B finance domain + 345B public). **No public retrain has been announced** since; Bloomberg's David Rosenberg has publicly pivoted toward smaller models, and the Terminal now orchestrates multiple commercial and open-weight LLMs through features like **AI-Powered Earnings Summaries (Jan 2024), AI News Summaries (Jan 2025), Document Insights (Apr 2025), Document Search & Analysis (Jun 2025), and ASKB** (an agent network releasing through 2025–2026). Data moat — 40+ years of proprietary content, 200M+ company documents, 800+ sell-side providers, 5,000+ daily news stories, Bloomberg Intelligence research — remains largely unassailable for its ~325K Terminal seats.

**Implication: the standalone domain-specific LLM approach has lost; orchestration over frontier models wins.**

### 2.6 Perplexity Finance and the consumer tier

Perplexity Finance (Oct/Nov 2024) is an aggregator: **Quartr partnership** (live + archived transcripts for 11,000+ companies), Financial Modeling Prep quotes, SEC filings, FactSet/S&P/LSEG/Coinbase/Polymarket data, and Plaid portfolio linking. 75% of paying users reportedly use Finance features. Runs on Sonar (Llama-based) plus frontier models. Pricing: free, Pro $20/mo, Max $200/mo, Enterprise. Not designed for institutional compliance/audit. Copyright lawsuits from BBC, NYT, Reddit, Nikkei, and others cloud the data-sourcing story.

### 2.7 Data infrastructure players you must partner with or around

- **Quartr** — 14,500+ companies, 40M+ first-party docs, >98% live event coverage; REST + webhooks + Snowflake share; raised $10M in 2025. Perplexity's backbone.
- **Kensho** (S&P Global) — NERD (named-entity recognition → 25M+ Capital IQ IDs or 100M+ Wikimedia), Scribe (finance ASR), Extract, Link, and **LLM-Ready API (kFinance)** — Python client + **MCP server** supporting Claude, ChatGPT, Databricks, Amazon Quick Suite. Strategy: "we're the data layer for everyone else's LLM." Arguably the most strategically dangerous positioning for a new entrant.
- **S&P Capital IQ Pro** — ChatIQ + Multi-Document ChatIQ + Document Intelligence 2.0 (Oct 2025), Earnings IQ Alerts, Natural-Language Screening, Chart Explainer, Visible Alpha integration. 109,000+ public and 60M+ private companies.
- **Daloopa** — AI fundamental/KPI extraction with every cell hyperlinked to source; 5,500+ tickers, 14y history, >99% accuracy claimed; MCP connectors with Anthropic and OpenAI. Their Feb 2026 FinRetrieval benchmark showed structured-DB retrieval jumps agent accuracy to ~90% (+71pp vs web-only).
- **Koyfin** — Bloomberg alternative; notably has **no first-party AI assistant** — a strategic opening.

---

## 3. State of the art: agentic RAG for finance

### 3.1 Agent architecture — what actually works

Classical RAG (embed → retrieve → generate) fails on any serious financial workflow. Production systems are loops with planners, tools, verifiers, and memory. The empirical hierarchy is clear:

- **ReAct (Yao et al., 2022)** — still dominant because it's simple, transparent, and tool-friendly. Weakness: cascading failure on bad early steps.
- **Planner-Executor / Plan-and-Execute** — a planner emits a complete DAG of sub-tasks; an executor runs them (often in parallel). Advantages for regulated finance: determinism, auditability, human-in-the-loop review of the plan before execution, parallelism.
- **Self-RAG (Asai et al., 2023), Reflexion (Shinn et al., 2023), CRITIC, RAG-Critic (ACL 2025)** — self-correction via reflection tokens, verbal episodic memory of failures, or external-tool critique. A single relevance-checkpoint between retrieval and generation captures ~80% of the hallucination-reduction benefit of full Reflexion loops at a fraction of the cost.
- **Iterative retrieval** — Self-Ask, IRCoT (Trivedi et al., 2023), FLARE (Jiang et al., 2023), ITER-RETGEN, Auto-RAG, CoRAG, R3-RAG. FLARE fires retrieval only on low-confidence tokens (triggering on 30–60% of sentences vs. every sentence for IRCoT), substantially cheaper for long-form memos.
- **Multi-agent supervisor/worker** — Anthropic's production research system (June 2025) had a Lead Researcher (Opus 4) spawn 3–5 Sonnet 4 sub-agents in parallel, outperforming single-agent Opus 4 by **90.2%**, with **token usage explaining 80% of performance variance**. Trade-off: **~15× the tokens of chat** and ~4× single-agent. Justified only for high-value deep-research tasks.

Deep Research products exemplify the pattern:

- **OpenAI Deep Research (Feb 2, 2025)** — fine-tuned o3 trained end-to-end with RL on browsing/tool-use. 5–30 min runs, 26.6% on Humanity's Last Exam, 67.36% GAIA single-pass. API (June 2025): `o3-deep-research-2025-06-26` at $10/$40 per M tokens; ~$10/query on o3, ~$0.92 on o4-mini.
- **Google Gemini Deep Research** — explicit user-editable research plan before execution (human-in-the-loop checkpoint OpenAI lacks); planner/executor/synthesizer separation with Flash Thinking.
- **Perplexity Deep Research (Feb 14, 2025)** — 2–4 min runs, modular planner/retriever/synthesizer; 21.1% on HLE; Sonar-DR API at ~$1.19/medium query.
- **Anthropic Claude Research** — the canonical supervisor/worker architecture. "Start wide, then narrow" prompting heuristic; effort-scaling rules baked into prompts. **Claude for Financial Services** (July 2025) adds DCF/IC-memo/earnings skills and MCP connectors to FactSet, Daloopa, LSEG, Morningstar, PitchBook, Snowflake, Databricks.

Open-source references to study: **GPT Researcher** (assafelovic, 25.7K⭐), **STORM/Co-STORM** (Stanford OVAL, arXiv 2402.14207 / 2408.15232) for outline-first, **LangChain open_deep_research** for the LangGraph Scope→Research→Write template, **HuggingFace open-deep-research** (smolagents, 55.15% GAIA). RL-trained agents — **Search-R1, R1-Searcher, R1-Searcher++** — are the research frontier but not yet production-ready for finance.

### 3.2 Advanced retrieval — the precision story

**Hybrid search is not optional in finance.** Dense embeddings miss tickers, CUSIPs, and GAAP line items; BM25/SPLADE catches them. RRF at k=60 is the default fusion because it is score-agnostic. SPLADE pre-computed at index time adds term expansion. BlackRock × NVIDIA's **HybridRAG** (arXiv 2408.04948) fuses vector and knowledge-graph retrieval and beats either alone on every RAGAS metric over Nifty-50 earnings calls.

**Rerankers are the second-biggest precision lever.** Current leaderboards (Agentset ELO, Voyage benchmarks): Zerank-1/2 ~1638 ELO (top), **Cohere Rerank v4.0 Pro ~1629**, Voyage rerank-2.5 ~close, BGE-reranker-v2-m3 the best OSS baseline. Voyage rerank-2 beats BGE-v2-m3 by 14.75% and Cohere v3 by 6.33% across 93 datasets. **ArXiv 2511.18177 shows cross-encoder reranking alone gives a +59-point MRR@5 improvement** over vanilla retrieval. Recommended: Cohere Rerank v4 Pro via Bedrock for in-VPC enterprise; BGE-reranker-v2-m3 on-prem.

**Query understanding** — query decomposition, HyDE, step-back prompting, multi-query/RAG-Fusion, LlamaIndex RouterQueryEngine. Decomposition is the go-to for multi-company comparisons; HyDE helps terse queries; step-back helps over-specific ones.

**Anthropic Contextual Retrieval (Sept 2024) is the highest-ROI single intervention.** Prepending a 50–100 token LLM-generated context summary to each chunk before embedding reduces retrieval failures **49%**; add contextual BM25 + reranking and failures drop **67%**. Prompt caching makes the one-time contextualization affordable. This is the single change that will move the needle most on a 10-K/10-Q corpus.

**GraphRAG for finance** — Company ↔ subsidiary ↔ CIK ↔ LEI ↔ executive ↔ SIC ↔ peer is naturally a graph. Microsoft GraphRAG reports 86% vs 32% on enterprise benchmarks but is expensive to maintain. **LightRAG** is the better default for daily-updated corpora; **HippoRAG** (PageRank over KGs) is ~10–30× cheaper for multi-hop queries. **HybridRAG** (BlackRock × NVIDIA) is SOTA on financial earnings-call QA.

**Long-context vs RAG**: if your knowledge base is <200K tokens, stuff it in the prompt with caching. For any real buy-side universe, RAG is mandatory. Long-context (Gemini 2.5 Pro 1–2M, Claude 4 200K, GPT-5 256K) is best as the **synthesis** step after RAG.

### 3.3 Chunking and financial document processing

Structure-aware + hierarchical parent-child chunking (child 256–384 tokens, parent 1024–2048) plus Anthropic-style contextual prepending is the production pattern. **Never split a table.** Serialize tables to Markdown/JSON and attach caption/heading as context; generate a one-paragraph NL summary of each table and embed both.

**Parsing tool comparison (2025–2026 benchmarks)**:

| Tool | Key benchmark | Strengths | Finance fit |
|---|---|---|---|
| **Reducto** | ~90.2 on RD-TableBench; best on complex finance tables | Bbox citations, SOC 2 Type II, HIPAA, ZDR, on-prem | **Top pick** for 10-K/Q/S-1 |
| **LlamaParse Agentic** | 84.9% on ParseBench | Consistent ~6s/doc; Goldman Sachs customer | High-volume transcripts |
| **Docling (IBM)** | 97.9% on complex sustainability tables; native XBRL | MIT, local, air-gapped | On-prem fallback |
| **Unstructured** | 0.844 adjusted table score (own bench) | Broad format support, in-VPC | Diverse enterprise |
| **Azure DocIntel / Textract** | 0.72–0.83 RD-TableBench | Managed, baseline | Scanned filings only |

**XBRL is a force multiplier.** When a number is XBRL-tagged, you skip OCR entirely. Use **Arelle** for validation, sec-api.io's XBRL-to-JSON for speed, but maintain your own **concept-mapping table** (e.g., `revenue_total` → {Revenues, RevenueFromContractWithCustomerExcludingAssessedTax, SalesRevenueNet, SalesRevenueGoodsNet}) because companies change tags across years.

**Finance-specific retrieval gotchas** you must solve: numerical reasoning (predicate filtering against a structured store, not embeddings); temporal grounding (fiscal vs. calendar periods per issuer, carried as `contextRef` metadata); entity disambiguation (Apple Inc. vs. Apple Hospitality REIT; multi-CIK parents); financial synonyms; comparable units handling per-row.

### 3.4 Citation, grounding, hallucination detection

Every factual claim needs `{doc_id, page, bbox, section_path, char_offsets, xbrl_concept?, context_ref?}`. Table cell citations must include row-label and column-label stacks. Chart citations should flag lower confidence.

Verification approaches:

- **NLI-based (TRUE, DeBERTa-v3-MNLI)** over each claim vs. its cited passage
- **ALCE** (Gao et al., EMNLP 2023, arXiv 2305.14627) for citation recall/precision
- **SelfCheckGPT** (Manakul et al., 2023) for zero-resource consistency
- **FActScore** for long-form
- **G-Eval** for rubric scoring
- **Semantic Entropy** (Farquhar et al., Nature 2024)
- **Patronus Lynx** (arXiv 2407.08488, Llama-3-70B fine-tune trained on FinanceBench) is the best finance-tuned hallucination guardrail; Lynx-70B beats GPT-4o by ~1% on HaluBench
- A dedicated **numeric-consistency verifier** (regex-extract numbers and round-trip against the cited passage) catches the single most common financial-RAG hallucination

### 3.5 FinanceBench and the benchmark suite to target

| Benchmark | What it measures | SOTA anchor |
|---|---|---|
| **FinanceBench** (Patronus, 2023; arXiv 2311.11944) | 10,231 Qs over 10-K/Q/ERs; GPT-4-Turbo+RAG 19% baseline | Vendor claims: Fintool 98%, Vectify Mafin 2.5 98.7% on open 150 |
| **FinQA** (arXiv 2109.00122) | 8,281 numerical reasoning Qs | FinQANet-RoBERTa 61.24 exec / 58.86 program |
| **ConvFinQA** (arXiv 2210.03849) | Multi-turn numerical | |
| **TAT-QA, MultiHierTT** | Tabular+textual, hierarchical | |
| **DocFinQA** (arXiv 2401.06915) | Full-document context avg ~123K words | |
| **FinDER** (arXiv 2504.15800) | Retrieval-focused user-style queries | |
| **FinBen** (arXiv 2402.12659) | 36 datasets / 24 tasks / 7 aspects including agent + RAG | |
| **Vals AI Finance Agent Benchmark** (arXiv 2508.00828) | 537 expert-authored Qs, private/public split | Claude Sonnet 4.6 63.3%, Opus 4.6 60.0–60.7%, o3 48.3% — Fintool v4 claims 90% |
| **RD-TableBench, ParseBench, FinTabNet** | Parsing accuracy | Reducto 90.2%, LlamaParse Agentic 84.9%, Docling 97.9% on one corpus |

Vendor-reported numbers (Fintool 98/90%, Vectify 98.7%) vary by methodology (document context presence, judge model, open-100 vs. 150 subset). **Vals AI is the most actively maintained independent leaderboard.**

### 3.6 Compliance and enterprise — table stakes

- **SOC 2 Type II**: 6–12 month observation, ~$30–100K first-year all-in, ~$15–40K ongoing. AI-specific controls to add: model-change management, prompt/template versioning, RAG-index access control, eval/guardrail evidence, sub-processor DD, data-flow diagrams confirming no training on customer data, prompt-injection logging, HITL sign-off logs, NIST AI RMF or ISO 42001 mapping. Auditors: Prescient Assurance, A-LIGN, Schellman, BARR, KirkpatrickPrice.
- **ISO 27001** overlaps ~70–80% with SOC 2; combined readiness ~30–40% cheaper than sequential. Add **ISO 42001** for AI differentiation.
- **GDPR**: Article 28 DPAs with all sub-processors (Anthropic/OpenAI auto-include SCCs), eight data subject rights, 72-hour breach notification, post-Schrems II Transfer Impact Assessments.
- **SEC Rule 17a-4**: WORM storage or the **May 2023 audit-trail alternative**, 6-year default retention, 24-hour retrieval, serialized time-stamping. SEC FY2024 recordkeeping penalties topped **$600M**.
- **FINRA 4511 / 3110**: FINRA 2024–25 guidance and Reg Notice 22-18 make clear that **AI-generated outputs are "records"** and subject to principal review under 3110(b)(4). Outsourcing does not transfer the obligation.
- **MiFID II** research unbundling partially reversed; UK permits rebundling; EU amendments from **6 June 2026**. AI research outputs may themselves require separate research-fee attribution.
- **MNPI**: per-project information barriers, MNPI tagging with retrieval exclusion, formal wall-crossing workflows, Shield FC / SteelEye surveillance integration.

**Audit log fields per AI claim**: request_id, user_id, workspace/project, timestamp (RFC3339), query (raw+normalized), retrieval_query, corpus/index IDs, chunk offsets retrieved, retrieval scores, entitlements, **model version/snapshot**, prompt template ID + version hash, temperature, guardrail policy, raw + post-processed output, citations with doc_id+chunk offset, grounding score, token counts, latency, cost, reviewer_id, review status, edits, export events.

**No-training contracts**: OpenAI **Zero Data Retention** (gated for regulated industries; excludes stateful Threads/Files), Anthropic commercial DPA (7-day default, ZDR addendum), Azure OpenAI Modified Abuse Monitoring for ZDR, AWS Bedrock (no training by default, PrivateLink available, customer-KMS fine-tuning).

---

## 4. Data moat and build-vs-buy — the strategic map

| Category | Build or Buy | Recommended Vendor | Year-1 Cost |
|---|---|---|---|
| SEC EDGAR filings + sections | Wrap free SEC APIs | sec-api.io Business/Enterprise | $3K–$30K |
| XBRL standardized financials | Buy | sec-api.io or Daloopa | $10K–$250K |
| Fundamental/KPI extraction | Partner | **Daloopa** via MCP | $50K–$500K |
| Earnings transcripts | Buy | **Quartr API** (primary); Refinitiv StreetEvents fallback | $50K–$250K |
| Expert calls | Must buy — Tegus is locked in AlphaSense | AlphaSense/Tegus corp tier; Inex One aggregator | $75K–$500K+ |
| Broker research | Must buy — legally entitled content | AlphaSense WSI AMR; Visible Alpha for consensus | $100K–$500K |
| Alt data (card, web, app, foot traffic, jobs) | Buy ticker-sliced | YipitData, Similarweb, SensorTower, Placer.ai, Revelio | $30K–$500K each |
| News/wires | Buy | Benzinga + Dow Jones DNA | $15K–$100K |
| **Macro (FRED, BEA, BLS, IMF, WB, OECD, ECB)** | **Build (free APIs)** | FRED API | ~$0 |
| Commodity / FX | Buy | CME, ICE | $10K–$100K |
| Crypto | Buy | Kaiko ($10K–$55K), Glassnode | $15K–$105K |
| **Patents, clinical trials, FDA/EMA/FCC** | **Build (free APIs)** | USPTO/Google Patents BQ, ClinicalTrials.gov, openFDA | ~$0 |
| Court filings | Hybrid | CourtListener (free) + PACER monitor | $0–$20K |
| Insider trading / 13F | Build | SEC EDGAR + sec-api.io | $0–$15K |
| **Entity resolution** | Buy (hidden moat) | Kensho NERD / Link | $15K–$150K |
| LLM-grounded structured QA | Partner | Kensho LLM-Ready API, Daloopa MCP | $100K–$500K |

**Estimated year-1 data license budget: $0.7M–$2.5M** for a credible mid-market GenAI Deep Research platform; $3–5M by year 2 with alt-data expansion. Bloomberg-tier coverage exceeds $5M/year.

**Three categories you absolutely cannot skip**: Quartr-class transcripts, Daloopa-class fundamentals (or build your own KPI extractor), and a real entity-resolution layer (Kensho Link or equivalent). **One category where a new entrant loses**: expert calls. Tegus is locked inside AlphaSense; don't try to rebuild it.

---

## 5. What a winning new entrant looks like

- **Technical moat**: ISD-class iterative agentic orchestration with context distillation, hybrid retrieval, contextual retrieval, a finance-tuned reranker, a multi-verifier grounding layer (NLI + numeric-consistency + citation presence).
- **Content moat**: Quartr transcripts + Daloopa fundamentals + Kensho entity resolution + free macro/patent/trials/FDA backbone + (optional) Visible Alpha consensus + AMR broker research via the AlphaSense corporate tier.
- **UX moat**: grid + deep-research report hybrid, with claim-level citations, Excel-native model generation, and stream-first long-running UX.
- **Price anchor**: $5K–$10K/seat undercuts AlphaSense/Hebbia while delivering Lite-tier seat proliferation; Pro tier at $15K–$20K with premium data bundled.
- **Differentiator where competitors are weak**: Koyfin has no AI layer, Rogo is OpenAI-locked, AlphaSense Deep Research is slow, Hebbia has no content. A platform that combines **best-in-class agentic orchestration with licensed content and a strong entity graph** can split the middle.

---

# PART 2 — FILE-BY-FILE UPGRADE PLAN AND PHASED ROADMAP

The current codebase is a solid scaffold — parallel Tavily search, a multi-stage "Gravity" RAG API (Query Understanding → Planner → Reader → Extractor → Critic → Verifier → Writer) that already instantiates most of the right stages, Supabase auth, a server-side LLM proxy, and a starter set of finance data sources. The gaps are in **data coverage, retrieval precision, grounding discipline, orchestration durability, and enterprise controls**. This section addresses each file and then lays out a 12-month roadmap.

---

## 6. File-by-file assessment

### 6.1 `deepResearchService.ts` — the orchestration pipeline

**What it does well.** Provides a coherent entry point to the research pipeline and coordinates the other services.

**Gaps vs world-class systems.** TypeScript-based orchestration without durable state; no checkpointing for long (10–30 min) runs; no human-in-the-loop checkpoint on the plan; no explicit sub-agent parallelism; no streaming of intermediate artifacts; no token/cost budget enforcement; likely no outline-first template system.

**Upgrade recommendations:**

- Port the orchestration runtime to **LangGraph (TypeScript) or a Python sidecar** with Postgres checkpointing. Model the pipeline as a state machine with explicit nodes (Scope → Plan → Research-Fanout → Compress → Reflect-and-Gap → Synthesize → Verify). Use LangGraph's `Send` API for parallel sub-agent fanout.
- Adopt an **outline-first pattern** against fixed templates for Investment Memo, Earnings Preview, Earnings Recap, Thematic Research, Company Primer, M&A Screen. Each template drives sub-agent spawning per section.
- Implement **model tiering**: Claude Sonnet 4.5 for research sub-agents, Opus 4.5 or o3 only for final synthesis, Haiku 4.5 / Gemini 2.5 Flash-Lite for compression and classification. Expected 3–10× cost savings vs. flat Opus.
- Add **sub-agent compression** — every sub-agent must return a cleaned summary, not raw scraped content, to avoid supervisor-context blow-up.
- Implement **hard budgets**: per-query token cap (e.g., 500K), per-sub-agent tool calls (10–30), max sub-agents (10), per-query cost ceiling with graceful early-termination.
- Stream a **thinking panel** with step + source-list; checkpoint every ~30s; support cancellation via a shared cancel-event polled between tool calls.
- **Priority: P0**.

### 6.2 `gravitySearchService.ts` — the backend RAG

**What it does well.** Already implements the right conceptual stages (QU → Planner → Reader → Extractor → Critic → Verifier → Writer); five-channel retrieval suggests hybrid/multi-source retrieval.

**Gaps.** Likely monolithic prompt-stitching rather than first-class agent steps; unclear how retrieval channels are fused (RRF?); no explicit reranker; no contextual retrieval; unclear citation granularity; no claim-level NLI verification; no numeric-consistency check.

**Upgrade recommendations:**

- **Retrieval stack**: hybrid BM25/SPLADE + dense embeddings fused with RRF at k=60; **Cohere Rerank v4 Pro** (hosted) or **bge-reranker-v2-m3** (self-host) as the rerank stage; retrieve 50–150 candidates, keep top 10–20.
- **Anthropic Contextual Retrieval** — prepend a 50–100 token LLM-generated context summary to every chunk pre-embedding. This alone should move retrieval failure ~49% → add BM25 + rerank to get to ~67% reduction.
- **Query understanding**: LlamaIndex-style RouterQueryEngine over {simple lookup, decomposition, HyDE, step-back}; budget router on cheap model (Haiku / Flash-Lite).
- **Chunking**: structure-aware chunking on 10-K Items (1A Risk Factors, 7 MD&A, 8 Financial Statements) and transcript speakers; **hierarchical parent-child** (child 384 tokens / parent 1536); never split a table; add one-paragraph NL summaries of each table and embed both.
- **Verifier upgrade**: run every claim through a **DeBERTa-v3-MNLI** entailment model against cited passages (ALCE-style citation recall/precision). Add a dedicated **numeric-consistency verifier** (regex-extract numbers, round-trip against cited passage). Optionally add **Patronus Lynx 2.0** as a finance-tuned hallucination guardrail.
- **Writer upgrade**: force per-sentence inline citations `[doc_id:page#bbox]`; enforce via prompt + post-generation verifier.
- **Critic upgrade**: add an explicit gap-detection pass comparing findings to the template/brief before writing.
- **Priority: P0**.

### 6.3 `secEdgarService.ts` — the filings layer

**What it does well.** Exists; provides a starting interface.

**Gaps.** "Basic EDGAR XML scraping via regex — not robust" is a red flag. No section-aware parsing, no XBRL handling, no full-text search beyond 2001, no rate-limit compliance beyond basics, no entity resolution.

**Upgrade recommendations:**

- Replace regex scraping with **sec-api.io Business or Enterprise** ($3K–$30K/yr) for Query, Full-Text Search, Stream WebSocket, Extractor (10-K/10-Q/8-K sections), XBRL-to-JSON. ~300ms publication-to-API latency.
- For XBRL, run **Arelle** locally for validation, parse via `inlineXbrlDocumentSet`; complement with sec-api.io XBRL-to-JSON for convenience. Build a **concept-normalization table** mapping vendor-specific and company-extension tags to canonical line items (`revenue_total`, `operating_income`, etc.) with priority ordering for multi-tag situations.
- Build or license a **section tagger** that maps 10-K/10-Q text to Item identifiers (Item 1A, Item 7, Item 8, Note 1 to Financial Statements, etc.). Use LlamaParse/Reducto bounding boxes for cell-level citation.
- Add **entity resolution**: wire CIK/ticker/CUSIP/LEI mapping; resolve ambiguous entities (Apple Inc. vs Apple Hospitality REIT) with confidence scoring. Consider **Kensho Link** or **Refinitiv PermID** (free) initially.
- Add 8-K item-type parsing (Item 2.02 Earnings, Item 5.02 Officer Changes, Item 7.01 Reg FD); Form 4 insider parsing; 13F institutional holdings; SC 13D/G activist filings; DEF 14A proxy; S-1/424B4.
- Respect SEC rate limits (10 req/s, User-Agent header); run nightly companyfacts.zip/submissions.zip bulk ingestion for backfill.
- **Priority: P0**.

### 6.4 `tavilyService.ts` — web search

**What it does well.** Parallel queries; clean web search abstraction.

**Gaps.** Tavily alone is insufficient for financial research; web results are secondary to primary SEC/transcript sources; no source-authority scoring; no deep-fetch of PDFs behind results.

**Upgrade recommendations:**

- Keep Tavily as one channel but add **Exa** (semantic), **Perplexity Sonar API**, and **Firecrawl** for fuller web coverage.
- Add **source-authority scoring** — SEC/investor relations > sell-side research > mainstream financial news > blogs. Encode into retrieval fusion.
- **Route web to the right sub-agent**: web search is for *news, thematic color, competitor claims*; primary-source sub-agents should prefer SEC/transcripts first and web only for gaps.
- Add a **scrape+parse step** via LlamaParse/Reducto for PDFs returned from web search.
- Log source URLs + retrieval timestamps for compliance trail.
- **Priority: P1**.

### 6.5 `marketData.ts` — quotes and fundamentals

**What it does well.** Alpha Vantage integration with static fallback.

**Gaps.** Alpha Vantage is rate-limited and retail-grade; no intraday quality for institutional use; no consensus estimates; no segment-level KPIs.

**Upgrade recommendations:**

- Migrate primary market data to **Polygon.io** (Starter ~$199/mo, Advanced $499/mo, full-tick $1500+) or **Databento** for tick data; keep Alpha Vantage only as backup.
- Add **Visible Alpha** (S&P) for segment-level consensus estimates — critical for earnings previews; $50K–$300K/yr enterprise.
- Add **FactSet Mercury** or **LSEG Refinitiv** for consensus if budget permits; **Financial Modeling Prep** ($300/mo) as retail-grade consensus.
- Integrate **Daloopa MCP** for normalized KPI history (revenue by segment, ASP, units, subscriber counts) — this is a differentiator vs. competitors relying on raw SEC data.
- Add **fx/commodities** via CME/ICE or Polygon's multi-asset coverage; **crypto** via Kaiko (institutional) for paid tiers, CoinGecko free tier for retail.
- **Priority: P1** for consensus/KPIs; **P2** for tick-data.

### 6.6 `pdfExport.ts` — report output

**What it does well.** React-PDF-renderer; reasonable starter.

**Gaps.** Static PDF output; no interactive artifacts; no Excel model export; no PowerPoint deck generation; no editable living-document experience.

**Upgrade recommendations:**

- Keep PDF export but add **Excel export** via **openpyxl** (Python sidecar) following Anthropic's published `xlsx` skill conventions (blue hardcodes, black formulas, green cross-sheet links; run headless LibreOffice recalc; validate zero #REF!/#DIV/0!/#NAME? errors).
- Add **PowerPoint export** via python-pptx or integrate a FlashDocs-style deck generator for IC memos and pitchbooks.
- Add **interactive report UI** — inline citations with hover-previews of source bboxes; editable cells for analyst override; shareable stable URLs with versioned snapshots for compliance.
- Add **grid-UX output** (Hebbia Matrix / AlphaSense Generative Grid style) for multi-document analysis where rows=tickers/docs, columns=prompts, cells=cited answers. This is table stakes for institutional buyers.
- **Priority: P0** for Excel; **P1** for PowerPoint and grid UX.

### 6.7 `fredService.ts` — macro data

**What it does well.** FRED integration covers the right primary source.

**Gaps.** Demo key is a showstopper for any real deployment; no BEA/BLS/IMF/World Bank/OECD/ECB coverage; no vintage/ALFRED support.

**Upgrade recommendations:**

- Move to a **production FRED API key**; store in env, rotate quarterly.
- Add **BEA** (GDP, NIPA), **BLS** (CPI, PPI, employment), **IMF** (WEO via SDMX), **World Bank** (WDI), **OECD**, **ECB SDW**, **Revelio Labs Public Labor Statistics** — all free APIs. Build one unified `macroService` with canonical series IDs across providers.
- Support **ALFRED vintages** for point-in-time macro (critical for backtests and honest historical analysis).
- **Priority: P1**.

### 6.8 `cryptoMarketService.ts` — crypto

**What it does well.** CoinGecko coverage.

**Gaps.** No on-chain metrics; no derivatives data; no institutional-grade latency.

**Upgrade recommendations:**

- Keep CoinGecko for retail tier. For institutional tier, add **Kaiko** (avg $28.5K/yr; spot + derivatives + order book) and **Glassnode** enterprise (on-chain metrics) — both are MCP/API friendly.
- For retail, consider **Messari**, **DefiLlama**, **Coinpaprika** for TVL and DeFi coverage.
- **Priority: P2** unless crypto is a primary vertical.

### 6.9 `influencerService.ts` — social signals

**What it does well.** Supabase-backed; bespoke differentiator.

**Gaps.** Crypto-only; no equity social sentiment; no Reddit/Twitter/StockTwits/SeekingAlpha ingestion with compliance-safe framing.

**Upgrade recommendations:**

- Extend to equities via **Brandwatch**, **Thinknum**, or **Revelio Labs** for social/job-posting signals.
- Add Reddit WallStreetBets/Stocks ingestion via Pushshift-style APIs (with license check).
- Add StockTwits via their official API.
- Treat influencer signals as **context, never a citation source** — compliance will reject it otherwise. Tag retrieval results as "sentiment, unverified."
- **Priority: P2**.

### 6.10 `llm.ts` — server-side LLM proxy

**What it does well.** Multi-provider (Anthropic, Gemini, DeepSeek, Groq); server-side proxy pattern is compliance-friendly.

**Gaps.** Likely no structured model routing, no cost tracking per query, no request-level logging in the SOC-2 sense, no failover, no rate-limit management, no caching.

**Upgrade recommendations:**

- Replace bespoke proxy with **Portkey** (SaaS, SOC2/HIPAA/GDPR, $49+/mo) or **LiteLLM self-hosted in-VPC** for regulated deployments. Either gives you virtual keys per customer, per-client budgets, PII redaction, guardrails, and SOC2 posture.
- **Model tiering**: reasoning = Claude Opus 4.5 / Gemini 3 Pro / GPT-5.1; workhorse = Claude Sonnet 4.5; summarization = Haiku 4.5 / Gemini 2.5 Flash-Lite; on-prem = DeepSeek-V3.2 / Llama 4 / Qwen 3.
- **Prompt caching** everywhere possible (Anthropic cache, Gemini implicit caching) — essential for contextual retrieval's one-time context generation and for agentic loops.
- **Failover**: wire secondary providers per tier so a 429/5xx auto-retries on an equivalent model.
- **Zero Data Retention**: negotiate OpenAI ZDR, Anthropic ZDR addendum, Azure OpenAI Modified Abuse Monitoring for all enterprise deployments. Document in customer DPA.
- Every LLM call emits a structured trace span: request_id, user_id, workspace, model_version, prompt_template_hash, tokens, cost, latency. Route to **Langfuse self-hosted** for data residency.
- **Priority: P0**.

### 6.11 `supabase.ts` — auth

**What it does well.** Off-the-shelf auth.

**Gaps.** For enterprise finance, Supabase Auth alone is insufficient: no SCIM provisioning out of the box, no enterprise SSO beyond basic OIDC, no hierarchical team/workspace/project RBAC, no source-level entitlements.

**Upgrade recommendations:**

- Keep Supabase for retail/prosumer tier. For enterprise tier, add **WorkOS** or **Auth0** for SAML 2.0 SSO + SCIM provisioning with Okta, Azure AD, OneLogin.
- Implement **three-tier RBAC**: organization → workspace/team → project. Roles: admin, member, reviewer, auditor, viewer. Principle of least privilege.
- **Source-level entitlements**: retrieval must filter chunks by user entitlements *pre-retrieval* (not just pre-display) to prevent prompt-injection exfiltration of unauthorized data (broker research the user isn't licensed for, MNPI materials, deal-room docs).
- MFA enforcement, session timeouts, IP allow-listing per workspace.
- **Priority: P0**.

### 6.12 `apiKeys.ts` — key management

**What it does well.** Env + localStorage; flexible.

**Gaps.** localStorage is an enterprise no-go (XSS exfiltration risk); no customer-managed keys; no rotation.

**Upgrade recommendations:**

- Move customer API keys to **server-side encrypted storage** (AWS Secrets Manager, GCP Secret Manager, or customer KMS for CMEK tier).
- Support **BYOK** (customer-managed encryption keys via AWS KMS / GCP Cloud KMS / Azure Key Vault) for enterprise tier — revocation acts as kill-switch.
- Add automatic **key rotation** (quarterly for internal, on-demand for customer keys).
- Audit-log every key access event.
- **Priority: P0** for removing localStorage; **P1** for CMEK.

### 6.13 `api.ts` — backend client

**What it does well.** Authenticated API client.

**Gaps.** Likely no retry logic, no idempotency keys, no request tracing headers, no rate-limit awareness.

**Upgrade recommendations:**

- Add **idempotency keys** on POST endpoints (critical when long-running research queries can be retried).
- Propagate **W3C Trace Context** headers (`traceparent`) so request traces stitch into Langfuse/OTel end-to-end.
- Exponential backoff with circuit breakers per downstream service.
- **Priority: P1**.

---

## 7. Phased roadmap

### Phase 1 — Foundation (0–3 months)

**Goal**: Close P0 gaps; ship a credible MVP with citation-grounded output.

- **Retrieval rebuild**: hybrid BM25/SPLADE + dense (voyage-3-large or voyage-finance-2 via API) + RRF; Cohere Rerank v4 Pro; Anthropic Contextual Retrieval on all chunks.
- **Vector DB**: choose **Turbopuffer** (cloud, object-storage economics, namespace-per-customer) or **Qdrant Cloud** (better on-prem story). Migrate off any ad-hoc stores.
- **SEC layer**: sec-api.io Business, Arelle for XBRL validation, concept-normalization table for top 50 line items, 10-K section extractor.
- **Parsing**: **Reducto** for 10-K/10-Q/S-1 ingestion (bounding boxes for citation); **LlamaParse** for transcripts and high-volume docs.
- **Orchestration**: port deepResearchService to **LangGraph** state machine with Postgres checkpointing; outline-first against Investment Memo, Earnings Preview/Recap, Thematic, Company Primer, M&A Screen templates; parallel sub-agent fanout via `Send`.
- **Grounding**: per-sentence citations enforced by prompt + post-gen verifier; NLI entailment (DeBERTa-v3-MNLI) per claim; numeric-consistency verifier.
- **Model tiering**: Claude Sonnet 4.5 (workhorse) + Opus 4.5 (synthesis) + Haiku 4.5 (compression); Portkey or LiteLLM gateway with ZDR.
- **Enterprise baseline**: server-side API key storage (remove localStorage); three-tier RBAC; SAML SSO via WorkOS for enterprise tier; Langfuse self-hosted observability; begin **SOC 2 Type II** observation window with A-LIGN or Prescient Assurance.
- **Data partnerships**: sign **Quartr API** (earnings transcripts) and **Daloopa MCP** (fundamentals) — these two alone dramatically raise output quality.
- **Capability gate**: ≥70% on FinanceBench open 150 with per-claim NLI verification pass rate ≥90%; ≥55% on Vals AI Finance Agent Benchmark equivalent internal set.

### Phase 2 — Competitive parity (3–6 months)

**Goal**: Match AlphaSense/Hebbia on core workflows.

- **Grid UX**: Hebbia Matrix / AlphaSense Generative Grid analogue — rows=docs/tickers, columns=prompts, cells=cited answers. This is table stakes for institutional buyers.
- **Financial modeling automation**: Excel export via openpyxl + Anthropic xlsx-skill conventions; DCF, Comps, LBO templates; cell-anchored citations in notes.
- **Entity graph**: **Neo4j Aura** with CIK/LEI/ticker/executive graph; ingest Form 4 (insiders), 13F (institutional holdings), SC 13D/G, DEF 14A (proxies); **LightRAG or HybridRAG** fusion on top.
- **Broader data**: Visible Alpha consensus ($50K–$300K); Polygon.io market data; FRED + BEA + BLS + IMF + World Bank + OECD + ECB macro; Kaiko crypto (if vertical demands); Benzinga news.
- **Reranking upgrade**: finance-tuned embeddings (voyage-finance-2 A/B vs. voyage-3-large on held-out financial QA); experiment with BGE-M3 self-host for cost.
- **Deep Research UX**: streaming thinking panel, editable research plan checkpoint (Gemini-DR style), cancellation, checkpoint replay. Target: IC memo in 5–10 min, thematic report in 15–25 min.
- **Compliance gates**: complete **SOC 2 Type II** report; ISO 27001 readiness; EU data residency deployment; customer DPA with ZDR addendum; audit-trail WORM archival (Global Relay or Smarsh integration for 17a-4 customers).
- **Evaluation**: construct custom **golden set of 300–500 analyst-authored Q&As** across slices (10-K facts, multi-doc peer comparison, numerical reasoning, thematic synthesis). Nightly eval via Braintrust or Langfuse; CI deployment gates.
- **Capability gate**: ≥85% on FinanceBench open 150; ≥65% on Vals-equivalent internal benchmark; SOC 2 Type II report delivered; first 10 enterprise logos.

### Phase 3 — Differentiation (6–12 months)

**Goal**: Build proprietary moat that competitors cannot trivially copy.

- **Proprietary content partnerships**: pursue **AlphaSense Wall Street Insights AMR** style direct broker deals (18–24 month BD cycle; start now). Alternative: deep integration partnerships with 2–3 mid-market banks as design partners.
- **ISD-class orchestration**: implement context distillation agents (compress sub-agent outputs >90%); a Maximizer-style token-router; **DSPy optimization** of high-volume sub-agents (10-K section extractor, KPI extractor, footnote linker) with MIPROv2 on labeled golden sets.
- **Financial-tuned guardrail**: fine-tune a **Patronus Lynx-style finance-hallucination detector** on your own corpus; publish benchmark results.
- **Alt data tier**: 2–3 ticker-sliced datasets matched to initial verticals (consumer: YipitData card + Placer foot traffic; tech: SensorTower app + Similarweb web). $50K–$300K/yr each.
- **Private/air-gapped deployment**: VPC deployment via AWS PrivateLink + BYOK; optional on-prem for top-tier banks using **DeepSeek-V3.2** or **Qwen 3** on H100s.
- **Agentic workflows**: pre-built agents for Channel Check, Company Profiles, SWOT, M&A Screen, Earnings Reaction — analogous to AlphaSense Workflow Agents but extensible via DSL.
- **Chrome/Excel/Office plug-ins**: meet analysts where they live (Excel sidebar for model generation, Outlook plugin for email summarization, Chrome extension for research-as-you-browse).
- **Benchmark publication**: publish an independent Finance Agent Benchmark leaderboard or contribute to Vals AI; be transparent about your numbers — this is how you earn technical credibility vs. self-reported vendor claims.
- **Capability gate**: ≥92% on FinanceBench open 150 with full citation traceability; ≥75% on Vals-equivalent; <$5 per IC-memo query at production quality; first enterprise VPC deployment.

---

## 8. Default tech stack (concrete picks)

| Layer | Pick | Rationale |
|---|---|---|
| **Vector DB** | **Turbopuffer** (cloud) or **Qdrant** (on-prem) | Object-storage economics at billion-vector scale; per-tenant namespaces |
| **Reranker** | **Cohere Rerank v4.0 Pro** via Bedrock | In-VPC, finance-tuned on tables/JSON; SOC 2 |
| **Graph DB** | **Neo4j Aura Enterprise** + optional **Memgraph** for streaming | Best ecosystem for CIK/LEI/subsidiary graphs |
| **Orchestration** | **LangGraph** runtime + **DSPy** optimizer | Durable, inspectable, checkpointable; DSPy for prompt optimization |
| **Doc Parsing** | **Reducto** (10-K/Q/S-1) + **LlamaParse** (transcripts) + **Docling** (on-prem) | Accuracy where it matters, cost where it doesn't |
| **Embeddings** | **voyage-finance-2** (filings) + **voyage-3-large** (general) + **BGE-M3** (on-prem) | FinMTEB shows finance-tuned beats general |
| **LLMs** | Reasoning: **Claude Opus 4.5 / Gemini 3 Pro** · Workhorse: **Claude Sonnet 4.5** · Cheap: **Haiku 4.5 / Gemini 2.5 Flash-Lite** · On-prem: **DeepSeek-V3.2 / Qwen 3** | Multi-vendor, swap via gateway |
| **LLM Gateway** | **Portkey** (SaaS) or **LiteLLM** (in-VPC) | Virtual keys, PII filter, budgets per-client |
| **Observability** | **Langfuse self-hosted** + **Braintrust** for CI | Data residency + regression gating |
| **Grounding** | **DeBERTa-v3-MNLI** NLI + **Patronus Lynx 2.0** + custom numeric-consistency | Multi-layer hallucination defense |
| **Compliance archival** | **Global Relay** or **Smarsh** integration | 17a-4 / FINRA 4511 WORM |

Estimated monthly infrastructure cost for mid-size deployment (5M chunks indexed, 100K queries/mo, 10 analysts): **$3K–$8K infra + $2K–$5K LLM** — scaling roughly linearly with query volume.

---

## 9. Build-vs-buy decisions summarized

| Component | Decision | Why |
|---|---|---|
| SEC filings | **Buy** (sec-api.io) + **Build** section tagger | Base data is free; normalization is the work |
| XBRL normalization | **Build** | Concept-mapping is your moat |
| Fundamentals/KPIs | **Partner** (Daloopa MCP) | 99%+ accuracy is hard to match; don't replicate |
| Earnings transcripts | **Partner** (Quartr) | First-party coverage; Perplexity validates |
| Expert calls | **Partner** (AlphaSense corp tier / Inex One); do not attempt to build | Tegus is locked; two-sided marketplace unrealistic |
| Broker research | **Partner** (AlphaSense WSI AMR) + **license** Visible Alpha | Legally entitled content; scraping is a lawsuit |
| Macro / patents / trials / FDA / insiders / 13F | **Build** | All free APIs |
| Alt data | **Buy ticker-sliced** | Collection apparatus is the moat |
| Entity resolution | **Buy** (Kensho Link / NERD) | S&P's quiet moat; don't rebuild |
| Doc parsing | **Buy** (Reducto + LlamaParse) | 15–20pp accuracy gap; not a differentiator |
| Embeddings | **Buy** API (Voyage) + build custom ingestion | Fine-tune only if you have scale and labeled data |
| Retrieval/RAG orchestration | **Build** | This is your product |
| Compliance surveillance (MNPI) | **Partner** (Shield / SteelEye) | Regulated sub-vertical; not your edge |
| Excel model generation | **Build** (openpyxl + Anthropic skill) + **license Canalyst** for coverage | Universal model generator is a 3-year effort |

---

## 10. Closing opinions — non-obvious takes

1. **Contextual retrieval is the single highest-ROI change you can ship.** Anthropic's approach reduces retrieval failures 49% standalone, 67% with BM25 + rerank. It beats upgrading embeddings or rerankers.

2. **Multi-agent is oversold for day-to-day Q&A.** It costs ~15× the tokens. Use single ReAct + verifier for 90% of queries; reserve supervisor/worker fanout for true deep-research tasks where the output is worth $5+ of compute.

3. **Hybrid search is not optional in finance.** Dense-only silently drops tickers and GAAP line items. RRF at k=60 with BM25/SPLADE + dense is baseline, not optimization.

4. **Knowledge graphs for finance should be lightweight.** Full Microsoft GraphRAG is overkill for daily-updated filings; LightRAG / HybridRAG keyed to CIK/LEI/ticker captures the cross-filing reasoning benefit at a fraction of the cost.

5. **The grounding layer is where production financial RAG lives or dies.** Per-sentence citations + ALCE-style NLI + deterministic numeric-consistency check catches what LLM-as-judge misses — and it's what compliance actually cares about.

6. **Excel is the analyst's canvas, not chat.** Any platform that cannot emit formula-preserving, style-compliant workbooks with Anthropic-skill conventions will lose to Hebbia, Rogo, AlphaSense Carousel, and Daloopa. This is the single most underinvested area relative to its buyer value.

7. **Data partnerships, not model choice, determine your ceiling.** Quartr + Daloopa + Kensho + AlphaSense WSI-AMR is the minimum credible backbone. Frontier models commoditize monthly; content partnerships take years to build and cannot be bypassed.

8. **BloombergGPT's fate is instructive.** The standalone finance-domain LLM is dead. Orchestration over frontier models with proprietary content and deterministic verifiers is the architecture that won.

9. **Fintool's acquisition by Microsoft signals incumbent platform consolidation.** Your window to build a defensible standalone platform is 18–36 months before Office/Excel + Copilot + MCP-connected data vendors commoditize the basic Q&A experience. Your moat must be content partnerships + agentic orchestration sophistication + enterprise compliance posture — not any one of these alone.

10. **The entity-resolution layer is the hidden moat.** Every transcript, filing, news story, and alt-data record must map to a canonical entity. Kensho charges rent here for a reason. A new entrant's one chance at a sustainable technical moat is to build a high-quality citation graph that unifies all ingested content — more defensible than any model choice.

---

*Sources consulted include: AlphaSense press releases and product pages; Hebbia engineering blog and Sacra/TechCrunch/a16z writeups; Rogo, Brightwave, Finster, Linq, Fintool, FinChat, Perplexity, Quartr, Kensho, S&P, Daloopa, Koyfin websites and press; OpenAI, Anthropic, Google, Perplexity Deep Research blogs and system cards; LangChain, LlamaIndex, HuggingFace open-source references; arXiv papers on STORM/Co-STORM, Self-RAG, Reflexion, FLARE, IRCoT, HybridRAG, GraphRAG/LightRAG/HippoRAG, ALCE, SelfCheckGPT, Patronus Lynx, FinanceBench, FinQA, ConvFinQA, TAT-QA, MultiHierTT, FinBen, DocFinQA, FinDER, FinTextQA, SEC-QA, Vals Finance Agent Benchmark, ParseBench, RD-TableBench, FinTabNet, FinRetrieval; SEC Rule 17a-4 and FINRA Rules 4511/3110 primary texts; OpenAI ZDR, Anthropic DPA, Azure OpenAI ZDR, AWS Bedrock data-protection docs; vendor pricing and benchmark pages for Qdrant, Weaviate, Pinecone, Turbopuffer, Milvus/Zilliz, pgvector, Cohere Rerank, Voyage, Jina, BGE, Neo4j, Memgraph, TigerGraph, Kuzu, Neptune, LangGraph, DSPy, LlamaIndex, CrewAI, AutoGen, Reducto, LlamaParse, Docling, Unstructured, Langfuse, Arize Phoenix, LangSmith, Helicone, Braintrust, Portkey, LiteLLM.*
