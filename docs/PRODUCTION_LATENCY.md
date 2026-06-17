# Production Latency — turnkey path to <3s (spend, no code)

Status (2026-06-17): correctness/capability is done — 20/20 regression battery green
(`services/gravity-api/scripts/reliability_battery.py`), single-entity + comparison +
trend + multi-metric + grounded bull/bear, all HIGH/MEDIUM confidence, ~32 commits.

The ONLY remaining gap is cold latency (12-32s vs <3s). It is **proven spend-gated** —
four free code levers were tried and measured, none moved it:

| Lever | Result |
|---|---|
| Skip model validators on fast path | 36s → 13s (kept) |
| Groq-70b first | free 100k TPD ~98% burned by mid-day → 429 → deepseek |
| gemini_flash first | free tier rate-limited → deepseek |
| Terse prompt (−60% output tokens) | latency UNCHANGED → cost is deepseek's TTFT, not output |

Conclusion: cold latency = deepseek's inherent response time + a single shared-CPU Fly
machine. No prompt/routing/pipeline change reaches <3s.

## The fix is pure ops — and the code is ALREADY ready for it

No code change is required. The router fallback chain already prefers
`groq_large` (llama-3.3-70b, 1-3s, reads in-context facts) and `gpt4o` (gpt-4o-mini)
ahead of slow paths; they only lose today because their FREE tiers are capped. Fund
them and the existing chain uses them automatically.

### Step 1 — fund a fast model (~$0-20/mo)
Either:
- **Groq dev tier** (recommended): upgrade the existing Groq key at
  https://console.groq.com/settings/billing. Same `GROQ_API_KEY` — the TPD cap lifts,
  `groq_large` stops 429ing, SIMPLE queries answer in 1-3s. Then promote it to first for
  SIMPLE in `app/llm/router.py` (one line; reverted earlier only because the free cap
  made it a wasted attempt).
- **OpenAI**: add credit to the existing `OPENAI_API_KEY`; `gpt4o` (gpt-4o-mini, ~3-5s)
  becomes a funded fast path.

### Step 2 — stop the other free tiers stealing budget
The Cohere rerank trial key (1000/mo, exhausted) and gemini retries add latency on the
fallback. Either fund a Cohere production key or set rerank off; both are env/ops only.

### Step 3 — scale Fly off a single shared CPU (~$10-30/mo)
```
fly scale vm performance-2x -a gravity-api-prod     # or
fly scale count 2 -a gravity-api-prod               # horizontal, kills saturation 503s
```
The single shared-cpu machine saturates under concurrent queries (the 503s/120s seen in
testing). One `performance` VM or 2 machines removes that.

### Expected result
P50 < 3s, P95 < 8s, zero saturation timeouts at concurrency 3. Re-run
`python scripts/reliability_battery.py --max-latency 3` to verify the SLA.

## What needs real engineering (not spend)
The multi-agent orchestrator (`AGENTIC_ORCHESTRATOR_ENABLED`, gated off) is hardened
(Reader scopes+pins XBRL facts, Writer never empties, pipeline falls back to single-pass)
but the full Planner→Reader→Extractor→Critic→Writer loop is slow (120s) + crash-prone.
It's a dedicated rebuild, not a patch. Single-pass already delivers the agentic capability
(grounded analysis, trends, multi-metric) at 3-17s, so the orchestrator is optional.
