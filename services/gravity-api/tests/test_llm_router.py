"""Tests for the LLM Router — heuristic complexity classification and model selection."""
import pytest
from unittest.mock import patch, MagicMock

from app.llm.router import LLMRouter, QueryComplexity, RoutingDecision


class TestHeuristicClassify:
    """Test the fallback heuristic classifier (no LLM calls)."""

    @pytest.fixture(autouse=True)
    def router(self):
        # Patch _init_clients so we don't need real API keys
        with patch.object(LLMRouter, "_init_clients"):
            self.router = LLMRouter()
            self.router._clients = {}  # empty — forces heuristic
            yield

    def test_simple_factual(self):
        assert self.router._heuristic_classify("What was AAPL revenue in Q4 2025?") == QueryComplexity.SIMPLE

    def test_math_ev_ebitda(self):
        assert self.router._heuristic_classify("What is TSLA's EV/EBITDA relative to sector median?") == QueryComplexity.MATH

    def test_math_dcf(self):
        assert self.router._heuristic_classify("Calculate the DCF valuation for MSFT") == QueryComplexity.MATH

    def test_math_ratio(self):
        assert self.router._heuristic_classify("What is the price-to-earnings ratio for AMD?") == QueryComplexity.MATH

    def test_complex_contradiction(self):
        assert self.router._heuristic_classify("Does CFO guidance align with analyst expectations?") == QueryComplexity.COMPLEX

    def test_complex_cross_reference(self):
        assert self.router._heuristic_classify("Cross-reference 10-K risk factors with earnings commentary") == QueryComplexity.COMPLEX

    def test_medium_compare(self):
        assert self.router._heuristic_classify("Compare FAANG margin trends") == QueryComplexity.MEDIUM

    def test_medium_trend(self):
        assert self.router._heuristic_classify("How has TSLA revenue changed since 2023?") == QueryComplexity.MEDIUM

    def test_medium_versus(self):
        assert self.router._heuristic_classify("NVIDIA vs AMD data center GPU market share") == QueryComplexity.MEDIUM

    def test_default_simple(self):
        assert self.router._heuristic_classify("AAPL stock price") == QueryComplexity.SIMPLE


class TestModelSelection:
    """Test that model selection follows the routing table and fallback chain."""

    @pytest.fixture(autouse=True)
    def router(self):
        with patch.object(LLMRouter, "_init_clients"):
            self.router = LLMRouter()
            self.router._clients = {}
            yield

    def test_select_simple_prefers_gemini_flash(self):
        mock_gemini = MagicMock()
        mock_gemini.model_id = "gemini-2.0-flash"
        self.router._clients["gemini_flash"] = mock_gemini

        result = self.router.select_model(QueryComplexity.SIMPLE)
        assert result.model_id == "gemini-2.0-flash"

    def test_select_complex_prefers_claude_opus(self):
        mock_opus = MagicMock()
        mock_opus.model_id = "claude-opus-4-6"
        self.router._clients["claude_opus"] = mock_opus

        result = self.router.select_model(QueryComplexity.COMPLEX)
        assert result.model_id == "claude-opus-4-6"

    def test_select_math_prefers_gpt5(self):
        mock_gpt = MagicMock()
        mock_gpt.model_id = "gpt-5.2"
        self.router._clients["gpt5"] = mock_gpt

        result = self.router.select_model(QueryComplexity.MATH)
        assert result.model_id == "gpt-5.2"

    def test_select_medium_prefers_claude_sonnet(self):
        mock_sonnet = MagicMock()
        mock_sonnet.model_id = "claude-sonnet-4-5"
        self.router._clients["claude_sonnet"] = mock_sonnet

        result = self.router.select_model(QueryComplexity.MEDIUM)
        assert result.model_id == "claude-sonnet-4-5"

    def test_fallback_to_any_available(self):
        mock_deepseek = MagicMock()
        mock_deepseek.model_id = "deepseek-r1"
        self.router._clients["deepseek"] = mock_deepseek

        # COMPLEX prefers claude_opus which isn't available, but deepseek is
        result = self.router.select_model(QueryComplexity.COMPLEX)
        assert result.model_id == "deepseek-r1"

    def test_no_models_raises(self):
        with pytest.raises(RuntimeError, match="No LLM clients"):
            self.router.select_model(QueryComplexity.SIMPLE)


class TestRoutingDecision:
    """Test that RoutingDecision has the correct fields."""

    def test_routing_decision_fields(self):
        rd = RoutingDecision(
            complexity=QueryComplexity.SIMPLE,
            primary_model="gemini-2.0-flash",
            provider="google",
            estimated_cost=0.003,
            reasoning="test",
        )
        assert rd.complexity == QueryComplexity.SIMPLE
        assert rd.estimated_cost == 0.003
        assert rd.provider == "google"
