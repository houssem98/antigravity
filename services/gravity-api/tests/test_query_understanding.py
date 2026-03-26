"""Tests for Query Understanding — intent classification, entity extraction, channel routing."""
import json
import pytest

from app.core.query_understanding import QueryUnderstanding, DEFAULT_QUERY_PLAN
from tests.conftest import MockLLMClient


@pytest.mark.asyncio
class TestQueryUnderstanding:
    """Test that QueryUnderstanding parses LLM output and applies auto-rules."""

    async def test_successful_analysis(self, mock_llm_json):
        qu = QueryUnderstanding(llm_client=mock_llm_json)
        result = await qu.analyze("What was Apple's revenue in Q4 2025?")

        assert result["intent"] == "multi_hop"
        assert result["complexity"] == "complex"
        assert "AAPL" in result["entities"]["companies"]
        assert "dense" in result["retrieval_channels"]

    async def test_auto_adds_graph_for_entity_relationship(self):
        """Entity relationship intent should auto-add graph channel."""
        llm = MockLLMClient([json.dumps({
            "intent": "entity_relationship",
            "complexity": "medium",
            "entities": {"companies": ["TSMC"]},
            "retrieval_channels": ["dense", "bm25"],
        })])
        qu = QueryUnderstanding(llm_client=llm)
        result = await qu.analyze("Who are TSMC's top customers?")

        assert "graph" in result["retrieval_channels"]

    async def test_auto_adds_structured_for_calculation(self):
        """Calculation intent should auto-add structured channel."""
        llm = MockLLMClient([json.dumps({
            "intent": "calculation",
            "complexity": "math",
            "entities": {"companies": ["MSFT"]},
            "retrieval_channels": ["dense"],
        })])
        qu = QueryUnderstanding(llm_client=llm)
        result = await qu.analyze("What is MSFT's EV/EBITDA?")

        assert "structured" in result["retrieval_channels"]

    async def test_fallback_on_invalid_json(self):
        """Invalid LLM response should return DEFAULT_QUERY_PLAN."""
        llm = MockLLMClient(["This is not JSON at all"])
        qu = QueryUnderstanding(llm_client=llm)
        result = await qu.analyze("some query")

        assert result["intent"] == DEFAULT_QUERY_PLAN["intent"]
        assert result["complexity"] == DEFAULT_QUERY_PLAN["complexity"]
        # Should contain original query words
        assert "some" in result["expanded_terms"]["original"]

    async def test_defaults_filled_for_missing_fields(self):
        """Partial JSON should be filled with defaults."""
        llm = MockLLMClient([json.dumps({"intent": "trend_analysis"})])
        qu = QueryUnderstanding(llm_client=llm)
        result = await qu.analyze("How has TSLA margin changed?")

        assert result["intent"] == "trend_analysis"
        assert result["complexity"] == "medium"  # default
        assert "dense" in result["retrieval_channels"]  # default channels
