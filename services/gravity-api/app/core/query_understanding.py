"""
Gravity Search — Query Understanding Agent
Uses Gemini 2.5 Flash to classify intent, extract entities, expand synonyms, parse temporal refs.
Target: <50ms per query.
"""

import json
import structlog

from app.core.reasoning.prompts import QUERY_UNDERSTANDING_SYSTEM
from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage

logger = structlog.get_logger()

# Default plan when LLM classification fails
DEFAULT_QUERY_PLAN = {
    "intent": "document_search",
    "complexity": "medium",
    "entities": {"companies": [], "people": [], "dates": [], "metrics": [], "themes": []},
    "expanded_terms": {"original": [], "synonyms": [], "concepts": []},
    "filters": {},
    "retrieval_channels": ["dense", "bm25", "splade"],
}


class QueryUnderstanding:
    """Analyze user queries to plan retrieval strategy."""

    def __init__(self, llm_client: BaseLLMClient):
        self.llm = llm_client  # Gemini 2.5 Flash

    async def analyze(self, query: str) -> dict:
        """
        Full query analysis pipeline:
          1. Intent classification
          2. Entity extraction & resolution
          3. Synonym/concept expansion
          4. Temporal parsing
          5. Retrieval channel selection
        """
        try:
            response = await self.llm.generate(
                messages=[
                    LLMMessage(role="system", content=QUERY_UNDERSTANDING_SYSTEM),
                    LLMMessage(role="user", content=query),
                ],
                config=LLMConfig(temperature=0.0, max_tokens=1000, json_mode=True),
            )

            plan = json.loads(response.content)

            # Ensure all expected fields exist
            plan.setdefault("intent", "document_search")
            plan.setdefault("complexity", "medium")
            plan.setdefault("entities", {})
            plan.setdefault("expanded_terms", {})
            plan.setdefault("filters", {})
            plan.setdefault("retrieval_channels", ["dense", "bm25", "splade"])

            # Auto-add graph channel if entity-relationship query detected
            if plan["intent"] in ("entity_relationship", "supply_chain"):
                if "graph" not in plan["retrieval_channels"]:
                    plan["retrieval_channels"].append("graph")

            # Auto-add structured channel if calculation/quantitative query
            if plan["intent"] in ("calculation", "simple_lookup"):
                if "structured" not in plan["retrieval_channels"]:
                    plan["retrieval_channels"].append("structured")

            logger.info(
                "query_analyzed",
                intent=plan["intent"],
                complexity=plan["complexity"],
                channels=plan["retrieval_channels"],
                entity_count=sum(len(v) for v in plan.get("entities", {}).values() if isinstance(v, list)),
            )

            return plan

        except Exception as e:
            logger.warning("query_understanding_failed", error=str(e))
            return {**DEFAULT_QUERY_PLAN, "expanded_terms": {"original": query.split()}}
