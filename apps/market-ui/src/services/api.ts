// API Client — calls backend with auth token
import { getAccessToken } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';

async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const token = await getAccessToken();

    if (!token) {
        throw new Error('Not authenticated');
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...options.headers,
        },
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response;
}

// Research API
export const apiStartResearch = async (query: string) => {
    const response = await authFetch('/api/research', {
        method: 'POST',
        body: JSON.stringify({ query }),
    });
    return response.json();
};

export const apiGetResearchHistory = async () => {
    const response = await authFetch('/api/research');
    return response.json();
};

export const apiGetReport = async (id: string) => {
    const response = await authFetch(`/api/research/${id}`);
    return response.json();
};

// Market API
export const apiGetQuote = async (symbol: string) => {
    const response = await authFetch(`/api/market/quote/${symbol}`);
    return response.json();
};

export const apiGetOverview = async (symbol: string) => {
    const response = await authFetch(`/api/market/overview/${symbol}`);
    return response.json();
};
