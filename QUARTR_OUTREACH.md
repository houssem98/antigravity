# Quartr Outreach Package

**Goal:** Sign Quartr API for earnings transcript coverage (14,500+ companies, 40M+ first-party docs, >98% live event coverage).

**Why Quartr (per plan §6.5, §10.7):**
- "Three categories you absolutely cannot skip: Quartr-class transcripts, Daloopa-class fundamentals, real entity resolution."
- Perplexity Finance uses Quartr as backbone — independent validation that Quartr is enterprise-ready.
- $50K–$250K/yr range; cheapest of the must-have-three.

**Status:** Quartr raised $10M in 2025. Active sales motion. Reachable.

**Time to close (realistic):** 4–8 weeks from first touch to signed.

---

## 1 · Discovery (Week 0, before outreach)

Confirm these via Quartr website / LinkedIn / press:

- Pricing tiers: Starter / Pro / Enterprise. Plan estimates $50K–$250K/yr.
- Contract length: typically annual; quarterly discount possible.
- Data delivery: REST + webhooks + Snowflake share.
- License terms: redistribution? AI training? Per-user vs per-org seat count?
- Sales contact: contact form on quartr.com → discovery call; or LinkedIn outreach to founders/CRO.

**Founders / known contacts:**
- David Stenmark (CEO, ex-banker)
- Lukas Lindblom (Founder, ex-product)
- Sales contact: `sales@quartr.com` (verify on their site)
- Backers: J12 Ventures, Spintop Ventures, Cherry Ventures — useful warm-intro path

---

## 2 · Cold email template

**Subject:** Gravity Search × Quartr — transcript coverage for AI research platform

**Body:**

> Hi [Name],
>
> I'm [Your Name], building Gravity Search — an AI-native financial research platform. Architecture is close to AlphaSense Deep Research + Hebbia Matrix, with SEC filings, XBRL, and our own grounding stack already wired (NLI + Patronus Lynx + numeric verifier).
>
> The retrieval engine works against SEC EDGAR end-to-end. The missing leg is earnings transcripts. We've evaluated Refinitiv StreetEvents and Quartr; Quartr won on coverage (~98% live), latency, and API ergonomics. Perplexity's choice validates the architecture for us.
>
> Looking for:
> - Quartr API access for full transcript corpus (~14,500 companies)
> - REST + webhook for live events
> - License terms compatible with grounded AI search (retrieve + cite, not retrain)
> - Initial 6-month pilot pricing, with annual commit option
>
> What does Q2 2026 look like for a discovery call? 15 min is enough to confirm fit; if there's mutual interest, I'll send our stack overview + benchmark numbers ahead of a deeper session.
>
> Best,
> [Your Name]
> [Title] · [Company]
> [Calendly link]
> [LinkedIn]

**Personalization slots:**
- Reference a recent Quartr blog post / news (raised $10M in 2025, expanded to X market, hired CRO)
- Reference Perplexity partnership if you're cold and need a hook
- If you have an intro: lead with the introducer's name, not the cold pitch

---

## 3 · Discovery call brief (15 min)

**Their goal:** qualify you. They want: real funding, real corpus need, willing-to-sign timeline.

**Your goal:** confirm price band, license language, integration plan.

**Run order (15 min):**

| Min | Topic |
|---|---|
| 0–2 | Mutual intros |
| 2–5 | Your context: what you're building, who pays you, why now |
| 5–8 | Their tiers, included features per tier, typical Customer Success ramp |
| 8–11 | License terms: AI training restriction? Citation requirements? Redistribution? Storage? |
| 11–13 | Pricing band + contract length + payment terms + minimums |
| 13–15 | Next steps |

**Questions to bring:**

1. **Coverage**: All public companies, or only those that consent? Pre-IPO?
2. **Latency**: Live call transcript SLA — minutes from end of call to API?
3. **Format**: Speaker-diarized? Timestamps per turn? Translated content?
4. **License**:
   - "Retrieve and cite" allowed in commercial AI product? (Most important.)
   - Persistent storage of transcript chunks in our vector DB?
   - Can we surface transcript excerpts in customer-facing answers with attribution?
   - Forbidden: training a model on transcript content?
5. **SLA**: Uptime % committed. Notification window for outages.
6. **Compliance**: SOC 2 status? Sub-processor list? GDPR DPA?
7. **Pricing**:
   - Pricing dimension — per-user, per-API-call, per-company, flat tier?
   - Volume discount thresholds?
   - Annual prepay vs monthly?
   - Trial / pilot terms? 30-day evaluation possible?
8. **Integration**:
   - Webhook reliability — retry policy on failure?
   - Snowflake share vs REST — recommended pattern for our scale?
   - Historical backfill — included or one-time fee?

**Red flags to listen for:**
- "We require credit for every excerpt" → may conflict with sentence-level citation UI
- "No third-party redistribution" — we're not redistributing, we're synthesizing for customers, confirm OK
- Minimums above $250K/yr year-one → renegotiate or push to phase 2
- "We don't support startups under $X ARR" → ask for design-partner pilot rate

---

## 4 · After the call

**Within 24 hours, send:**
1. Recap email — confirm what you heard re price, license, timeline.
2. Stack one-pager attached (use `INVESTOR_DECK.md` slides 3, 4, 5, 7 as PDF).
3. Specific ask: send draft MSA + price quote for $X/yr (your target band).

---

## 5 · Contract negotiation checklist

| Term | Target | Walk-away |
|---|---|---|
| Annual price | $50K–$100K year-one | >$250K without 36-mo commit |
| Contract length | 12 mo with auto-renew opt-out at 60d notice | 3-year required, no termination |
| Payment | Net 45, quarterly | Annual upfront required without discount |
| License for AI retrieval + cite | **Required** | Any "training" loophole left ambiguous — get email confirmation |
| Pilot / trial | 30-90 day at zero or reduced rate | No trial offered |
| SLA | 99.5% uptime, 4h response on P1 | < 99% or no remedy |
| Termination for cause | 30 days written notice | None — locks you in |
| Data residency | EU customers — EU region option | US-only when EU customer asks |
| Sub-processor list | Available, 30-day change notice | None |
| Indemnification | Mutual, capped at fees paid | Asymmetric in their favor |
| Liability cap | 12× monthly fee or 1× annual | Unlimited indirect |
| Audit rights | Annual, 30-day notice, SOC 2 satisfies | Onsite-only at customer cost |

**Red lines** (do not sign without):
- Right to cite excerpts in customer-facing AI answers with attribution
- Right to delete chunks on customer offboarding
- No commitment to migrate to higher tier in <6 mo
- Force majeure clause covering data-provider outages
- Right to terminate without penalty if Quartr is acquired or sub-processors change materially

---

## 6 · Fallback plans

If Quartr says no (or pricing infeasible):

1. **Refinitiv StreetEvents** — incumbent. More expensive (~$100K-$500K), slower API.
2. **AlphaStreet** — newer entrant, possibly cheaper.
3. **Manual scrape EDGAR 8-K exhibit 99** (already shipped in `app/ingestion/sources/earnings.py` tier 1). Covers US issuers. No live transcript, just press release text. ~80% coverage, free.
4. **Motley Fool / Seeking Alpha free tier scrape** — fragile, ToS-risky. Last resort.

Even without Quartr, the EDGAR 8-K tier is already production-quality. Quartr is upgrade, not enabler.

---

## 7 · 30-day execution plan

| Day | Action |
|---|---|
| 1 | Send cold email + LinkedIn connect to David Stenmark |
| 1 | Ping warm-intro path: J12, Spintop, Cherry partners on LinkedIn |
| 3 | Follow-up email if no reply |
| 5 | Book discovery call |
| 7 | Discovery call → send recap + one-pager |
| 14 | Receive draft MSA |
| 21 | Redline back. Counterproposal on price + license language |
| 28 | Negotiate terms, sign DPA |
| 30 | Contract signed; first API key issued |
| 31 | Wire `QUARTR_API_KEY` into Render env; live transcript ingestion enabled |

---

## 8 · Internal readiness checks (before signing)

- [ ] We can absorb the data: Postgres + Qdrant storage budget
- [ ] We can pay the bill — credit reserved for at least 12 months
- [ ] Counsel reviewed MSA + DPA
- [ ] Reference customer agreement that Quartr-attribution language meets their compliance needs
- [ ] `earnings.py` already supports Quartr as Tier 2 source; switch flag once key is live

**Don't sign before:** running FinanceBench eval, getting one design-partner pilot signed (Quartr's value isn't proven without a customer asking for it).
