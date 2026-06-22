# Research-Assistant Roadmap — close the coverage gap

**Today:** Quick Answer is a *SEC-filing-fact engine*. It answers "Apple FY2023 revenue"
perfectly and **refuses** "what did the CEO say on the Q3 call", "analyst sentiment",
"current price", "why did it drop today" — it has no source for them.

**Goal:** an AlphaSense-style research assistant that covers **filings + transcripts +
estimates + live price + news**, while keeping the one thing we already do better than
anyone: **grounded, cited, no-hallucination answers.**

The danger: every new source **dilutes trust**. Filings are primary, regulated, exact.
News is noisy, biased, sometimes wrong. So the architecture must tag every fact with a
**source type + trust tier + timestamp**, and the answer must respect that hierarchy.

```
Trust tier (highest → lowest)
  1  SEC XBRL exact fact          (regulated, audited)        ← we have
  2  SEC filing prose             (regulated)                 ← we have
  3  Earnings-call transcript     (primary, company's words)  ← Phase 1
  4  Analyst estimate / rating    (third-party, structured)   ← Phase 3
  5  Live quote / price           (real-time fact)            ← Phase 2
  6  News / press                 (unverified, recency)       ← Phase 4
```

---

## Phase 0 — Multi-source infrastructure  ·  FREE  ·  foundation (do FIRST)
Without this, mixing sources is chaos. No new data yet — just the plumbing.
- **Stamp every passage** with `source_type` (filing | xbrl | transcript | estimate |
  quote | news) and `published_at`. Already partly there; make it universal + required.
- **Trust-tier in the prompt**: when sources conflict, prefer the higher tier and *show
  both* ("10-K reports $X[1]; news claims $Y[5] — filing is authoritative").
- **Query understanding → temporal + source intent**: classify each query as
  `historical-fact` (→ filing/XBRL), `latest-event` (→ news/quote),
  `opinion/sentiment` (→ estimates/news), `qualitative-management` (→ transcript).
  This routing decides which channels even run.
- **Recency rule**: "today / now / latest / current" must route to live/news, never to a
  2-year-old filing chunk.
- **Exit:** every answer labels each cited fact's type + date; "current price" no longer
  pulls a stale filing.

## Phase 1 — Earnings-call transcripts  ·  ~$20/mo API  ·  HIGHEST user value
Most-asked missing thing ("what did the CEO say", "guidance on the call"). Transcripts
are **primary-source** (tier 3) — low hallucination risk, high payoff.
- **Source:** Financial Modeling Prep (transcripts + estimates + price in one ~$20-50/mo
  plan) or API Ninjas / Seeking Alpha. `earnings.py` ingestion stub already exists.
- **Ingest** → chunk **by speaker turn** → embed into the existing dense channel →
  cite `Speaker, Q3 FY2025 call (date)`.
- **Quarterly coverage** for the S&P500 we already index.
- **Exit:** "What did Tim Cook say about Services growth on the latest call?" returns a
  cited quote.

## Phase 2 — Live price / quote TOOL  ·  free tier  ·  easy, high "wow"
NOT RAG — there's no document. It's a **tool the agent calls** on demand.
- **Source:** Finnhub / Polygon / Alpha Vantage free tier (yfinance for dev).
- **Add a quote tool** to the agent: query understanding sees "price/quote/market cap" →
  call the API → return a tier-5 live fact with timestamp ("as of 2026-06-17 16:00 ET").
- Keep it OUT of the corpus (prices change by the second; never cache stale).
- **Exit:** "What's NVDA trading at?" returns a timestamped live quote, not a refusal.

## Phase 3 — Analyst estimates / consensus / ratings  ·  same API as Phase 1
Unlocks "analyst sentiment", "consensus EPS", "price target", "beat or miss".
- **Source:** FMP / Finnhub — consensus EPS & revenue, rating distribution, price targets.
- Store as a **structured channel like XBRL** (third-party tier 4, clearly labeled
  "(consensus est.)" — never as reported fact; rule 9 already enforces this).
- Enables "Did Apple beat consensus?" = reported XBRL (tier 1) vs estimate (tier 4).
- **Exit:** "What's the analyst price target for MSFT?" answers, labeled as estimate.

## Phase 4 — News + sentiment  ·  NOISIEST  ·  do LAST  ·  liability risk
"Why did it drop today", "recent news". Highest value-per-query for retail, but the
**lowest trust** and the biggest hallucination/bias surface. Do it last, gate it hard.
- **Source:** Finnhub company-news / Marketaux / GDELT (free-ish). Poll for recency.
- **Ingest** headline + summary → dense channel with a **recency boost**, dedup, and a
  **source-quality allowlist** (reject content farms).
- **Sentiment** = a *derived* layer over news + transcripts (FinBERT or LLM classify),
  always shown as "(sentiment, derived)" — never as fact.
- **Hard rule:** news is tier 6 — it can *contextualize* ("shares fell after [news][5]")
  but never override a filing figure.
- **Exit:** "Why did TSLA drop this week?" returns cited recent news with dates.

## Phase 5 — Multi-source fusion + conflict surfacing  ·  ties it together
- **Trust-tiered fusion**: when two sources disagree, the answer states both and names
  the authoritative one.
- **Recency-aware**: blend "as-of" stamps so a live quote and an annual figure coexist
  without one poisoning the other.
- **Coverage honesty**: tell the user what's covered ("filings + transcripts since 2019,
  live price, news last 30d") so the edges aren't discovered as failures.
- **Exit:** a single answer can weave "reported revenue $X[1, 10-K], consensus was $Y[4],
  shares moved on [news][6], now trading at $Z[quote]" — each tier labeled.

---

## Sequencing & cost
```
Phase 0 infra        ─ FREE  ─ do first, everything depends on it
Phase 1 transcripts  ─ $20/mo ─ highest value, primary-source, low risk
Phase 2 live quote   ─ free  ─ easy, big perceived win
Phase 3 estimates    ─ same API ─ unlocks sentiment/beat-miss
Phase 4 news+sentiment ─ free-ish ─ LAST: noisy, liability, gate hard
Phase 5 fusion       ─ FREE  ─ ties tiers together
```
One paid plan (FMP ~$20-50/mo) covers Phases 1+3 and most of 2. News is mostly free.

## The mentor's honest warning
1. **Do NOT do all five at once.** Phase 1 (transcripts) alone gets you ~70% of the
   "research assistant" feeling for the least risk. Ship it, measure, then continue.
2. **Every source you add can lie.** Your current superpower is that you *don't*. Protect
   it with strict trust tiers — a news headline must never be allowed to override a 10-K.
3. **This competes with the latency fix.** A research assistant that takes 25s is still a
   failed product. Coverage and speed are both required; don't let coverage work hide the
   unfixed spinner.
4. **Decide the identity first.** "SEC-filing-fact engine" (own it, it's excellent) vs
   "research assistant" (this roadmap, 4-8 weeks + API spend). Pick deliberately — don't
   half-build the second and ship it wearing the first's name.
