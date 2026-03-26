/**
 * Antigravity — Shared TypeScript Types
 *
 * Types shared between market-ui, market-server, and gravity-ui.
 * Import with: import { SearchResult, ResearchReport } from 'shared-types'
 */

// ── Search ──────────────────────────────────────

export interface SearchResult {
    id: string;
    title: string;
    snippet: string;
    url: string;
    score: number;
    source: 'gravity' | 'market' | 'web';
    metadata?: Record<string, unknown>;
    timestamp?: string;
}

export interface SearchRequest {
    query: string;
    limit?: number;
    offset?: number;
    filters?: SearchFilters;
}

export interface SearchFilters {
    dateRange?: { start: string; end: string };
    sources?: string[];
    sectors?: string[];
    documentTypes?: string[];
}

export interface SearchResponse {
    results: SearchResult[];
    total: number;
    query: string;
    latencyMs: number;
}

// ── Research Reports ────────────────────────────

export interface ResearchReport {
    id: string;
    title: string;
    summary: string;
    content: string;
    citations: Citation[];
    createdAt: string;
    updatedAt: string;
    status: 'pending' | 'generating' | 'complete' | 'error';
}

export interface Citation {
    id: string;
    text: string;
    source: string;
    url: string;
    relevanceScore: number;
}

// ── Market Data ─────────────────────────────────

export interface MarketData {
    symbol: string;
    companyName: string;
    price: number;
    change: number;
    changePercent: number;
    volume: number;
    marketCap?: number;
    timestamp: string;
}

export interface MarketSentiment {
    symbol: string;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
    sources: number;
    summary: string;
}

// ── Health / API ────────────────────────────────

export interface HealthResponse {
    status: 'ok' | 'degraded' | 'error';
    timestamp: string;
    services?: Record<string, 'ok' | 'unavailable'>;
}

export interface ApiError {
    code: string;
    message: string;
    details?: unknown;
}
