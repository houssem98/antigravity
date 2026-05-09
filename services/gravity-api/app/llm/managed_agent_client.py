"""
Gravity Search — Claude Managed Agent Client

Provides an interface to the Anthropic `/v1/agents` API (currently in beta).
Used to run end-to-end financial workflows via the deployed agent cookbooks
(e.g., market-researcher, earnings-reviewer).

This is Layer 3 of the Claude for Financial Services integration.
"""

from __future__ import annotations

import json
import os
import re
import asyncio

import structlog
import jsonschema

from anthropic import AsyncAnthropic

logger = structlog.get_logger()

# Agent IDs mapping (slug -> CMA agent_id)
# In production, these are provisioned by deploy-managed-agent.sh
# and loaded from environment or database.
_AGENT_IDS = {
    "market-researcher": os.environ.get("CMA_MARKET_RESEARCHER_ID", ""),
    "earnings-reviewer": os.environ.get("CMA_EARNINGS_REVIEWER_ID", ""),
}

# Handoff schema from orchestrate.py reference
HANDOFF_PAYLOAD_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["event"],
    "properties": {
        "event": {"type": "string", "maxLength": 2000},
        "context_ref": {"type": "string", "maxLength": 256,
                        "pattern": r"^[A-Za-z0-9 ._/:#-]+$"},
    },
}

HANDOFF_RE = re.compile(
    r'\{"type":\s*"handoff_request".*?\}\}', re.DOTALL
)


class ManagedAgentClient:
    """Client for deploying and executing Claude Managed Agents."""

    def __init__(self, api_key: str | None = None):
        # We need the ANTHROPIC_API_KEY. Default uses env var.
        self.client = AsyncAnthropic(api_key=api_key)
        self.agent_ids = _AGENT_IDS

    def _extract_handoff(self, text: str) -> dict | None:
        """Parse handoff request from agent text stream."""
        m = HANDOFF_RE.search(text)
        if not m:
            return None
        try:
            obj = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
        target = obj.get("target_agent")
        payload = obj.get("payload")
        if target not in self.agent_ids:
            return None
        try:
            jsonschema.validate(instance=payload, schema=HANDOFF_PAYLOAD_SCHEMA)
        except jsonschema.ValidationError:
            return None
        return {"target_agent": target, "payload": payload}

    async def run_agent(
        self,
        agent_slug: str,
        input_text: str,
        on_progress=None,
    ) -> dict:
        """
        Run a managed agent end-to-end for a given input.

        Args:
            agent_slug: Name of the agent (e.g. "market-researcher")
            input_text: The user's query or instruction
            on_progress: Optional async callback for streaming updates
        """
        agent_id = self.agent_ids.get(agent_slug)
        if not agent_id:
            # For testing/mocking, if no ID is set, simulate a successful run
            if os.environ.get("MOCK_CMA") == "1":
                return self._mock_run(agent_slug, input_text, on_progress)
            raise ValueError(f"No Managed Agent ID deployed for {agent_slug}")

        try:
            # Create session
            session = await self.client.beta.agents.sessions.create(agent_id=agent_id)
            session_id = session.id

            result_text = ""
            current_agent = agent_id

            # Initial steer
            stream = await self.client.beta.agents.sessions.steer(
                agent_id=current_agent,
                input=input_text,
                session_id=session_id,
                stream=True,
            )

            async for event in stream:
                if event.type == "message_delta" and hasattr(event, "text"):
                    text_delta = event.text
                    result_text += text_delta

                    if on_progress:
                        await on_progress({"type": "text", "text": text_delta})

                    # Handle sub-agent delegation (handoff)
                    handoff = self._extract_handoff(result_text)
                    if handoff:
                        target_slug = handoff["target_agent"]
                        target_id = self.agent_ids.get(target_slug)
                        if target_id:
                            if on_progress:
                                await on_progress({
                                    "type": "handoff",
                                    "target": target_slug
                                })
                            
                            # Re-steer to the target sub-agent
                            stream = await self.client.beta.agents.sessions.steer(
                                agent_id=target_id,
                                input=handoff["payload"]["event"],
                                session_id=session_id,
                                stream=True,
                            )
                            result_text = "" # Reset for new agent output
                            current_agent = target_id

            return {
                "status": "completed",
                "session_id": session_id,
                "result": result_text,
            }

        except Exception as e:
            logger.error("cma_run_failed", agent=agent_slug, error=str(e))
            raise RuntimeError(f"Managed Agent execution failed: {str(e)}")

    def _mock_run(self, agent_slug: str, input_text: str, on_progress=None) -> dict:
        """Simulated response for testing when no real agent_id is configured."""
        logger.info("cma_mock_run", agent=agent_slug)
        return {
            "status": "completed",
            "session_id": "mock_session_123",
            "result": f"# Mock {agent_slug} Report\n\nGenerated for: {input_text}\n\nThis is a mock response because CMA_{agent_slug.upper().replace('-', '_')}_ID is not set.",
        }

# Singleton accessor
_cma_client: ManagedAgentClient | None = None

def get_managed_agent_client() -> ManagedAgentClient:
    global _cma_client
    if _cma_client is None:
        from app.config import settings
        _cma_client = ManagedAgentClient(api_key=settings.anthropic_api_key)
    return _cma_client
