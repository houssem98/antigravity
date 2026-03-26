"""Tests for the Verifier Agent — financial arithmetic verification."""
import json
import pytest

from app.core.agents.agent_base import AgentContext
from app.core.agents.verifier_agent import VerifierAgent
from tests.conftest import MockLLMClient


@pytest.mark.asyncio
class TestVerifierAgent:
    """Test financial fact verification."""

    async def test_skip_when_no_numeric_facts(self):
        """Verifier should skip if there are no numeric facts."""
        llm = MockLLMClient(["should not be called"])
        verifier = VerifierAgent(llm=llm)

        ctx = AgentContext(query="test")
        ctx.extracted_facts = [
            {"metric": "Business Description", "value": "Apple designs electronics", "entity": "AAPL"}
        ]
        result = await verifier.execute(ctx)

        assert result.verification_results == []
        assert llm._call_count == 0

    async def test_verifies_numeric_facts(self):
        """Verifier should call LLM with numeric facts."""
        verification_response = json.dumps({
            "verified_facts": [
                {
                    "fact_index": 0,
                    "metric": "Revenue",
                    "status": "verified",
                    "original_value": "124.3",
                    "reason": "Directly stated in 10-K",
                    "cross_check": "Product ($89.5B) + Services ($34.8B) = $124.3B ✓",
                },
                {
                    "fact_index": 1,
                    "metric": "Net Income",
                    "status": "verified",
                    "original_value": "36.3",
                    "reason": "Directly stated",
                },
            ],
            "warnings": [],
            "overall_confidence": 0.95,
        })

        llm = MockLLMClient([verification_response])
        verifier = VerifierAgent(llm=llm)

        ctx = AgentContext(query="What was Apple's revenue?")
        ctx.extracted_facts = [
            {"metric": "Revenue", "value": "124.3", "unit": "USD Billion", "entity": "AAPL"},
            {"metric": "Net Income", "value": "36.3", "unit": "USD Billion", "entity": "AAPL"},
        ]
        result = await verifier.execute(ctx)

        assert llm._call_count == 1
        assert result.verification_results["verified_count"] == 2
        assert result.verification_results["warning_count"] == 0
        assert result.verification_results["overall_confidence"] == 0.95

    async def test_catches_arithmetic_warning(self):
        """Verifier should surface arithmetic warnings."""
        verification_response = json.dumps({
            "verified_facts": [
                {
                    "fact_index": 0,
                    "metric": "Revenue Growth",
                    "status": "warning",
                    "original_value": "15",
                    "reason": "Stated as 15% but calculated as 11.9%",
                },
            ],
            "warnings": [
                "Revenue growth stated as 15% but $124.3B / $111.0B - 1 = 11.9%"
            ],
            "overall_confidence": 0.6,
        })

        llm = MockLLMClient([verification_response])
        verifier = VerifierAgent(llm=llm)

        ctx = AgentContext(query="What was growth?")
        ctx.extracted_facts = [
            {"metric": "Revenue Growth", "value": "15", "unit": "%", "entity": "AAPL"},
        ]
        result = await verifier.execute(ctx)

        assert result.verification_results["warning_count"] == 1
        assert len(result.verification_results["warnings"]) == 1

    async def test_handles_llm_failure(self):
        """Verifier should handle LLM failures gracefully."""
        llm = MockLLMClient(["not valid json {{{"])
        verifier = VerifierAgent(llm=llm)

        ctx = AgentContext(query="test")
        ctx.extracted_facts = [
            {"metric": "Revenue", "value": "124.3", "unit": "B"},
        ]
        result = await verifier.execute(ctx)

        # Should not crash
        assert "error" in result.verification_results

    async def test_trace_entries_logged(self):
        """Verifier should log trace entries."""
        verification_response = json.dumps({
            "verified_facts": [
                {"fact_index": 0, "metric": "Rev", "status": "verified", "original_value": "100"},
            ],
            "warnings": [],
            "overall_confidence": 0.9,
        })

        llm = MockLLMClient([verification_response])
        verifier = VerifierAgent(llm=llm)

        ctx = AgentContext(query="test")
        ctx.extracted_facts = [
            {"metric": "Rev", "value": "100", "unit": "USD"},
        ]
        result = await verifier.execute(ctx)

        assert len(result.trace_log) >= 1
        assert result.trace_log[0].agent == "Verifier"
