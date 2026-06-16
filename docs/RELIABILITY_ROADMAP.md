# Reliability Roadmap — close the B→D gap

Architecture earns a B. Lived experience earns a D. This roadmap closes that gap.
NOT about Mafin/accuracy — about making what we have **trustworthy, fast, correct**.
Grounded in a cold test battery (2026-06-16): ~2/8 realistic queries worked; same
query failed 1/4 times; 13-37s latency; wrong company + wrong period repeatedly.

Sequence by trust-impact-per-effort. Do R1+R2 first — they're the crisis and mostly free.

## STATUS (2026-06-16, end of sprint)
- **R1 determinism — DONE.** Cache gate hardened (never cache NONE/refusal; flushed poison).
- **R2 period — DONE (partial).** Period-aware reorder keeps the asked FY; structured
  facts immune. Future-dated corpus purge still worthwhile.
- **R3 entity — DONE.** Possessive `'s` strip ("Amazon's"→AMZN, was CHUC) + single-char
  token drop ("Nvidia's R&D"→NVDA, was DHI). 0 wrong-company on the battery.
- **R4 latency — BLOCKED on spend.** Free wins banked (fast path skips dead-Groq
  validators 36s→12s; deep-validate tied to iterative path). Floor is deepseek 15-40s +
  single shared-cpu Fly saturating. Needs funded fast model + Fly scale. ← the wall.
- **R5 coverage — DONE (partial).** FCF/margins compute from components; bank NII
  backfilled (12 banks); comparison path fixed (scoped per-entity + interleaved facts).
  Long-tail tickers/periods still need wider `--sp500` backfill.
- **R6 eval — NOT yet wired into CI.** Cold battery is manual (`POST /v1/search`).
Result: 12/12 single-entity exact-XBRL + working comparisons, mostly HIGH confidence.
Remaining gap is **latency under load (spend)**, not correctness.

## R1 — Determinism (the 25% same-query failure) · CRISIS · free
Same query "Apple FY2023 net income": 3/4 OK, 1/4 "not found" (a 3s path that
skipped retrieval). A finance tool that contradicts itself on query #3 has zero trust.
- **Diagnose the fail path**: why does retrieval sometimes return empty for a query
  it answers correctly other times? Suspects: (a) a channel races/errors → empty
  top_passages → "not found" emitted before structured/XBRL returns; (b) semantic
  cache returns a stale *empty* result; (c) single-pass vs iterative divergence
  (iterative drops structured); (d) the 3s = a fast-fail before XBRL awaited.
- **Fix**: never emit "not found" while a forced channel (structured/tree_nav) had
  data or is pending; retry-once on empty retrieval; don't cache empty/failed answers;
  ensure numeric Qs always await the structured channel.
- **Exit**: same query → same correct answer 10/10.

## R2 — Corpus data hygiene (wrong-period pollution) · CRISIS · free
Lookups grab the wrong year because the corpus has **future/mis-dated docs** (Q1
**FY2026**) that out-rank the real FY2023 filing. This silently breaks period
accuracy across the WHOLE product — likely the single highest-leverage fix.
- **Audit**: count chunks by filing_date/period; find future-dated (>today) and
  mislabeled filings.
- **Purge or down-rank** future/duplicate/mis-dated chunks in Qdrant.
- **Period-aware retrieval**: when the query names FYxxxx, hard-filter retrieval to
  that period's filing (or strongly boost it); never let a later-period chunk answer.
- **Exit**: "Apple FY2023 revenue" never returns a Q1 FY2026 chunk; period match 100%.

## R3 — Entity resolution hardening (wrong company) · HIGH · free
"Coca-Cola" resolved to "Coca-Cola Consolidated" (a different listed company). In
finance that's not a typo, it's a liability.
- Exact ticker → exact official name first; fuzzy ONLY within the same entity, never
  onto a different CIK/ticker.
- Disambiguation list for common collisions (KO vs COKE, GOOGL, BRK).
- Confidence floor: if name match is ambiguous, ask/clarify rather than guess.
- **Exit**: 0 wrong-company answers on a 50-name battery.

## R4 — Latency ("Quick" must mean <3s) · HIGH · needs spend
13-37s today. The name is false advertising.
- **Cache** deterministic answers hard (XBRL facts/ratios don't change intra-day).
- **Trim** pipeline for simple lookups: skip validation/ALiiCE/self-consistency.
- **Fast model** for the hot path — free Gemini rate-limits, so fund Groq dev tier
  (1-2s, reliable) or a small paid tier. Reserve DeepSeek for reasoning.
- **Scale Fly** — single shared-cpu saturates (health hit 18s under load).
- **Exit**: P50 < 3s, P95 < 8s, 0 timeouts at concurrency 3.

## R5 — Coverage gaps users expect · MEDIUM
- **Quarterly XBRL** backfill (Tesla Q3 etc — we only have annual).
- **On-demand fix**: fetch the ASKED period, not just the latest filing (Palantir
  FY2023 returned FY2022).
- **Comparison path**: multi-company queries currently break.
- **Exit**: quarterly + on-demand + comparison all answer.

## R6 — Honest continuous eval · ALWAYS · free
- The cold diverse battery (like today) wired into CI: determinism (same-query 10x),
  latency P50/P95, correctness, wrong-company rate. Gate deploys on it.
- **No warm-cache demos.** Test what users actually get, cold.

## Sequencing
```
R1 determinism  ─┐ the trust crisis — free, do NOW
R2 data hygiene ─┘ (R2 probably lifts accuracy more than any model work)
R3 entity        — free, do next
R4 latency       — needs a funded fast model + Fly scale
R5 coverage      — incremental
R6 eval          — wire alongside, run every change
```

## The mentor's one line
Until R1+R2 are done, **everything else is polishing a tool that lies 1-in-4 and
grabs the wrong year.** Fix reliability before features, before Mafin. A correct,
fast, trustworthy 28% beats an unreliable, slow 40%.
