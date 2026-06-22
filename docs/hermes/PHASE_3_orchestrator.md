# Phase 3 — Replace Agentic Orchestrator (HIGH RISK)

**Status:** TODO
**Risk:** **HIGH** — affects core query path for `reasoning_depth=agentic`
**ETA:** Week 2 (5-7 days)
**Depends on:** Phase 1 + Phase 2 stable, 14 days no regressions

## Goal

Replace custom `app/core/agents/orchestrator.py` (Planner→Reader→Extractor→Critic→Writer)
with native Hermes agentic loop. Hermes has 90-iteration support, retry logic,
fallback models, and trajectory persistence built in.

**Expected wins:**
- ~50% latency reduction on agentic queries (Hermes uses parallel tool calls)
- Free trajectory logs (no manual instrumentation)
- Built-in model fallback (Hermes auto-retries on different provider)
- Less code to maintain (~800 LOC reduction)

## Critical Constraints

⚠️ **This phase replaces production code in the search pipeline.** Triple safeguards required:

1. **Keep custom orchestrator in repo** for 90 days minimum
2. **Dual-engine config:** runtime can switch between custom and Hermes
3. **Eval gate:** Hermes must match or beat custom on 200-query golden set

## Acceptance Criteria

- [ ] New file: `app/core/agents/hermes_orchestrator.py`
- [ ] Config flag: `agentic_engine: str = "custom"` (default unchanged)
- [ ] All project tools wrapped as Hermes-compatible tool definitions
- [ ] 200-query eval shows Hermes ≥ custom on pass_rate, faithfulness, relevancy
- [ ] p95 latency: Hermes ≤ custom × 1.0 (no regression)
- [ ] Manual review: 20 representative queries, no quality degradation
- [ ] Custom code retained for 90 days (do NOT delete `orchestrator.py`)

## Architecture

### Current (custom orchestrator)

```
Query
  → Planner (decide steps)
  → Reader (fetch context per step)
  → Extractor (pull facts from context)
  → Critic (validate facts)
  → Writer (synthesize final answer)
```

### New (Hermes orchestrator)

```
Query
  → AIAgent.run_conversation
    ├─ Tools injected: search_qdrant, query_graph, structured_sql, web_search
    ├─ Internal loop: plan → call tools → reflect → iterate (max 90)
    └─ Output: synthesized answer + trajectory
```

## Tool Adapter Layer

`services/gravity-api/app/core/agents/hermes_tools.py`:

```python
from agent.tool_registry import register_tool
from app.core.retrieval import dense_search, graph_search, structured_search

@register_tool(
    name="search_qdrant",
    description="Semantic search over 10-K/10-Q chunks via Qdrant + voyage-finance-2 embeddings",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "filters": {"type": "object"},
            "limit": {"type": "integer", "default": 10}
        },
        "required": ["query"]
    }
)
async def search_qdrant(query: str, filters: dict = None, limit: int = 10):
    results = await dense_search.search(query, filters=filters, limit=limit)
    return [{"text": r.text, "score": r.score, "metadata": r.metadata} for r in results]


@register_tool(
    name="query_graph",
    description="Cypher query against company/filing/topic knowledge graph",
    parameters={...}
)
async def query_graph(cypher: str):
    return await graph_search.execute_cypher(cypher)


@register_tool(
    name="structured_sql",
    description="Query TimescaleDB for time-series financial data",
    parameters={...}
)
async def structured_sql(sql: str):
    return await structured_search.execute_safe_sql(sql)


# Whitelist for security
HERMES_AGENT_TOOLS = ["search_qdrant", "query_graph", "structured_sql", "web_search"]
```

## Hermes Orchestrator

`services/gravity-api/app/core/agents/hermes_orchestrator.py`:

```python
from run_agent import AIAgent
from app.core.agents.hermes_tools import HERMES_AGENT_TOOLS
from app.config import settings


class HermesOrchestrator:
    """Drop-in replacement for custom 5-agent loop."""

    async def execute(self, query: str, query_plan: dict, trace_id: str) -> dict:
        agent = AIAgent(
            api_key=settings.openrouter_api_key,
            base_url=settings.hermes_base_url,
            model=settings.hermes_model,
            enabled_toolsets=HERMES_AGENT_TOOLS,
            max_iterations=15,  # custom is ~5, give Hermes headroom
            save_trajectories=True,
            quiet_mode=True,
            skip_memory=True,
        )

        system_message = self._build_system_prompt(query_plan)

        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: agent.run_conversation(
                user_message=query,
                system_message=system_message,
            )
        )

        return {
            "answer": result.get("content"),
            "sources": self._extract_sources_from_trajectory(result.get("messages", [])),
            "trajectory": result.get("messages"),
            "iterations": result.get("api_calls"),
            "cost_usd": result.get("estimated_cost_usd"),
        }
```

## Dual-Engine Wiring

`services/gravity-api/app/core/search_pipeline.py`:

```python
async def _agentic_path(self, query, query_plan, trace_id):
    if settings.agentic_engine == "hermes":
        orchestrator = HermesOrchestrator()
    else:
        orchestrator = CustomAgentOrchestrator()  # existing

    return await orchestrator.execute(query, query_plan, trace_id)
```

`app/config.py`:

```python
agentic_engine: str = "custom"  # values: "custom" | "hermes"
```

## Quality Gates (Must Pass Before Default Swap)

### Gate 1 — Tool parity

Every custom orchestrator capability must exist as Hermes tool. Audit checklist:

- [ ] Qdrant semantic search
- [ ] Elasticsearch BM25 search
- [ ] SPLADE sparse search
- [ ] Neo4j Cypher query
- [ ] TimescaleDB structured SQL
- [ ] Cohere reranking
- [ ] Citation validation
- [ ] NLI faithfulness check

### Gate 2 — 200-query eval

```bash
# Run against custom
AGENTIC_ENGINE=custom python tests/eval/run_deepeval.py \
  --limit 200 --output baselines/custom-orchestrator.json

# Run against Hermes
AGENTIC_ENGINE=hermes python tests/eval/run_deepeval.py \
  --limit 200 --output baselines/hermes-orchestrator.json

# Compare
python scripts/baseline_diff.py \
  baselines/custom-orchestrator.json \
  baselines/hermes-orchestrator.json
```

Hermes must:
- Match or beat custom on `pass_rate`
- Match or beat on each metric (`answer_relevancy`, `faithfulness`, `contextual_relevancy`)
- p95 latency ≤ custom × 1.0

### Gate 3 — Manual review

Pick 20 queries across categories:
- 5 simple lookup
- 5 multi-doc synthesis
- 5 temporal reasoning
- 3 calculation
- 2 contradiction detection

For each, compare custom vs Hermes outputs side-by-side. No quality degradation acceptable.

### Gate 4 — Production canary

After dev/staging eval passes:
- Deploy with `AGENTIC_ENGINE=custom` (default)
- Enable Hermes for 5% of users (header-based routing): `X-Hermes-Canary: true`
- Monitor 72hr for user-reported issues, error rates

## Rollback Procedures

### Instant (config swap)

```bash
fly secrets set AGENTIC_ENGINE=custom -a gravity-api-prod
fly deploy
# Production reverts to custom orchestrator in ~30s
```

### Removal (after 90 days of stability)

If Hermes proves stable for 90 days, can delete custom code:

```bash
git rm services/gravity-api/app/core/agents/orchestrator.py
git rm services/gravity-api/app/core/agents/planner.py
# etc
```

**Not before 90 days.** Production code retention insurance.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Hermes hallucinates more than custom critic | HIGH | NLI judge runs post-Hermes regardless |
| Tool calling failures | HIGH | Per-tool retry logic, fallback to custom |
| Trajectory bloat (10MB+ per query) | MED | Cap trajectory at 100 messages |
| OpenRouter rate limits at scale | MED | Cache + queue, multi-provider failover |
| Latency regression | MED | p95 monitoring, auto-rollback |
| Cost explosion (Hermes runs more iterations) | HIGH | `max_iterations=15` cap, daily cost alert |

## Success Criteria for Phase 3 → Phase 4

After 30 days at `AGENTIC_ENGINE=hermes` in prod:
1. Pass rate within 2% of custom baseline
2. p95 latency within 10% of custom
3. Cost per agentic query ≤ custom cost
4. Zero rollback triggers fired
5. User satisfaction unchanged (NPS or support tickets)

Tag stable: `git tag hermes-phase3-stable && git push --tags`

Next: [PHASE_4_scheduled_reports.md](PHASE_4_scheduled_reports.md)
