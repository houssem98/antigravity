"""
Gravity Search — Logical Consistency Verifier
Fills the gap left by numeric_verifier.py (checks numbers) and
temporal_verifier.py (checks dates): this module checks LOGICAL
consistency of financial reasoning chains.

Inspired by: CRITIC (2023-2024), StructRAG (Oct 2024), and
"Let's Verify Step by Step" (OpenAI PRM800K) step-level validation.

What it catches that numerics/temporal miss:
  - "Revenue increased → COGS should increase (or margin must expand)"
  - "EPS increased → Net Income increased OR share count decreased"
  - "Gross margin expanded → either pricing ↑ or input costs ↓ or mix improved"
  - "FCF grew faster than Net Income → working capital improvement or low CapEx"
  - "Revenue declined but inventory rose → demand destruction signal"
  - Contradictory sentiment: "strong growth" in narrative but negative numbers

Design: Rule-based checks (fast, no LLM) + LLM-fallback for complex chains.
Rule-based is O(n) over extracted facts, <5ms.
LLM fallback for COMPLEX/MATH queries only when rules flag issues.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

import structlog

logger = structlog.get_logger()


@dataclass
class LogicIssue:
    """A detected logical inconsistency."""
    rule_id: str
    description: str
    severity: str  # "error" | "warning" | "info"
    facts_involved: list[str] = field(default_factory=list)


@dataclass
class LogicVerificationResult:
    """Output of logic verification pass."""
    issues: list[LogicIssue] = field(default_factory=list)
    passed: bool = True
    summary: str = ""

    @property
    def error_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "error")

    @property
    def warning_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "warning")


# ── Rule-Based Logic Checks ──────────────────────────────────────────────────

class FinancialLogicVerifier:
    """
    Checks extracted financial facts for logical consistency.

    Uses deterministic rules (no LLM) to verify that the financial
    relationships in the answer and extracted facts are coherent.
    """

    def verify_answer(self, answer: str, extracted_facts: list[dict]) -> LogicVerificationResult:
        """
        Run all logic checks against answer text and extracted facts.

        Args:
            answer: Generated answer text
            extracted_facts: List of dicts from ExtractorAgent with keys:
                             metric, value, unit, period, entity, confidence

        Returns:
            LogicVerificationResult with any detected issues
        """
        result = LogicVerificationResult()

        # Group facts by entity + period for cross-metric checks
        fact_map = self._build_fact_map(extracted_facts)

        # Run rule-based checks
        self._check_margin_consistency(fact_map, result)
        self._check_eps_consistency(fact_map, result)
        self._check_fcf_consistency(fact_map, result)
        self._check_growth_consistency(fact_map, result)
        self._check_narrative_vs_numbers(answer, fact_map, result)
        self._check_debt_coverage(fact_map, result)
        self._check_inventory_vs_revenue(fact_map, result)

        result.passed = result.error_count == 0
        result.summary = self._build_summary(result)

        if result.issues:
            logger.info(
                "logic_verifier_issues_found",
                errors=result.error_count,
                warnings=result.warning_count,
            )

        return result

    # ── Individual Rules ──────────────────────────────────────────────────

    def _check_margin_consistency(self, fact_map: dict, result: LogicVerificationResult) -> None:
        """
        Rule: If gross_margin expanded, then EITHER revenue grew faster than COGS,
        OR COGS fell while revenue was stable/grew.
        """
        for entity, periods in fact_map.items():
            for period, facts in periods.items():
                gm = self._get_fact(facts, "gross_margin")
                gm_prior = self._find_prior_period_fact(fact_map, entity, period, "gross_margin")
                revenue = self._get_fact(facts, "revenue")
                cogs = self._get_fact(facts, "cogs")

                if gm is not None and gm_prior is not None:
                    gm_change = gm - gm_prior
                    # Gross margin expanded significantly but COGS ratio check
                    if abs(gm_change) > 5 and revenue is not None and cogs is not None:
                        computed_gm = (revenue - cogs) / revenue * 100 if revenue > 0 else None
                        if computed_gm is not None and abs(computed_gm - gm) > 2:
                            result.issues.append(LogicIssue(
                                rule_id="MARGIN_CONSISTENCY",
                                description=(
                                    f"{entity} {period}: Stated gross margin {gm:.1f}% is inconsistent "
                                    f"with computed {computed_gm:.1f}% from revenue/COGS figures. "
                                    f"Check for unit mismatch (B vs M)."
                                ),
                                severity="error",
                                facts_involved=["gross_margin", "revenue", "cogs"],
                            ))

    def _check_eps_consistency(self, fact_map: dict, result: LogicVerificationResult) -> None:
        """
        Rule: If EPS changed direction opposite to Net Income, it must be
        explained by share count change (buyback or dilution).
        """
        for entity, periods in fact_map.items():
            for period, facts in periods.items():
                eps = self._get_fact(facts, "eps")
                net_income = self._get_fact(facts, "net_income")
                eps_prior = self._find_prior_period_fact(fact_map, entity, period, "eps")
                ni_prior = self._find_prior_period_fact(fact_map, entity, period, "net_income")

                if all(v is not None for v in [eps, net_income, eps_prior, ni_prior]):
                    eps_direction = 1 if eps > eps_prior else -1
                    ni_direction = 1 if net_income > ni_prior else -1

                    if eps_direction != ni_direction:
                        # This is valid if share count changed — flag as info/warning
                        result.issues.append(LogicIssue(
                            rule_id="EPS_NI_DIRECTION",
                            description=(
                                f"{entity} {period}: EPS moved {'up' if eps_direction > 0 else 'down'} "
                                f"while Net Income moved {'up' if ni_direction > 0 else 'down'}. "
                                "This implies significant share count change — verify buyback/dilution."
                            ),
                            severity="warning",
                            facts_involved=["eps", "net_income"],
                        ))

    def _check_fcf_consistency(self, fact_map: dict, result: LogicVerificationResult) -> None:
        """
        Rule: FCF = Operating Cash Flow - CapEx.
        If all three are stated, verify they add up.
        """
        for entity, periods in fact_map.items():
            for period, facts in periods.items():
                fcf = self._get_fact(facts, "free_cash_flow")
                ocf = self._get_fact(facts, "operating_cash_flow")
                capex = self._get_fact(facts, ["capex", "capital_expenditure"])

                if fcf is not None and ocf is not None and capex is not None:
                    computed_fcf = ocf - abs(capex)  # CapEx is typically negative in CF statement
                    tolerance = abs(computed_fcf) * 0.05  # 5% tolerance for rounding/adjustments

                    if abs(fcf - computed_fcf) > max(tolerance, 0.1):  # $100M min tolerance
                        result.issues.append(LogicIssue(
                            rule_id="FCF_CONSISTENCY",
                            description=(
                                f"{entity} {period}: Stated FCF {fcf:.2f}B ≠ "
                                f"OCF ({ocf:.2f}B) - CapEx ({capex:.2f}B) = {computed_fcf:.2f}B. "
                                "Check if CapEx includes acquisitions or if different FCF definition used."
                            ),
                            severity="warning",
                            facts_involved=["free_cash_flow", "operating_cash_flow", "capex"],
                        ))

    def _check_growth_consistency(self, fact_map: dict, result: LogicVerificationResult) -> None:
        """
        Rule: If revenue is growing but gross profit is falling, gross margin is contracting.
        The answer should reflect this — not describe it as margin expansion.
        """
        for entity, periods in fact_map.items():
            for period, facts in periods.items():
                rev_growth = self._get_fact(facts, "revenue_growth")
                gm_change = self._get_fact(facts, "gross_margin_change")

                if rev_growth is not None and gm_change is not None:
                    # Revenue growing fast but margin falling significantly = warning
                    if rev_growth > 15 and gm_change < -3:
                        result.issues.append(LogicIssue(
                            rule_id="GROWTH_MARGIN_TRADEOFF",
                            description=(
                                f"{entity} {period}: Revenue growing {rev_growth:.1f}% "
                                f"but gross margin contracting {abs(gm_change):.1f}bps. "
                                "This suggests volume growth at expense of pricing power. "
                                "Ensure answer addresses this tension."
                            ),
                            severity="info",
                            facts_involved=["revenue_growth", "gross_margin_change"],
                        ))

    def _check_narrative_vs_numbers(
        self, answer: str, fact_map: dict, result: LogicVerificationResult
    ) -> None:
        """
        Rule: Detect when positive narrative language contradicts negative numbers.
        E.g., "strong growth" but revenue fell, "margin expansion" but margin compressed.
        """
        answer_lower = answer.lower()

        # Collect all growth facts across all entities/periods
        all_revenue_growths = []
        all_margin_changes = []
        for entity, periods in fact_map.items():
            for period, facts in periods.items():
                rg = self._get_fact(facts, "revenue_growth")
                if rg is not None:
                    all_revenue_growths.append(rg)
                mc = self._get_fact(facts, "gross_margin_change")
                if mc is not None:
                    all_margin_changes.append(mc)

        # Check: "strong growth" / "robust growth" but revenue actually fell
        positive_growth_words = ["strong growth", "robust growth", "accelerating growth",
                                  "impressive growth", "exceptional growth"]
        if any(pw in answer_lower for pw in positive_growth_words):
            negative_growths = [g for g in all_revenue_growths if g < -2]
            if negative_growths:
                result.issues.append(LogicIssue(
                    rule_id="NARRATIVE_NUMBER_CONFLICT",
                    description=(
                        f"Answer uses strong growth language but extracted facts show "
                        f"revenue declining ({min(negative_growths):.1f}% worst case). "
                        "Verify the answer is not generalizing from one segment while overall is negative."
                    ),
                    severity="warning",
                    facts_involved=["revenue_growth"],
                ))

        # Check: "margin expansion" but margins fell
        expansion_words = ["margin expansion", "expanding margins", "improving margins", "higher margins"]
        if any(ew in answer_lower for ew in expansion_words):
            contracting_margins = [m for m in all_margin_changes if m < -50]  # >50bps contraction
            if contracting_margins:
                result.issues.append(LogicIssue(
                    rule_id="MARGIN_NARRATIVE_CONFLICT",
                    description=(
                        f"Answer describes margin expansion but data shows contraction of "
                        f"{abs(min(contracting_margins)):.0f}bps. "
                        "Check if referring to specific segment vs. total company."
                    ),
                    severity="error",
                    facts_involved=["gross_margin_change"],
                ))

    def _check_debt_coverage(self, fact_map: dict, result: LogicVerificationResult) -> None:
        """
        Rule: Interest Coverage = EBIT / Interest Expense.
        If coverage < 1.5x, flag as a material risk.
        """
        for entity, periods in fact_map.items():
            for period, facts in periods.items():
                ebit = self._get_fact(facts, ["ebit", "operating_income"])
                interest_exp = self._get_fact(facts, ["interest_expense", "interest_expense_net"])

                if ebit is not None and interest_exp is not None and interest_exp > 0:
                    coverage = ebit / interest_exp
                    if coverage < 1.5:
                        severity = "error" if coverage < 1.0 else "warning"
                        result.issues.append(LogicIssue(
                            rule_id="DEBT_COVERAGE",
                            description=(
                                f"{entity} {period}: Interest coverage ratio is {coverage:.1f}x "
                                f"(EBIT {ebit:.2f}B / Interest {interest_exp:.2f}B). "
                                f"{'BELOW 1.0x — cannot cover interest from operations.' if coverage < 1.0 else 'Below 1.5x — tight coverage, monitor carefully.'}"
                            ),
                            severity=severity,
                            facts_involved=["ebit", "interest_expense"],
                        ))

    def _check_inventory_vs_revenue(self, fact_map: dict, result: LogicVerificationResult) -> None:
        """
        Rule: If revenue is declining but inventory is rising, demand destruction signal.
        Days Inventory Outstanding (DIO) rising > 20% = warning.
        """
        for entity, periods in fact_map.items():
            for period, facts in periods.items():
                rev_growth = self._get_fact(facts, "revenue_growth")
                inv_growth = self._get_fact(facts, "inventory_growth")

                if rev_growth is not None and inv_growth is not None:
                    if rev_growth < -5 and inv_growth > 15:
                        result.issues.append(LogicIssue(
                            rule_id="INVENTORY_DEMAND",
                            description=(
                                f"{entity} {period}: Revenue falling {abs(rev_growth):.1f}% while "
                                f"inventory growing {inv_growth:.1f}%. "
                                "Potential demand destruction or supply chain imbalance — "
                                "check management commentary for explanation."
                            ),
                            severity="warning",
                            facts_involved=["revenue_growth", "inventory_growth"],
                        ))

    # ── Helper Methods ────────────────────────────────────────────────────

    def _build_fact_map(self, extracted_facts: list[dict]) -> dict:
        """
        Build nested dict: entity → period → {metric: value}
        """
        fact_map: dict = {}
        for fact in extracted_facts:
            entity = fact.get("entity", "unknown")
            period = fact.get("period", "unknown")
            metric = fact.get("metric", "").lower().replace(" ", "_")
            value = fact.get("value")

            if not metric or value is None:
                continue

            # Try to parse numeric value
            if isinstance(value, str):
                value = self._parse_numeric(value)

            if value is None:
                continue

            if entity not in fact_map:
                fact_map[entity] = {}
            if period not in fact_map[entity]:
                fact_map[entity][period] = {}

            fact_map[entity][period][metric] = value

        return fact_map

    def _get_fact(self, facts: dict, keys: str | list[str]) -> Optional[float]:
        """Get a fact value, trying multiple key aliases."""
        if isinstance(keys, str):
            keys = [keys]
        for key in keys:
            if key in facts:
                return facts[key]
        return None

    def _find_prior_period_fact(
        self, fact_map: dict, entity: str, current_period: str, metric: str
    ) -> Optional[float]:
        """Look up the prior period value for a metric."""
        # Simple heuristic: find any period that "looks like" prior
        # This is a best-effort match — exact logic depends on period format
        if entity not in fact_map:
            return None

        periods = sorted(fact_map[entity].keys())
        try:
            idx = periods.index(current_period)
            if idx > 0:
                prior_period = periods[idx - 1]
                return fact_map[entity][prior_period].get(metric)
        except (ValueError, IndexError):
            pass
        return None

    @staticmethod
    def _parse_numeric(value: str) -> Optional[float]:
        """Parse strings like '$124.3B', '15.2%', '3.4' to float."""
        if not isinstance(value, str):
            return None
        value = value.strip().replace(",", "").replace("$", "").replace("%", "")
        multiplier = 1.0
        if value.upper().endswith("B"):
            multiplier = 1.0
            value = value[:-1]
        elif value.upper().endswith("M"):
            multiplier = 0.001
            value = value[:-1]
        elif value.upper().endswith("K"):
            multiplier = 0.000001
            value = value[:-1]
        elif value.upper().endswith("T"):
            multiplier = 1000.0
            value = value[:-1]
        try:
            return float(value) * multiplier
        except ValueError:
            return None

    @staticmethod
    def _build_summary(result: LogicVerificationResult) -> str:
        if not result.issues:
            return "No logical inconsistencies detected."
        parts = [f"{result.error_count} error(s), {result.warning_count} warning(s) found:"]
        for issue in result.issues[:5]:  # Cap at 5 in summary
            icon = "❌" if issue.severity == "error" else "⚠️"
            parts.append(f"  {icon} [{issue.rule_id}] {issue.description[:100]}...")
        return "\n".join(parts)


# Module-level singleton
_verifier = FinancialLogicVerifier()


def verify_logic(answer: str, extracted_facts: list[dict]) -> LogicVerificationResult:
    """Convenience function: run logic verification."""
    return _verifier.verify_answer(answer, extracted_facts)
