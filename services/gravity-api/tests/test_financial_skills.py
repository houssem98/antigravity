"""
Tests for the Financial Skills Loader

Verifies that SKILL.md files from financial-services-main are properly loaded,
indexed, and matched to queries.
"""

import pytest
import sys
import os

# Add the gravity-api root to sys.path so app imports resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.finance.financial_skills import (
    FinancialSkillsLoader,
    get_skills_loader,
    FinancialSkill,
    AgentPrompt,
)


@pytest.fixture
def loader():
    """Fresh loader instance for each test."""
    inst = FinancialSkillsLoader()
    inst.load()
    return inst


class TestSkillLoading:
    """Test that skills are discovered and loaded from the filesystem."""

    def test_skills_loaded(self, loader: FinancialSkillsLoader):
        """Should load a non-trivial number of skills."""
        names = loader.get_all_skill_names()
        assert len(names) >= 20, f"Expected 20+ skills, got {len(names)}: {names}"

    def test_comps_analysis_exists(self, loader: FinancialSkillsLoader):
        """The comps-analysis skill should exist and have content."""
        skill = loader.get_skill_by_name("comps-analysis")
        assert skill is not None
        assert skill.vertical == "financial-analysis"
        assert len(skill.content) > 500  # SKILL.md is ~30KB
        assert "Comparable Company Analysis" in skill.content

    def test_dcf_model_exists(self, loader: FinancialSkillsLoader):
        """The dcf-model skill should exist."""
        skill = loader.get_skill_by_name("dcf-model")
        assert skill is not None
        assert skill.vertical == "financial-analysis"

    def test_earnings_analysis_exists(self, loader: FinancialSkillsLoader):
        """The earnings-analysis skill should exist under equity-research."""
        skill = loader.get_skill_by_name("earnings-analysis")
        assert skill is not None
        assert skill.vertical == "equity-research"

    def test_verticals_covered(self, loader: FinancialSkillsLoader):
        """Should cover all major verticals."""
        verticals = set(s.vertical for s in loader._skills.values())
        expected = {
            "financial-analysis",
            "equity-research",
            "investment-banking",
            "private-equity",
            "wealth-management",
            "fund-admin",
        }
        assert expected.issubset(verticals), f"Missing verticals: {expected - verticals}"


class TestAgentPrompts:
    """Test that named agent prompts are loaded."""

    def test_agent_prompts_loaded(self, loader: FinancialSkillsLoader):
        """Should load at least some agent prompts."""
        assert len(loader._agent_prompts) >= 1

    def test_market_researcher_prompt(self, loader: FinancialSkillsLoader):
        """The market-researcher agent prompt should be loaded."""
        prompt = loader.get_agent_prompt("market-researcher")
        assert prompt is not None
        assert "Market Researcher" in prompt.content
        assert len(prompt.skills_used) >= 3


class TestQueryMatching:
    """Test the query → skill matching logic."""

    def test_comps_query(self, loader: FinancialSkillsLoader):
        """A comps query should match comps-analysis."""
        skills = loader.get_relevant_skills("Build comps for FAANG mega-caps")
        names = [s.name for s in skills]
        assert "comps-analysis" in names

    def test_dcf_query(self, loader: FinancialSkillsLoader):
        """A DCF query should match dcf-model."""
        skills = loader.get_relevant_skills("Run a DCF valuation for Tesla with WACC sensitivity")
        names = [s.name for s in skills]
        assert "dcf-model" in names

    def test_earnings_query(self, loader: FinancialSkillsLoader):
        """An earnings query should match earnings-analysis."""
        skills = loader.get_relevant_skills("Analyze Apple's Q4 2025 earnings call and EPS beat")
        names = [s.name for s in skills]
        assert "earnings-analysis" in names

    def test_sector_query(self, loader: FinancialSkillsLoader):
        """A sector query should match sector-overview."""
        skills = loader.get_relevant_skills("Industry overview of the semiconductor sector")
        names = [s.name for s in skills]
        assert "sector-overview" in names

    def test_merger_query(self, loader: FinancialSkillsLoader):
        """An M&A query should match merger-model."""
        skills = loader.get_relevant_skills("Accretion dilution analysis for the Microsoft Activision merger")
        names = [s.name for s in skills]
        assert "merger-model" in names

    def test_max_skills_limit(self, loader: FinancialSkillsLoader):
        """Should respect max_skills parameter."""
        skills = loader.get_relevant_skills(
            "Compare sector comps, valuation multiples, and competitive landscape",
            max_skills=2,
        )
        assert len(skills) <= 2

    def test_no_match(self, loader: FinancialSkillsLoader):
        """A non-financial query should return no skills."""
        skills = loader.get_relevant_skills("What is the weather in Paris?")
        assert len(skills) == 0


class TestContextBuilding:
    """Test the prompt context building methods."""

    def test_build_skill_context(self, loader: FinancialSkillsLoader):
        """Should produce a non-empty context block for a matching query."""
        ctx = loader.build_skill_context("Build comparable company analysis for tech stocks")
        assert len(ctx) > 100
        assert "Financial Analysis Methodology" in ctx
        assert "Comps Analysis" in ctx

    def test_build_skill_context_empty(self, loader: FinancialSkillsLoader):
        """Should return empty string for non-matching query."""
        ctx = loader.build_skill_context("What is the weather in Paris?")
        assert ctx == ""

    def test_build_skill_context_max_chars(self, loader: FinancialSkillsLoader):
        """Should respect max_chars limit."""
        ctx = loader.build_skill_context(
            "Build comps for tech sector valuations",
            max_chars=500,
        )
        assert len(ctx) <= 600  # Allow small overhead for headers

    def test_build_agent_workflow_context(self, loader: FinancialSkillsLoader):
        """Should return workflow context for a sector analysis query."""
        ctx = loader.build_agent_workflow_context("Sector primer on AI infrastructure")
        assert len(ctx) > 50
        assert "market-researcher" in ctx.lower() or "Workflow" in ctx


class TestSingleton:
    """Test the singleton pattern."""

    def test_get_skills_loader_returns_same_instance(self):
        """Should always return the same instance."""
        a = get_skills_loader()
        b = get_skills_loader()
        assert a is b


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
