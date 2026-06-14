"""
SEC XBRL exact-facts source.

SEC publishes every public company's XBRL-tagged financials as structured JSON:
  - ticker→CIK map:  https://www.sec.gov/files/company_tickers.json
  - company facts:   https://data.sec.gov/api/xbrl/companyfacts/CIK{10digit}.json

companyfacts gives, per us-gaap concept, every reported value with its period
(start/end), fiscal year (fy), fiscal period (fp), and source form (10-K/10-Q).
These are the company's OWN tagged numbers — the cleanest numeric source there is,
immune to the table-scraping column-misalignment that broke our extractor.

Used for the deterministic numeric-answer channel: (ticker × concept × period) →
exact value, instead of guessing the figure from prose.

SEC requires a descriptive User-Agent.
"""

from __future__ import annotations

import json
import structlog

logger = structlog.get_logger()

SEC_UA = "antigravity-research houssemzitoub@gmail.com"
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"

# Common financial-statement concepts (us-gaap) covering most FinanceBench line
# items. The LLM picks among the ones present; we don't force a single mapping.
CORE_CONCEPTS: list[str] = [
    # Income statement
    "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
    "CostOfRevenue", "CostOfGoodsAndServicesSold", "GrossProfit",
    "OperatingIncomeLoss", "OperatingExpenses",
    "ResearchAndDevelopmentExpense",
    "SellingGeneralAndAdministrativeExpense",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeTaxExpenseBenefit", "NetIncomeLoss",
    "EarningsPerShareBasic", "EarningsPerShareDiluted",
    "WeightedAverageNumberOfSharesOutstandingBasic",
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    # Balance sheet
    "Assets", "AssetsCurrent", "CashAndCashEquivalentsAtCarryingValue",
    "ShortTermInvestments", "AccountsReceivableNetCurrent", "InventoryNet",
    "PropertyPlantAndEquipmentNet", "Goodwill",
    "Liabilities", "LiabilitiesCurrent", "AccountsPayableCurrent",
    "LongTermDebtNoncurrent", "LongTermDebt", "DebtCurrent",
    "StockholdersEquity", "RetainedEarningsAccumulatedDeficit",
    "CommonStockSharesOutstanding",
    # Cash flow
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInInvestingActivities",
    "NetCashProvidedByUsedInFinancingActivities",
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsOfDividendsCommonStock", "PaymentsForRepurchaseOfCommonStock",
    "DepreciationDepletionAndAmortization",
]


class SECXBRLClient:
    def __init__(self, http=None):
        self._http = http
        self._ticker_map: dict[str, int] | None = None
        self._title_map: dict[str, int] | None = None

    async def _client(self):
        if self._http is None:
            import httpx
            self._http = httpx.AsyncClient(headers={"User-Agent": SEC_UA}, timeout=30)
        return self._http

    async def _load_ticker_map(self) -> None:
        if self._ticker_map is not None:
            return
        c = await self._client()
        r = await c.get(TICKERS_URL)
        r.raise_for_status()
        data = r.json()
        tmap, title_map = {}, {}
        for row in data.values():
            cik = int(row["cik_str"])
            tmap[row["ticker"].upper()] = cik
            title_map[_norm_name(row["title"])] = cik
        self._ticker_map, self._title_map = tmap, title_map
        logger.info("sec_ticker_map_loaded", n=len(tmap))

    async def resolve_cik(self, ticker: str = "", company: str = "") -> int | None:
        """Resolve CIK from a ticker (preferred) or a company name (fuzzy)."""
        await self._load_ticker_map()
        assert self._ticker_map is not None and self._title_map is not None
        if ticker and ticker.upper() in self._ticker_map:
            return self._ticker_map[ticker.upper()]
        if company:
            n = _norm_name(company)
            if n in self._title_map:
                return self._title_map[n]
            # fuzzy: first title that starts with / contains the company tokens
            toks = n.split()
            best = None
            for title, cik in self._title_map.items():
                if title.startswith(n) or all(t in title for t in toks):
                    best = cik
                    if title.startswith(n):
                        break
            return best
        return None

    async def get_company_facts(self, cik: int) -> dict:
        c = await self._client()
        r = await c.get(FACTS_URL.format(cik=cik))
        r.raise_for_status()
        return r.json()

    @staticmethod
    def extract_facts(facts: dict, fiscal_years: list[int],
                      concepts: list[str] | None = None) -> list[dict]:
        """
        Pull (concept, fy, value, unit, form, period) rows for the given fiscal
        years from a companyfacts payload. Annual (10-K, fp=FY) values preferred.
        """
        usgaap = (facts.get("facts", {}) or {}).get("us-gaap", {}) or {}
        # concepts=None → ALL tagged concepts (true coverage ceiling); else the
        # given list (CORE_CONCEPTS keeps LLM context small).
        concepts = concepts if concepts is not None else list(usgaap.keys())
        out: list[dict] = []
        for concept in concepts:
            node = usgaap.get(concept)
            if not node:
                continue
            for unit, points in (node.get("units", {}) or {}).items():
                for p in points:
                    end = p.get("end", "")
                    start = p.get("start", "")
                    if not end:
                        continue
                    # The XBRL `fy` field is the FILING's fiscal year, not the data
                    # point's period (a FY2023 10-K tags FY2023/FY2022/FY2021 all as
                    # fy=2023). Derive the true period year from the END date.
                    try:
                        period_year = int(end[:4])
                    except ValueError:
                        continue
                    if period_year not in fiscal_years:
                        continue
                    # Duration concepts (income/cash-flow) have start+end: require an
                    # ANNUAL span (~1yr) to drop quarterly/9-month values. Instant
                    # concepts (balance sheet) have no start — keep as-is.
                    if start:
                        try:
                            d0 = _date(start); d1 = _date(end)
                            days = (d1 - d0).days
                        except Exception:
                            continue
                        if days < 330 or days > 400:
                            continue
                    out.append({
                        "concept": concept,
                        "label": _humanize(concept),
                        "fy": period_year,
                        "value": p.get("val"),
                        "unit": unit,
                        "form": p.get("form", ""),
                        "end": end,
                    })
        # dedupe (concept, fy): prefer 10-K, then the latest end date.
        best: dict[tuple, dict] = {}
        for r in out:
            k = (r["concept"], r["fy"])
            cur = best.get(k)
            if (cur is None
                    or (r["form"] == "10-K" and cur["form"] != "10-K")
                    or (r["form"] == cur["form"] and r["end"] > cur["end"])):
                best[k] = r
        return list(best.values())


def _date(s: str):
    from datetime import date
    return date.fromisoformat(s[:10])


def _norm_name(s: str) -> str:
    s = s.lower()
    for suf in (" inc", " corp", " co", " ltd", " plc", " sa", " ag", " nv",
                " holdings", " company", " the", ",", ".", "/de", "/"):
        s = s.replace(suf, " ")
    return " ".join(s.split())


def _humanize(concept: str) -> str:
    import re
    return re.sub(r"(?<!^)(?=[A-Z])", " ", concept).replace("And", "and")


def facts_to_block(rows: list[dict]) -> str:
    """Render extracted XBRL rows as a compact, LLM-readable facts table."""
    rows = sorted(rows, key=lambda r: (r["fy"], r["concept"]))
    lines = []
    for r in rows:
        v = r["value"]
        try:
            vs = f"{float(v):,.0f}"
        except (TypeError, ValueError):
            vs = str(v)
        lines.append(f"FY{r['fy']} | {r['label']} ({r['concept']}): {vs} {r['unit']} [{r['form']}]")
    return "\n".join(lines)
