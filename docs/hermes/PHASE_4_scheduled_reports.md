# Phase 4 — Scheduled Reports (Cron)

**Status:** TODO
**Risk:** Low (standalone feature, no impact on real-time search)
**ETA:** Week 3 (3-5 days)
**Depends on:** Phase 2 (skills) for template reuse

## Goal

Premium revenue feature: users schedule recurring research runs.

**Use cases:**
- "Every Monday 9am: summarize last week's TSLA filings"
- "Quarterly: run DCF on my watchlist, email PDF"
- "Daily: alert if any portfolio company files 8-K"

## Acceptance Criteria

- [ ] DB table `scheduled_reports`
- [ ] API: `POST/GET/DELETE /v1/scheduled-reports`
- [ ] Worker process: polls due reports, executes via Hermes
- [ ] Output channels: email (Postmark), Slack webhook, in-app inbox
- [ ] UI: market-ui schedule builder with cron expression input
- [ ] Premium tier gating: feature locked behind Pro/Enterprise

## Data Model

```sql
CREATE TABLE scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  skill_id UUID REFERENCES user_skills(id),  -- reuse Phase 2 skills
  parameters JSONB NOT NULL DEFAULT '{}',
  cron_expression TEXT NOT NULL,             -- "0 9 * * 1"
  timezone TEXT DEFAULT 'UTC',
  output_channels JSONB NOT NULL,            -- [{"type":"email","to":"x@y.com"},...]
  active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  run_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_scheduled_reports_next_run ON scheduled_reports(next_run_at) WHERE active = true;
```

## Worker Architecture

```
┌─────────────────────────────────────────────────────┐
│  Fly Machine: gravity-scheduler                      │
│  Process: services/gravity-api/app/scheduler/worker  │
│                                                       │
│  Every 60s:                                          │
│    1. SELECT * FROM scheduled_reports                │
│       WHERE active=true AND next_run_at <= now()     │
│    2. For each due report:                           │
│       a. Lock row (FOR UPDATE SKIP LOCKED)           │
│       b. Resolve skill + params                      │
│       c. Run via Hermes orchestrator                 │
│       d. Dispatch to output channels                 │
│       e. Update last_run_at, next_run_at, run_count  │
│       f. Unlock                                      │
└─────────────────────────────────────────────────────┘
```

`services/gravity-api/app/scheduler/worker.py`:

```python
import asyncio
import croniter
from datetime import datetime, timezone

async def scheduler_loop():
    while True:
        due_reports = await db.fetch_due_reports()
        await asyncio.gather(*[run_report(r) for r in due_reports])
        await asyncio.sleep(60)


async def run_report(report):
    try:
        # Execute via Hermes
        skill = await db.get_skill(report.skill_id)
        result = await hermes_run_skill(skill, report.parameters)

        # Dispatch outputs
        for channel in report.output_channels:
            await dispatch[channel["type"]](channel, result)

        await db.update_report_success(report.id)
    except Exception as e:
        logger.error("scheduled_report_failed", report_id=report.id, error=str(e))
        await db.update_report_failure(report.id)


async def dispatch_email(channel, result):
    await postmark.send(
        to=channel["to"],
        subject=f"Gravity Report: {result['name']}",
        body=result["content"]
    )
```

## Cron Validation

Use `croniter` to validate expressions:

```python
from croniter import croniter
from datetime import datetime

def validate_cron(expr: str) -> bool:
    try:
        croniter(expr, datetime.now())
        return True
    except (ValueError, TypeError):
        return False

def next_run(expr: str, tz: str) -> datetime:
    base = datetime.now(timezone.utc)
    return croniter(expr, base).get_next(datetime)
```

## Output Channels

| Channel | Provider | Setup |
|---|---|---|
| Email | Postmark | `POSTMARK_TOKEN` secret on Fly |
| Slack webhook | Direct HTTP POST | User pastes webhook URL |
| In-app inbox | Postgres `report_outputs` table | Auto-poll on UI load |
| Discord webhook | Direct HTTP POST | Same as Slack |
| Telegram | Hermes built-in | Use `hermes send telegram` |

## Premium Tier Gating

```python
# Free: no scheduled reports
# Pro ($29/mo): 5 scheduled reports
# Enterprise: unlimited

@router.post("/v1/scheduled-reports")
async def create(user_tier: str = Depends(get_tier)):
    if user_tier == "free":
        raise HTTPException(402, "Scheduled reports require Pro tier")
    count = await db.count_reports(user_id)
    if user_tier == "pro" and count >= 5:
        raise HTTPException(402, "Pro tier max is 5 reports; upgrade to Enterprise")
```

## Reliability

### Worker resilience

- **Single-instance lock:** Use `SELECT ... FOR UPDATE SKIP LOCKED` to prevent dupes
- **Idempotency:** Track `run_id` in `report_outputs` to dedupe retries
- **Backoff:** Failed reports retry with exponential backoff (1min, 5min, 30min)
- **Auto-disable:** After 5 consecutive failures, mark `active=false` + email user

### Monitoring

- Metric: `scheduled_reports_due` (Prometheus gauge)
- Metric: `scheduled_reports_runtime_seconds` (histogram)
- Metric: `scheduled_reports_failures_total` (counter)
- Alert: page on-call if `failures_total` increases > 10/hr

## Fly Setup

```toml
# services/gravity-api/fly.scheduler.toml
app = "gravity-scheduler-prod"

[processes]
  scheduler = "python -m app.scheduler.worker"

[[services]]
  internal_port = 8080  # health check only
  protocol = "tcp"

  [[services.tcp_checks]]
    interval = "30s"
    timeout = "5s"
```

Deploy:
```bash
fly apps create gravity-scheduler-prod
fly deploy --config fly.scheduler.toml
```

## Rollback

```bash
# Pause all schedules instantly (no deploy needed)
psql $DATABASE_URL -c "UPDATE scheduled_reports SET active=false"

# Shut down worker
fly scale count 0 -a gravity-scheduler-prod

# Hide UI feature
vercel env add VITE_SCHEDULED_REPORTS_ENABLED false production
```

## Risks

| Risk | Mitigation |
|---|---|
| Cron expression DoS (`* * * * *`) | Validate min interval ≥ 5 minutes |
| Email spam (bug causing rapid sends) | Per-user daily limit (10 reports max) |
| Cost explosion from frequent Hermes runs | Daily cost alert per user |
| Worker missed runs (downtime) | Catch-up logic on restart, alert if > 1hr gap |
| User leaves, reports keep running | Auto-disable after 30 days of inactive user |

## Success Criteria

After 14 days in beta:
1. 10+ users with at least 1 active scheduled report
2. Worker uptime ≥ 99.5%
3. Failure rate < 2%
4. Avg report runtime ≤ 60s
5. Zero spam complaints

Tag stable: `git tag hermes-phase4-stable && git push --tags`

Next: [PHASE_5_mcp_export.md](PHASE_5_mcp_export.md)
