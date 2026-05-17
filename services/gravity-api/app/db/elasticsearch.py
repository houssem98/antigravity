"""Gravity Search — Elasticsearch Client"""

try:
    from elasticsearch import AsyncElasticsearch as _AsyncElasticsearch
    _ES_AVAILABLE = True
except ImportError:
    _ES_AVAILABLE = False
    class _AsyncElasticsearch:  # type: ignore[no-redef]
        def __init__(self, *args, **kwargs): pass
        async def info(self, *args, **kwargs): return {"status": "mock"}
        async def search(self, *args, **kwargs): return {"hits": {"hits": []}}
        async def close(self, *args, **kwargs): pass

from app.config import settings

class ESLazyClient:
    def __init__(self):
        self._client = None

    def _ensure_client(self):
        if self._client is None:
            self._client = _AsyncElasticsearch(
                hosts=[settings.elasticsearch_url],
                request_timeout=5,
                max_retries=0,
                retry_on_timeout=False,
            )

    def __getattr__(self, name):
        self._ensure_client()
        return getattr(self._client, name)

    async def info(self, **kwargs):
        self._ensure_client()
        return await self._client.info(**kwargs)

    async def search(self, **kwargs):
        self._ensure_client()
        return await self._client.search(**kwargs)
        
    async def close(self):
        if self._client:
            await self._client.close()

es_client = ESLazyClient()

# Custom financial analyzer config for BM25
FINANCIAL_ANALYZER = {
    "settings": {
        "analysis": {
            "filter": {
                "financial_synonyms": {
                    "type": "synonym",
                    "lenient": True,
                    "synonyms": [
                        # ── Income Statement ──────────────────────────────────────
                        "revenue, net sales, top line, turnover, net revenue, total revenue, total sales, revenues",
                        "gross profit, gross income, gross margin dollars",
                        "operating income, operating profit, ebit, operating earnings, income from operations",
                        "net income, net earnings, net profit, bottom line, net loss, earnings attributable",
                        "ebitda, adjusted ebitda, operating ebitda",
                        "eps, earnings per share, diluted eps, diluted earnings per share, basic eps",
                        "operating expenses, opex, operating costs, total operating expenses",
                        "selling general administrative, sga, sg&a, general administrative expenses",
                        "research development, r&d, research and development expense",
                        "cost of goods sold, cogs, cost of revenue, cost of sales",
                        "gross margin, gross profit margin, gross margin rate",
                        "operating margin, operating profit margin, ebit margin",
                        "net margin, net profit margin, net income margin, profit margin",
                        "revenue growth, sales growth, top line growth, organic revenue growth",
                        "comparable sales, same store sales, comps, like for like sales",
                        # ── Balance Sheet ─────────────────────────────────────────
                        "total assets, asset base, balance sheet size",
                        "total liabilities, total debt obligations",
                        "shareholders equity, stockholders equity, book value, net assets",
                        "cash, cash equivalents, cash and equivalents, liquidity",
                        "cash and short term investments, cash position, total liquidity",
                        "long term debt, long-term borrowings, senior notes, term loans",
                        "net debt, net leverage, debt minus cash",
                        "inventory, inventories, stock on hand, finished goods",
                        "accounts receivable, ar, receivables, trade receivables",
                        "accounts payable, ap, payables, trade payables",
                        "working capital, net working capital",
                        "goodwill, goodwill and intangibles, acquired intangibles",
                        "book value per share, tangible book value, nav per share",
                        # ── Cash Flow ─────────────────────────────────────────────
                        "capex, capital expenditure, capital spending, property plant equipment additions",
                        "free cash flow, fcf, unlevered free cash flow, levered free cash flow",
                        "operating cash flow, cash from operations, cash provided by operating activities",
                        "investing activities, cash used in investing",
                        "financing activities, cash from financing",
                        "capital allocation, capital return",
                        "buyback, share repurchase, stock repurchase, stock buyback, repurchase program",
                        "dividend, distribution, payout, cash dividend, special dividend",
                        # ── Valuation ────────────────────────────────────────────
                        "price to earnings, pe ratio, p/e, price earnings ratio, earnings multiple",
                        "ev ebitda, enterprise value to ebitda, ev/ebitda multiple",
                        "price to sales, ps ratio, p/s, price sales ratio, revenue multiple",
                        "price to book, pb ratio, p/b, price book value",
                        "price to free cash flow, p/fcf, free cash flow yield",
                        "enterprise value, ev, total enterprise value",
                        "market cap, market capitalization, equity market cap",
                        "dcf, discounted cash flow, intrinsic value",
                        "wacc, weighted average cost of capital, cost of capital",
                        "terminal value, perpetuity value",
                        "sum of parts, sotp, conglomerate discount",
                        # ── Growth & Outlook ──────────────────────────────────────
                        "guidance, outlook, forecast, projection, targets, financial targets",
                        "raised guidance, raised outlook, guidance increase, guidance raise",
                        "lowered guidance, cut guidance, guidance reduction, guidance cut",
                        "consensus, street consensus, analyst consensus, street estimate",
                        "beat, earnings beat, revenue beat, beat expectations",
                        "miss, earnings miss, revenue miss, missed expectations",
                        "in line, met expectations, inline with consensus",
                        "cagr, compound annual growth rate, annualized growth rate",
                        "organic growth, constant currency growth, cc growth",
                        "total addressable market, tam, addressable market",
                        "market share, share gains, share of market",
                        # ── Risk ──────────────────────────────────────────────────
                        "risk factor, risk factors, key risk, material risk",
                        "macro risk, macroeconomic risk, economic uncertainty",
                        "currency risk, fx risk, foreign exchange risk, fx headwind, fx tailwind",
                        "interest rate risk, rate sensitivity, duration risk",
                        "credit risk, counterparty risk, default risk",
                        "liquidity risk, funding risk, refinancing risk",
                        "regulatory risk, regulatory scrutiny, regulatory action, compliance risk",
                        "geopolitical risk, geopolitical uncertainty",
                        "supply chain risk, supply chain disruption, supply disruption",
                        "competitive risk, competitive pressure, pricing pressure",
                        "concentration risk, customer concentration",
                        # ── Corporate Actions ─────────────────────────────────────
                        "acquisition, merger, takeover, deal, ma deal, business combination",
                        "merger agreement, definitive agreement, agreed to acquire",
                        "divestiture, divestment, asset sale, spin-off, carve-out",
                        "ipo, initial public offering, listing, public offering",
                        "secondary offering, follow-on offering, equity offering, dilution",
                        "restructuring, reorganization, transformation, turnaround",
                        "layoffs, workforce reduction, headcount reduction, job cuts",
                        "partnership, joint venture, jv, strategic alliance, collaboration",
                        # ── Debt & Financing ──────────────────────────────────────
                        "leverage, leverage ratio, debt leverage, financial leverage",
                        "refinancing, debt refinancing, debt restructuring",
                        "credit rating, credit upgrade, credit downgrade, investment grade, junk",
                        "covenant, debt covenant, financial covenant",
                        "maturity, debt maturity, notes due",
                        "high yield, high yield bonds, junk bonds",
                        "investment grade, ig bonds, ig credit",
                        # ── Macro ────────────────────────────────────────────────
                        "inflation, cpi, consumer price index, price increases, pricing power",
                        "deflation, disinflation, falling prices",
                        "gdp, gross domestic product, economic growth, economic output",
                        "recession, economic downturn, contraction",
                        "interest rate, fed funds rate, policy rate, benchmark rate",
                        "federal reserve, fed, fomc, central bank",
                        "yield curve, treasury yield, 10 year yield, 2 year yield",
                        "tariff, import duty, customs, trade barrier, trade war",
                        "quantitative easing, qe, asset purchases, balance sheet expansion",
                        "quantitative tightening, qt, balance sheet reduction",
                        # ── Profitability & Efficiency ────────────────────────────
                        "return on equity, roe, return on shareholders equity",
                        "return on assets, roa, asset returns",
                        "return on invested capital, roic, return on capital",
                        "asset turnover, revenue to assets",
                        "inventory turnover, days inventory outstanding, dio",
                        "days sales outstanding, dso, receivable days",
                        "days payable outstanding, dpo, payable days",
                        "cash conversion cycle, ccc, working capital cycle",
                        # ── Technology & AI ───────────────────────────────────────
                        "artificial intelligence, ai, machine learning, ml, generative ai, gen ai",
                        "cloud, cloud computing, cloud services, cloud revenue",
                        "software as a service, saas, subscription software",
                        "platform, digital platform, marketplace",
                        "semiconductor, chip, processor, gpu",
                        "data center, hyperscale, colocation",
                        # ── Earnings Event ───────────────────────────────────────
                        "earnings call, earnings conference call, results call, investor call",
                        "earnings release, results release, press release, quarterly results",
                        "annual report, 10-k, form 10k",
                        "quarterly report, 10-q, form 10q",
                        "8-k, form 8k, current report, material event",
                        "proxy statement, def14a, annual meeting",
                        "investor day, analyst day, capital markets day",
                        "prepared remarks, management commentary",
                        "question and answer, q&a session, analyst questions",
                    ],
                },
                "ticker_filter": {
                    "type": "pattern_capture",
                    "preserve_original": True,
                    "patterns": [r"[A-Z]{1,5}"],
                },
            },
            "analyzer": {
                "financial_analyzer": {
                    "type": "custom",
                    "tokenizer": "standard",
                    "filter": [
                        "lowercase",
                        "financial_synonyms",
                        "ticker_filter",
                    ],
                },
            },
        },
    },
    "mappings": {
        "properties": {
            "chunk_id": {"type": "keyword"},
            "document_id": {"type": "keyword"},
            "text": {"type": "text", "analyzer": "financial_analyzer"},
            "ticker": {"type": "keyword"},
            "company_name": {"type": "text"},
            "filing_type": {"type": "keyword"},
            "filing_date": {"type": "date"},
            "section": {"type": "keyword"},
            "chunk_level": {"type": "integer"},
            "metadata": {"type": "object", "enabled": False},
        },
    },
}


def get_es_client() -> ESLazyClient:
    """Return the shared Elasticsearch client singleton."""
    return es_client


async def ensure_index():
    """Create the Elasticsearch index with financial analyzer if it doesn't exist."""
    index = settings.elasticsearch_index
    exists = await es_client.indices.exists(index=index)
    if not exists:
        await es_client.indices.create(index=index, body=FINANCIAL_ANALYZER)
