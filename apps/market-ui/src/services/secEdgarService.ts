// SEC EDGAR Filing Service
// Fetches SEC filings (10-K, 10-Q, 8-K) from the public EDGAR database

export interface SECFiling {
    filingType: string;
    filingDate: string;
    reportDate: string;
    accessionNumber: string;
    fileNumber: string;
    url: string;
    company: string;
    cik: string;
}

const SEC_BASE_URL = 'https://www.sec.gov';
const USER_AGENT = 'MarketIntelligence research@example.com'; // SEC requires User-Agent with email

export const searchFilings = async (
    companyName: string,
    filingTypes: string[] = ['10-K', '10-Q', '8-K'],
    limit: number = 10
): Promise<SECFiling[]> => {
    try {
        // First, search for the company to get CIK
        const searchUrl = `${SEC_BASE_URL}/cgi-bin/browse-edgar?company=${encodeURIComponent(companyName)}&action=getcompany&output=atom`;

        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': USER_AGENT,
            },
        });

        if (!response.ok) {
            throw new Error(`SEC EDGAR API error: ${response.statusText}`);
        }

        const text = await response.text();

        // Parse XML to extract filings (simplified - in production use proper XML parser)
        const filings: SECFiling[] = [];
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
        const matches = text.matchAll(entryRegex);

        for (const match of matches) {
            const entry = match[1];

            // Extract filing type
            const typeMatch = entry.match(/<category[^>]*term="([^"]+)"/);
            const filingType = typeMatch ? typeMatch[1] : '';

            if (!filingTypes.includes(filingType)) continue;

            // Extract other details
            const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
            const linkMatch = entry.match(/<link[^>]*href="([^"]+)"/);
            const updatedMatch = entry.match(/<updated>([^<]+)<\/updated>/);

            if (linkMatch && titleMatch) {
                filings.push({
                    filingType,
                    filingDate: updatedMatch ? updatedMatch[1].split('T')[0] : '',
                    reportDate: '',
                    accessionNumber: '',
                    fileNumber: '',
                    url: linkMatch[1],
                    company: companyName,
                    cik: '',
                });
            }

            if (filings.length >= limit) break;
        }

        return filings;
    } catch (error) {
        console.error('SEC EDGAR search error:', error);
        return [];
    }
};

export const getFilingContent = async (url: string): Promise<string> => {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch filing: ${response.statusText}`);
        }

        return await response.text();
    } catch (error) {
        console.error('Error fetching filing content:', error);
        return '';
    }
};

// ─── XBRL Concept Normalization (plan §6.3) ────────────────────────────────
// Companies file XBRL with different tags across years and extensions.
// "Revenue" might be us-gaap:Revenues, us-gaap:RevenueFromContractWith...,
// us-gaap:SalesRevenueNet, us-gaap:SalesRevenueGoodsNet, or a company-
// specific custom concept. Without a normalization table, cross-company
// and cross-period comparison silently breaks.
//
// The map below is a minimal starter — the canonical line items most
// equity-research workflows actually need. Entries are ordered by
// preference: earlier entries win when multiple match on the same filing.

export type CanonicalConcept =
    | 'revenue_total' | 'cost_of_revenue' | 'gross_profit'
    | 'operating_expenses' | 'research_development' | 'sga'
    | 'operating_income' | 'net_income' | 'eps_basic' | 'eps_diluted'
    | 'cash' | 'total_assets' | 'total_liabilities' | 'stockholders_equity'
    | 'operating_cash_flow' | 'capex' | 'free_cash_flow'
    | 'shares_outstanding' | 'total_debt' | 'long_term_debt';

export const XBRL_CONCEPT_MAP: Record<CanonicalConcept, string[]> = {
    revenue_total: [
        'Revenues',
        'RevenueFromContractWithCustomerExcludingAssessedTax',
        'RevenueFromContractWithCustomerIncludingAssessedTax',
        'SalesRevenueNet',
        'SalesRevenueGoodsNet',
        'SalesRevenueServicesNet',
    ],
    cost_of_revenue: [
        'CostOfRevenue',
        'CostOfGoodsAndServicesSold',
        'CostOfGoodsSold',
        'CostOfServices',
    ],
    gross_profit: ['GrossProfit'],
    operating_expenses: ['OperatingExpenses'],
    research_development: [
        'ResearchAndDevelopmentExpense',
        'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost',
    ],
    sga: [
        'SellingGeneralAndAdministrativeExpense',
        'GeneralAndAdministrativeExpense',
        'SellingAndMarketingExpense',
    ],
    operating_income: ['OperatingIncomeLoss'],
    net_income: [
        'NetIncomeLoss',
        'ProfitLoss',
        'NetIncomeLossAvailableToCommonStockholdersBasic',
    ],
    eps_basic: ['EarningsPerShareBasic'],
    eps_diluted: ['EarningsPerShareDiluted'],
    cash: [
        'CashAndCashEquivalentsAtCarryingValue',
        'Cash',
        'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
    ],
    total_assets: ['Assets'],
    total_liabilities: ['Liabilities'],
    stockholders_equity: [
        'StockholdersEquity',
        'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
    ],
    operating_cash_flow: [
        'NetCashProvidedByUsedInOperatingActivities',
        'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
    ],
    capex: [
        'PaymentsToAcquirePropertyPlantAndEquipment',
        'PaymentsToAcquireProductiveAssets',
        'PaymentsForCapitalImprovements',
    ],
    free_cash_flow: [],   // derived, not tagged directly
    shares_outstanding: [
        'CommonStockSharesOutstanding',
        'WeightedAverageNumberOfSharesOutstandingBasic',
        'WeightedAverageNumberOfDilutedSharesOutstanding',
    ],
    total_debt: ['LongTermDebt', 'DebtInstrumentCarryingAmount'],
    long_term_debt: [
        'LongTermDebtNoncurrent',
        'LongTermDebt',
        'LongTermDebtAndCapitalLeaseObligations',
    ],
};

// Given a list of XBRL tags actually present in a filing, pick the canonical
// concept they map to. Preference: earlier entries in XBRL_CONCEPT_MAP win
// when multiple match. Returns null when no mapping exists.
export function normalizeXBRLTag(tag: string): CanonicalConcept | null {
    const normalized = tag.replace(/^us-gaap:/i, '').trim();
    for (const [canonical, tags] of Object.entries(XBRL_CONCEPT_MAP) as [CanonicalConcept, string[]][]) {
        for (const t of tags) {
            if (t.toLowerCase() === normalized.toLowerCase()) return canonical;
        }
    }
    return null;
}

// Given a map of XBRL tag → value (what companyfacts.zip looks like),
// collapse to a canonical {concept: value} map. Respects preference
// ordering — the first matching tag per concept wins.
export function canonicalizeFacts(
    tagValues: Record<string, number>,
): Partial<Record<CanonicalConcept, number>> {
    const out: Partial<Record<CanonicalConcept, number>> = {};
    for (const [canonical, tags] of Object.entries(XBRL_CONCEPT_MAP) as [CanonicalConcept, string[]][]) {
        if (canonical === 'free_cash_flow') continue;   // derived below
        for (const t of tags) {
            // Check both with and without the us-gaap: prefix.
            const candidates = [t, `us-gaap:${t}`];
            for (const c of candidates) {
                if (c in tagValues && typeof tagValues[c] === 'number') {
                    out[canonical] = tagValues[c];
                    break;
                }
            }
            if (out[canonical] !== undefined) break;
        }
    }
    // Derive FCF = operating_cash_flow − capex when both present. Capex in
    // SEC data is a positive cash outflow, so we subtract it.
    if (out.operating_cash_flow !== undefined && out.capex !== undefined) {
        out.free_cash_flow = out.operating_cash_flow - out.capex;
    }
    return out;
}

// ─── 10-K / 10-Q Section Tagger (plan §6.3) ────────────────────────────────
// SEC rules require 10-K text to be organized by Item numbers. Plain-text
// HTML from EDGAR has these as headings like "ITEM 1. BUSINESS" or
// "Item 1A. Risk Factors" with varying capitalization. A regex-based
// tagger is 95% accurate on modern filings and has zero external deps.

export type TenKItem =
    | 'item_1' | 'item_1a' | 'item_1b' | 'item_1c'
    | 'item_2' | 'item_3' | 'item_4'
    | 'item_5' | 'item_6'
    | 'item_7' | 'item_7a'
    | 'item_8' | 'item_9' | 'item_9a' | 'item_9b'
    | 'item_10' | 'item_11' | 'item_12' | 'item_13' | 'item_14'
    | 'item_15' | 'item_16';

export interface TaggedSection {
    item: TenKItem;
    heading: string;
    startOffset: number;
    endOffset: number;
    body: string;
}

// Case-insensitive `i` flag so "Item", "ITEM", "item" all match. Hyphen
// at the end of the char-class so it isn't interpreted as a range.
const ITEM_HEADING_RE = /^\s*item\s+(\d+[a-c]?)(?:[.\s:–—\-])\s*([^\n\r]{0,120})/gmi;

// Canonical label per Item so downstream consumers don't have to know SEC
// numbering rules by heart.
export const TENK_ITEM_LABELS: Record<TenKItem, string> = {
    item_1:   'Business',
    item_1a:  'Risk Factors',
    item_1b:  'Unresolved Staff Comments',
    item_1c:  'Cybersecurity',
    item_2:   'Properties',
    item_3:   'Legal Proceedings',
    item_4:   'Mine Safety Disclosures',
    item_5:   'Market for Registrant\'s Common Equity',
    item_6:   'Reserved (Selected Financial Data pre-2021)',
    item_7:   'MD&A',
    item_7a:  'Quantitative and Qualitative Disclosures about Market Risk',
    item_8:   'Financial Statements and Supplementary Data',
    item_9:   'Changes in and Disagreements with Accountants',
    item_9a:  'Controls and Procedures',
    item_9b:  'Other Information',
    item_10:  'Directors, Executive Officers and Corporate Governance',
    item_11:  'Executive Compensation',
    item_12:  'Security Ownership',
    item_13:  'Certain Relationships and Related Transactions',
    item_14:  'Principal Accountant Fees and Services',
    item_15:  'Exhibits, Financial Statement Schedules',
    item_16:  'Form 10-K Summary',
};

function itemKey(num: string): TenKItem | null {
    const n = num.toLowerCase();
    const key = `item_${n}` as TenKItem;
    return key in TENK_ITEM_LABELS ? key : null;
}

// Segment a 10-K or 10-Q text body by Item headings. Skips table-of-
// contents entries by requiring the heading to be followed by at least
// 200 characters of body before the next heading. Returns sections in
// document order.
export function tag10KSections(text: string): TaggedSection[] {
    const matches: Array<{ item: TenKItem; heading: string; offset: number }> = [];
    ITEM_HEADING_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ITEM_HEADING_RE.exec(text)) !== null) {
        const item = itemKey(m[1]);
        if (!item) continue;
        matches.push({
            item,
            heading: (m[0] || '').replace(/\s+/g, ' ').trim(),
            offset: m.index,
        });
    }

    // Drop TOC-style matches: if two consecutive matches are < 200 chars
    // apart, the earlier one is a TOC entry, not a real section start.
    const kept: typeof matches = [];
    for (let i = 0; i < matches.length; i++) {
        const curr = matches[i];
        const next = matches[i + 1];
        const gap = next ? next.offset - curr.offset : text.length - curr.offset;
        if (gap >= 200) kept.push(curr);
    }

    // Deduplicate by item — keep the first occurrence after TOC filtering.
    const seen = new Set<TenKItem>();
    const deduped: typeof matches = [];
    for (const k of kept) {
        if (seen.has(k.item)) continue;
        seen.add(k.item);
        deduped.push(k);
    }

    const sections: TaggedSection[] = [];
    for (let i = 0; i < deduped.length; i++) {
        const curr = deduped[i];
        const next = deduped[i + 1];
        const endOffset = next ? next.offset : text.length;
        sections.push({
            item: curr.item,
            heading: curr.heading,
            startOffset: curr.offset,
            endOffset,
            body: text.slice(curr.offset, endOffset).trim(),
        });
    }
    return sections;
}

// ─── 8-K Item-Type Parser (plan §6.3) ──────────────────────────────────────
// 8-K filings declare triggering events via "Item 2.02 Results of Operations",
// "Item 5.02 Departure of Directors", etc. Parsing these is the difference
// between "company filed an 8-K" and "company announced earnings" as a
// queryable signal.

export const EIGHT_K_ITEMS: Record<string, string> = {
    '1.01': 'Entry into a Material Definitive Agreement',
    '1.02': 'Termination of a Material Definitive Agreement',
    '1.03': 'Bankruptcy or Receivership',
    '1.04': 'Mine Safety Reporting',
    '2.01': 'Completion of Acquisition or Disposition',
    '2.02': 'Results of Operations and Financial Condition',   // earnings
    '2.03': 'Creation of a Direct Financial Obligation',
    '2.04': 'Triggering Events That Accelerate a Direct Financial Obligation',
    '2.05': 'Costs Associated with Exit or Disposal Activities',
    '2.06': 'Material Impairments',
    '3.01': 'Notice of Delisting / Failure to Satisfy Listing Rule',
    '3.02': 'Unregistered Sales of Equity Securities',
    '3.03': 'Material Modification to Rights of Security Holders',
    '4.01': 'Changes in Registrant\'s Certifying Accountant',
    '4.02': 'Non-Reliance on Previously Issued Financial Statements',
    '5.01': 'Changes in Control of Registrant',
    '5.02': 'Departure / Appointment of Directors or Officers',
    '5.03': 'Amendments to Articles / Bylaws; Change in Fiscal Year',
    '5.04': 'Temporary Suspension of Trading Under Registrant\'s Employee Benefit Plans',
    '5.05': 'Amendments to the Code of Ethics',
    '5.06': 'Change in Shell Company Status',
    '5.07': 'Submission of Matters to a Vote of Security Holders',
    '5.08': 'Shareholder Director Nominations',
    '6.01': 'ABS Informational and Computational Material',
    '6.03': 'Change in Credit Enhancement or Other External Support',
    '7.01': 'Regulation FD Disclosure',
    '8.01': 'Other Events',
    '9.01': 'Financial Statements and Exhibits',
};

export interface EightKItem {
    itemNumber: string;           // e.g. "2.02"
    label: string;                // looked-up human-readable label
    raw: string;                  // the matched raw heading
}

const EIGHT_K_ITEM_RE = /(?:^|\n)\s*item\s+(\d\.\d{2})\b[^\n\r]{0,120}/gim;

export function parse8KItems(text: string): EightKItem[] {
    const out: EightKItem[] = [];
    const seen = new Set<string>();
    EIGHT_K_ITEM_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EIGHT_K_ITEM_RE.exec(text)) !== null) {
        const num = m[1];
        if (seen.has(num)) continue;
        seen.add(num);
        out.push({
            itemNumber: num,
            label: EIGHT_K_ITEMS[num] || 'Unknown 8-K item',
            raw: (m[0] || '').replace(/\s+/g, ' ').trim(),
        });
    }
    return out;
}

// ─── Ticker ↔ CIK Resolution (plan §6.3) ───────────────────────────────────
// Entity-resolution lite. The SEC publishes company_tickers.json free (a
// tiny ~400KB file updated nightly) mapping ticker → CIK → company name.
// Fetch once per session, cache in memory. Callers can resolve "AAPL"
// → CIK 0000320193 and vice versa.

export interface TickerRecord {
    ticker: string;
    cik: string;        // 10-digit zero-padded
    title: string;      // company name
}

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
let _tickerIndexPromise: Promise<Map<string, TickerRecord>> | null = null;

export function _clearTickerIndex_FOR_TESTS(): void {
    _tickerIndexPromise = null;
}

export function padCik(raw: string | number): string {
    return String(raw).replace(/[^0-9]/g, '').padStart(10, '0');
}

export function parseTickerFileJson(json: unknown): Map<string, TickerRecord> {
    const out = new Map<string, TickerRecord>();
    if (!json || typeof json !== 'object') return out;
    // company_tickers.json is shaped { "0": { cik_str, ticker, title }, "1": {...}, ... }
    for (const v of Object.values(json as Record<string, unknown>)) {
        if (!v || typeof v !== 'object') continue;
        const row = v as Record<string, unknown>;
        const ticker = typeof row.ticker === 'string' ? row.ticker.toUpperCase() : '';
        const cik = padCik(String(row.cik_str ?? ''));
        const title = typeof row.title === 'string' ? row.title : '';
        if (ticker && cik && cik !== '0000000000') {
            out.set(ticker, { ticker, cik, title });
        }
    }
    return out;
}

async function loadTickerIndex(): Promise<Map<string, TickerRecord>> {
    if (_tickerIndexPromise) return _tickerIndexPromise;
    _tickerIndexPromise = (async () => {
        const res = await fetch(TICKERS_URL, { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok) throw new Error(`SEC ticker index: HTTP ${res.status}`);
        const json = await res.json();
        return parseTickerFileJson(json);
    })();
    return _tickerIndexPromise;
}

export async function resolveTickerToCik(ticker: string): Promise<TickerRecord | null> {
    const idx = await loadTickerIndex();
    return idx.get(ticker.toUpperCase()) ?? null;
}

export async function resolveCikToTicker(cik: string | number): Promise<TickerRecord | null> {
    const padded = padCik(cik);
    const idx = await loadTickerIndex();
    for (const rec of idx.values()) {
        if (rec.cik === padded) return rec;
    }
    return null;
}
