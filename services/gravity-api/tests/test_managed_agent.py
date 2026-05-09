"""
Tests for the Claude Managed Agent Client.
"""

import pytest
import os
import json
from unittest.mock import AsyncMock, patch

from app.llm.managed_agent_client import ManagedAgentClient, get_managed_agent_client

@pytest.fixture
def mock_env(monkeypatch):
    monkeypatch.setenv("CMA_MARKET_RESEARCHER_ID", "agent_123")
    monkeypatch.setenv("MOCK_CMA", "1")

@pytest.fixture
def client(mock_env):
    c = ManagedAgentClient(api_key="sk-test")
    c.agent_ids = {
        "market-researcher": "agent_123",
        "earnings-reviewer": "agent_456"
    }
    return c


class TestManagedAgentClient:
    def test_client_init(self, mock_env):
        c = ManagedAgentClient(api_key="sk-test")
        c.agent_ids = {"market-researcher": "agent_123"}
        assert c.agent_ids["market-researcher"] == "agent_123"

    def test_extract_handoff_valid(self, client):
        text = '{"type": "handoff_request", "target_agent": "market-researcher", "payload": {"event": "do it", "context_ref": "ref1"}}'
        handoff = client._extract_handoff(text)
        assert handoff is not None
        assert handoff["target_agent"] == "market-researcher"
        assert handoff["payload"]["event"] == "do it"

    def test_extract_handoff_invalid_target(self, client):
        text = '{"type": "handoff_request", "target_agent": "unknown", "payload": {"event": "do it", "context_ref": "ref1"}}'
        handoff = client._extract_handoff(text)
        assert handoff is None

    def test_extract_handoff_invalid_json(self, client):
        text = '{"type": "handoff_request", "target_agent": "market-researcher", "payload": '
        handoff = client._extract_handoff(text)
        assert handoff is None

    def test_extract_handoff_no_match(self, client):
        text = "This is a normal message with no handoff."
        handoff = client._extract_handoff(text)
        assert handoff is None

    @pytest.mark.asyncio
    async def test_run_agent_mock(self, client):
        # Remove agent ID to trigger mock run
        client.agent_ids["market-researcher"] = None
        result = await client.run_agent("market-researcher", "analyze AAPL")
        assert result["status"] == "completed"
        assert "Mock market-researcher Report" in result["result"]

    @pytest.mark.asyncio
    @patch("anthropic.AsyncAnthropic")
    async def test_run_agent_live_missing_id(self, mock_anthropic, monkeypatch):
        # Make sure MOCK_CMA is off
        monkeypatch.delenv("MOCK_CMA", raising=False)
        c = ManagedAgentClient(api_key="sk-test")
        c.agent_ids["market-researcher"] = None

        with pytest.raises(ValueError, match="No Managed Agent ID deployed"):
            await c.run_agent("market-researcher", "analyze AAPL")
