# Phase 2 — Skills-Based Research Templates

**Status:** TODO
**Risk:** Low (additive feature, no impact on core search)
**ETA:** Day 4-7 (3-4 days)
**Depends on:** Phase 1 stable

## Goal

Let users save research workflows as reusable Hermes skills. Each skill is a
parameterized prompt + tool config + system message that runs against any
ticker/topic.

**Example skills:**
- "Earnings summary" — fetch latest 10-Q + press release, extract key metrics
- "DCF valuation" — pull financials, run DCF calculator, output sensitivity table
- "Competitive comparison" — given 2 tickers, compare margins/growth/multiples

## Acceptance Criteria

- [ ] DB table `user_skills` (Supabase Postgres)
- [ ] API: `POST /v1/skills`, `GET /v1/skills`, `GET /v1/skills/:id`, `POST /v1/skills/:id/run`, `DELETE /v1/skills/:id`
- [ ] UI: market-ui "Save as template" button on research results
- [ ] UI: market-ui skill library page with parameterized run form
- [ ] Hermes integration: each `/run` invokes `AIAgent.run_conversation` with skill's system prompt
- [ ] Authorization: skills scoped to user_id, premium tier required for > 5 skills

## Data Model

```sql
-- Supabase migration
CREATE TABLE user_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '[]',  -- [{"name":"ticker","type":"string","required":true}]
  enabled_toolsets JSONB DEFAULT '[]',     -- ["web_search", "memory"]
  model TEXT DEFAULT 'nousresearch/hermes-4-70b',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  run_count INTEGER DEFAULT 0,
  last_run_at TIMESTAMPTZ,

  UNIQUE(user_id, name)
);

CREATE INDEX idx_user_skills_user_id ON user_skills(user_id);

-- RLS
ALTER TABLE user_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own skills" ON user_skills
  FOR ALL USING (auth.uid() = user_id);
```

## API Routes

`services/gravity-api/app/api/routes/skills.py`:

```python
@router.post("/v1/skills")
async def create_skill(skill: SkillCreate, user_id: str = Depends(get_current_user)):
    """Save a new research template."""

@router.get("/v1/skills")
async def list_skills(user_id: str = Depends(get_current_user)):
    """List user's skills."""

@router.post("/v1/skills/{skill_id}/run")
async def run_skill(
    skill_id: str,
    params: dict,
    user_id: str = Depends(get_current_user),
):
    """Execute skill with provided parameters via Hermes."""
    skill = await get_skill(skill_id, user_id)
    rendered_prompt = render_template(skill.system_prompt, params)
    agent = AIAgent(
        api_key=settings.openrouter_api_key,
        base_url=settings.hermes_base_url,
        model=skill.model,
        enabled_toolsets=skill.enabled_toolsets,
        quiet_mode=True,
    )
    result = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: agent.run_conversation(
            user_message=rendered_prompt,
            system_message=skill.system_prompt,
        )
    )
    return {"result": result.get("content"), "cost_usd": result.get("estimated_cost_usd")}
```

## UI Changes (market-ui)

### "Save as Template" button on research results

`apps/market-ui/src/components/research/ResearchReport.tsx`:

```tsx
<Button onClick={() => openSaveSkillModal({
  systemPrompt: currentResearchPrompt,
  parameters: detectedParams,  // auto-extracted variables like {ticker}
})}>
  Save as Template
</Button>
```

### Skills library page

`apps/market-ui/src/pages/SkillsPage.tsx`:

```tsx
<SkillCard
  skill={skill}
  onRun={(params) => fetch(`/v1/skills/${skill.id}/run`, {
    method: 'POST',
    body: JSON.stringify(params)
  })}
/>
```

## Premium Tier Gating

Free tier: 5 skills max
Pro tier ($29/mo): 50 skills + custom toolsets
Enterprise: unlimited + custom system prompts

Enforce in `POST /v1/skills`:

```python
if skill_count >= tier_limit and tier != "enterprise":
    raise HTTPException(402, "Upgrade for more skills")
```

## Quality Gates

- [ ] Unit tests: skill CRUD endpoints
- [ ] Integration test: create skill → run skill → verify Hermes response
- [ ] UI E2E: Playwright test for save → list → run flow
- [ ] Load test: 100 concurrent skill runs, p95 < 10s

## Risks

| Risk | Mitigation |
|---|---|
| Prompt injection via parameters | Validate params against skill schema, escape user input |
| Skill abuse (running expensive ones repeatedly) | Per-user rate limit on `/v1/skills/{id}/run` |
| Storage bloat from large skills | Cap system_prompt at 8KB |
| Lock-in to Hermes (vendor risk) | Skill schema is model-agnostic; can swap models per skill |

## Backup Strategy

- All skills stored in Postgres (Supabase automated daily backups)
- Export endpoint: `GET /v1/skills/export` → JSONL dump
- Git-versioned starter skills in `services/gravity-api/skills/templates/` (committed)

## Rollback

```bash
# 1. Disable skills feature
fly secrets set SKILLS_ENABLED=false -a gravity-api-prod
fly deploy

# 2. Hide UI (deploy market-ui with feature flag off)
vercel env add VITE_SKILLS_ENABLED false production
vercel --prod

# 3. (Optional) Migrate data out before dropping table
pg_dump --table=user_skills > skills_backup.sql
```

Skills don't affect core search → low blast radius.

## Exit Criteria

Phase 2 complete when:
1. 10+ users have created at least 1 skill
2. Average skill run latency p95 < 8s
3. No prompt injection vulnerabilities in security review
4. UI E2E tests passing in CI

Tag stable: `git tag hermes-phase2-stable && git push --tags`

Next: [PHASE_3_orchestrator.md](PHASE_3_orchestrator.md)
