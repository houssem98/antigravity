# Phase 1 — Cheap-Route LLM Fallback

**Status:** TODO
**Risk:** Low (gated by feature flags, gradual rollout)
**ETA:** Day 2-3
**Depends on:** Phase 0 complete

## Goal

Route simple Q&A and summarization queries to Hermes-4-70B via OpenRouter.
Keep Claude/GPT/Gemini for complex multi-hop reasoning.

**Expected savings:** 30-40% of queries × 50× cheaper output = ~15% LLM bill reduction.

## Acceptance Criteria

- [ ] `HermesRoute` class added to `app/llm/router.py`
- [ ] Routing gated by `settings.hermes_enabled` + `hermes_route_percentage`
- [ ] Only routes queries where `query_plan["complexity"] in hermes_route_for`
- [ ] Deepeval pass_rate within 5% of baseline at each rollout step
- [ ] p95 latency within 50% of baseline
- [ ] No user-reported regressions over 24hr at 100% routing

## Implementation

### 1. Router integration

`services/gravity-api/app/llm/router.py`:

```python
import random
from app.config import settings
from app.llm.hermes_client import HermesAgentClient

class HermesRoute(BaseRoute):
    """OpenRouter-backed Hermes-4-70B for simple queries."""

    def __init__(self):
        self.client = HermesAgentClient(
            api_key=settings.openrouter_api_key,
            base_url=settings.hermes_base_url,
        )

    async def generate(self, messages, config):
        # Translate gravity-api message format to Hermes
        user_msg = messages[-1]["content"]
        result = await self.client.run_agent(user_msg)
        return LLMResponse(
            content=result["result"],
            model=settings.hermes_model,
            cost_usd=self._estimate_cost(result),
        )


class LLMRouter:
    def route(self, query_plan):
        # Hermes A/B gate
        if (
            settings.hermes_enabled
            and query_plan["complexity"] in settings.hermes_route_for.split(",")
            and random.random() * 100 < settings.hermes_route_percentage
        ):
            return RoutingDecision(
                primary_model=settings.hermes_model,
                route=HermesRoute(),
                ...
            )

        # Existing routing logic unchanged
        return self._existing_route(query_plan)
```

### 2. Cost estimation helper

Hermes responses include `estimated_cost_usd` field from run_conversation.
Pipe through to routing decision for cost tracking.

### 3. Observability hooks

Log every Hermes-routed query:

```python
logger.info("hermes_route_used",
    trace_id=trace_id,
    complexity=query_plan["complexity"],
    cost_usd=response.cost_usd,
    latency_ms=elapsed,
)
```

Add Langfuse trace tag `route=hermes` for downstream filtering.

## Rollout Schedule

| Day | Step | `HERMES_ROUTE_PERCENTAGE` | Check |
|---|---|---|---|
| 1 | Dark launch | `0` | Deploy code, verify no traffic routed |
| 2 | Staging 100% | `100` (staging only) | 1000-query smoke test |
| 3 | Prod 5% | `5` | Monitor 24hr, run baseline_diff |
| 4 | Prod 25% | `25` | Pass: continue, fail: rollback |
| 5 | Prod 50% | `50` | Pass: continue, fail: hold |
| 6 | Prod 100% (simple tier) | `100` | Final check, lock in |

Manual approval gate between each step.

## Quality Gates

Before bumping `HERMES_ROUTE_PERCENTAGE` to next tier:

```bash
# Capture today's metrics
python tests/eval/run_deepeval.py --limit 50 \
  --output baselines/post-phase1-day-N.json

# Diff vs baseline
python scripts/baseline_diff.py \
  baselines/pre-hermes.json \
  baselines/post-phase1-day-N.json

# Exit code 0 → proceed
# Exit code 1 → manual review, hold rollout
# Exit code 2 → auto-rollback (set percentage=0)
```

## Rollback Procedures

### Instant rollback (recommended)

```bash
fly secrets set HERMES_ROUTE_PERCENTAGE=0 -a gravity-api-prod
fly deploy
# ~30s downtime, queries revert to existing routing
```

### Full rollback (if Hermes route caused side effects)

```bash
fly secrets set HERMES_ENABLED=false HERMES_ROUTE_PERCENTAGE=0 -a gravity-api-prod
fly deploy
```

### Code-level rollback

```bash
git revert <phase-1-commit-sha>
git push origin hermes-integration
```

## Risks

| Risk | Mitigation |
|---|---|
| Hermes hallucinates more than Claude | Tight `complexity=simple` filter, deepeval gate |
| OpenRouter outage | Existing route as fallback (Hermes failure → exception → retry via Claude) |
| Latency spike on Hermes | p95 monitoring, auto-revert if > 50% baseline |
| Cost surprise | Daily cost report, alert if > 2× projected |

## Success Criteria for Phase 1 → Phase 2

After 7 days at 100% routing for `simple` tier:
1. Pass rate within 3% of baseline
2. Faithfulness/relevancy metrics within 3%
3. p95 latency within 20% of baseline
4. LLM cost reduction visible in Langfuse dashboard
5. Zero user complaints attributable to Hermes route

Tag stable point: `git tag hermes-phase1-stable && git push --tags`

Next: [PHASE_2_skills.md](PHASE_2_skills.md)
