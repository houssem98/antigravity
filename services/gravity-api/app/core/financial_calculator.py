"""
Gravity Search — Financial Calculator Engine
Programmatic financial calculations for FinQA/TAT-QA/BizBench benchmark excellence.

This module gives the pipeline the ability to COMPUTE answers, not just
retrieve and generate them. Financial benchmarks test arithmetic accuracy —
LLMs hallucinate calculations. This engine guarantees correct math.

Supported calculations:
  - Growth rates (YoY, QoQ, CAGR)
  - Margins (gross, operating, net, EBITDA)
  - Ratios (P/E, EV/EBITDA, debt/equity, current ratio)
  - Per-share metrics (EPS, book value, dividends)
  - Aggregations (sum, average, weighted average)
  - Percentage change, difference, ratio
"""

from __future__ import annotations

import re
import math
import structlog
from dataclasses import dataclass, field
from typing import Any

logger = structlog.get_logger()


# ── Value Parsing ────────────────────────────────────────────────────────

def parse_financial_number(text: str) -> float | None:
    """
    Parse a financial number string into a float.
    Handles: $124.3B, (1,234.56), -$45.6M, 12.5%, €100K, ¥1T
    """
    if not text or not text.strip():
        return None

    text = text.strip()

    # Detect negative from parentheses: (123) → -123
    is_negative = text.startswith("(") and text.endswith(")")
    if is_negative:
        text = text[1:-1]

    # Detect negative from minus/dash
    if text.startswith("-") or text.startswith("−"):
        is_negative = True
        text = text[1:]

    # Remove currency symbols and whitespace
    text = re.sub(r"[$€£¥₹\s]", "", text)

    # Extract multiplier suffix
    multiplier = 1.0
    suffix_match = re.search(r"([TtBbMmKk])(?:illion|illion)?$", text)
    if suffix_match:
        suffix = suffix_match.group(1).upper()
        multiplier = {"T": 1e12, "B": 1e9, "M": 1e6, "K": 1e3}.get(suffix, 1.0)
        text = text[:suffix_match.start()]

    # Handle percentage
    is_percent = text.endswith("%")
    if is_percent:
        text = text[:-1]

    # Remove commas
    text = text.replace(",", "")

    try:
        value = float(text) * multiplier
        if is_percent:
            value = value / 100.0  # Convert to decimal
        if is_negative:
            value = -value
        return value
    except (ValueError, TypeError):
        return None


# ── Calculation Functions ────────────────────────────────────────────────

def percentage_change(old: float, new: float) -> float:
    """Calculate percentage change: (new - old) / old × 100."""
    if old == 0:
        return float("inf") if new > 0 else float("-inf") if new < 0 else 0.0
    return ((new - old) / abs(old)) * 100.0


def yoy_growth(current: float, prior_year: float) -> float:
    """Year-over-year growth rate as percentage."""
    return percentage_change(prior_year, current)


def qoq_growth(current: float, prior_quarter: float) -> float:
    """Quarter-over-quarter growth rate as percentage."""
    return percentage_change(prior_quarter, current)


def cagr(beginning: float, ending: float, years: float) -> float:
    """Compound Annual Growth Rate."""
    if beginning <= 0 or ending <= 0 or years <= 0:
        return 0.0
    return ((ending / beginning) ** (1.0 / years) - 1.0) * 100.0


def gross_margin(revenue: float, cogs: float) -> float:
    """Gross margin = (Revenue - COGS) / Revenue × 100."""
    if revenue == 0:
        return 0.0
    return ((revenue - cogs) / revenue) * 100.0


def operating_margin(revenue: float, operating_income: float) -> float:
    """Operating margin = Operating Income / Revenue × 100."""
    if revenue == 0:
        return 0.0
    return (operating_income / revenue) * 100.0


def net_margin(revenue: float, net_income: float) -> float:
    """Net margin = Net Income / Revenue × 100."""
    if revenue == 0:
        return 0.0
    return (net_income / revenue) * 100.0


def ebitda_margin(revenue: float, ebitda: float) -> float:
    """EBITDA margin = EBITDA / Revenue × 100."""
    if revenue == 0:
        return 0.0
    return (ebitda / revenue) * 100.0


def pe_ratio(price: float, eps: float) -> float:
    """Price-to-Earnings ratio = Price / EPS."""
    if eps == 0:
        return float("inf")
    return price / eps


def ev_ebitda(enterprise_value: float, ebitda: float) -> float:
    """EV/EBITDA = Enterprise Value / EBITDA."""
    if ebitda == 0:
        return float("inf")
    return enterprise_value / ebitda


def debt_to_equity(total_debt: float, equity: float) -> float:
    """Debt-to-Equity = Total Debt / Equity."""
    if equity == 0:
        return float("inf")
    return total_debt / equity


def current_ratio(current_assets: float, current_liabilities: float) -> float:
    """Current Ratio = Current Assets / Current Liabilities."""
    if current_liabilities == 0:
        return float("inf")
    return current_assets / current_liabilities


def return_on_equity(net_income: float, avg_equity: float) -> float:
    """ROE = Net Income / Average Equity × 100."""
    if avg_equity == 0:
        return 0.0
    return (net_income / avg_equity) * 100.0


def return_on_assets(net_income: float, avg_assets: float) -> float:
    """ROA = Net Income / Average Assets × 100."""
    if avg_assets == 0:
        return 0.0
    return (net_income / avg_assets) * 100.0


def free_cash_flow(operating_cf: float, capex: float) -> float:
    """FCF = Operating Cash Flow - Capital Expenditures."""
    return operating_cf - abs(capex)


def weighted_average(values: list[float], weights: list[float]) -> float:
    """Weighted average of values."""
    if not values or not weights or len(values) != len(weights):
        return 0.0
    total_weight = sum(weights)
    if total_weight == 0:
        return 0.0
    return sum(v * w for v, w in zip(values, weights)) / total_weight


def eps_diluted(net_income: float, diluted_shares: float) -> float:
    """Diluted EPS = Net Income / Diluted Shares Outstanding."""
    if diluted_shares == 0:
        return 0.0
    return net_income / diluted_shares


# ── Calculation Registry ────────────────────────────────────────────────

CALC_REGISTRY: dict[str, dict] = {
    "percentage_change": {
        "fn": percentage_change,
        "params": ["old", "new"],
        "description": "Calculate percentage change between two values",
    },
    "yoy_growth": {
        "fn": yoy_growth,
        "params": ["current", "prior_year"],
        "description": "Year-over-year growth rate",
    },
    "qoq_growth": {
        "fn": qoq_growth,
        "params": ["current", "prior_quarter"],
        "description": "Quarter-over-quarter growth rate",
    },
    "cagr": {
        "fn": cagr,
        "params": ["beginning", "ending", "years"],
        "description": "Compound annual growth rate",
    },
    "gross_margin": {
        "fn": gross_margin,
        "params": ["revenue", "cogs"],
        "description": "Gross margin percentage",
    },
    "operating_margin": {
        "fn": operating_margin,
        "params": ["revenue", "operating_income"],
        "description": "Operating margin percentage",
    },
    "net_margin": {
        "fn": net_margin,
        "params": ["revenue", "net_income"],
        "description": "Net profit margin percentage",
    },
    "ebitda_margin": {
        "fn": ebitda_margin,
        "params": ["revenue", "ebitda"],
        "description": "EBITDA margin percentage",
    },
    "pe_ratio": {
        "fn": pe_ratio,
        "params": ["price", "eps"],
        "description": "Price to earnings ratio",
    },
    "ev_ebitda": {
        "fn": ev_ebitda,
        "params": ["enterprise_value", "ebitda"],
        "description": "EV/EBITDA valuation ratio",
    },
    "debt_to_equity": {
        "fn": debt_to_equity,
        "params": ["total_debt", "equity"],
        "description": "Debt to equity ratio",
    },
    "current_ratio": {
        "fn": current_ratio,
        "params": ["current_assets", "current_liabilities"],
        "description": "Current ratio (liquidity)",
    },
    "roe": {
        "fn": return_on_equity,
        "params": ["net_income", "avg_equity"],
        "description": "Return on equity percentage",
    },
    "roa": {
        "fn": return_on_assets,
        "params": ["net_income", "avg_assets"],
        "description": "Return on assets percentage",
    },
    "free_cash_flow": {
        "fn": free_cash_flow,
        "params": ["operating_cf", "capex"],
        "description": "Free cash flow calculation",
    },
    "eps_diluted": {
        "fn": eps_diluted,
        "params": ["net_income", "diluted_shares"],
        "description": "Diluted earnings per share",
    },
    "weighted_average": {
        "fn": weighted_average,
        "params": ["values", "weights"],
        "description": "Weighted average of values",
    },
}


def execute_calculation(calc_type: str, params: dict[str, Any]) -> dict:
    """
    Execute a financial calculation by name.

    Args:
        calc_type: Name of the calculation from CALC_REGISTRY
        params: Dictionary of parameter names to values (can be strings)

    Returns:
        {"result": float, "formula": str, "calc_type": str}
    """
    entry = CALC_REGISTRY.get(calc_type)
    if not entry:
        return {"error": f"Unknown calculation: {calc_type}", "result": None}

    fn = entry["fn"]
    expected_params = entry["params"]

    # Parse string values to floats
    parsed = {}
    for p in expected_params:
        raw = params.get(p)
        if raw is None:
            return {"error": f"Missing parameter: {p}", "result": None}
        if isinstance(raw, (list, tuple)):
            parsed[p] = [parse_financial_number(str(v)) or 0.0 for v in raw]
        elif isinstance(raw, (int, float)):
            parsed[p] = raw
        else:
            val = parse_financial_number(str(raw))
            if val is None:
                return {"error": f"Cannot parse '{raw}' as number", "result": None}
            parsed[p] = val

    try:
        result = fn(**parsed)
        formula_parts = [f"{k}={v}" for k, v in parsed.items()]
        return {
            "result": round(result, 4),
            "calc_type": calc_type,
            "formula": f"{calc_type}({', '.join(formula_parts)})",
            "description": entry["description"],
        }
    except Exception as e:
        return {"error": str(e), "result": None}


# ── Auto-Detect Calculation from Query ───────────────────────────────────

CALC_PATTERNS = [
    (r"(?:percentage|percent|%)\s*change", "percentage_change"),
    (r"year[- ]over[- ]year|yoy|y/y", "yoy_growth"),
    (r"quarter[- ]over[- ]quarter|qoq|q/q", "qoq_growth"),
    (r"cagr|compound\s+annual\s+growth", "cagr"),
    (r"gross\s+margin", "gross_margin"),
    (r"operating\s+margin", "operating_margin"),
    (r"(?:net\s+)?profit\s+margin|net\s+margin", "net_margin"),
    (r"ebitda\s+margin", "ebitda_margin"),
    (r"p/?e\s+ratio|price[- ](?:to[- ])?earnings", "pe_ratio"),
    (r"ev/?ebitda|enterprise\s+value.*ebitda", "ev_ebitda"),
    (r"debt[- ](?:to[- ])?equity", "debt_to_equity"),
    (r"current\s+ratio", "current_ratio"),
    (r"return\s+on\s+equity|roe\b", "roe"),
    (r"return\s+on\s+assets|roa\b", "roa"),
    (r"free\s+cash\s+flow|fcf\b", "free_cash_flow"),
    (r"(?:diluted\s+)?(?:earnings?\s+per\s+share|eps)", "eps_diluted"),
]


def detect_calculation_type(query: str) -> str | None:
    """Detect if a query requires a specific financial calculation."""
    query_lower = query.lower()
    for pattern, calc_type in CALC_PATTERNS:
        if re.search(pattern, query_lower):
            return calc_type
    return None
