"""Tests for the multi-agent pipeline — Planner, Reader, Extractor, Critic, Writer."""
import json
import pytest

from app.core.agents.agent_base import AgentContext, SubTask, CriticFeedback, TraceEntry
from app.core.agents.planner_agent import PlannerAgent
from tests.conftest import MockLLMClient


# ── AgentContext & Data Classes ─────────────────────────────────────────


class TestAgentContext:
    """Test shared pipeline context and tracing."""

    def test_default_context(self):
        ctx = AgentContext(query="test")
        assert ctx.query == "test"
        assert ctx.iteration == 0
        assert ctx.max_iterations == 2
        assert ctx.trace_log == []
        assert ctx.trace_id  # should be a UUID string

    def test_add_trace(self):
        ctx = AgentContext(query="test")
        ctx.add_trace("Planner", "decomposed", "3 sub-tasks", duration_ms=42.5)

        assert len(ctx.trace_log) == 1
        entry = ctx.trace_log[0]
        assert entry.agent == "Planner"
        assert entry.action == "decomposed"
        assert entry.duration_ms == 42.5

    def test_subtask_defaults(self):
        st = SubTask(id="st_1", question="What is X?")
        assert st.retrieval_strategy == "all"
        assert st.expected_output == "narrative"
        assert st.priority == 1
        assert st.target_companies == []

    def test_critic_feedback(self):
        fb = CriticFeedback(
            quality_score=0.65,
            is_sufficient=False,
            coverage_gaps=["Missing Q3 data"],
            retry_guidance="Search for Q3 2025 earnings",
        )
        assert fb.quality_score == 0.65
        assert not fb.is_sufficient
        assert "Missing Q3 data" in fb.coverage_gaps


# ── Planner Agent ───────────────────────────────────────────────────────


@pytest.mark.asyncio
class TestPlannerAgent:
    """Test query decomposition via mocked LLM."""

    async def test_simple_query_fast_path(self):
        """Simple queries skip LLM and produce 1 sub-task directly."""
        llm = MockLLMClient(["should not be called"])
        planner = PlannerAgent(llm=llm)

        ctx = AgentContext(
            query="What was Apple's revenue?",
            query_plan={"complexity": "simple", "entities": {"companies": ["AAPL"]}},
        )
        result = await planner.execute(ctx)

        assert len(result.sub_tasks) == 1
        assert result.sub_tasks[0].question == "What was Apple's revenue?"
        assert "AAPL" in result.sub_tasks[0].target_companies
        # LLM should NOT have been called
        assert llm._call_count == 0

    async def test_complex_query_decomposes(self):
        """Complex queries use LLM to decompose into multiple sub-tasks."""
        llm = MockLLMClient([json.dumps({
            "reasoning": "Multi-company comparison requires separate lookups",
            "sub_tasks": [
                {
                    "id": "st_1",
                    "question": "What was NVIDIA's data center revenue in Q3?",
                    "retrieval_strategy": "structured",
                    "target_companies": ["NVDA"],
                    "target_periods": ["Q3 FY2026"],
                    "expected_output": "number",
                    "priority": 1,
                },
                {
                    "id": "st_2",
                    "question": "What was AMD's data center revenue in Q3?",
                    "retrieval_strategy": "structured",
                    "target_companies": ["AMD"],
                    "target_periods": ["Q3 2025"],
                    "expected_output": "number",
                    "priority": 1,
                },
            ],
        })])

        planner = PlannerAgent(llm=llm)
        ctx = AgentContext(
            query="Compare NVIDIA vs AMD data center revenue",
            query_plan={"complexity": "complex"},
        )
        result = await planner.execute(ctx)

        assert len(result.sub_tasks) == 2
        assert result.sub_tasks[0].target_companies == ["NVDA"]
        assert result.sub_tasks[1].target_companies == ["AMD"]
        assert result.sub_tasks[0].retrieval_strategy == "structured"
        # LLM should have been called once
        assert llm._call_count == 1

    async def test_invalid_json_falls_back_to_single_task(self):
        """If the LLM returns invalid JSON, fallback to single task."""
        llm = MockLLMClient(["not valid json {{{"])
        planner = PlannerAgent(llm=llm)

        ctx = AgentContext(
            query="Some complex question",
            query_plan={"complexity": "complex"},
        )
        result = await planner.execute(ctx)

        assert len(result.sub_tasks) == 1
        assert result.sub_tasks[0].question == "Some complex question"

    async def test_replan_appends_tasks(self):
        """Replan should append new tasks, not replace existing ones."""
        llm = MockLLMClient([json.dumps({
            "sub_tasks": [
                {"id": "st_replan_1", "question": "What was Q3 2025 data?"}
            ],
        })])
        planner = PlannerAgent(llm=llm)

        existing_task = SubTask(id="st_1", question="Original question")
        ctx = AgentContext(
            query="Full query",
            query_plan={"complexity": "complex"},
            iteration=1,  # replan
        )
        ctx.sub_tasks = [existing_task]
        ctx.critic_feedback = CriticFeedback(
            quality_score=0.4,
            is_sufficient=False,
            coverage_gaps=["Missing Q3 data"],
            retry_guidance="Search for Q3",
        )

        result = await planner.execute(ctx)

        # Should have original + new task
        assert len(result.sub_tasks) == 2
        assert result.sub_tasks[0].id == "st_1"
        assert result.sub_tasks[1].id == "st_replan_1"

    async def test_trace_entries_logged(self):
        """Every planner action should produce a trace entry."""
        llm = MockLLMClient([json.dumps({
            "reasoning": "Simple split",
            "sub_tasks": [{"id": "st_1", "question": "Q1"}],
        })])
        planner = PlannerAgent(llm=llm)
        ctx = AgentContext(query="Test", query_plan={"complexity": "medium"})

        result = await planner.execute(ctx)

        assert len(result.trace_log) >= 1
        assert result.trace_log[0].agent == "Planner"
