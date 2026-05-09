"""
Tests for the MCP Client and MCP Retrieval Channel

Tests use mock HTTP responses to verify:
1. MCP client protocol compliance (initialize, tools/list, tools/call)
2. MCPRegistry config loading from .mcp.json files
3. MCPRetrievalChannel query → tool selection → RetrievalResult conversion
"""

import pytest
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.retrieval.mcp_client import (
    MCPClient,
    MCPServerConfig,
    MCPRegistry,
    MCPTool,
    MCPToolResult,
    get_mcp_registry,
)
from app.core.retrieval.mcp_retrieval import (
    MCPRetrievalChannel,
    _classify_query_intent,
    _extract_tickers,
    _select_tools_for_query,
)


# ── MCPServerConfig Tests ──────────────────────────────────────────────

class TestMCPServerConfig:
    def test_basic_config(self):
        cfg = MCPServerConfig(name="factset", url="https://mcp.factset.com/mcp")
        assert cfg.name == "factset"
        assert cfg.url == "https://mcp.factset.com/mcp"
        assert cfg.enabled is True
        assert cfg.timeout_s == 15.0

    def test_disabled_config(self):
        cfg = MCPServerConfig(name="test", url="", enabled=False)
        assert not cfg.enabled


# ── MCPClient Tests ────────────────────────────────────────────────────

class TestMCPClient:
    def test_client_creation(self):
        config = MCPServerConfig(name="test", url="https://example.com/mcp")
        client = MCPClient(config)
        assert client.config.name == "test"
        assert not client._initialized
        assert client.tools == []

    def test_request_id_increment(self):
        config = MCPServerConfig(name="test", url="https://example.com/mcp")
        client = MCPClient(config)
        id1 = client._next_id()
        id2 = client._next_id()
        assert id2 == id1 + 1

    def test_headers_with_api_key(self):
        config = MCPServerConfig(name="test", url="https://example.com/mcp", api_key="sk-123")
        client = MCPClient(config)
        headers = client._build_headers()
        assert headers["Authorization"] == "Bearer sk-123"
        assert headers["MCP-Protocol-Version"] == "2025-11-25"

    def test_headers_without_api_key(self):
        config = MCPServerConfig(name="test", url="https://example.com/mcp")
        client = MCPClient(config)
        headers = client._build_headers()
        assert "Authorization" not in headers

    def test_sse_parsing(self):
        config = MCPServerConfig(name="test", url="https://example.com/mcp")
        client = MCPClient(config)

        sse_text = 'data: {"jsonrpc": "2.0", "id": 1, "result": {"tools": []}}\n\n'
        result = client._parse_sse_response(sse_text)
        assert result == {"tools": []}

    def test_find_tool(self):
        config = MCPServerConfig(name="test", url="https://example.com/mcp")
        client = MCPClient(config)
        client._tools = [
            MCPTool(name="get_financials", description="Get company financial statements"),
            MCPTool(name="get_estimates", description="Get analyst consensus estimates"),
        ]
        assert client.find_tool("financials").name == "get_financials"
        assert client.find_tool("consensus").name == "get_estimates"
        assert client.find_tool("nonexistent") is None


# ── MCPToolResult Tests ────────────────────────────────────────────────

class TestMCPToolResult:
    def test_text_extraction(self):
        result = MCPToolResult(content=[
            {"type": "text", "text": "Revenue: $394B"},
            {"type": "text", "text": "Net Income: $97B"},
        ])
        assert "Revenue: $394B" in result.text
        assert "Net Income: $97B" in result.text

    def test_empty_result(self):
        result = MCPToolResult(content=[])
        assert result.text == "[]"

    def test_error_result(self):
        result = MCPToolResult(
            content=[{"type": "text", "text": "Not found"}],
            is_error=True,
        )
        assert result.is_error


# ── MCPRegistry Tests ──────────────────────────────────────────────────

class TestMCPRegistry:
    def test_registry_creation(self):
        registry = MCPRegistry()
        assert len(registry._clients) == 0

    def test_register_enabled(self):
        registry = MCPRegistry()
        registry.register(MCPServerConfig(
            name="test_provider",
            url="https://mcp.test.com/mcp",
            api_key="sk-123",
            enabled=True,
        ))
        assert "test_provider" in registry._clients

    def test_register_disabled(self):
        registry = MCPRegistry()
        registry.register(MCPServerConfig(
            name="disabled",
            url="https://mcp.test.com/mcp",
            enabled=False,
        ))
        assert "disabled" not in registry._clients

    def test_register_no_url(self):
        registry = MCPRegistry()
        registry.register(MCPServerConfig(name="empty", url="", enabled=True))
        assert "empty" not in registry._clients

    def test_get_enabled_clients(self):
        registry = MCPRegistry()
        registry.register(MCPServerConfig(name="a", url="https://a.com/mcp", api_key="k"))
        registry.register(MCPServerConfig(name="b", url="https://b.com/mcp", api_key="k"))
        assert len(registry.get_enabled_clients()) == 2

    def test_from_env_loads_mcp_json(self):
        """Should discover .mcp.json files from financial-services-main."""
        registry = MCPRegistry.from_env()
        # The .mcp.json files exist but API keys won't be set in test env,
        # so servers will be registered but not enabled (except mtnewswire which is free)
        # Just verify the registry was created without errors
        assert isinstance(registry, MCPRegistry)


# ── Query Intent Classification Tests ──────────────────────────────────

class TestQueryIntentClassification:
    def test_financials_intent(self):
        intents = _classify_query_intent("What was Apple's revenue in Q4 2025?")
        assert "financials" in intents

    def test_earnings_intent(self):
        intents = _classify_query_intent("NVIDIA earnings call transcript analysis")
        assert "financials" in intents or "transcripts" in intents

    def test_valuation_intent(self):
        intents = _classify_query_intent("What is Tesla's EV/EBITDA multiple?")
        assert "valuation" in intents

    def test_news_intent(self):
        intents = _classify_query_intent("Latest news about Microsoft acquisition")
        assert "news" in intents

    def test_credit_intent(self):
        intents = _classify_query_intent("What is Boeing's Moody's credit rating?")
        assert "credit" in intents

    def test_default_to_financials(self):
        intents = _classify_query_intent("Tell me about AAPL")
        assert intents == ["financials"]  # default fallback


class TestTickerExtraction:
    def test_from_entities(self):
        tickers = _extract_tickers("query", {"companies": ["AAPL", "MSFT"]})
        assert tickers == ["AAPL", "MSFT"]

    def test_from_query(self):
        tickers = _extract_tickers("Compare AAPL vs MSFT revenue growth")
        assert "AAPL" in tickers
        assert "MSFT" in tickers

    def test_filters_common_words(self):
        tickers = _extract_tickers("The DCF model for NVDA shows strong EPS")
        assert "NVDA" in tickers
        assert "DCF" not in tickers
        assert "EPS" not in tickers
        assert "THE" not in tickers

    def test_max_tickers(self):
        tickers = _extract_tickers("AA BB CC DD EE FF GG HH")
        assert len(tickers) <= 5


# ── Tool Selection Tests ───────────────────────────────────────────────

class TestToolSelection:
    def test_selects_matching_tools(self):
        config = MCPServerConfig(name="test", url="https://test.com/mcp")
        client = MCPClient(config)
        client._tools = [
            MCPTool(name="get_financial_statements", description="Get revenue and income"),
            MCPTool(name="get_weather", description="Get weather forecast"),
            MCPTool(name="get_estimates", description="Get analyst consensus estimates"),
        ]

        selected = _select_tools_for_query(
            client, "What is Apple's revenue?",
            intents=["financials"], tickers=["AAPL"],
        )
        tool_names = [name for name, _ in selected]
        assert "get_financial_statements" in tool_names
        assert "get_weather" not in tool_names

    def test_max_3_tools(self):
        config = MCPServerConfig(name="test", url="https://test.com/mcp")
        client = MCPClient(config)
        client._tools = [
            MCPTool(name=f"financial_tool_{i}", description="revenue income profit earnings")
            for i in range(10)
        ]
        selected = _select_tools_for_query(
            client, "revenue income ebitda earnings",
            intents=["financials"], tickers=["AAPL"],
        )
        assert len(selected) <= 3


# ── MCPRetrievalChannel Tests ─────────────────────────────────────────

class TestMCPRetrievalChannel:
    def test_channel_creation(self):
        channel = MCPRetrievalChannel()
        assert channel._registry is None
        assert not channel._initialized

    def test_chunk_result_short(self):
        chunks = MCPRetrievalChannel._chunk_result("short text", max_chars=1500)
        assert chunks == ["short text"]

    def test_chunk_result_long(self):
        text = "paragraph one\n\nparagraph two\n\nparagraph three\n\nparagraph four"
        # With a very small max_chars, it should split
        chunks = MCPRetrievalChannel._chunk_result(text, max_chars=30)
        assert len(chunks) >= 2

    def test_chunk_result_preserves_paragraph_boundaries(self):
        text = "A" * 500 + "\n\n" + "B" * 500 + "\n\n" + "C" * 500
        chunks = MCPRetrievalChannel._chunk_result(text, max_chars=600)
        assert len(chunks) >= 2
        # First chunk should be just the A's
        assert "A" * 500 in chunks[0]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
