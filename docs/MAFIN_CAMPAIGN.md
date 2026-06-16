# Mafin Campaign — the concrete plan from 30% → 98%

The definitive, sequenced plan to reach Mafin 2.5 (98.7% FinanceBench,
hallucination-free), grounded in everything proven this session. Supersedes the
high-level roadmaps (ROADMAP_TO_98, MAFIN_LEVEL_ROADMAP) with the actual build steps.

## Where we are (measured)
- **30% type-aware / 31% numeric / 16% hallucination** (50-Q, all fixes live).
- Built + live: scoping fix, XBRL exact facts (503 cos, 10yr), 75-ratio deterministic
  calculator, DeepSeek primary, GravityIndex tree-nav engine (7,548 nodes), all UI fixes.
- Failure analysis (35 fails on 50-Q): **26 not-found + 9 wrong-value**, ~all numeric
  long-tail (missing component concepts / narrative specifics), NOT nav-mechanism.

## The gap to 98%, decomposed
| Bucket | ~share of fails | Lever |
|---|---|---|
| Ratio missing a component concept | large | broaden XBRL concept coverage |
| Specific narrative item (restructuring, credit facility, segment-by-region) | medium | finer trees + better nav |
| Wrong-value (compute/period pick) | ~9 | validator + numeric verification |
| Historical doc not indexed | medium | closed-book doc coverage |
| Latency timeouts | infra | scale Fly + fast model |

## Phases (each: tasks → exit metric → effort)

### Phase A — Numeric coverage (30 → ~45%) · ~days · FREE
The biggest near-term lever (FinanceBench is 126/150 numeric).
- Add missing us-gaap concepts to `sec_xbrl.CORE_CONCEPTS` + `CONCEPT_LABELS` +
  ratio_engine `_CONCEPT_TO_METRIC`: InterestExpense, dividends-paid mapping,
  OperatingLeaseExpense, IncomeTaxExpense, shares (basic/diluted), preferred div.
- Add ratio defs missing from the failure set (dividend_payout_ratio, EBITDA-less-capex).
- Re-backfill S&P 500 XBRL (10yr). Re-run ratio engine over the wider concept set.
- **Exit:** numeric ≥ 45%; ratio "not-found" cluster cleared.

### Phase B — Validator-enforced grounding (hallucination 16 → ~0) · ~days · FREE
- Post-generation: every `$N`/`N%`/period figure must appear in a retrieved source
  or a computed ratio; else strip/refuse + log. Reuse Lynx/NLI + citation validator.
- Numeric verification: recompute FCF=OCF−capex, margin=GP/Rev, flag mismatches.
- **Exit:** FailSafe hallucination = 0%; no FinanceBench answer counts correct unless
  its number is in-source/computed.

### Phase C — GravityIndex nav quality (narrative tail + closed-book) · ~1-2 wks
The Mafin core. Current trees are top-section + 180-char summaries.
- **Finer trees**: split below Item level (individual statements, notes, segments).
- **LLM node summaries** at build time (gemini, cheap, once/filing) → nav precision.
- **Boost navigated content** in fusion (done — force-include) + tune top_nodes.
- **Closed-book harness**: build trees for the exact FinanceBench docs; eval tree-nav
  isolated (like financebench_pageindex.py but our engine).
- **Exit:** closed-book tree-nav ≥ 70% numeric; narrative subset ≥ 80%.

### Phase D — Coverage + freshness · ~1 wk · compute
- Build XBRL + trees for full S&P 500 → Russell 3000 (scheduled ingestion).
- Index the historical filings FinanceBench references (FY2017-2020 docs) so
  closed-book Qs have their source.
- **Exit:** any FinanceBench doc available; open-corpus FinanceBench 45 → 70%+.

### Phase E — Model + latency · ~days · $
- Fast reliable model for the hot path (Groq dev tier / funded) → kills the
  30-60s DeepSeek timeouts; route reasoning to DeepSeek, lookups to fast model.
- Scale the Fly machine (single shared-cpu saturates → health 18s under load).
- Self-consistency back on (cheap once model is fast) for numeric.
- **Exit:** P50 < 5s; 0 timeouts at concurrency 3; FinanceBench 70 → 85%.

### Phase F — Close to Mafin · ongoing
- Continuous CI eval: full 150-Q FinanceBench + FinDER + FailSafe + company-correct,
  weekly, gated. Publish the scoreboard.
- Iterate nav + concept coverage on the failure log until ≥ 98%.
- **Exit:** FinanceBench ≥ 98%, hallucination ~0, sustained.

## Trajectory
| Phase | FinanceBench | Hallucination |
|---|---|---|
| now | 30% | 16% |
| A numeric coverage | ~45% | 16% |
| B validator | ~45% | ~0% |
| C nav quality | ~60% | ~0% |
| D coverage | ~70% | ~0% |
| E model+latency | ~85% | ~0% |
| F iterate | **98%** | ~0% |

## Honest effort
**Phases A-B (~1 week, free): 30→45% + hallucination→0** — the highest ROI, do now.
**Phases C-F (4-8 weeks + some spend): 45→98%** — the real campaign; C (nav quality)
is the Mafin core, E needs a funded fast model + Fly scaling.

## Sequencing decision
Do **A then B** immediately (free, biggest near-term lift + trust). Then commit to
**C** (the multi-week Mafin-core nav campaign). D/E/F follow. This is the path; it's
weeks of focused work, not a deploy — but every piece is now scoped and the
foundation (engine, XBRL, ratios, scoping) is built and live.
