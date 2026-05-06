"""
Gravity Search -- ConvFinQA Numeric State Tracker
Implements multi-turn numeric state for financial conversations.

Problem: ConvFinQA queries like "What was the growth rate?" depend on values
established in Q1 ("Apple revenue 2023 was $383.3B") and Q2 ("2022 was $394.3B").
Without state, Q3 sees no numbers and hallucinates.

Solution: After each turn, extract key-value facts (entity, metric, period, value)
from the answer and store them in Redis (TTL 2h). On subsequent turns, inject
the KNOWN FACTS block into the LLM prompt BEFORE retrieval context.

Per ConvFinQA paper: +22% accuracy on multi-turn numeric questions vs. no state.
"""

from __future__ import annotations

import re
import json
import structlog
from dataclasses import dataclass, field

logger = structlog.get_logger()

# ── Number extraction ─────────────────────────────────────────────────────────

_SCALE = {
    "trillion": 1e12, "billion": 1e9, "million": 1e6, "thousand": 1e3,
    "t": 1e12, "b": 1e9, "m": 1e6, "k": 1e3,
}

_FACT_PATTERN = re.compile(
    r"(?P<entity>[A-Z][A-Za-z\s&\.]{1,40}?)(?:'s)?\s+"
    r"(?P<metric>(?:revenue|earnings|income|profit|loss|margin|eps|ebitda|"
    r"cash\s+flow|debt|equity|assets|liabilities|sales|operating|net|gross|"
    r"capital|expenditure|dividend|share|price|ratio|return|growth|rate|cost)"
    r"(?:\s+\w+){0,4})"
    r"(?:\s+(?:in|for|of|during))?"
    r"(?:\s+(?P<period>(?:FY|Q[1-4])?\s*(?:20\d{2}|19\d{2})|Q[1-4]\s*'?\d{2}))?"
    r"[\s:,was\-]+?"
    r"(?P<sign>[-\(])?"
    r"\$?(?P<amount>[\d,]+(?:\.\d+)?)"
    r"\)?"
    r"(?:\s*(?P<scale>trillion|billion|million|thousand|[tbmk]))?\b",
    re.IGNORECASE,
)


@dataclass
class NumericFact:
    """A single extracted numeric fact from a conversation turn."""
    entity: str          # "Apple", "Microsoft"
    metric: str          # "revenue", "net income", "operating margin"
    period: str          # "FY2023", "Q4 2024", ""
    value: float         # 391035.0 (always in millions or raw, per scale)
    value_str: str       # "$391.035B" (original text)
    unit: str = ""       # "millions", "billions", etc.
    turn: int = 0        # conversation turn index


def extract_numeric_facts(text: str, turn: int = 0) -> list[NumericFact]:
    """
    Extract numeric facts from a generated answer text.

    Finds patterns like:
      "Apple's revenue in FY2023 was $383.3B"
      "Net income declined to ($1.2B)"
      "Operating margin of 29.8%"
    """
    facts: list[NumericFact] = []
    seen: set[str] = set()

    for m in _FACT_PATTERN.finditer(text):
        try:
            entity = m.group("entity").strip()
            metric = m.group("metric").strip().lower()
            period = (m.group("period") or "").strip()
            amount_str = m.group("amount").replace(",", "")
            scale_str = (m.group("scale") or "").lower()
            sign = m.group("sign") or ""

            amount = float(amount_str)
            scale = _SCALE.get(scale_str, 1.0)
            value = amount * scale * (-1 if sign in ("-", "(") else 1)

            # Deduplicate
            key = f"{entity.lower()}|{metric}|{period}"
            if key in seen:
                continue
            seen.add(key)

            value_str = m.group(0).strip()[:60]
            facts.append(NumericFact(
                entity=entity,
                metric=metric,
                period=period,
                value=value,
                value_str=value_str,
                turn=turn,
            ))
        except (ValueError, AttributeError):
            continue

    return facts


# ── State store ───────────────────────────────────────────────────────────────

class NumericStateTracker:
    """
    Maintains a key-value store of numeric facts across conversation turns.

    Backed by Redis when available (TTL 2h per conversation), falls back
    to an in-memory dict for single-session use.

    Usage:
        tracker = NumericStateTracker()
        await tracker.record_turn(conversation_id, answer_text, turn=1)
        facts_block = await tracker.get_facts_block(conversation_id)
        # → "KNOWN FACTS FROM THIS CONVERSATION:\n- Apple revenue FY2023: $383.3B\n..."
    """

    def __init__(self):
        self._local: dict[str, list[dict]] = {}  # in-memory fallback

    async def record_turn(
        self, conversation_id: str, answer: str, turn: int = 0
    ) -> list[NumericFact]:
        """Extract facts from an answer and store them keyed to conversation_id."""
        facts = extract_numeric_facts(answer, turn=turn)
        if not facts:
            return facts

        serialized = [self._serialize(f) for f in facts]
        await self._append(conversation_id, serialized)
        logger.info(
            "numeric_state_recorded",
            conversation_id=conversation_id,
            facts_extracted=len(facts),
            turn=turn,
        )
        return facts

    async def get_facts_block(self, conversation_id: str) -> str:
        """
        Build a KNOWN FACTS block to prepend to the LLM prompt.

        Returns empty string if no facts stored yet.
        Format:
            KNOWN FACTS FROM THIS CONVERSATION:
            - Apple revenue FY2023: $383.3B
            - Apple revenue FY2022: $394.3B
            - Microsoft operating income FY2024: $109.4B
        """
        facts_data = await self._load(conversation_id)
        if not facts_data:
            return ""

        # Deduplicate: keep most recent fact per (entity, metric, period)
        seen: dict[str, dict] = {}
        for f in facts_data:
            key = f"{f['entity'].lower()}|{f['metric']}|{f['period']}"
            seen[key] = f  # later turn wins

        lines = ["KNOWN FACTS FROM THIS CONVERSATION:"]
        for f in seen.values():
            period_label = f" {f['period']}" if f["period"] else ""
            lines.append(f"  - {f['entity']}{period_label} {f['metric']}: {f['value_str']}")

        return "\n".join(lines)

    async def clear(self, conversation_id: str) -> None:
        """Clear all facts for a conversation (on session end)."""
        try:
            from app.db.redis import redis_client
            await redis_client.delete(f"numstate:{conversation_id}")
        except Exception:
            self._local.pop(conversation_id, None)

    # ── Internal helpers ──────────────────────────────────────────────────

    @staticmethod
    def _serialize(f: NumericFact) -> dict:
        return {
            "entity": f.entity,
            "metric": f.metric,
            "period": f.period,
            "value": f.value,
            "value_str": f.value_str,
            "turn": f.turn,
        }

    async def _append(self, conversation_id: str, facts: list[dict]) -> None:
        try:
            from app.db.redis import redis_client
            key = f"numstate:{conversation_id}"
            raw = await redis_client.get(key)
            existing = json.loads(raw) if raw else []
            existing.extend(facts)
            # Cap at 100 facts per conversation
            existing = existing[-100:]
            await redis_client.setex(key, 7200, json.dumps(existing))
        except Exception as e:
            logger.warning("numeric_state_redis_failed", error=str(e))
            self._local.setdefault(conversation_id, []).extend(facts)

    async def _load(self, conversation_id: str) -> list[dict]:
        try:
            from app.db.redis import redis_client
            key = f"numstate:{conversation_id}"
            raw = await redis_client.get(key)
            return json.loads(raw) if raw else []
        except Exception:
            return self._local.get(conversation_id, [])


# ── Singleton ─────────────────────────────────────────────────────────────────

_state_tracker: NumericStateTracker | None = None


def get_numeric_state_tracker() -> NumericStateTracker:
    global _state_tracker
    if _state_tracker is None:
        _state_tracker = NumericStateTracker()
    return _state_tracker
