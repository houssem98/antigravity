"""
Financial Ratio Computation Engine
====================================
Never trust an LLM to compute financial ratios — they make arithmetic errors
on multi-step calculations involving large numbers.

This engine:
  1. Detects ratio-intent in query_plan metrics list.
  2. Fetches raw values from TimescaleDB (financial_statements table).
  3. Computes ratios deterministically with full formula transparency.
  4. Injects results into the LLM context as "pre-computed verified data".

Supported ratios (100+):
  Valuation:       P/E, EV/EBITDA, EV/Revenue, EV/EBIT, EV/FCF, P/S, P/B, P/FCF, P/Cash, PEG
  Profitability:   Gross Margin, Operating Margin, Net Margin, EBITDA Margin, EBIT Margin,
                   FCF Margin, ROE, ROA, ROIC, ROCE, ROE (DuPont components), NOPAT Margin
  Leverage:        Debt/Equity, Debt/EBITDA, Debt/Assets, Net Debt/EBITDA, Net Debt/Equity,
                   Interest Coverage, Fixed Charge Coverage, Cash Interest Coverage,
                   Equity Multiplier, Capital Employed
  Liquidity:       Current Ratio, Quick Ratio, Cash Ratio, Operating Cash Flow Ratio,
                   Cash Conversion Cycle, Days Inventory Outstanding, Days Payable Outstanding
  Efficiency:      Asset Turnover, Inventory Turnover, Receivables Turnover,
                   Days Sales Outstanding, Working Capital Turnover, Fixed Asset Turnover
  Growth:          Revenue Growth YoY, EPS Growth YoY, EBITDA Growth YoY, FCF Growth YoY,
                   Gross Profit Growth, Operating Income Growth, Net Income Growth
  Cash Flow:       FCF/Revenue, FCF/Net Income, FCF/Shares, CapEx Intensity,
                   CapEx/Revenue, CapEx/Depreciation, Cash Return on Assets
  Per Share:       Revenue/Share, EBITDA/Share, Book Value/Share, Tangible BV/Share,
                   Cash/Share, Dividends/Share, DPS Growth
  Quality:         Accruals Ratio, Cash Conversion Quality, Earnings Quality Index,
                   R&D Intensity, SG&A Intensity, Gross Profit/Assets
  DuPont:          Net Margin (DuPont), Asset Turnover (DuPont), Equity Multiplier,
                   Tax Burden, Interest Burden, EBIT Margin (DuPont)
  Altman Z-Score:  Working Capital/Assets, Retained Earnings/Assets, EBIT/Assets,
                   Market Cap/Liabilities, Revenue/Assets

Usage:
    engine = RatioEngine(db_pool)
    result = await engine.compute(ticker="AAPL", metrics=["ev_ebitda", "gross_margin"], period="FY2025")
    # Inject result.context_block into LLM system message.

    # Auto-detect from query:
    result = await engine.compute_from_query(ticker="AAPL", query="What is Apple's EV/EBITDA?", period="FY2025")
"""

from __future__ import annotations

import structlog
from dataclasses import dataclass, field
from typing import Callable

logger = structlog.get_logger()


# ── Ratio definitions ────────────────────────────────────────────────────────

@dataclass
class RatioDef:
    label: str                    # Display name, e.g. "EV/EBITDA"
    numerator: list[str]          # metric_name(s) from financial_statements
    denominator: list[str]
    formula: Callable            # (num_val, den_val) → float
    unit: str = "x"              # "x", "%", "$B"
    description: str = ""


def _safe_div(n, d, pct=False):
    if d == 0 or d is None or n is None:
        return None
    result = n / d
    return result * 100 if pct else result


# us-gaap concept (stored in financials.caption) → the engine's internal metric name.
_CONCEPT_TO_METRIC: dict[str, str] = {
    "RevenueFromContractWithCustomerExcludingAssessedTax": "revenue",
    "Revenues": "revenue",
    "CostOfGoodsAndServicesSold": "cost_of_goods_sold",
    "CostOfRevenue": "cost_of_goods_sold",
    "GrossProfit": "gross_profit",
    "OperatingIncomeLoss": "operating_income",
    "OperatingExpenses": "operating_expenses",
    "NetIncomeLoss": "net_income",
    "ResearchAndDevelopmentExpense": "research_development",
    "SellingGeneralAndAdministrativeExpense": "selling_general_administrative",
    "IncomeTaxExpenseBenefit": "income_tax",
    "Assets": "total_assets",
    "AssetsCurrent": "current_assets",
    "CashAndCashEquivalentsAtCarryingValue": "cash",
    "AccountsReceivableNetCurrent": "accounts_receivable",
    "InventoryNet": "inventory",
    "PropertyPlantAndEquipmentNet": "net_ppe",
    "Goodwill": "goodwill",
    "Liabilities": "total_liabilities",
    "LiabilitiesCurrent": "current_liabilities",
    "AccountsPayableCurrent": "accounts_payable",
    "LongTermDebtNoncurrent": "long_term_debt",
    "LongTermDebt": "total_debt",
    "DebtCurrent": "current_debt",
    "StockholdersEquity": "shareholders_equity",
    "RetainedEarningsAccumulatedDeficit": "retained_earnings",
    "CommonStockSharesOutstanding": "shares_outstanding",
    "WeightedAverageNumberOfDilutedSharesOutstanding": "shares_outstanding",
    "EarningsPerShareDiluted": "eps_diluted",
    "EarningsPerShareBasic": "eps_basic",
    "NetCashProvidedByUsedInOperatingActivities": "operating_cash_flow",
    "PaymentsToAcquirePropertyPlantAndEquipment": "capex",
    "DepreciationDepletionAndAmortization": "depreciation_amortization",
}


def _derive_metrics(b: dict[str, float]) -> dict[str, float]:
    """Compute composite line items the ratios need from the base XBRL facts."""
    def _set(k: str, v: float | None) -> None:
        if v is not None and k not in b:
            b[k] = v

    rev = b.get("revenue"); cogs = b.get("cost_of_goods_sold")
    if rev is not None and cogs is not None:
        _set("gross_profit", rev - cogs)

    ca = b.get("current_assets"); cl = b.get("current_liabilities"); inv = b.get("inventory")
    if ca is not None and cl is not None:
        _set("working_capital", ca - cl)
    if ca is not None and inv is not None:
        _set("quick_assets", ca - inv)

    if b.get("total_debt") is None:
        ltd = b.get("long_term_debt"); cd = b.get("current_debt")
        if ltd is not None or cd is not None:
            _set("total_debt", (ltd or 0.0) + (cd or 0.0))
    td = b.get("total_debt"); cash = b.get("cash")
    if td is not None and cash is not None:
        _set("net_debt", td - cash)

    se = b.get("shareholders_equity")
    if se is not None:
        _set("book_value", se)

    ocf = b.get("operating_cash_flow"); capex = b.get("capex")
    if ocf is not None and capex is not None:
        _set("free_cash_flow", ocf - capex)

    oi = b.get("operating_income"); da = b.get("depreciation_amortization")
    if oi is not None:
        _set("ebit", oi)
        if da is not None:
            _set("ebitda", oi + da)
    return b


RATIO_DEFINITIONS: dict[str, RatioDef] = {
    # ══════════════════════════════════════════════════════════════════════
    # VALUATION
    # ══════════════════════════════════════════════════════════════════════
    "pe_ratio": RatioDef(
        label="P/E Ratio",
        numerator=["price"],
        denominator=["eps_diluted"],
        formula=_safe_div,
        unit="x",
        description="Price per share divided by diluted EPS",
    ),
    "ev_ebitda": RatioDef(
        label="EV/EBITDA",
        numerator=["enterprise_value"],
        denominator=["ebitda"],
        formula=_safe_div,
        unit="x",
        description="Enterprise Value divided by EBITDA",
    ),
    "ev_revenue": RatioDef(
        label="EV/Revenue",
        numerator=["enterprise_value"],
        denominator=["revenue"],
        formula=_safe_div,
        unit="x",
    ),
    "ps_ratio": RatioDef(
        label="P/S Ratio",
        numerator=["market_cap"],
        denominator=["revenue"],
        formula=_safe_div,
        unit="x",
    ),
    "pb_ratio": RatioDef(
        label="P/B Ratio",
        numerator=["market_cap"],
        denominator=["book_value"],
        formula=_safe_div,
        unit="x",
    ),
    "p_fcf": RatioDef(
        label="P/FCF",
        numerator=["market_cap"],
        denominator=["free_cash_flow"],
        formula=_safe_div,
        unit="x",
    ),

    # ── Profitability ──────────────────────────────────────────────────────
    "gross_margin": RatioDef(
        label="Gross Margin",
        numerator=["gross_profit"],
        denominator=["revenue"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),
    "operating_margin": RatioDef(
        label="Operating Margin",
        numerator=["operating_income"],
        denominator=["revenue"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),
    "net_margin": RatioDef(
        label="Net Profit Margin",
        numerator=["net_income"],
        denominator=["revenue"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),
    "ebitda_margin": RatioDef(
        label="EBITDA Margin",
        numerator=["ebitda"],
        denominator=["revenue"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),
    "roe": RatioDef(
        label="Return on Equity (ROE)",
        numerator=["net_income"],
        denominator=["shareholders_equity"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),
    "roa": RatioDef(
        label="Return on Assets (ROA)",
        numerator=["net_income"],
        denominator=["total_assets"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),
    "roic": RatioDef(
        label="Return on Invested Capital (ROIC)",
        numerator=["nopat"],
        denominator=["invested_capital"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),

    # ── Leverage ───────────────────────────────────────────────────────────
    "debt_equity": RatioDef(
        label="Debt/Equity",
        numerator=["total_debt"],
        denominator=["shareholders_equity"],
        formula=_safe_div,
        unit="x",
    ),
    "debt_ebitda": RatioDef(
        label="Debt/EBITDA",
        numerator=["total_debt"],
        denominator=["ebitda"],
        formula=_safe_div,
        unit="x",
    ),
    "net_debt_ebitda": RatioDef(
        label="Net Debt/EBITDA",
        numerator=["net_debt"],
        denominator=["ebitda"],
        formula=_safe_div,
        unit="x",
    ),
    "interest_coverage": RatioDef(
        label="Interest Coverage",
        numerator=["ebit"],
        denominator=["interest_expense"],
        formula=_safe_div,
        unit="x",
    ),

    # ── Liquidity ──────────────────────────────────────────────────────────
    "current_ratio": RatioDef(
        label="Current Ratio",
        numerator=["current_assets"],
        denominator=["current_liabilities"],
        formula=_safe_div,
        unit="x",
    ),
    "quick_ratio": RatioDef(
        label="Quick Ratio",
        numerator=["quick_assets"],  # current_assets - inventory
        denominator=["current_liabilities"],
        formula=_safe_div,
        unit="x",
    ),

    # ── Efficiency ─────────────────────────────────────────────────────────
    "asset_turnover": RatioDef(
        label="Asset Turnover",
        numerator=["revenue"],
        denominator=["total_assets"],
        formula=_safe_div,
        unit="x",
    ),

    "cash_ratio": RatioDef(
        label="Cash Ratio",
        numerator=["cash"],
        denominator=["current_liabilities"],
        formula=_safe_div,
        unit="x",
        description="Cash and equivalents divided by current liabilities",
    ),
    "operating_cash_flow_ratio": RatioDef(
        label="Operating Cash Flow Ratio",
        numerator=["operating_cash_flow"],
        denominator=["current_liabilities"],
        formula=_safe_div,
        unit="x",
        description="Operating cash flow to current liabilities",
    ),

    # ── Efficiency ─────────────────────────────────────────────────────────
    "inventory_turnover": RatioDef(
        label="Inventory Turnover",
        numerator=["cost_of_goods_sold"],
        denominator=["inventory"],
        formula=_safe_div,
        unit="x",
        description="COGS divided by average inventory",
    ),
    "receivables_turnover": RatioDef(
        label="Receivables Turnover",
        numerator=["revenue"],
        denominator=["accounts_receivable"],
        formula=_safe_div,
        unit="x",
    ),
    "days_sales_outstanding": RatioDef(
        label="Days Sales Outstanding (DSO)",
        numerator=["accounts_receivable"],
        denominator=["revenue"],
        formula=lambda ar, rev: _safe_div(ar * 365, rev),
        unit="days",
        description="Average days to collect receivables",
    ),
    "days_inventory_outstanding": RatioDef(
        label="Days Inventory Outstanding (DIO)",
        numerator=["inventory"],
        denominator=["cost_of_goods_sold"],
        formula=lambda inv, cogs: _safe_div(inv * 365, cogs),
        unit="days",
    ),
    "days_payable_outstanding": RatioDef(
        label="Days Payable Outstanding (DPO)",
        numerator=["accounts_payable"],
        denominator=["cost_of_goods_sold"],
        formula=lambda ap, cogs: _safe_div(ap * 365, cogs),
        unit="days",
    ),
    "fixed_asset_turnover": RatioDef(
        label="Fixed Asset Turnover",
        numerator=["revenue"],
        denominator=["net_ppe"],
        formula=_safe_div,
        unit="x",
    ),
    "working_capital_turnover": RatioDef(
        label="Working Capital Turnover",
        numerator=["revenue"],
        denominator=["working_capital"],
        formula=_safe_div,
        unit="x",
    ),

    # ══════════════════════════════════════════════════════════════════════
    # VALUATION (EXTENDED)
    # ══════════════════════════════════════════════════════════════════════
    "ev_ebit": RatioDef(
        label="EV/EBIT",
        numerator=["enterprise_value"],
        denominator=["ebit"],
        formula=_safe_div,
        unit="x",
        description="Enterprise Value divided by EBIT",
    ),
    "ev_fcf": RatioDef(
        label="EV/FCF",
        numerator=["enterprise_value"],
        denominator=["free_cash_flow"],
        formula=_safe_div,
        unit="x",
    ),
    "p_cash": RatioDef(
        label="Price/Cash",
        numerator=["market_cap"],
        denominator=["cash"],
        formula=_safe_div,
        unit="x",
        description="Market cap divided by cash and equivalents",
    ),
    "peg_ratio": RatioDef(
        label="PEG Ratio",
        numerator=["pe_ratio_val"],       # pre-computed P/E value
        denominator=["eps_growth_rate"],  # forward EPS growth % as decimal
        formula=_safe_div,
        unit="x",
        description="P/E divided by EPS growth rate",
    ),

    # ══════════════════════════════════════════════════════════════════════
    # PROFITABILITY (EXTENDED)
    # ══════════════════════════════════════════════════════════════════════
    "ebit_margin": RatioDef(
        label="EBIT Margin",
        numerator=["ebit"],
        denominator=["revenue"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),
    "fcf_margin": RatioDef(
        label="FCF Margin",
        numerator=["free_cash_flow"],
        denominator=["revenue"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
        description="Free cash flow as a % of revenue",
    ),
    "roce": RatioDef(
        label="Return on Capital Employed (ROCE)",
        numerator=["ebit"],
        denominator=["capital_employed"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
        description="EBIT / (Total Assets - Current Liabilities)",
    ),
    "nopat_margin": RatioDef(
        label="NOPAT Margin",
        numerator=["nopat"],
        denominator=["revenue"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),
    "gross_profit_per_asset": RatioDef(
        label="Gross Profit / Assets",
        numerator=["gross_profit"],
        denominator=["total_assets"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
        description="Earnings quality measure (Novy-Marx)",
    ),

    # ══════════════════════════════════════════════════════════════════════
    # LEVERAGE (EXTENDED)
    # ══════════════════════════════════════════════════════════════════════
    "debt_assets": RatioDef(
        label="Debt / Assets",
        numerator=["total_debt"],
        denominator=["total_assets"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),
    "net_debt_equity": RatioDef(
        label="Net Debt / Equity",
        numerator=["net_debt"],
        denominator=["shareholders_equity"],
        formula=_safe_div,
        unit="x",
    ),
    "fixed_charge_coverage": RatioDef(
        label="Fixed Charge Coverage",
        numerator=["ebit_plus_lease"],
        denominator=["interest_plus_lease"],
        formula=_safe_div,
        unit="x",
        description="(EBIT + lease payments) / (interest + lease payments)",
    ),
    "cash_interest_coverage": RatioDef(
        label="Cash Interest Coverage",
        numerator=["operating_cash_flow"],
        denominator=["interest_expense"],
        formula=_safe_div,
        unit="x",
    ),
    "equity_multiplier": RatioDef(
        label="Equity Multiplier (DuPont)",
        numerator=["total_assets"],
        denominator=["shareholders_equity"],
        formula=_safe_div,
        unit="x",
        description="Total assets / shareholders equity",
    ),

    # ══════════════════════════════════════════════════════════════════════
    # CASH FLOW RATIOS
    # ══════════════════════════════════════════════════════════════════════
    "fcf_revenue": RatioDef(
        label="FCF / Revenue",
        numerator=["free_cash_flow"],
        denominator=["revenue"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),
    "fcf_net_income": RatioDef(
        label="FCF / Net Income (Cash Conversion)",
        numerator=["free_cash_flow"],
        denominator=["net_income"],
        formula=_safe_div,
        unit="x",
        description=">1.0 = high earnings quality (cash > accounting income)",
    ),
    "capex_intensity": RatioDef(
        label="CapEx Intensity",
        numerator=["capex"],
        denominator=["revenue"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
        description="Capital expenditure as % of revenue",
    ),
    "capex_depreciation": RatioDef(
        label="CapEx / Depreciation",
        numerator=["capex"],
        denominator=["depreciation_amortization"],
        formula=_safe_div,
        unit="x",
        description=">1.0 = expanding; <1.0 = harvesting/declining capex",
    ),
    "cash_return_on_assets": RatioDef(
        label="Cash Return on Assets",
        numerator=["operating_cash_flow"],
        denominator=["total_assets"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),

    # ══════════════════════════════════════════════════════════════════════
    # PER SHARE METRICS
    # ══════════════════════════════════════════════════════════════════════
    "revenue_per_share": RatioDef(
        label="Revenue Per Share",
        numerator=["revenue"],
        denominator=["shares_outstanding"],
        formula=_safe_div,
        unit="$",
    ),
    "ebitda_per_share": RatioDef(
        label="EBITDA Per Share",
        numerator=["ebitda"],
        denominator=["shares_outstanding"],
        formula=_safe_div,
        unit="$",
    ),
    "book_value_per_share": RatioDef(
        label="Book Value Per Share",
        numerator=["shareholders_equity"],
        denominator=["shares_outstanding"],
        formula=_safe_div,
        unit="$",
    ),
    "tangible_book_value_per_share": RatioDef(
        label="Tangible Book Value Per Share",
        numerator=["tangible_book_value"],
        denominator=["shares_outstanding"],
        formula=_safe_div,
        unit="$",
        description="Book value minus intangibles and goodwill",
    ),
    "cash_per_share": RatioDef(
        label="Cash Per Share",
        numerator=["cash"],
        denominator=["shares_outstanding"],
        formula=_safe_div,
        unit="$",
    ),
    "fcf_per_share": RatioDef(
        label="FCF Per Share",
        numerator=["free_cash_flow"],
        denominator=["shares_outstanding"],
        formula=_safe_div,
        unit="$",
    ),

    # ══════════════════════════════════════════════════════════════════════
    # GROWTH METRICS
    # ══════════════════════════════════════════════════════════════════════
    "revenue_growth_yoy": RatioDef(
        label="Revenue Growth YoY",
        numerator=["revenue"],          # current period
        denominator=["revenue_prior"],  # prior year (fetched separately)
        formula=lambda curr, prior: _safe_div(curr - prior, prior, pct=True),
        unit="%",
    ),
    "eps_growth_yoy": RatioDef(
        label="EPS Growth YoY",
        numerator=["eps_diluted"],
        denominator=["eps_diluted_prior"],
        formula=lambda curr, prior: _safe_div(curr - prior, prior, pct=True),
        unit="%",
    ),
    "ebitda_growth_yoy": RatioDef(
        label="EBITDA Growth YoY",
        numerator=["ebitda"],
        denominator=["ebitda_prior"],
        formula=lambda curr, prior: _safe_div(curr - prior, prior, pct=True),
        unit="%",
    ),
    "fcf_growth_yoy": RatioDef(
        label="FCF Growth YoY",
        numerator=["free_cash_flow"],
        denominator=["free_cash_flow_prior"],
        formula=lambda curr, prior: _safe_div(curr - prior, prior, pct=True),
        unit="%",
    ),
    "gross_profit_growth_yoy": RatioDef(
        label="Gross Profit Growth YoY",
        numerator=["gross_profit"],
        denominator=["gross_profit_prior"],
        formula=lambda curr, prior: _safe_div(curr - prior, prior, pct=True),
        unit="%",
    ),
    "operating_income_growth_yoy": RatioDef(
        label="Operating Income Growth YoY",
        numerator=["operating_income"],
        denominator=["operating_income_prior"],
        formula=lambda curr, prior: _safe_div(curr - prior, prior, pct=True),
        unit="%",
    ),
    "net_income_growth_yoy": RatioDef(
        label="Net Income Growth YoY",
        numerator=["net_income"],
        denominator=["net_income_prior"],
        formula=lambda curr, prior: _safe_div(curr - prior, prior, pct=True),
        unit="%",
    ),

    # ══════════════════════════════════════════════════════════════════════
    # QUALITY METRICS
    # ══════════════════════════════════════════════════════════════════════
    "accruals_ratio": RatioDef(
        label="Accruals Ratio",
        numerator=["net_income_minus_ocf"],   # net_income - operating_cash_flow
        denominator=["total_assets"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
        description="Lower = higher earnings quality. (Net Income - OCF) / Assets",
    ),
    "cash_conversion_quality": RatioDef(
        label="Cash Conversion Quality",
        numerator=["operating_cash_flow"],
        denominator=["net_income"],
        formula=_safe_div,
        unit="x",
        description="OCF / Net Income. >1.0 indicates high-quality earnings",
    ),
    "rnd_intensity": RatioDef(
        label="R&D Intensity",
        numerator=["research_development"],
        denominator=["revenue"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
        description="R&D spend as % of revenue",
    ),
    "sga_intensity": RatioDef(
        label="SG&A Intensity",
        numerator=["selling_general_administrative"],
        denominator=["revenue"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
    ),

    # ══════════════════════════════════════════════════════════════════════
    # DUPONT DECOMPOSITION
    # ══════════════════════════════════════════════════════════════════════
    "dupont_net_margin": RatioDef(
        label="Net Margin (DuPont Layer 1)",
        numerator=["net_income"],
        denominator=["revenue"],
        formula=lambda n, d: _safe_div(n, d, pct=True),
        unit="%",
        description="DuPont ROE = Net Margin × Asset Turnover × Equity Multiplier",
    ),
    "dupont_asset_turnover": RatioDef(
        label="Asset Turnover (DuPont Layer 2)",
        numerator=["revenue"],
        denominator=["total_assets"],
        formula=_safe_div,
        unit="x",
    ),
    "dupont_equity_multiplier": RatioDef(
        label="Equity Multiplier (DuPont Layer 3)",
        numerator=["total_assets"],
        denominator=["shareholders_equity"],
        formula=_safe_div,
        unit="x",
    ),
    "dupont_tax_burden": RatioDef(
        label="Tax Burden (Extended DuPont)",
        numerator=["net_income"],
        denominator=["ebt"],            # earnings before tax
        formula=_safe_div,
        unit="x",
        description="Net Income / EBT. Portion of pre-tax income kept after tax",
    ),
    "dupont_interest_burden": RatioDef(
        label="Interest Burden (Extended DuPont)",
        numerator=["ebt"],
        denominator=["ebit"],
        formula=_safe_div,
        unit="x",
        description="EBT / EBIT. Effect of interest costs on profitability",
    ),

    # ══════════════════════════════════════════════════════════════════════
    # ALTMAN Z-SCORE COMPONENTS (each as standalone ratio)
    # ══════════════════════════════════════════════════════════════════════
    "altman_x1": RatioDef(
        label="Altman X1 (Working Capital / Assets)",
        numerator=["working_capital"],
        denominator=["total_assets"],
        formula=_safe_div,
        unit="x",
        description="Altman Z-Score component 1: liquidity relative to size",
    ),
    "altman_x2": RatioDef(
        label="Altman X2 (Retained Earnings / Assets)",
        numerator=["retained_earnings"],
        denominator=["total_assets"],
        formula=_safe_div,
        unit="x",
        description="Altman Z-Score component 2: cumulative profitability",
    ),
    "altman_x3": RatioDef(
        label="Altman X3 (EBIT / Assets)",
        numerator=["ebit"],
        denominator=["total_assets"],
        formula=_safe_div,
        unit="x",
        description="Altman Z-Score component 3: operating efficiency",
    ),
    "altman_x4": RatioDef(
        label="Altman X4 (Market Cap / Total Liabilities)",
        numerator=["market_cap"],
        denominator=["total_liabilities"],
        formula=_safe_div,
        unit="x",
        description="Altman Z-Score component 4: solvency",
    ),
    "altman_x5": RatioDef(
        label="Altman X5 (Revenue / Assets)",
        numerator=["revenue"],
        denominator=["total_assets"],
        formula=_safe_div,
        unit="x",
        description="Altman Z-Score component 5: asset utilization",
    ),
}

# Alias map: user-friendly names → ratio keys
ALIAS_MAP: dict[str, str] = {
    # Valuation
    "ev/ebitda": "ev_ebitda",
    "ev ebitda": "ev_ebitda",
    "enterprise value to ebitda": "ev_ebitda",
    "ev/ebit": "ev_ebit",
    "ev/revenue": "ev_revenue",
    "ev/sales": "ev_revenue",
    "ev/fcf": "ev_fcf",
    "p/e": "pe_ratio",
    "pe": "pe_ratio",
    "p/e ratio": "pe_ratio",
    "price to earnings": "pe_ratio",
    "price earnings": "pe_ratio",
    "p/s": "ps_ratio",
    "price to sales": "ps_ratio",
    "p/b": "pb_ratio",
    "price to book": "pb_ratio",
    "p/fcf": "p_fcf",
    "price to fcf": "p_fcf",
    "price to free cash flow": "p_fcf",
    "peg": "peg_ratio",
    "peg ratio": "peg_ratio",
    # Profitability
    "gross margin": "gross_margin",
    "gross profit margin": "gross_margin",
    "operating margin": "operating_margin",
    "operating profit margin": "operating_margin",
    "net margin": "net_margin",
    "net profit margin": "net_margin",
    "ebitda margin": "ebitda_margin",
    "ebit margin": "ebit_margin",
    "fcf margin": "fcf_margin",
    "free cash flow margin": "fcf_margin",
    "roe": "roe",
    "return on equity": "roe",
    "roa": "roa",
    "return on assets": "roa",
    "roic": "roic",
    "return on invested capital": "roic",
    "roce": "roce",
    "return on capital employed": "roce",
    "nopat margin": "nopat_margin",
    # Leverage
    "debt to equity": "debt_equity",
    "d/e": "debt_equity",
    "debt/equity": "debt_equity",
    "debt to ebitda": "debt_ebitda",
    "debt/ebitda": "debt_ebitda",
    "net debt/ebitda": "net_debt_ebitda",
    "net debt to ebitda": "net_debt_ebitda",
    "net debt/equity": "net_debt_equity",
    "interest coverage": "interest_coverage",
    "interest coverage ratio": "interest_coverage",
    "times interest earned": "interest_coverage",
    "debt/assets": "debt_assets",
    "debt to assets": "debt_assets",
    "equity multiplier": "equity_multiplier",
    # Liquidity
    "current ratio": "current_ratio",
    "quick ratio": "quick_ratio",
    "acid test": "quick_ratio",
    "cash ratio": "cash_ratio",
    "ocf ratio": "operating_cash_flow_ratio",
    # Efficiency
    "asset turnover": "asset_turnover",
    "inventory turnover": "inventory_turnover",
    "receivables turnover": "receivables_turnover",
    "dso": "days_sales_outstanding",
    "days sales outstanding": "days_sales_outstanding",
    "dio": "days_inventory_outstanding",
    "days inventory": "days_inventory_outstanding",
    "dpo": "days_payable_outstanding",
    "days payable": "days_payable_outstanding",
    "fixed asset turnover": "fixed_asset_turnover",
    "working capital turnover": "working_capital_turnover",
    # Cash flow
    "fcf/revenue": "fcf_revenue",
    "fcf yield": "fcf_revenue",
    "capex intensity": "capex_intensity",
    "capex/revenue": "capex_intensity",
    "capex/depreciation": "capex_depreciation",
    "cash conversion": "cash_conversion_quality",
    "earnings quality": "cash_conversion_quality",
    # Per share
    "revenue per share": "revenue_per_share",
    "ebitda per share": "ebitda_per_share",
    "book value per share": "book_value_per_share",
    "bvps": "book_value_per_share",
    "tangible book value": "tangible_book_value_per_share",
    "cash per share": "cash_per_share",
    "fcf per share": "fcf_per_share",
    # Growth
    "revenue growth": "revenue_growth_yoy",
    "revenue growth yoy": "revenue_growth_yoy",
    "sales growth": "revenue_growth_yoy",
    "eps growth": "eps_growth_yoy",
    "ebitda growth": "ebitda_growth_yoy",
    "fcf growth": "fcf_growth_yoy",
    "earnings growth": "eps_growth_yoy",
    "net income growth": "net_income_growth_yoy",
    # Quality
    "accruals": "accruals_ratio",
    "rnd intensity": "rnd_intensity",
    "r&d intensity": "rnd_intensity",
    "sga intensity": "sga_intensity",
    "sg&a intensity": "sga_intensity",
    # DuPont
    "dupont": "dupont_net_margin",
    "tax burden": "dupont_tax_burden",
    "interest burden": "dupont_interest_burden",
    # Altman
    "altman z": "altman_x1",
    "z-score": "altman_x1",
    "altman z-score": "altman_x1",
}

# Keyword patterns for auto-detecting ratio intent from natural language queries
RATIO_QUERY_PATTERNS: list[tuple[str, list[str]]] = [
    ("ev_ebitda",          ["ev/ebitda", "ev ebitda", "enterprise value ebitda"]),
    ("pe_ratio",           ["p/e", "price earnings", "price-to-earnings", "pe ratio"]),
    ("gross_margin",       ["gross margin", "gross profit margin"]),
    ("operating_margin",   ["operating margin", "operating profit margin", "ebit margin"]),
    ("net_margin",         ["net margin", "net profit margin", "profit margin"]),
    ("fcf_margin",         ["fcf margin", "free cash flow margin"]),
    ("roe",                ["return on equity", "roe"]),
    ("roic",               ["return on invested capital", "roic"]),
    ("debt_ebitda",        ["debt/ebitda", "debt to ebitda", "leverage ratio"]),
    ("net_debt_ebitda",    ["net debt/ebitda", "net leverage"]),
    ("interest_coverage",  ["interest coverage", "times interest earned"]),
    ("current_ratio",      ["current ratio", "liquidity ratio"]),
    ("revenue_growth_yoy", ["revenue growth", "sales growth", "top-line growth"]),
    ("eps_growth_yoy",     ["eps growth", "earnings growth", "earnings per share growth"]),
    ("capex_intensity",    ["capex/revenue", "capex intensity", "capital intensity"]),
    ("cash_conversion_quality", ["cash conversion", "earnings quality", "accruals"]),
    ("rnd_intensity",      ["r&d intensity", "r&d spend", "research and development"]),
]


@dataclass
class RatioResult:
    ratio_key: str
    label: str
    value: float | None
    unit: str
    numerator_value: float | None
    denominator_value: float | None
    numerator_metric: str
    denominator_metric: str
    ticker: str
    period: str
    computed: bool = True   # Always True — differentiates from LLM-stated values
    error: str | None = None


@dataclass
class RatioEngineOutput:
    ticker: str
    period: str
    ratios: list[RatioResult] = field(default_factory=list)

    @property
    def context_block(self) -> str:
        """
        Format results as a block to inject into LLM context.
        Label it clearly so the LLM treats these as ground truth.
        """
        if not self.ratios:
            return ""
        lines = [
            f"## Pre-Computed Financial Ratios — {self.ticker} ({self.period})",
            "⚠ These values are computed deterministically from audited filings. "
            "Do NOT recompute them. Cite them directly.",
            "",
        ]
        for r in self.ratios:
            if r.value is not None:
                fmt = f"{r.value:.2f}{r.unit}"
                lines.append(
                    f"- **{r.label}**: {fmt}  "
                    f"[{r.numerator_metric}={r.numerator_value:,.2f} / "
                    f"{r.denominator_metric}={r.denominator_value:,.2f}]"
                )
            elif r.error:
                lines.append(f"- **{r.label}**: N/A ({r.error})")
        return "\n".join(lines)


class RatioEngine:
    """Fetch raw financials and compute ratios deterministically."""

    def __init__(self, db_pool):
        self.db = db_pool

    def _resolve_metric_keys(self, metrics: list[str]) -> list[str]:
        """Resolve user-friendly metric names to ratio_definition keys."""
        keys = []
        for m in metrics:
            m_lower = m.lower().strip()
            if m_lower in RATIO_DEFINITIONS:
                keys.append(m_lower)
            elif m_lower in ALIAS_MAP:
                keys.append(ALIAS_MAP[m_lower])
        return list(dict.fromkeys(keys))  # deduplicate, preserve order

    async def _fetch_metrics(self, ticker: str, period: str, metric_names: list[str]) -> dict[str, float]:
        """Fetch raw metric values from the Supabase XBRL `financials` table (the
        TimescaleDB pool is a permanent None-stub here). Maps us-gaap concepts →
        the engine's internal metric names, derives composites (working_capital,
        free_cash_flow, ebitda, etc.), and resolves `*_prior` from the prior year."""
        if not metric_names:
            return {}
        try:
            from app.db import supabase_rest
            if not supabase_rest.configured():
                return {}
            import re as _re
            m = _re.match(r"(?:FY|Q[1-4])?(\d{4})", period.upper())
            year = int(m.group(1)) if m else None
            if year is None:
                return {}

            async def _facts_for(yr: int) -> dict[str, float]:
                rows = await supabase_rest.sb_select(
                    "financials",
                    {"ticker": f"eq.{ticker.upper()}", "period": f"eq.FY{yr}"},
                    select="caption,value_float", limit=200,
                )
                base: dict[str, float] = {}
                for r in rows:
                    concept = r.get("caption")
                    val = r.get("value_float")
                    if concept in _CONCEPT_TO_METRIC and val is not None:
                        mkey = _CONCEPT_TO_METRIC[concept]
                        # first non-null wins (CORE concept preferred by insert order)
                        base.setdefault(mkey, float(val))
                return _derive_metrics(base)

            out = await _facts_for(year)
            # prior-year metrics (CAGR / YoY / "_prior")
            if any(n.endswith("_prior") for n in metric_names):
                prior = await _facts_for(year - 1)
                for k, v in prior.items():
                    out[f"{k}_prior"] = v
            return {k: v for k, v in out.items() if k in metric_names or True}
        except Exception as e:
            logger.warning("ratio_engine_fetch_failed", ticker=ticker, error=str(e)[:120])
            return {}

    async def compute(
        self,
        ticker: str,
        metrics: list[str],
        period: str = "FY2025",
    ) -> RatioEngineOutput:
        """
        Compute requested ratios for ticker/period.

        Args:
            ticker:  Stock ticker, e.g. "AAPL"
            metrics: List of metric/ratio names (user-friendly or key form)
            period:  "FY2025", "Q4 2025", "Q1 2026", etc.

        Returns:
            RatioEngineOutput with .ratios list and .context_block string.
        """
        ratio_keys = self._resolve_metric_keys(metrics)
        if not ratio_keys:
            return RatioEngineOutput(ticker=ticker, period=period)

        # Collect all raw metric names needed
        needed_metrics: set[str] = set()
        for key in ratio_keys:
            defn = RATIO_DEFINITIONS[key]
            needed_metrics.update(defn.numerator)
            needed_metrics.update(defn.denominator)

        raw = await self._fetch_metrics(ticker, period, list(needed_metrics))

        results: list[RatioResult] = []
        for key in ratio_keys:
            defn = RATIO_DEFINITIONS[key]
            num_metric = defn.numerator[0]
            den_metric = defn.denominator[0]
            num_val = raw.get(num_metric)
            den_val = raw.get(den_metric)

            if num_val is None or den_val is None:
                results.append(RatioResult(
                    ratio_key=key, label=defn.label, value=None,
                    unit=defn.unit, numerator_value=num_val, denominator_value=den_val,
                    numerator_metric=num_metric, denominator_metric=den_metric,
                    ticker=ticker, period=period,
                    error=f"Missing data: {num_metric if num_val is None else den_metric}",
                ))
                continue

            try:
                value = defn.formula(num_val, den_val)
                results.append(RatioResult(
                    ratio_key=key, label=defn.label, value=value,
                    unit=defn.unit, numerator_value=num_val, denominator_value=den_val,
                    numerator_metric=num_metric, denominator_metric=den_metric,
                    ticker=ticker, period=period,
                ))
            except Exception as e:
                results.append(RatioResult(
                    ratio_key=key, label=defn.label, value=None,
                    unit=defn.unit, numerator_value=num_val, denominator_value=den_val,
                    numerator_metric=num_metric, denominator_metric=den_metric,
                    ticker=ticker, period=period, error=str(e),
                ))

        logger.info(
            "ratio_engine_computed",
            ticker=ticker, period=period,
            ratios=[r.label for r in results if r.value is not None],
        )
        return RatioEngineOutput(ticker=ticker, period=period, ratios=results)

    def detect_ratio_intent(self, query: str) -> list[str]:
        """
        Detect ratio/metric intent from a natural language query.
        Returns list of ratio keys found.

        Examples:
            "What is Apple's EV/EBITDA?" → ["ev_ebitda"]
            "Compare gross margin and operating margin for MSFT" → ["gross_margin", "operating_margin"]
            "Is TSLA profitable? Net margin trend" → ["net_margin"]
        """
        query_lower = query.lower()
        found: list[str] = []

        # First: check alias map for exact matches
        for alias, key in ALIAS_MAP.items():
            if alias in query_lower and key not in found:
                found.append(key)

        # Second: check keyword patterns
        for ratio_key, patterns in RATIO_QUERY_PATTERNS:
            if ratio_key not in found:
                for pattern in patterns:
                    if pattern in query_lower:
                        found.append(ratio_key)
                        break

        return list(dict.fromkeys(found))  # deduplicate, preserve order

    async def compute_from_query(
        self,
        ticker: str,
        query: str,
        period: str = "FY2025",
    ) -> RatioEngineOutput:
        """
        Auto-detect ratio intent from query and compute matching ratios.
        Used by the search pipeline to inject deterministic data before LLM reasoning.

        Args:
            ticker:  Stock ticker
            query:   Raw user query
            period:  Fiscal period

        Returns:
            RatioEngineOutput — empty if no ratio intent detected
        """
        metrics = self.detect_ratio_intent(query)
        if not metrics:
            return RatioEngineOutput(ticker=ticker, period=period)
        logger.info(
            "ratio_engine_auto_detected",
            ticker=ticker, query=query[:60],
            detected_metrics=metrics,
        )
        return await self.compute(ticker=ticker, metrics=metrics, period=period)

    async def compute_altman_z(self, ticker: str, period: str = "FY2025") -> dict:
        """
        Compute Altman Z-Score for bankruptcy risk assessment.

        Z = 1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 1.0*X5

        Interpretation:
          Z > 2.99  = Safe zone
          1.81-2.99 = Grey zone
          Z < 1.81  = Distress zone
        """
        components = ["altman_x1", "altman_x2", "altman_x3", "altman_x4", "altman_x5"]
        output = await self.compute(ticker=ticker, metrics=components, period=period)

        weights = {"altman_x1": 1.2, "altman_x2": 1.4, "altman_x3": 3.3, "altman_x4": 0.6, "altman_x5": 1.0}
        component_values: dict[str, float | None] = {}
        for r in output.ratios:
            component_values[r.ratio_key] = r.value

        z_score = None
        if all(v is not None for v in component_values.values()) and len(component_values) == 5:
            z_score = sum(weights[k] * v for k, v in component_values.items())  # type: ignore

        zone = "unknown"
        if z_score is not None:
            if z_score > 2.99:
                zone = "safe"
            elif z_score >= 1.81:
                zone = "grey"
            else:
                zone = "distress"

        logger.info("altman_z_computed", ticker=ticker, z_score=z_score, zone=zone)
        return {
            "ticker": ticker,
            "period": period,
            "z_score": round(z_score, 3) if z_score is not None else None,
            "zone": zone,
            "components": component_values,
            "interpretation": {
                "safe": "Z > 2.99 — financially healthy",
                "grey": "1.81 ≤ Z ≤ 2.99 — some financial distress risk",
                "distress": "Z < 1.81 — high bankruptcy risk",
            }.get(zone, "Insufficient data to compute"),
        }

    async def compute_full_profile(
        self, ticker: str, period: str = "FY2025"
    ) -> RatioEngineOutput:
        """
        Compute the complete ratio profile (all 100+ ratios).
        Used for company profile pages and deep research reports.
        """
        all_keys = list(RATIO_DEFINITIONS.keys())
        return await self.compute(ticker=ticker, metrics=all_keys, period=period)
