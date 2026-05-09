"""
Gravity Search — Planner Agent
Hebbia-style query decomposition: breaks complex queries into parallel sub-tasks.

Simple queries → single sub-task (no overhead).
Complex queries → N sub-tasks with per-task retrieval strategies.

Uses the existing QueryUnderstanding output + an LLM call for decomposition.
"""

from __future__ import annotations

import json
import structlog

from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage
from app.core.agents.agent_base import BaseAgent, AgentContext, SubTask
from app.core.finance.financial_skills import get_skills_loader

logger = structlog.get_logger()


DECOMPOSITION_SYSTEM = """You are a financial research query planner.
Your task: decompose a complex financial research query into focused sub-questions
that can each be answered independently and in parallel.

Rules:
1. For SIMPLE queries (single fact, single company, single metric) — return exactly 1 sub-task.
2. For COMPLEX queries (multi-company comparison, multi-period analysis, multi-hop) — decompose into 2-5 sub-tasks.
3. Each sub-task must be self-contained and answerable from SEC filings, earnings transcripts, or market data.
4. Assign a retrieval_strategy to each sub-task:
   - "all" for general questions
   - "dense" for semantic/conceptual questions
   - "structured" for numerical/metric lookups
   - "graph" for entity relationships
5. Extract target companies (tickers) and time periods when mentioned.

Respond with ONLY valid JSON in this format:
{
  "reasoning": "Brief explanation of why you decomposed this way",
  "sub_tasks": [
    {
      "id": "st_1",
      "question": "What was NVIDIA's data center revenue in Q3 FY2026?",
      "retrieval_strategy": "structured",
      "target_companies": ["NVDA"],
      "target_periods": ["Q3 FY2026"],
      "expected_output": "number",
      "priority": 1
    }
  ]
}"""


REPLAN_SYSTEM = """You are a financial research query planner doing a REFINEMENT pass.
The previous research attempt had gaps. Based on the critic's feedback, generate
ONLY the additional sub-tasks needed to fill the gaps. Do NOT repeat sub-tasks
that were already adequately answered.

Respond with ONLY valid JSON in the same format as before."""


class PlannerAgent(BaseAgent):
    """Decomposes complex queries into parallel sub-tasks."""

    name = "Planner"

    def __init__(self, llm: BaseLLMClient):
        self.llm = llm

    async def execute(self, ctx: AgentContext) -> AgentContext:
        is_replan = ctx.iteration > 0 and ctx.critic_feedback is not None

        if is_replan:
            return await self._replan(ctx)
        else:
            return await self._initial_plan(ctx)

    async def _initial_plan(self, ctx: AgentContext) -> AgentContext:
        """First-pass planning: decompose the query."""
        complexity = ctx.query_plan.get("complexity", "medium")

        # Fast path: simple queries skip LLM decomposition
        if complexity == "simple":
            ctx.sub_tasks = [
                SubTask(
                    id="st_1",
                    question=ctx.query,
                    retrieval_strategy="all",
                    target_companies=[
                        t for t in ctx.query_plan.get("entities", {}).get("companies", [])
                    ],
                    expected_output="narrative",
                    priority=1,
                )
            ]
            ctx.add_trace(self.name, "fast_plan", f"Simple query → 1 sub-task (no LLM)")
            return ctx

        # Complex path: use LLM decomposition
        # Inject workflow guidance from financial agent templates if relevant
        workflow_context = self._load_workflow_guidance(ctx)
        system_prompt = DECOMPOSITION_SYSTEM
        if workflow_context:
            system_prompt = DECOMPOSITION_SYSTEM + workflow_context
            ctx.add_trace(
                self.name, "workflow_injection",
                f"Injected financial workflow guidance ({len(workflow_context)} chars)",
            )

        user_content = f"Query: {ctx.query}\n\nQuery analysis: {json.dumps(ctx.query_plan, default=str)}"

        response = await self.llm.generate(
            messages=[
                LLMMessage(role="system", content=system_prompt),
                LLMMessage(role="user", content=user_content),
            ],
            config=LLMConfig(temperature=0.0, max_tokens=2000, json_mode=True),
        )
        ctx.total_cost_usd += response.cost_usd

        try:
            plan = json.loads(response.content)
            raw_tasks = plan.get("sub_tasks", [])

            ctx.sub_tasks = [
                SubTask(
                    id=t.get("id", f"st_{i+1}"),
                    question=t["question"],
                    retrieval_strategy=t.get("retrieval_strategy", "all"),
                    target_companies=t.get("target_companies", []),
                    target_periods=t.get("target_periods", []),
                    expected_output=t.get("expected_output", "narrative"),
                    priority=t.get("priority", 1),
                )
                for i, t in enumerate(raw_tasks)
            ]

            reasoning = plan.get("reasoning", "")
            ctx.add_trace(
                self.name, "decomposed",
                f"{len(ctx.sub_tasks)} sub-tasks | {reasoning[:150]}",
                duration_ms=response.latency_ms,
            )

        except (json.JSONDecodeError, KeyError) as e:
            # Fallback: treat the whole query as one task
            logger.warning("planner_parse_failed", error=str(e))
            ctx.sub_tasks = [
                SubTask(id="st_1", question=ctx.query, retrieval_strategy="all", priority=1)
            ]
            ctx.add_trace(self.name, "fallback_plan", f"Parse failed: {e}")

        return ctx

    async def _replan(self, ctx: AgentContext) -> AgentContext:
        """Refinement pass: generate only the sub-tasks needed to fill gaps."""
        feedback = ctx.critic_feedback
        assert feedback is not None

        user_content = (
            f"Original query: {ctx.query}\n\n"
            f"Critic feedback:\n"
            f"  Quality score: {feedback.quality_score:.2f}\n"
            f"  Coverage gaps: {feedback.coverage_gaps}\n"
            f"  Unsupported claims: {feedback.unsupported_claims}\n"
            f"  Retry guidance: {feedback.retry_guidance}\n\n"
            f"Previous sub-tasks: {json.dumps([{'id': t.id, 'question': t.question} for t in ctx.sub_tasks], default=str)}"
        )

        response = await self.llm.generate(
            messages=[
                LLMMessage(role="system", content=REPLAN_SYSTEM),
                LLMMessage(role="user", content=user_content),
            ],
            config=LLMConfig(temperature=0.0, max_tokens=2000, json_mode=True),
        )
        ctx.total_cost_usd += response.cost_usd

        try:
            plan = json.loads(response.content)
            new_tasks = [
                SubTask(
                    id=t.get("id", f"st_replan_{i+1}"),
                    question=t["question"],
                    retrieval_strategy=t.get("retrieval_strategy", "all"),
                    target_companies=t.get("target_companies", []),
                    target_periods=t.get("target_periods", []),
                    expected_output=t.get("expected_output", "narrative"),
                    priority=t.get("priority", 1),
                )
                for i, t in enumerate(plan.get("sub_tasks", []))
            ]

            # Append new tasks (don't replace — keep previous results)
            ctx.sub_tasks.extend(new_tasks)
            ctx.add_trace(
                self.name, "replanned",
                f"+{len(new_tasks)} new sub-tasks for gaps: {feedback.coverage_gaps}",
                duration_ms=response.latency_ms,
            )

        except (json.JSONDecodeError, KeyError) as e:
            logger.warning("replan_parse_failed", error=str(e))
            ctx.add_trace(self.name, "replan_failed", str(e))

        return ctx

    @staticmethod
    def _load_workflow_guidance(ctx: AgentContext) -> str:
        """Load workflow guidance from financial agent templates if relevant.

        For example, if the query is about sector analysis, this injects the
        market-researcher agent's step-by-step workflow into the decomposition
        prompt so sub-tasks follow institutional analyst workflows.
        """
        try:
            loader = get_skills_loader()
            workflow = loader.build_agent_workflow_context(ctx.query)
            return workflow
        except Exception as e:
            logger.warning("workflow_guidance_load_failed", error=str(e))
            return ""
