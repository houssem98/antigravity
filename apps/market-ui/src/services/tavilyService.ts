// Tavily Web Search Service
// Provides web research capabilities with content extraction

import { getApiKeys } from './apiKeys';

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

export const searchWeb = async (
    query: string,
    maxResults: number = 10
): Promise<TavilySearchResponse> => {
    const { tavily } = getApiKeys();

    if (!tavily) {
        throw new Error('Tavily API key not configured');
    }

    try {
        const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                api_key: tavily,
                query,
                max_results: maxResults,
                search_depth: 'advanced',
                include_answer: false,
                include_raw_content: false,
                include_images: false,
            }),
        });

        if (!response.ok) {
            throw new Error(`Tavily API error: ${response.statusText}`);
        }

        const data = await response.json();

        return {
            query,
            results: data.results || [],
            images: data.images || [],
        };
    } catch (error) {
        console.error('Tavily search error:', error);
        throw error;
    }
};

export const searchMultipleQueries = async (
    queries: string[],
    maxResultsPerQuery: number = 5
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

    // Deduplicate by URL
    const uniqueResults = Array.from(
        new Map(allResults.map(r => [r.url, r])).values()
    );

    // Sort by relevance score
    return uniqueResults.sort((a, b) => b.score - a.score);
};

// Parallel version — fires all queries simultaneously for maximum speed
export const searchMultipleQueriesParallel = async (
    queries: string[],
    maxResultsPerQuery: number = 6
): Promise<TavilySearchResult[]> => {
    const settled = await Promise.allSettled(
        queries.slice(0, 12).map(q => searchWeb(q, maxResultsPerQuery))
    );

    const allResults: TavilySearchResult[] = [];
    for (const r of settled) {
        if (r.status === 'fulfilled') allResults.push(...r.value.results);
    }

    const uniqueResults = Array.from(
        new Map(allResults.map(r => [r.url, r])).values()
    );

    return uniqueResults.sort((a, b) => b.score - a.score);
};
