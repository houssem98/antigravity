"""
Gravity Search — Extractor Agent
Extracts structured facts from retrieved passages.

Converts unstructured text → structured rows:
  {fact, value, unit, period, source_id, confidence}

This is the Hebbia "structured table output" equivalent — every extracted
data point is traced back to its source passage.
"""

from __future__ import annotations

import json
import time
import structlog

from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage
from app.core.agents.agent_base import BaseAgent, AgentContext

logger = structlog.get_logger()


EXTRACTION_SYSTEM = """You are a financial data extraction engine.
Given a set of document passages and a research question, extract ALL structured
facts, metrics, and data points mentioned in the passages.

Rules:
1. Every extracted fact MUST have a source_id pointing to the passage it came from.
2. Extract numbers with their units (e.g., "$13.5B", "32.4%", "1.2x").
3. Extract time periods when available (e.g., "Q3 FY2026", "FY2024").
4. Extract entity names / tickers when relevant.
5. Assign a confidence score: 1.0 = directly stated, 0.8 = strongly implied, 0.5 = inferred.
6. DERIVATION: For calculated values (margins, growth rates, ratios), show the formula.
   Example: "gross_margin = gross_profit / revenue = $57.4B / $124.3B = 46.2%"
7. CROSS-CHECK: When multiple numbers relate, note the relationship.
   Example: "Product Revenue + Services Revenue should equal Total Revenue"
8. Also provide a concise narrative summary answering the question.

Respond with ONLY valid JSON:
{
  "narrative": "Brief answer to the question based on extracted data.",
  "facts": [
    {
      "metric": "Data Center Revenue",
      "value": "13.5",
      "unit": "USD Billion",
      "period": "Q3 FY2026",
      "entity": "NVIDIA",
      "ticker": "NVDA",
      "source_id": "src_1",
      "confidence": 1.0,
      "derivation": "Directly stated in source passage",
      "cross_check": "Should be less than Total Revenue of $35.1B"
    }
  ]
}"""


class ExtractorAgent(BaseAgent):
    """Extracts structured facts from retrieved passages."""

    name = "Extractor"

    def __init__(self, llm: BaseLLMClient):
        self.llm = llm

    async def execute(self, ctx: AgentContext) -> AgentContext:
        """Extract structured data from all retrieved passages."""
        t0 = time.perf_counter()

        all_facts = []
        all_narratives = []

        for sub_task in ctx.sub_tasks:
            passages = ctx.retrieved_passages.get(sub_task.id, [])
            if not passages:
                continue

            # Build passage context
            passage_context = self._format_passages(passages)

            response = await self.llm.generate(
                messages=[
                    LLMMessage(role="system", content=EXTRACTION_SYSTEM),
                    LLMMessage(
                        role="user",
                        content=(
                            f"Question: {sub_task.question}\n\n"
                            f"Passages:\n{passage_context}"
                        ),
                    ),
                ],
                config=LLMConfig(temperature=0.0, max_tokens=3000, json_mode=True),
            )
            ctx.total_cost_usd += response.cost_usd

            try:
                extraction = json.loads(response.content)
                facts = extraction.get("facts", [])
                narrative = extraction.get("narrative", "")

                # Tag each fact with the sub-task it came from
                for fact in facts:
                    fact["sub_task_id"] = sub_task.id
                    fact["sub_task_question"] = sub_task.question

                all_facts.extend(facts)
                if narrative:
                    all_narratives.append({
                        "sub_task_id": sub_task.id,
                        "question": sub_task.question,
                        "narrative": narrative,
                    })

            except (json.JSONDecodeError, KeyError) as e:
                logger.warning("extraction_failed", subtask=sub_task.id, error=str(e))

        ctx.extracted_facts = all_facts
        # Store narratives in context for the Writer
        ctx.query_plan["_narratives"] = all_narratives

        elapsed = (time.perf_counter() - t0) * 1000
        ctx.add_trace(
            self.name, "extracted",
            f"{len(all_facts)} facts from {len(ctx.sub_tasks)} sub-tasks",
            duration_ms=elapsed,
        )
        return ctx

    def _format_passages(self, passages) -> str:
        """Format passages for the LLM prompt."""
        parts = []
        for i, p in enumerate(passages):
            source_id = f"src_{i+1}"
            header = f"[{source_id}] {p.document_title}"
            if p.ticker:
                header += f" ({p.ticker})"
            if p.section:
                header += f" — {p.section}"
            if p.filing_date:
                header += f" [{p.filing_date}]"
            parts.append(f"{header}\n{p.text[:1500]}")
        return "\n\n---\n\n".join(parts)
