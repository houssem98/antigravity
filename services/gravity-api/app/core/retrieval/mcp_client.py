"""
Gravity Search — Model Context Protocol (MCP) Client

Generic client for Anthropic's MCP financial data servers (FactSet, S&P CapIQ,
Morningstar, Daloopa, etc.). Implements the JSON-RPC 2.0 / Streamable HTTP
transport defined by the Model Context Protocol specification.

MCP flow:
  1. POST /mcp  {method: "initialize", ...}     → handshake + capabilities
  2. POST /mcp  {method: "tools/list"}           → discover available tools
  3. POST /mcp  {method: "tools/call", ...}      → execute a tool (query data)

Each provider exposes domain-specific tools (e.g., factset__get_company_financials,
sp_global__get_fundamental_data, morningstar__get_valuation). This client handles
the protocol plumbing; MCPRetrievalChannel (mcp_retrieval.py) handles the conversion
to RetrievalResult objects for RRF fusion.
"""

from __future__ import annotations

import json
import uuid
import asyncio
from dataclasses import dataclass, field
from typing import Any

import httpx
import structlog

logger = structlog.get_logger()

MCP_PROTOCOL_VERSION = "2025-11-25"


# ── Data Types ─────────────────────────────────────────────────────────

@dataclass
class MCPTool:
    """A tool exposed by an MCP server."""
    name: str
    description: str = ""
    input_schema: dict = field(default_factory=dict)


@dataclass
class MCPToolResult:
    """Result from calling an MCP tool."""
    content: list[dict] = field(default_factory=list)  # [{type: "text", text: "..."}]
    is_error: bool = False
    raw_response: dict = field(default_factory=dict)

    @property
    def text(self) -> str:
        """Extract text content from result."""
        parts = []
        for item in self.content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts) if parts else json.dumps(self.content, indent=2)


@dataclass
class MCPServerConfig:
    """Configuration for a single MCP server."""
    name: str
    url: str
    api_key: str = ""
    enabled: bool = True
    timeout_s: float = 15.0
    # Provider-specific metadata
    provider_type: str = ""  # "factset", "sp_global", "morningstar", etc.
    data_category: str = ""  # "fundamentals", "estimates", "news", "transcripts"


# ── MCP Client ─────────────────────────────────────────────────────────

class MCPClient:
    """
    Client for a single MCP server endpoint.

    Usage:
        client = MCPClient(MCPServerConfig(name="factset", url="https://mcp.factset.com/mcp"))
        await client.initialize()
        tools = await client.list_tools()
        result = await client.call_tool("factset__get_company_financials", {"ticker": "AAPL"})
    """

    def __init__(self, config: MCPServerConfig):
        self.config = config
        self._http: httpx.AsyncClient | None = None
        self._tools: list[MCPTool] = []
        self._initialized = False
        self._request_id = 0

    def _next_id(self) -> int:
        self._request_id += 1
        return self._request_id

    def _build_headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        }
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    async def _get_http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                timeout=httpx.Timeout(self.config.timeout_s, connect=5.0),
                headers=self._build_headers(),
            )
        return self._http

    async def _rpc_call(self, method: str, params: dict | None = None) -> dict:
        """Send a JSON-RPC 2.0 request and return the result."""
        http = await self._get_http()

        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": method,
        }
        if params:
            payload["params"] = params

        try:
            response = await http.post(self.config.url, json=payload)
            response.raise_for_status()

            # Handle SSE responses (text/event-stream)
            content_type = response.headers.get("content-type", "")
            if "text/event-stream" in content_type:
                return self._parse_sse_response(response.text)

            data = response.json()

            if "error" in data:
                error = data["error"]
                logger.warning(
                    "mcp_rpc_error",
                    server=self.config.name,
                    method=method,
                    error_code=error.get("code"),
                    error_message=error.get("message"),
                )
                return {"error": error}

            return data.get("result", {})

        except httpx.TimeoutException:
            logger.warning("mcp_timeout", server=self.config.name, method=method)
            return {"error": {"code": -1, "message": "timeout"}}
        except httpx.HTTPStatusError as e:
            logger.warning("mcp_http_error", server=self.config.name, status=e.response.status_code)
            return {"error": {"code": e.response.status_code, "message": str(e)}}
        except Exception as e:
            logger.error("mcp_request_failed", server=self.config.name, error=str(e))
            return {"error": {"code": -1, "message": str(e)}}

    def _parse_sse_response(self, raw: str) -> dict:
        """Parse Server-Sent Events response to extract JSON-RPC result."""
        result = {}
        for line in raw.split("\n"):
            line = line.strip()
            if line.startswith("data:"):
                data_str = line[5:].strip()
                if data_str:
                    try:
                        data = json.loads(data_str)
                        if "result" in data:
                            result = data["result"]
                        elif "error" in data:
                            result = {"error": data["error"]}
                    except json.JSONDecodeError:
                        continue
        return result

    # ── MCP Protocol Methods ─────────────────────────────────────────

    async def initialize(self) -> bool:
        """Perform MCP handshake with the server."""
        if self._initialized:
            return True

        result = await self._rpc_call("initialize", {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {
                "tools": {}
            },
            "clientInfo": {
                "name": "antigravity-gravity-search",
                "version": "1.0.0",
            },
        })

        if "error" in result:
            logger.warning(
                "mcp_init_failed",
                server=self.config.name,
                error=result["error"],
            )
            return False

        self._initialized = True
        logger.info(
            "mcp_initialized",
            server=self.config.name,
            server_info=result.get("serverInfo", {}),
            capabilities=list(result.get("capabilities", {}).keys()),
        )
        return True

    async def list_tools(self) -> list[MCPTool]:
        """Discover available tools from the MCP server."""
        if not self._initialized:
            await self.initialize()

        result = await self._rpc_call("tools/list")
        if "error" in result:
            return []

        self._tools = [
            MCPTool(
                name=t.get("name", ""),
                description=t.get("description", ""),
                input_schema=t.get("inputSchema", {}),
            )
            for t in result.get("tools", [])
        ]

        logger.info(
            "mcp_tools_discovered",
            server=self.config.name,
            tool_count=len(self._tools),
            tool_names=[t.name for t in self._tools[:10]],
        )
        return self._tools

    async def call_tool(self, tool_name: str, arguments: dict | None = None) -> MCPToolResult:
        """Execute a tool on the MCP server."""
        if not self._initialized:
            await self.initialize()

        result = await self._rpc_call("tools/call", {
            "name": tool_name,
            "arguments": arguments or {},
        })

        if "error" in result:
            return MCPToolResult(
                content=[{"type": "text", "text": f"Error: {result['error']}"}],
                is_error=True,
                raw_response=result,
            )

        return MCPToolResult(
            content=result.get("content", []),
            is_error=result.get("isError", False),
            raw_response=result,
        )

    async def close(self):
        """Close the HTTP client."""
        if self._http and not self._http.is_closed:
            await self._http.aclose()

    @property
    def tools(self) -> list[MCPTool]:
        return self._tools

    def find_tool(self, keyword: str) -> MCPTool | None:
        """Find a tool by keyword in its name or description."""
        keyword_lower = keyword.lower()
        for tool in self._tools:
            if keyword_lower in tool.name.lower() or keyword_lower in tool.description.lower():
                return tool
        return None


# ── MCP Registry ───────────────────────────────────────────────────────

class MCPRegistry:
    """
    Registry of all configured MCP servers.
    Loads configs from env vars and .mcp.json files in financial-services-main.

    Usage:
        registry = MCPRegistry.from_env()
        await registry.initialize_all()
        clients = registry.get_enabled_clients()
    """

    def __init__(self):
        self._clients: dict[str, MCPClient] = {}

    def register(self, config: MCPServerConfig) -> None:
        """Register an MCP server config. Only creates client if enabled."""
        if config.enabled and config.url:
            self._clients[config.name] = MCPClient(config)
            logger.info("mcp_registered", server=config.name, url=config.url[:50])

    async def initialize_all(self) -> dict[str, bool]:
        """Initialize all registered MCP clients in parallel."""
        if not self._clients:
            return {}

        tasks = {
            name: client.initialize()
            for name, client in self._clients.items()
        }
        results = {}
        gathered = await asyncio.gather(*tasks.values(), return_exceptions=True)
        for name, result in zip(tasks.keys(), gathered):
            if isinstance(result, Exception):
                logger.warning("mcp_init_exception", server=name, error=str(result))
                results[name] = False
            else:
                results[name] = result

        logger.info("mcp_registry_init", results=results)
        return results

    async def discover_all_tools(self) -> dict[str, list[MCPTool]]:
        """List tools from all initialized clients."""
        all_tools = {}
        for name, client in self._clients.items():
            if client._initialized:
                tools = await client.list_tools()
                all_tools[name] = tools
        return all_tools

    def get_client(self, name: str) -> MCPClient | None:
        return self._clients.get(name)

    def get_enabled_clients(self) -> dict[str, MCPClient]:
        return {n: c for n, c in self._clients.items() if c.config.enabled}

    async def close_all(self):
        """Close all HTTP clients."""
        for client in self._clients.values():
            await client.close()

    @staticmethod
    def from_env() -> MCPRegistry:
        """Build a registry from environment variables and .mcp.json configs."""
        import os
        from pathlib import Path

        registry = MCPRegistry()

        # ── Load from .mcp.json files in financial-services-main ──
        repo_root = Path(__file__).resolve().parents[5]  # → antigravity/
        mcp_json_files = list(
            (repo_root / "financial-services-main" / "plugins").rglob(".mcp.json")
        )

        seen_urls: set[str] = set()
        for mcp_file in mcp_json_files:
            try:
                data = json.loads(mcp_file.read_text(encoding="utf-8"))
                for server_name, server_cfg in data.get("mcpServers", {}).items():
                    url = server_cfg.get("url", "")
                    if not url or url in seen_urls:
                        continue
                    seen_urls.add(url)

                    # Check for API key env var: <PROVIDER>_MCP_API_KEY or <PROVIDER>_API_KEY
                    env_prefix = server_name.upper().replace("-", "_").replace(" ", "_")
                    api_key = (
                        os.environ.get(f"{env_prefix}_MCP_API_KEY", "")
                        or os.environ.get(f"{env_prefix}_API_KEY", "")
                    )

                    # Also check <PROVIDER>_MCP_URL override
                    url = os.environ.get(f"{env_prefix}_MCP_URL", url)

                    # Only enable if we have an API key (except for open/free servers)
                    enabled = bool(api_key) or server_name in ("mtnewswire",)

                    registry.register(MCPServerConfig(
                        name=server_name,
                        url=url,
                        api_key=api_key,
                        enabled=enabled,
                        provider_type=server_name,
                    ))
            except Exception as e:
                logger.warning("mcp_json_parse_failed", path=str(mcp_file), error=str(e))

        return registry


# ── Singleton ──────────────────────────────────────────────────────────

_registry_instance: MCPRegistry | None = None


def get_mcp_registry() -> MCPRegistry:
    """Get the singleton MCP registry instance."""
    global _registry_instance
    if _registry_instance is None:
        _registry_instance = MCPRegistry.from_env()
    return _registry_instance
