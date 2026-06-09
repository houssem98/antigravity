# Hermes Integration Roadmap

Status: Phase 0 in progress.
Tag: `pre-hermes-baseline` (rollback point)
Branch: `hermes-integration`

## Phases

| # | Name | Risk | Status | ETA |
|---|---|---|---|---|
| 0 | Safety net (flags, baselines, rollback) | None | IN PROGRESS | Day 1 |
| 1 | Cheap-route LLM fallback (A/B 5%) | Low | TODO | Day 2-3 |
| 2 | Skill-based research templates | Low | TODO | Day 4-7 |
| 3 | Replace agentic orchestrator | **HIGH** | TODO | Week 2 |
| 4 | Scheduled reports (cron) | Low | TODO | Week 3 |
| 5 | MCP server export | Low | TODO | Week 4 |

## Phase 0 — Safety Net (CURRENT)

**Goal:** Establish rollback path + baseline metrics before any Hermes code runs in pipeline.

**Done:**
- [x] Tag `pre-hermes-baseline` pushed to GitHub
- [x] Branch `hermes-integration` created
- [x] Feature flags in `app/config.py`:
  - `hermes_enabled: bool = False` (kill switch)
  - `hermes_route_percentage: int = 0`
  - `hermes_route_for: str = "simple,summarization"`
  - `hermes_model: str = "nousresearch/hermes-4-70b"`
- [x] `baselines/` dir + README
- [x] `scripts/baseline_diff.py` (auto-rollback trigger)

**Remaining (Phase 0):**
- [ ] Capture `baselines/pre-hermes.json` (run deepeval against local API)
- [ ] CI workflow: nightly deepeval + diff vs baseline
- [ ] Commit + push branch

**Capture baseline command:**
```bash
cd services/gravity-api
.venv/Scripts/python -m uvicorn app.main:app --port 8000 &
# wait healthy
curl -s --max-time 5 http://localhost:8000/health
# run eval
python tests/eval/run_deepeval.py --limit 50 --output baselines/pre-hermes.json
```

## Rollback Commands (Universal)

**Instant (no deploy):**
```bash
fly secrets set HERMES_ENABLED=false -a gravity-api-prod
fly deploy -a gravity-api-prod  # ~30s
```

**Branch revert (any phase):**
```bash
git checkout main
git reset --hard pre-hermes-baseline  # nuclear option
```

**Per-phase backup branches (created after each phase passes eval):**
- `hermes-phase1-stable`
- `hermes-phase2-stable`
- etc.

## Quality Gates Per Phase

Every phase must pass:
1. Deepeval pass_rate within 5% of baseline
2. Each RAG metric (faithfulness, answer_relevancy, contextual_relevancy) within 5%
3. p95 latency within 50% of baseline
4. Manual review of 10 representative queries

Failures trigger auto-rollback via `baseline_diff.py` exit code 2.

## Phase 1 Plan — Cheap-Route Fallback

**Files to change:**
- `app/llm/router.py` — add `HermesRoute` class behind feature flag
- `app/llm/hermes_client.py` — already exists, gate by `settings.hermes_enabled`
- `app/llm/__init__.py` — register Hermes route in routing table

**A/B logic:**
```python
def route(query_plan):
    if settings.hermes_enabled and query_plan["complexity"] in settings.hermes_route_for.split(","):
        if random.random() < settings.hermes_route_percentage / 100:
            return HermesRoute()
    return existing_route_logic(query_plan)
```

**Rollout schedule:**
- Day 1: deploy with `HERMES_ROUTE_PERCENTAGE=0` (dark launch)
- Day 2: flip to 5% on staging, run 1000-query smoke test
- Day 3: 5% prod, monitor 24hr
- Day 4: 25% if metrics hold
- Day 5: 50% if metrics hold
- Day 6: 100% for `simple` tier

**Rollback at any step:** `HERMES_ROUTE_PERCENTAGE=0` + redeploy (30s).

**Expected savings:** 30% query share × 50x cost reduction = ~15% LLM bill cut.

## Phase 2 Plan — Skills Templates

(Detailed plan deferred until Phase 1 validates.)

## Phase 3 Plan — Replace Orchestrator (HIGH RISK)

(Detailed plan deferred until Phase 1+2 validate.)

## Approval Gates

| Gate | Approver | Criteria |
|---|---|---|
| Phase 1 → 2 | self | Deepeval green for 7 days at 100% routing |
| Phase 2 → 3 | self | No user-reported regressions in 14 days |
| Phase 3 (orchestrator swap) | self + 200-query manual review | Match or beat custom on all metrics |
| Phase 4 → 5 | self | Cron infra stable for 7 days |

## Sunset Plan (If Hermes Fails)

If after 30 days Hermes underperforms:
1. Set `hermes_enabled=false` permanently
2. Document failure modes in `HERMES_POSTMORTEM.md`
3. Keep code in `hermes-integration` branch for future revisit
4. Merge only stable parts (e.g., MCP export) to main if standalone wins
