// Tavily Web Search — thin client over market-server /api/tavily/search.
// Keys never leave the server.

import { getAccessToken } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';

export interface TavilySearchResult {
    title: string;
    url: string;
    content: string;
    score: number;
    publishedDate?: string;
}

export interface TavilySearchResponse {
    query: string;
    results: TavilySearchResult[];
    images?: string[];
}

// ─── Source-Authority Classification ────────────────────────────────────────
// Research plan §6.4: SEC / IR > premium wire > mainstream news > aggregators.
// Dense/semantic Tavily scores alone silently upweight blogs over SEC filings,
// so we blend the Tavily score with a domain-authority prior before ranking.

export type SourceAuthority = 'primary' | 'premium_news' | 'mainstream' | 'aggregator' | 'other';

// Primary: regulators, central banks, statistical agencies, issuer IR sites.
const PRIMARY_HOSTS = [
    'sec.gov', 'federalreserve.gov', 'bea.gov', 'bls.gov', 'treasury.gov',
    'cftc.gov', 'finra.org', 'fdic.gov', 'occ.gov', 'consumerfinance.gov',
    'imf.org', 'worldbank.org', 'oecd.org',
    'ecb.europa.eu', 'europa.eu', 'bankofengland.co.uk', 'boj.or.jp',
    'esma.europa.eu',
];
// Matches investor-relations subdomains across issuers (ir.apple.com, investor.msft.com, ...).
const IR_PATTERN = /(^|\.)ir\.|(^|\.)investors?\.|investorrelations?\./i;

const PREMIUM_NEWS = [
    'reuters.com', 'bloomberg.com', 'wsj.com', 'ft.com', 'economist.com',
    'nytimes.com', 'washingtonpost.com',
];
const MAINSTREAM_NEWS = [
    'cnbc.com', 'marketwatch.com', 'barrons.com', 'forbes.com',
    'businessinsider.com', 'finance.yahoo.com', 'investopedia.com',
    'axios.com', 'politico.com',
];
const AGGREGATORS = [
    'seekingalpha.com', 'morningstar.com', 'fool.com', 'finbold.com',
    'zacks.com', 'benzinga.com', 'tipranks.com', 'simplywall.st',
];

function hostFromUrl(url: string): string {
    try { return new URL(url).hostname.toLowerCase(); }
    catch { return ''; }
}

function hostMatches(host: string, list: string[]): boolean {
    return list.some(h => host === h || host.endsWith('.' + h));
}

export function classifyAuthority(url: string): SourceAuthority {
    const host = hostFromUrl(url);
    if (!host) return 'other';
    if (hostMatches(host, PRIMARY_HOSTS)) return 'primary';
    if (IR_PATTERN.test(host)) return 'primary';
    if (hostMatches(host, PREMIUM_NEWS)) return 'premium_news';
    if (hostMatches(host, MAINSTREAM_NEWS)) return 'mainstream';
    if (hostMatches(host, AGGREGATORS)) return 'aggregator';
    return 'other';
}

const AUTHORITY_WEIGHT: Record<SourceAuthority, number> = {
    primary:      1.00,
    premium_news: 0.75,
    mainstream:   0.55,
    aggregator:   0.40,
    other:        0.25,
};

export function authorityWeight(tier: SourceAuthority): number {
    return AUTHORITY_WEIGHT[tier];
}

// Blended score: 40% Tavily semantic + 60% domain-authority prior.
// Authority-heavy because Tavily often ranks well-SEO'd aggregators above
// primary SEC pages, and primary sources are what compliance wants cited.
export function weightedAuthorityScore(r: TavilySearchResult): number {
    const tavily = typeof r.score === 'number' ? r.score : 0.5;
    const auth = authorityWeight(classifyAuthority(r.url));
    return 0.4 * tavily + 0.6 * auth;
}

async function postTavily(query: string, maxResults: number): Promise<TavilySearchResponse> {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated — sign in to run web search');

    const res = await fetch(`${API_BASE}/api/tavily/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            query,
            max_results: maxResults,
            search_depth: 'advanced',
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `Tavily proxy failed (${res.status})`);
    }
    const data = await res.json();
    return {
        query,
        results: data.results || [],
        images: data.images || [],
    };
}

export const searchWeb = async (
    query: string,
    maxResults: number = 10,
): Promise<TavilySearchResponse> => postTavily(query, maxResults);

export const searchMultipleQueries = async (
    queries: string[],
    maxResultsPerQuery: number = 5,
): Promise<TavilySearchResult[]> => {
    const allResults: TavilySearchResult[] = [];
    for (const query of queries) {
        try {
            const response = await searchWeb(query, maxResultsPerQuery);
            allResults.push(...response.results);
        } catch (error) {
            console.error(`Failed to search for "${query}":`, error);
        }
    }
    const uniqueResults = Array.from(new Map(allResults.map(r => [r.url, r])).values());
    return uniqueResults.sort((a, b) => weightedAuthorityScore(b) - weightedAuthorityScore(a));
};

// Parallel version — fires all queries simultaneously for maximum speed
export const searchMultipleQueriesParallel = async (
    queries: string[],
    maxResultsPerQuery: number = 6,
): Promise<TavilySearchResult[]> => {
    const settled = await Promise.allSettled(
        queries.slice(0, 12).map(q => searchWeb(q, maxResultsPerQuery))
    );
    const allResults: TavilySearchResult[] = [];
    for (const r of settled) {
        if (r.status === 'fulfilled') allResults.push(...r.value.results);
    }
    const uniqueResults = Array.from(new Map(allResults.map(r => [r.url, r])).values());
    return uniqueResults.sort((a, b) => weightedAuthorityScore(b) - weightedAuthorityScore(a));
};
