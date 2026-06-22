# Hermes Integration — Documentation Index

Per-phase implementation plans, rollback procedures, and quality gates for the
Hermes-4-70B integration into gravity-api.

**Current branch:** `hermes-integration`
**Rollback tag:** `pre-hermes-baseline`
**Master kill switch:** `settings.hermes_enabled` (default `False`)

## Quick Links

| Doc | Purpose |
|---|---|
| [PHASE_0_safety_net.md](PHASE_0_safety_net.md) | Feature flags, baselines, rollback infra (CURRENT) |
| [PHASE_1_cheap_route.md](PHASE_1_cheap_route.md) | A/B route 5-100% simple queries to Hermes |
| [PHASE_2_skills.md](PHASE_2_skills.md) | User-defined research templates |
| [PHASE_3_orchestrator.md](PHASE_3_orchestrator.md) | Replace custom agentic loop (HIGH RISK) |
| [PHASE_4_scheduled_reports.md](PHASE_4_scheduled_reports.md) | Cron-driven recurring reports |
| [PHASE_5_mcp_export.md](PHASE_5_mcp_export.md) | Expose gravity-api as MCP server |
| [ROLLBACK.md](ROLLBACK.md) | Universal rollback procedures |
| [QUALITY_GATES.md](QUALITY_GATES.md) | Per-phase pass/fail criteria |

## Phase Status

| # | Phase | Risk | Status | ETA |
|---|---|---|---|---|
| 0 | Safety net | None | IN PROGRESS | Day 1 |
| 1 | Cheap-route fallback | Low | TODO | Day 2-3 |
| 2 | Skills templates | Low | TODO | Day 4-7 |
| 3 | Replace orchestrator | **HIGH** | TODO | Week 2 |
| 4 | Scheduled reports | Low | TODO | Week 3 |
| 5 | MCP export | Low | TODO | Week 4 |

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-06-09 | Use OpenRouter (not Together) | Single key access, cheaper, no Chinese hosting concerns |
| 2026-06-09 | Hermes-4-70B over Hermes-3 | Tool-use support, better function calling |
| 2026-06-09 | Keep custom orchestrator until Phase 3 passes 200-query eval | Production stability over speed |

## Cost Projection

| Phase | Worst (rollback) | Best (success) |
|---|---|---|
| 1 | $0 | -15% LLM bill |
| 2 | $0 | +$50/user premium |
| 3 | $0 | -50% agentic latency |
| 4 | $0 | +$100/user/mo tier |
| 5 | $0 | New B2B channel |
