// Gravity Search API Client
// Connects Kimi's report pipeline to Gravity's pre-indexed financial document corpus.
// Gravity replaces Tavily: instead of scraping the web, we query verified SEC filings,
// earnings transcripts, and structured financial data from the indexed knowledge base.

const GRAVITY_BASE = process.env.GRAVITY_API_URL ?? 'http://localhost:8000';
const GRAVITY_TIMEOUT_MS = 15_000;

// ─── Types (compatible with TavilyResult so swap is drop-in) ──────────────────

export interface GravitySource {
    title: string;
    url: string;
    content: string;
    score: number;
    published_date?: string;
    ticker?: string;
    section?: string;
    document_id?: string;
    retrieval_method?: string;
}

export interface GravityStructuredRow {
    metric: string;
    value: string | number;
    unit?: string;
    period?: string;
    ticker?: string;
}

export interface GravitySearchResponse {
    sources: GravitySource[];
    structured_data: GravityStructuredRow[];
    answer?: string;
    confidence?: number;
    sql_query?: string;
}

export interface GravityDocument {
    id: string;
    ticker: string;
    company_name: string;
    filing_type: string;
    filing_date: string | null;
    title: string;
    chunk_count: number;
    status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildEdgarUrl(ticker: string, filing_type: string): string {
    return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(ticker)}&type=${encodeURIComponent(filing_type)}&dateb=&owner=include&count=10`;
}

function normalizeSources(raw: any[]): GravitySource[] {
    return (raw || []).map((s: any) => ({
        title: [s.document_title, s.section].filter(Boolean).join(' · '),
        url: s.document_id
            ? buildEdgarUrl(s.ticker || '', s.filing_type || '')
            : `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(s.ticker || '')}`,
        content: s.text || '',
        score: s.score ?? 0,
        published_date: s.filing_date ?? undefined,
        ticker: s.ticker,
        section: s.section,
        document_id: s.document_id,
        retrieval_method: s.retrieval_method,
    }));
}

async function gravityFetch(path: string, body: object): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GRAVITY_TIMEOUT_MS);
    try {
        const res = await fetch(`${GRAVITY_BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Gravity API ${path} → HTTP ${res.status}`);
        return res.json();
    } finally {
        clearTimeout(timer);
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run multiple search queries against Gravity's hybrid index (dense + BM25 + SPLADE + graph + SQL).
 * Returns deduplicated, relevance-ranked sources compatible with the TavilyResult interface.
 */
export async function searchGravityParallel(
    queries: string[],
    tickers: string[],
    maxPerQuery = 6,
): Promise<GravitySource[]> {
    const settled = await Promise.allSettled(
        queries.slice(0, 12).map(async (query) => {
            try {
                const data = await gravityFetch('/v1/search', {
                    query,
                    filters: {
                        companies: tickers,
                        document_types: ['10-K', '10-Q', '8-K', 'earnings_transcript'],
                    },
                    options: {
                        max_sources: maxPerQuery,
                        stream: false,
                        include_structured_data: false,
                    },
                });
                return normalizeSources(data.sources || []);
            } catch {
                return [] as GravitySource[];
            }
        })
    );

    const allResults: GravitySource[] = [];
    const seenIds = new Set<string>();

    for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        for (const item of r.value) {
            const key = item.document_id ?? item.url;
            if (!seenIds.has(key)) {
                seenIds.add(key);
                allResults.push(item);
            }
        }
    }

    return allResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * Query structured financial data (TimescaleDB via NL→SQL) for a set of tickers.
 * Returns financial metrics (revenue, margins, EPS, etc.) with period and source.
 */
export async function fetchGravityStructured(
    query: string,
    tickers: string[],
    limit = 50,
): Promise<GravityStructuredRow[]> {
    try {
        const data = await gravityFetch('/v1/search/structured', {
            query,
            companies: tickers,
            limit,
        });
        return (data.rows || data.structured_data || []) as GravityStructuredRow[];
    } catch {
        return [];
    }
}

/**
 * Fetch indexed documents (filings) for a ticker from Gravity's document index.
 */
export async function fetchGravityDocuments(
    ticker: string,
    limit = 10,
): Promise<GravityDocument[]> {
    try {
        const res = await fetch(
            `${GRAVITY_BASE}/v1/documents?ticker=${encodeURIComponent(ticker)}&limit=${limit}`,
            { signal: AbortSignal.timeout(GRAVITY_TIMEOUT_MS) }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return (data.documents || data || []) as GravityDocument[];
    } catch {
        return [];
    }
}

/**
 * Check whether Gravity backend is reachable.
 */
export async function isGravityAvailable(): Promise<boolean> {
    try {
        const res = await fetch(`${GRAVITY_BASE}/health`, {
            signal: AbortSignal.timeout(3_000),
        });
        return res.ok;
    } catch {
        return false;
    }
}
