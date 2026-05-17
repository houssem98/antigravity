# Investor Deck — Gravity Search

**Stage target:** Pre-seed / seed ($500K–$2M)
**Audience:** AI-native investors who understand fintech & RAG (Khosla, Thrive, a16z, Sequoia, Decibel, Point72 Ventures, OMERS, Peak XV)
**Format:** 12 slides, ~10-minute pitch + Q&A
**Use:** Replace `[TODO]` placeholders. Each slide caption = max 3 sentences. Numbers must be real.

---

## Slide 1 · Title

> **Gravity Search**
> AI-native financial research for the next generation of analysts.
>
> [Founder name] · [Email] · [Date]
> [Logo placeholder]

---

## Slide 2 · The problem

**Analysts spend 60–80% of their time on retrieval & synthesis. Existing tools fail in three specific ways:**

1. **AlphaSense / Bloomberg / FactSet** — $20K+/seat, slow, content-locked
2. **ChatGPT / Perplexity** — wrong on financial numbers, no citations, no compliance trail
3. **Hebbia / Rogo** — engine-good, no proprietary content moat, $10K/seat

Quote from prospect interview:
> "I'd pay $5K/seat for AlphaSense if it wasn't so slow. I'd pay $1K/seat for Perplexity if I could trust the numbers." — [Anon analyst, mid-cap hedge fund]

**Market opportunity:**
- 6,500 enterprise customers buy AlphaSense at avg $66K ARR — **$429M visible TAM** at current price points.
- Add Hebbia + Rogo + specialist tier ~ $200M ARR aggregate.
- Bloomberg Terminal: ~325K seats × ~$30K = **$9.7B/yr** — partially addressable.

---

## Slide 3 · Why now

| Year | Inflection |
|---|---|
| 2023 | RAG was a research pattern; FinanceBench launched at 19% baseline |
| 2024 | Contextual Retrieval (Anthropic Sept) cut retrieval failure 49% — production-ready quality |
| 2025 | Multi-agent Deep Research products (Anthropic / OpenAI / Gemini) hit GAIA 55–67% |
| 2025 | AlphaSense bought Tegus at 70% markdown — content consolidation cycle started |
| 2026 | Fintool acquired by Microsoft — incumbents will commoditize basic Q&A within 18 mo |

**Window**: 18–36 months before Office + Excel + MCP-connected data vendors close the gap. The defensible standalone platform is being built **now**.

---

## Slide 4 · Solution

**Three coordinated layers:**

```
┌───────────────────────────────────────────────────────────────┐
│ UI: Grid (Hebbia-style) + Deep-Research report + Excel export │
├───────────────────────────────────────────────────────────────┤
│ Engine: LangGraph state machine                                │
│  Scope → Plan → Research-Fanout → Compress → Reflect → Verify  │
│  Hybrid retrieval (RRF + Cohere rerank + Contextual)           │
│  Multi-verifier grounding (NLI + numeric + Patronus Lynx)      │
├───────────────────────────────────────────────────────────────┤
│ Data: SEC EDGAR + XBRL + Quartr + Daloopa + macro + news       │
│  Pre-retrieval entitlement ACL · MNPI walls · 17a-4 WORM       │
└───────────────────────────────────────────────────────────────┘
```

**Differentiation in one sentence:**
> Hebbia's engineering quality + AlphaSense's compliance posture + a content stack a new entrant can actually afford.

---

## Slide 5 · Traction (replace with real numbers)

| Metric | Today |
|---|---|
| Code: plan completion (engineering benchmark) | **~82%** |
| FinanceBench score (open 150) | **[TODO — run eval]** |
| Vals AI score | **[TODO — run eval]** |
| Design partners in conversation | **[TODO]** |
| Paying customers | **[TODO]** |
| MRR | **[TODO]** |
| Pilot LOIs | **[TODO]** |

**Code milestones already shipped (technical credibility):**
- 7 retrieval channels: dense, BM25, SPLADE, graph, structured, GDELT news, social
- LangGraph orchestration with Postgres checkpointing
- Patronus-Lynx-style finance hallucination grader
- Multi-tenant Qdrant + pre-retrieval entitlement ACL
- 17a-4 WORM audit-trail-alternative + HITL reviewer audit
- SAML 2.0 SSO + SCIM v2 + MFA + BYOK via AWS/GCP/Azure KMS

**Honest note**: code-side is tier-2 capable. Eval + customer count are 0 today. This raise funds the gap.

---

## Slide 6 · Competition (positioning)

| | AlphaSense | Hebbia | Rogo | Perplexity | **Gravity** |
|---|---|---|---|---|---|
| Hybrid retrieval | ✅ | ✅ | ⚠ | ❌ | ✅ |
| Contextual retrieval | ⚠ | ✅ | ❌ | ❌ | ✅ |
| Multi-agent orchestration | ⚠ | ✅ ISD | ⚠ | ⚠ | ✅ LangGraph |
| Grid UX | ✅ | ✅ Matrix | ❌ | ❌ | ✅ |
| Excel export (Anthropic skill) | ❌ | ⚠ | ⚠ | ❌ | ✅ |
| Pre-retrieval ACL + MNPI walls | ✅ | ✅ | ⚠ | ❌ | ✅ |
| 17a-4 audit log + hash chain | ✅ | ✅ | ⚠ | ❌ | ✅ |
| BYOK via customer KMS | ✅ | ✅ | ⚠ | ❌ | ✅ |
| Premium content (Quartr / Daloopa / Tegus) | ✅ ✅ ✅ | ❌ (BYO) | ⚠ | ⚠ Quartr | **⏳ in process** |
| Per-seat $/yr | $20K | $10K | $10K | $0.2K | **$5K target** |

**Position**: technical parity with Hebbia at half the price; compliance parity with AlphaSense at one-quarter the content footprint. Wedge on **Excel + compliance + price**.

---

## Slide 7 · Business model

**Pricing (Plan §5):**
- **Free**: 50 queries/mo, public sources only — top-of-funnel
- **Pro**: $49/mo individual — full retrieval, no premium content
- **Team**: $499/mo (5 seats) — workspace, audit log access
- **Enterprise**: $5K–$20K/seat — SAML, BYOK, SOC 2 report, premium content, EU residency

**Unit economics target:**
- ARPU: $99/mo year-one blended (free heavy)
- LLM cost per query: $0.05–$0.30 (model tiering + caching)
- Gross margin: 75% target after $200/seat data-license amortization
- CAC payback: <12 mo via product-led growth + design-partner referrals

---

## Slide 8 · Go-to-market

**Three-pronged motion:**

**1. Bottom-up (Pro/Team):** Vercel free tier landing + Stripe self-serve checkout. Target: 1,000 free signups / 100 paid in 6 months. PLG.

**2. Design partner (Enterprise wedge):** 2-3 mid-market hedge funds or family offices, free or reduced-price pilot, 90-day eval, customer reference rights. Plan §7 P2 target: first 10 enterprise logos in 6 months.

**3. Content partnership leverage:** Quartr + Daloopa signed → marketing co-launch → referenceable content moat. Pursue AlphaSense WSI AMR broker research deal (18-24 mo BD cycle; start now).

**Distribution channels:**
- Twitter/LinkedIn organic from founders' analyst networks
- Sponsorships on analyst-focused podcasts (Animal Spirits, On The Tape)
- Booth + speaking slots at SIFMA, FactSet user conf, AI Frontiers
- Direct LinkedIn outreach to investment-banking analysts under 30

---

## Slide 9 · Team

**[Founder Name]** — CEO / CTO
- [Background: ex-XX YC W23 / ex-XX trading desk / ex-Google AI / etc.]
- Why this problem: [personal story — analyst who hated tools, engineer who saw the gap, etc.]
- Why now: [Skills aligned: built X, shipped Y, raised Z previously]

**Open roles** (to fill from raise):
- Founding engineer (full-stack) — Mar 2026
- Founding analyst-in-residence — Apr 2026
- Sales engineer — post first 10 logos

**Advisors target:**
- 1× ex-AlphaSense / Hebbia engineer
- 1× ex-buyside analyst with current network
- 1× compliance/legal counsel for fintech AI

---

## Slide 10 · Financials & ask

**Raise**: $1.5M seed at $10M post-money.

**18-month deployment**:

| Bucket | $ | What |
|---|---|---|
| Engineering payroll | $600K | 2 engineers + founder |
| Data licenses | $400K | Quartr + Daloopa year-1 + Visible Alpha pilot |
| Infrastructure | $80K | Render scale-up + LLM credits + Voyage embed + Cohere rerank |
| SOC 2 Type II audit | $80K | A-LIGN year-1 + readiness consulting |
| Legal | $40K | MSA + DPA + entity setup + IP filings |
| Sales / marketing | $150K | Founder time + LinkedIn ads + conferences |
| Reserve (runway buffer) | $150K | 3 months extra runway |

**Milestones funded:**
- M0 (today): code shipped, friend-pilot live
- M3: First 50 paid signups + 1 enterprise pilot signed
- M6: Quartr + Daloopa contracts signed; ≥85% FinanceBench
- M9: 10 enterprise pilots; SOC 2 observation halfway through
- M12: SOC 2 Type II delivered; 3 enterprise paying logos
- M18: $300K-$500K ARR, ready for $5-10M Series A

---

## Slide 11 · Risks & mitigations

| Risk | Mitigation |
|---|---|
| Incumbent (AlphaSense / Hebbia / Microsoft Copilot) ships competing product | 18-36 mo window. Wedge on Excel + compliance + price. Build content moat in parallel. |
| LLM cost spike (~$X per query) | Aggressive model tiering: Haiku/Flash-Lite for compression. Prompt caching. Self-host inference for top accounts via DeepSeek/Qwen. |
| Quartr / Daloopa won't license to startup | 4 fallback transcript sources (EDGAR 8-K free, AlphaStreet, Refinitiv, manual). KPI extractor built in-house already. |
| SEC / FINRA changes recordkeeping rules | 17a-4 alternative + WORM archival already shipped. Monitor SEC update calendar. |
| Customer churn from no-eval-numbers | Run FinanceBench + Vals AI immediately. Publish. Beat OSS baseline at minimum. |
| Founder concentration | Plan first key hire within 90 days of close. Advisor agreements for content moat. |

---

## Slide 12 · Vision

**5-year**: $50M ARR. 100+ enterprise logos. Proprietary entity-resolution graph (Kensho-class) becomes our quiet moat. Public benchmark contributor at FinanceBench v3.

**10-year**: Bloomberg-tier alternative for the AI-native generation of analysts. Acquired or IPO-track at $1B+.

**Why we win:**
- Best-in-class agentic orchestration (Hebbia-equivalent code)
- Licensed content moat that didn't exist 18 months ago (Quartr + Daloopa now reachable for new entrants)
- Compliance posture from day one — no retrofit
- Founder discipline: $1.5M to first 10 customers, not $50M to vague "scale"

---

## Appendix — backup slides

### A1 · Technical architecture
Diagram: 10-stage search pipeline (Query → Cache → Parallel Retrieval → RRF + Rerank → Generation → NLI + Lynx verify → Audit log → Stream answer + citations).

### A2 · Sample query trace (real screenshot)
Show input "Apple FY24 segment revenue trend" → retrieved passages (with bbox citations) → generated answer → grounding scores.

### A3 · Benchmark comparison
FinanceBench number, Vals AI number, latency p50/p95, cost per query — all measured, no claims without numbers.

### A4 · Compliance posture
SOC 2 control mapping. NIST AI RMF mapping. GDPR sub-processor list.

### A5 · Customer pipeline
Logos of design-partner discussions (anonymized to avoid leaks).

---

## How to use this deck

1. Run FinanceBench eval first — **single most leverage activity before any pitch**.
2. Sign 1 design-partner pilot LOI (free is fine) — replace "[TODO]" customer count with `1 LOI`.
3. Build founder LinkedIn profile pages around financial-AI thought leadership for 30 days.
4. Warm intros only — cold-pitching seed VCs without a logo is 5x harder.

**Send order:**
1. Friendly angels with fintech operator background ($25K-$100K checks)
2. Pre-seed funds with current AI-finance theses (Decibel, Point72 Ventures, Khosla)
3. Series A funds for relationship-building only — too early for cheque

---

## What NOT to put in the deck

- Specific account names of design partners (NDA, leak risk)
- LLM provider keys, env values, internal infrastructure details
- Bloomberg / FactSet pricing screenshots (legal risk, antitrust optics)
- Customer revenue projections beyond 18 months (will be wrong)
- "We will beat AlphaSense in 12 months" — strategic patience > bravado

---

**Deck status**: ready for first-pass review. Sub in real numbers, founder bio, and screenshots, then iterate with 3 trusted advisors before sending wide.
