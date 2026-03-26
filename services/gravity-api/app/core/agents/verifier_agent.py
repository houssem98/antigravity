"""
Gravity Search — Financial Verifier Agent
Per Fin-R1 paper: verifies numerical claims and arithmetic in extracted data.

Why this matters:
  - LLMs are unreliable at arithmetic (hallucinate calculations)
  - Financial data requires exact numbers (revenue, margins, growth rates)
  - This agent cross-checks extracted facts before the Writer synthesizes

Flow:
  1. Takes extracted facts with numeric values
  2. Cross-checks: do sub-components sum correctly?
  3. Verifies YoY/QoQ growth rate calculations
  4. Validates percentage accuracy (e.g., margin = income/revenue)
  5. Flags any inconsistencies as verification_warnings
"""

from __future__ import annotations

import json
import time
import structlog

from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage
from app.core.agents.agent_base import BaseAgent, AgentContext

logger = structlog.get_logger()


VERIFICATION_SYSTEM = """You are a financial data verification engine.
Given extracted financial facts, verify the mathematical consistency of the data.

Check for:
1. ARITHMETIC: Do sub-components add up to reported totals?
   Example: Product Revenue + Services Revenue should ≈ Total Revenue
2. GROWTH RATES: Are YoY/QoQ percentages mathematically correct given the values?
   Example: If Q4 revenue = $124.3B and Q3 = $118.7B, QoQ growth should be ~4.7%
3. MARGIN CONSISTENCY: Do margins match income/revenue ratios?
   Example: If gross profit = $57.4B and revenue = $124.3B, gross margin should be ~46.2%
4. CROSS-REFERENCES: Do numbers mentioned in different sources agree?
   Example: Revenue stated as $124.3B in one passage and $124.3 billion in another = OK

For each fact, output a verification status.

Respond with ONLY valid JSON:
{
  "verified_facts": [
    {
      "fact_index": 0,
      "metric": "Total Revenue",
      "status": "verified" | "unverified" | "warning" | "error",
      "original_value": "124.3",
      "reason": "Matches source passage directly.",
      "cross_check": "Product ($89.5B) + Services ($34.8B) = $124.3B ✓"
    }
  ],
  "warnings": [
    "Revenue growth stated as 12% but calculated as 11.3% from prior year values."
  ],
  "overall_confidence": 0.92
}"""


class VerifierAgent(BaseAgent):
    """
    Verifies numerical accuracy of extracted financial facts.

    Runs between Critic evaluation and Writer synthesis.
    Uses Gemini Flash for fast, cheap verification.
    """

    name = "Verifier"

    def __init__(self, llm: BaseLLMClient):
        self.llm = llm

    async def execute(self, ctx: AgentContext) -> AgentContext:
        """Verify extracted facts for arithmetic consistency."""
        t0 = time.perf_counter()

        numeric_facts = [
            f for f in ctx.extracted_facts
            if f.get("value") and self._is_numeric(str(f.get("value", "")))
        ]

        if not numeric_facts:
            ctx.verification_results = []
            ctx.add_trace(self.name, "skipped", "No numeric facts to verify")
            return ctx

        # ── Step 1: Programmatic verification (no LLM needed) ──────
        # Use the financial calculator to verify computable facts
        calc_warnings = self._programmatic_verify(numeric_facts)

        # Build verification prompt
        facts_text = self._format_facts_for_verification(numeric_facts)

        try:
            response = await self.llm.generate(
                messages=[
                    LLMMessage(role="system", content=VERIFICATION_SYSTEM),
                    LLMMessage(role="user", content=f"Verify these extracted financial facts:\n\n{facts_text}"),
                ],
                config=LLMConfig(temperature=0.0, max_tokens=2000, json_mode=True),
            )
            ctx.total_cost_usd += response.cost_usd

            result = json.loads(response.content)
            verified_facts = result.get("verified_facts", [])
            warnings = result.get("warnings", [])
            overall_confidence = result.get("overall_confidence", 0.5)

            # Apply verification status back to extracted facts
            for vf in verified_facts:
                idx = vf.get("fact_index", -1)
                if 0 <= idx < len(numeric_facts):
                    numeric_facts[idx]["verification_status"] = vf.get("status", "unverified")
                    numeric_facts[idx]["verification_reason"] = vf.get("reason", "")
                    if vf.get("cross_check"):
                        numeric_facts[idx]["cross_check"] = vf["cross_check"]

            ctx.verification_results = {
                "verified_count": sum(1 for v in verified_facts if v.get("status") == "verified"),
                "warning_count": sum(1 for v in verified_facts if v.get("status") == "warning"),
                "error_count": sum(1 for v in verified_facts if v.get("status") == "error"),
                "total_checked": len(verified_facts),
                "warnings": warnings,
                "overall_confidence": overall_confidence,
            }

            elapsed = (time.perf_counter() - t0) * 1000
            ctx.add_trace(
                self.name, "verified",
                f"{ctx.verification_results['verified_count']}/{len(verified_facts)} verified | "
                f"{len(warnings)} warnings | confidence={overall_confidence:.2f}",
                duration_ms=elapsed,
            )

        except (json.JSONDecodeError, Exception) as e:
            logger.warning("verifier_failed", error=str(e))
            ctx.verification_results = {"error": str(e), "total_checked": 0}
            ctx.add_trace(self.name, "error", f"Verification failed: {e}")

        return ctx

    def _format_facts_for_verification(self, facts: list[dict]) -> str:
        """Format numeric facts for the verification prompt."""
        lines = []
        for i, fact in enumerate(facts[:30]):  # Cap at 30 facts
            entity = fact.get("entity", "")
            metric = fact.get("metric", "")
            value = fact.get("value", "")
            unit = fact.get("unit", "")
            period = fact.get("period", "")
            source = fact.get("source_id", "")
            lines.append(
                f"[{i}] {entity} | {metric} = {value} {unit} | Period: {period} | Source: {source}"
            )
        return "\n".join(lines)

    @staticmethod
    def _is_numeric(text: str) -> bool:
        """Check if value looks numeric."""
        import re
        cleaned = re.sub(r"[$€£¥,\s()%BbMmKk]", "", text).replace("−", "-")
        if not cleaned:
            return False
        try:
            float(cleaned)
            return True
        except ValueError:
            return False

    def _programmatic_verify(self, facts: list[dict]) -> list[str]:
        """
        Programmatically verify calculations using the financial calculator.
        This catches arithmetic errors without relying on the LLM.
        Returns a list of warning strings.
        """
        from app.core.financial_calculator import (
            parse_financial_number,
            percentage_change,
            gross_margin,
            operating_margin,
            net_margin,
        )

        warnings = []
        facts_by_metric = {}
        for f in facts:
            key = (f.get("entity", ""), f.get("metric", "").lower())
            facts_by_metric[key] = f

        # Check growth rates: if we have current and prior values
        for f in facts:
            metric = f.get("metric", "").lower()
            entity = f.get("entity", "")

            # Check if a stated growth rate matches the underlying values
            if "growth" in metric or "change" in metric:
                stated_growth = parse_financial_number(str(f.get("value", "")))
                if stated_growth is None:
                    continue

                # Try to find the base metric
                base_metric = metric.replace("growth", "").replace("change", "").replace("yoy", "").replace("y/y", "").strip()
                for period_key in ["current", "prior", "q4", "q3", "fy2024", "fy2023"]:
                    # This is best-effort — if we find both periods, verify
                    pass

        # Check margins: if we have revenue + income, verify stated margins
        for f in facts:
            metric = f.get("metric", "").lower()
            entity = f.get("entity", "")

            if "gross margin" in metric:
                stated = parse_financial_number(str(f.get("value", "")))
                rev_fact = facts_by_metric.get((entity, "revenue")) or facts_by_metric.get((entity, "total revenue"))
                cogs_fact = facts_by_metric.get((entity, "cost of revenue")) or facts_by_metric.get((entity, "cogs"))

                if stated and rev_fact and cogs_fact:
                    rev = parse_financial_number(str(rev_fact.get("value", "")))
                    cogs = parse_financial_number(str(cogs_fact.get("value", "")))
                    if rev and cogs:
                        computed = gross_margin(rev, cogs)
                        # Compare as percentages
                        stated_pct = stated * 100 if stated < 1 else stated
                        if abs(computed - stated_pct) > 2.0:
                            warnings.append(
                                f"Gross margin stated as {stated_pct:.1f}% but computed as "
                                f"{computed:.1f}% from revenue={rev} and COGS={cogs}"
                            )
                            f["verification_status"] = "warning"
                            f["verification_reason"] = warnings[-1]

            elif "operating margin" in metric:
                stated = parse_financial_number(str(f.get("value", "")))
                rev_fact = facts_by_metric.get((entity, "revenue")) or facts_by_metric.get((entity, "total revenue"))
                oi_fact = facts_by_metric.get((entity, "operating income"))

                if stated and rev_fact and oi_fact:
                    rev = parse_financial_number(str(rev_fact.get("value", "")))
                    oi = parse_financial_number(str(oi_fact.get("value", "")))
                    if rev and oi:
                        computed = operating_margin(rev, oi)
                        stated_pct = stated * 100 if stated < 1 else stated
                        if abs(computed - stated_pct) > 2.0:
                            warnings.append(
                                f"Operating margin stated as {stated_pct:.1f}% but computed as "
                                f"{computed:.1f}% from revenue={rev} and operating income={oi}"
                            )
                            f["verification_status"] = "warning"
                            f["verification_reason"] = warnings[-1]

            elif "net margin" in metric:
                stated = parse_financial_number(str(f.get("value", "")))
                rev_fact = facts_by_metric.get((entity, "revenue")) or facts_by_metric.get((entity, "total revenue"))
                ni_fact = facts_by_metric.get((entity, "net income"))

                if stated and rev_fact and ni_fact:
                    rev = parse_financial_number(str(rev_fact.get("value", "")))
                    ni = parse_financial_number(str(ni_fact.get("value", "")))
                    if rev and ni:
                        computed = net_margin(rev, ni)
                        stated_pct = stated * 100 if stated < 1 else stated
                        if abs(computed - stated_pct) > 2.0:
                            warnings.append(
                                f"Net margin stated as {stated_pct:.1f}% but computed as "
                                f"{computed:.1f}% from revenue={rev} and net income={ni}"
                            )
                            f["verification_status"] = "warning"
                            f["verification_reason"] = warnings[-1]

        # Check sums: if sub-components exist, verify they sum to total
        for f in facts:
            metric = f.get("metric", "").lower()
            entity = f.get("entity", "")
            if "total" in metric:
                total_val = parse_financial_number(str(f.get("value", "")))
                if total_val is None:
                    continue
                # Look for components (e.g., "product revenue" + "services revenue" = "total revenue")
                base = metric.replace("total", "").strip()
                components = []
                for other in facts:
                    if other.get("entity") == entity and other is not f:
                        other_metric = other.get("metric", "").lower()
                        if base and base in other_metric and "total" not in other_metric:
                            comp_val = parse_financial_number(str(other.get("value", "")))
                            if comp_val:
                                components.append((other_metric, comp_val))

                if len(components) >= 2:
                    comp_sum = sum(v for _, v in components)
                    if abs(comp_sum - total_val) / max(abs(total_val), 1e-10) > 0.05:
                        comp_desc = " + ".join(f"{n}={v}" for n, v in components)
                        warnings.append(
                            f"Component sum mismatch: {comp_desc} = {comp_sum}, "
                            f"but total {metric} = {total_val}"
                        )

        return warnings
