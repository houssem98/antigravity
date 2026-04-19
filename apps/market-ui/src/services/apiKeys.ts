// Server-configured API key status.
// Keys never live in the browser — market-server proxies LLM, Tavily, and Alpha
// Vantage calls using keys from its own env. This module just reads server
// availability so the UI can gate features and render status.

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';

export interface ServerKeyStatus {
    llm: {
        anthropic: boolean;
        gemini: boolean;
        deepseek: boolean;
        groq: boolean;
    };
    tavily: boolean;
    alphaVantage: boolean;
}

const EMPTY_STATUS: ServerKeyStatus = {
    llm: { anthropic: false, gemini: false, deepseek: false, groq: false },
    tavily: false,
    alphaVantage: false,
};

let _cached: ServerKeyStatus | null = null;
let _inflight: Promise<ServerKeyStatus> | null = null;

export async function fetchServerKeyStatus(force = false): Promise<ServerKeyStatus> {
    if (!force && _cached) return _cached;
    if (_inflight) return _inflight;

    _inflight = (async () => {
        try {
            const res = await fetch(`${API_BASE}/api/llm/providers`);
            if (!res.ok) return EMPTY_STATUS;
            const data = await res.json();
            const providerMap: Record<string, boolean> = {};
            for (const p of data.providers ?? []) providerMap[p.id] = !!p.available;
            const status: ServerKeyStatus = {
                llm: {
                    anthropic: !!providerMap.anthropic,
                    gemini:    !!providerMap.gemini,
                    deepseek:  !!providerMap.deepseek,
                    groq:      !!providerMap.groq,
                },
                tavily:       !!data.dataProviders?.tavily,
                alphaVantage: !!data.dataProviders?.alphaVantage,
            };
            _cached = status;
            return status;
        } catch {
            return EMPTY_STATUS;
        } finally {
            _inflight = null;
        }
    })();
    return _inflight;
}

export function getCachedKeyStatus(): ServerKeyStatus | null {
    return _cached;
}

// Synchronous check using the last fetched cache. Call fetchServerKeyStatus()
// before relying on this (e.g. at app mount).
export function hasRequiredKeys(): boolean {
    const s = _cached;
    if (!s) return false;
    const anyLLM = s.llm.anthropic || s.llm.gemini || s.llm.deepseek || s.llm.groq;
    return anyLLM && s.tavily;
}

export async function hasRequiredKeysAsync(): Promise<boolean> {
    const s = await fetchServerKeyStatus();
    const anyLLM = s.llm.anthropic || s.llm.gemini || s.llm.deepseek || s.llm.groq;
    return anyLLM && s.tavily;
}
