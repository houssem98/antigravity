"""
Hermes Agent Adapter for Antigravity

Integrates the NousResearch Hermes Agent framework as a first-class execution engine.
Hermes is optimized for the Hermes-3 model family, supporting advanced reasoning,
function calling, and multi-turn autonomy.
"""

import os
import structlog
from typing import Dict, Any, Optional

# NousResearch hermes-agent exposes AIAgent in run_agent module (v0.14+).
try:
    from run_agent import AIAgent
    HERMES_AVAILABLE = True
except ImportError:
    AIAgent = None  # type: ignore[assignment,misc]
    HERMES_AVAILABLE = False

logger = structlog.get_logger()


class HermesAgentClient:
    """Adapter for running Hermes-3 powered agentic workflows."""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.api_key = api_key or os.getenv("TOGETHER_API_KEY") or os.getenv("OPENROUTER_API_KEY")
        self.base_url = base_url or os.getenv("HERMES_BASE_URL", "https://api.together.xyz/v1")
        self.model = os.getenv("HERMES_MODEL", "NousResearch/Hermes-3-Llama-3.1-70B")

        if not self.api_key and not os.getenv("MOCK_HERMES", ""):
            logger.warning("hermes_api_key_missing", status="mock_mode_implied")

    async def run_agent(
        self,
        query: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Executes a research task using the Hermes Agent framework."""
        if os.getenv("MOCK_HERMES", "1") == "1" or not HERMES_AVAILABLE:
            logger.info("hermes_agent_mock_run", query=query, has_context=bool(context))
            return {
                "status": "completed",
                "session_id": "hermes_mock_123",
                "result": (
                    f"## Hermes Agent Research Report\n\n**Query**: {query}\n\n"
                    "Mocked response — no live API key or library unavailable. "
                    f"Live mode would use `{self.model}`."
                ),
                "engine": "hermes",
            }

        logger.info("hermes_agent_start", query=query, model=self.model)

        agent = AIAgent(
            api_key=self.api_key,
            base_url=self.base_url,
            model=self.model,
            system_prompt=(
                "You are an elite financial researcher powered by Hermes-3. "
                "Use your tools to extract and synthesize data."
            ),
            context=context or {},
        )

        try:
            response = await agent.run(query)
            return {
                "status": "completed",
                "session_id": getattr(response, "session_id", "hermes_live"),
                "result": getattr(response, "content", str(response)),
                "engine": "hermes",
            }
        except Exception as e:
            logger.error("hermes_agent_failed", error=str(e))
            raise


def get_hermes_client() -> HermesAgentClient:
    return HermesAgentClient()
