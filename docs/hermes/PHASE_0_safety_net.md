# Phase 0 — Safety Net

**Status:** IN PROGRESS
**Risk:** None (no behavior change)
**ETA:** Day 1 (2 hours)
**Owner:** self

## Goal

Establish rollback path + baseline metrics **before** any Hermes code touches the search pipeline. Every later phase depends on this safety net.

## Acceptance Criteria

- [x] Tag `pre-hermes-baseline` pushed to GitHub
- [x] Branch `hermes-integration` created and tracking remote
- [x] Feature flags in `app/config.py` (all default `False` / `0`)
- [x] `baselines/` dir with README documenting capture procedure
- [x] `scripts/baseline_diff.py` with auto-rollback thresholds
- [ ] `baselines/pre-hermes.json` captured (50-query deepeval snapshot)
- [ ] CI workflow `deepeval-baseline.yml` runs nightly, alerts on drift

## Implementation

### 1. Tag baseline + branch (DONE)

```bash
git tag pre-hermes-baseline -m "Pre-Hermes integration baseline — 2026-06-09"
git push origin pre-hermes-baseline
git checkout -b hermes-integration
```

### 2. Feature flags (DONE)

`services/gravity-api/app/config.py:38-47`:

```python
openrouter_api_key: str = ""
together_api_key: str = ""

# Hermes Integration (Phase 0 feature flags)
hermes_enabled: bool = False
hermes_route_percentage: int = 0  # 0-100
hermes_route_for: str = "simple,summarization"
hermes_model: str = "nousresearch/hermes-4-70b"
hermes_base_url: str = "https://openrouter.ai/api/v1"
```

### 3. Baseline diff script (DONE)

`scripts/baseline_diff.py` — exit codes:
- `0` — within tolerance
- `1` — minor regression (manual review)
- `2` — critical regression (auto-rollback)

Thresholds:
- Pass rate drop > 5% → critical
- Any metric drop > 5% → critical
- p95 latency increase > 50% → critical

### 4. Capture baseline (TODO)

```bash
cd services/gravity-api

# Option A — against deployed prod
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
GRAVITY_API_URL=https://gravity-api-prod.fly.dev \
.venv/Scripts/python tests/eval/run_deepeval.py \
  --limit 50 --output baselines/pre-hermes.json

# Option B — against local dev API
.venv/Scripts/python -m uvicorn app.main:app --port 8000 &
sleep 10
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
.venv/Scripts/python tests/eval/run_deepeval.py \
  --limit 50 --output baselines/pre-hermes.json
```

Estimated cost: ~$2 (Anthropic Sonnet judge for 50 queries).
Time: 5-15 min.

### 5. CI nightly drift check (TODO)

`.github/workflows/deepeval-baseline.yml`:

```yaml
name: Hermes Baseline Drift Check
on:
  schedule:
    - cron: "0 6 * * *"  # daily 6am UTC
  workflow_dispatch:

jobs:
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -r services/gravity-api/requirements.txt
      - name: Run deepeval against prod
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GRAVITY_API_URL: https://gravity-api-prod.fly.dev
        run: |
          cd services/gravity-api
          python tests/eval/run_deepeval.py --limit 50 \
            --output /tmp/today.json
      - name: Compare vs baseline
        id: diff
        run: |
          python scripts/baseline_diff.py \
            services/gravity-api/baselines/pre-hermes.json \
            /tmp/today.json
        continue-on-error: true
      - name: Alert on critical regression
        if: steps.diff.outcome == 'failure'
        run: |
          curl -X POST $SLACK_WEBHOOK -d '{"text":"Hermes baseline drift CRITICAL"}'
```

## Rollback Test (Required Before Phase 1)

Verify kill switch works **before** Phase 1 starts:

```bash
# 1. Confirm Hermes route disabled
curl -s https://gravity-api-prod.fly.dev/v1/search?q=test | grep -i hermes
# Should NOT see "engine: hermes"

# 2. Set kill switch
fly secrets set HERMES_ENABLED=true HERMES_ROUTE_PERCENTAGE=100 -a gravity-api-prod
fly deploy

# 3. Verify Hermes route active
curl -s https://gravity-api-prod.fly.dev/v1/search?q=test | grep hermes
# Should see hermes if route built

# 4. Flip kill switch
fly secrets set HERMES_ENABLED=false -a gravity-api-prod
fly deploy

# 5. Confirm reverted
curl -s https://gravity-api-prod.fly.dev/v1/search?q=test | grep hermes
# Should NOT see hermes
```

If step 5 still shows Hermes → kill switch broken → Phase 1 blocked.

## Exit Criteria

Phase 0 complete when:
1. Baseline JSON captured and committed
2. Rollback test passes 3 consecutive times
3. CI nightly drift check green for 24 hours

Next: [PHASE_1_cheap_route.md](PHASE_1_cheap_route.md)
