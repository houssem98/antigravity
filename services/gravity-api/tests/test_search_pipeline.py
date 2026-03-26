"""Tests for the search pipeline — agentic routing and event streaming structure."""
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from app.core.search_pipeline import SearchPipeline, SearchEvent


class TestSearchEvent:
    """Test the SearchEvent data class."""

    def test_basic_event(self):
        event = SearchEvent(type="status", data="Analyzing query...")
        assert event.type == "status"
        assert event.data == "Analyzing query..."

    def test_event_with_trace_id(self):
        event = SearchEvent(type="metadata", data={"latency_ms": 150}, trace_id="abc-123")
        assert event.trace_id == "abc-123"
        assert event.data["latency_ms"] == 150


class TestShouldUseAgentic:
    """Test the agentic routing decision logic."""

    @pytest.fixture
    def pipeline(self):
        """Create a SearchPipeline with all dependencies mocked."""
        with patch("app.core.search_pipeline.LLMRouter"):
            p = SearchPipeline(
                llm_router=MagicMock(),
                retrieval_orchestrator=MagicMock(),
                reranker=MagicMock(),
                query_understander=MagicMock(),
                citation_validator=MagicMock(),
                semantic_cache=MagicMock(),
            )
            return p

    def test_explicit_agentic_depth(self, pipeline):
        """reasoning_depth='agentic' should always use agentic."""
        result = pipeline._should_use_agentic(
            reasoning_depth="agentic",
            query_plan={"complexity": "simple"},
        )
        assert result is True

    def test_explicit_fast_depth(self, pipeline):
        """reasoning_depth='fast' should never use agentic."""
        result = pipeline._should_use_agentic(
            reasoning_depth="fast",
            query_plan={"complexity": "complex"},
        )
        assert result is False

    def test_auto_with_complex_query(self, pipeline):
        """Auto mode should route complex queries to agentic."""
        result = pipeline._should_use_agentic(
            reasoning_depth="auto",
            query_plan={"complexity": "complex"},
        )
        assert result is True

    def test_auto_with_simple_query(self, pipeline):
        """Auto mode should keep simple queries on linear pipeline."""
        result = pipeline._should_use_agentic(
            reasoning_depth="auto",
            query_plan={"complexity": "simple"},
        )
        assert result is False

    def test_auto_with_math_query(self, pipeline):
        """Math queries should use agentic."""
        result = pipeline._should_use_agentic(
            reasoning_depth="auto",
            query_plan={"complexity": "math"},
        )
        assert result is True

    def test_auto_with_multi_hop_intent(self, pipeline):
        """Multi-hop reasoning intent should trigger agentic regardless of complexity label."""
        result = pipeline._should_use_agentic(
            reasoning_depth="auto",
            query_plan={"complexity": "medium", "intent": "multi_hop_reasoning"},
        )
        assert result is True

    def test_auto_with_contradiction_intent(self, pipeline):
        """Contradiction detection intent should trigger agentic."""
        result = pipeline._should_use_agentic(
            reasoning_depth="auto",
            query_plan={"complexity": "medium", "intent": "contradiction_detection"},
        )
        assert result is True
