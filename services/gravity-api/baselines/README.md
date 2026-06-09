# Baselines — Pre-Hermes Reference Metrics

Reference deepeval runs locked at known good states. Used as comparison
benchmarks for Hermes integration phases.

## Snapshots

| File | Created | Git Tag | Notes |
|---|---|---|---|
| `pre-hermes.json` | 2026-06-09 | `pre-hermes-baseline` | Captured before Phase 0 |

## Capture Procedure

```bash
# Ensure local API is running
cd services/gravity-api
.venv/Scripts/python -m uvicorn app.main:app --port 8000 &

# Wait for healthy
curl -s --max-time 5 http://localhost:8000/health

# Run eval (50 queries, ~5min)
python tests/eval/run_deepeval.py \
  --url http://localhost:8000 \
  --limit 50 \
  --output baselines/pre-hermes.json
```

## Comparison Procedure (Per Hermes Phase)

```bash
# After Hermes change, re-run eval
python tests/eval/run_deepeval.py --limit 50 --output baselines/post-phase-N.json

# Diff
python scripts/baseline_diff.py baselines/pre-hermes.json baselines/post-phase-N.json
```

## Rollback Threshold

Auto-rollback (flip `HERMES_ENABLED=false`) if:
- `pass_rate` drops > 5%
- Any metric (`answer_relevancy`, `faithfulness`, `contextual_relevancy`) drops > 5%
- p95 latency increases > 50%

## Snapshot Schema

```json
{
  "timestamp": "20260609_HHMMSS",
  "api_url": "http://localhost:8000",
  "judge_model": "anthropic/claude-sonnet-4-6",
  "pass_rate": 0.0,
  "metric_averages": {
    "Answer Relevancy": 0.0,
    "Faithfulness": 0.0,
    "Contextual Relevancy": 0.0
  },
  "results": [...]
}
```
