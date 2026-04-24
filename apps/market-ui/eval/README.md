# Deep Research Eval Gate

Fixture-based quality gate for `performDeepResearch`. Pure scoring — no LLM calls, no API keys, no network.

## Running locally

```bash
# From apps/market-ui/
npm run eval                # fixtures mode (default)
npm run eval:synthetic      # harness wiring probe only, no fixtures needed
```

Exits non-zero when aggregate thresholds fail. See `src/services/evalRunner.ts` for threshold env vars (`EVAL_PASS_RATE_FLOOR`, `EVAL_AVG_OVERALL_FLOOR`, `EVAL_AVG_GROUNDING_FLOOR`).

## Adding a fixture

1. Run deep research on a query that matches a [`SEED_GOLDEN`](../src/services/evaluation.ts) entry.
2. Save the resulting `ResearchReport` JSON to `eval/fixtures/<goldenId>.json` in this schema:

```json
{
  "goldenId": "nvda-earnings-preview",
  "report": { /* ResearchReport */ }
}
```

3. Only the fields read by `scoreReport` are required:
   - `markdown` — for ticker / metric / section presence checks
   - `metadata.template` — for template-match
   - `metadata.verification.totalClaims` + `groundedClaims` — for grounding rate

Everything else is optional.

4. Re-run `npm run eval`. A new fixture that lowers the aggregate score below thresholds will fail CI — that's the point.

## Thresholds (current defaults)

| Gate | Floor | Override |
|---|---|---|
| Pass rate (fixtures passing ÷ total) | 80% | `EVAL_PASS_RATE_FLOOR` |
| Avg overall weighted score | 0.70 | `EVAL_AVG_OVERALL_FLOOR` |
| Avg numeric-grounding rate | 0.70 | `EVAL_AVG_GROUNDING_FLOOR` |

Individual fixtures also have their own `passed` flag (overall ≥ 0.70 AND grounding ≥ minGroundingRate). An individual failure does not alone break CI; only the aggregate thresholds do. This lets you commit a known-bad fixture for regression-tracking without blocking merges.

## What's NOT covered here

- **Live eval against real models** — the runner scores frozen JSONs, not fresh generations. To regression-test model quality, run `performDeepResearch` against a SEED_GOLDEN query manually, save the report, and add it as a fixture.
- **Hallucination / attribution correctness** — the scorer only measures structural presence (template, tickers, metrics, sections) plus the numeric-grounding rate reported in `metadata.verification`. It does not re-verify claims against source evidence.
- **Inter-rater agreement with human reviewers** — the scoring weights in [`evaluation.ts`](../src/services/evaluation.ts) were picked by hand, not calibrated against human judgment. Treat pass/fail as a smoke signal, not a quality ceiling.
