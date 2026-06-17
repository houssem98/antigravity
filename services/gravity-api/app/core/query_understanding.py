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
    "temporal_intent": "historical",
    "needs_live_data": False,
}


# Temporal/source intent — free heuristic, drives recency routing + honesty.
# "current price / today / now" must NOT be answered from a 2-year-old filing.
import re as _re

_LIVE_TERMS = _re.compile(
    r"\b(current(?:ly)?|right now|as of today|today'?s?|latest price|stock price|"
    r"share price|trading at|market cap|quote|premarket|after.?hours|intraday|"
    r"this (?:morning|afternoon|week)|past (?:hour|day)|real.?time|live)\b",
    _re.IGNORECASE,
)
_OPINION_TERMS = _re.compile(
    r"\b(analyst|consensus|price target|rating|upgrade|downgrade|sentiment|"
    r"buy or sell|is it a buy|overvalued|undervalued|bullish|bearish|"
    r"should i (?:buy|sell)|fair value)\b",
    _re.IGNORECASE,
)
_MGMT_TERMS = _re.compile(
    r"\b(what did .* say|on the (?:call|earnings call)|management (?:said|guidance|"
    r"commentary)|ceo said|cfo said|guidance (?:on|from) the call|prepared remarks|"
    r"q&a)\b",
    _re.IGNORECASE,
)


def classify_temporal_intent(query: str) -> dict:
    """Returns {temporal_intent, needs_live_data}. Free, deterministic, <1ms.
      latest      → wants current/real-time → live quote/news (we lack these today)
      opinion     → analyst/sentiment       → estimates/news
      qualitative → management commentary    → transcripts
      historical  → reported facts           → filings/XBRL (our strength)"""
    q = query or ""
    if _LIVE_TERMS.search(q):
        return {"temporal_intent": "latest", "needs_live_data": True}
    if _OPINION_TERMS.search(q):
        return {"temporal_intent": "opinion", "needs_live_data": False}
    if _MGMT_TERMS.search(q):
        return {"temporal_intent": "qualitative", "needs_live_data": False}
    return {"temporal_intent": "historical", "needs_live_data": False}


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

            # Temporal/source intent (free heuristic) — drives recency routing + honesty
            plan.update(classify_temporal_intent(query))

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
            return {
                **DEFAULT_QUERY_PLAN,
                "expanded_terms": {"original": query.split()},
                **classify_temporal_intent(query),
            }
