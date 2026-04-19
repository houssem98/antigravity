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
    return uniqueResults.sort((a, b) => b.score - a.score);
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
    return uniqueResults.sort((a, b) => b.score - a.score);
};
