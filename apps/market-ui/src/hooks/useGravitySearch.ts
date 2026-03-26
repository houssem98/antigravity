// useGravitySearch — WebSocket streaming hook for Gravity Search
// Connects directly to Gravity's FastAPI backend via native WebSocket.
// Streams tokens in real-time, populates sources and citations as they arrive.

import { useState, useCallback, useRef } from 'react';

const GRAVITY_WS =
    typeof window !== 'undefined'
        ? `ws://${window.location.hostname}:8000/v1/search/stream`
        : 'ws://localhost:8000/v1/search/stream';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SearchStatus =
    | 'idle' | 'understanding' | 'searching' | 'reranking'
    | 'reasoning' | 'validating' | 'complete' | 'error';

export interface GravitySource {
    chunk_id: string;
    document_id: string;
    text: string;
    ticker: string;
    document_title: string;
    section: string;
    filing_date: string;
    page: number | null;
    score: number;
    retrieval_method: string;
}

export interface GravityCitation {
    citation_number: number;
    chunk_id: string;
    text: string;
    document_title: string;
    ticker: string;
    section: string;
    is_verified: boolean;
}

export interface GravityMetric {
    metric: string;
    value: string | number;
    unit?: string;
    period?: string;
    ticker?: string;
    entity?: string;
    row_id?: string;
    source_id?: string;
}

export interface ChartSpec {
    chart_id: string;
    chart_type: 'line' | 'bar' | 'stacked_bar' | 'area';
    title: string;
    x_axis: string;
    y_axis: string;
    y_label?: string;
    series: Array<{ entity?: string; metric: string }>;
    data_refs: string[];
}

export interface AgentTraceStep {
    agent: 'Planner' | 'Reader' | 'Extractor' | 'Critic' | 'Verifier' | 'Writer';
    action: string;
    detail: string;
    iteration: number;
    quality_score?: number;
    timestamp: number;
}

export interface GravitySearchState {
    status: SearchStatus;
    streamingAnswer: string;       // tokens as they arrive
    finalAnswer: string;           // complete answer after streaming
    sources: GravitySource[];
    citations: GravityCitation[];
    structuredData: GravityMetric[];
    chartSpecs: ChartSpec[];
    followUpQueries: string[];
    confidence: number;
    error: string | null;
    latencyMs: number | null;
    modelUsed: string | null;
    cacheHit: boolean;
    // Agentic mode: live reasoning trace
    agentSteps: AgentTraceStep[];
    agentTraceComplete: boolean;
    totalIterations: number;
    totalCostUsd: number | null;
}

const INITIAL_STATE: GravitySearchState = {
    status: 'idle',
    streamingAnswer: '',
    finalAnswer: '',
    sources: [],
    citations: [],
    structuredData: [],
    chartSpecs: [],
    followUpQueries: [],
    confidence: 0,
    error: null,
    latencyMs: null,
    modelUsed: null,
    cacheHit: false,
    agentSteps: [],
    agentTraceComplete: false,
    totalIterations: 0,
    totalCostUsd: null,
};

// ─── Filter types ─────────────────────────────────────────────────────────────

export interface SearchFilters {
    document_types?: string[];   // e.g. ['10-K', '10-Q', 'earnings_transcript']
    companies?: string[];        // ticker symbols
    date_range?: { from?: string; to?: string };
    sections?: string[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGravitySearch() {
    const [state, setState] = useState<GravitySearchState>(INITIAL_STATE);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectRef = useRef(0);
    const traceIdRef = useRef('');

    const reset = useCallback(() => {
        wsRef.current?.close();
        wsRef.current = null;
        setState(INITIAL_STATE);
    }, []);

    const search = useCallback((query: string, conversationId?: string, filters?: SearchFilters) => {
        // Cancel any in-flight search
        wsRef.current?.close();
        wsRef.current = null;
        reconnectRef.current = 0;

        const traceId = crypto.randomUUID();
        traceIdRef.current = traceId;

        setState({ ...INITIAL_STATE, status: 'understanding' });

        function connect() {
            const ws = new WebSocket(`${GRAVITY_WS}?trace_id=${traceId}`);
            wsRef.current = ws;

            ws.onopen = () => {
                reconnectRef.current = 0;
                ws.send(JSON.stringify({
                    query,
                    trace_id: traceId,
                    conversation_id: conversationId,
                    filters: filters && Object.keys(filters).length > 0 ? filters : undefined,
                }));
            };

            ws.onmessage = (ev) => {
                try {
                    const msg = JSON.parse(ev.data as string);
                    const { type, data } = msg;

                    setState(prev => {
                        switch (type) {
                            case 'status':
                                return { ...prev, status: data.status as SearchStatus };
                            case 'sources':
                                return { ...prev, sources: data.sources ?? [] };
                            case 'token':
                                return { ...prev, streamingAnswer: prev.streamingAnswer + (data.token ?? '') };
                            case 'answer':
                                return {
                                    ...prev,
                                    status: 'complete',
                                    finalAnswer: data.answer ?? '',
                                    streamingAnswer: '',
                                    citations: data.citations ?? [],
                                    confidence: data.confidence ?? 0,
                                    followUpQueries: data.follow_up_queries ?? [],
                                    structuredData: data.structured_data ?? [],
                                    chartSpecs: data.chart_specs ?? [],
                                };
                            case 'agent_trace':
                                return {
                                    ...prev,
                                    agentSteps: [
                                        ...prev.agentSteps,
                                        {
                                            agent: data.agent,
                                            action: data.action,
                                            detail: data.detail ?? '',
                                            iteration: data.iteration ?? 0,
                                            quality_score: data.quality_score,
                                            timestamp: Date.now(),
                                        } as AgentTraceStep,
                                    ],
                                };
                            case 'agent_trace_complete':
                                return {
                                    ...prev,
                                    agentTraceComplete: true,
                                    totalIterations: data.total_iterations ?? 0,
                                    totalCostUsd: data.total_cost_usd ?? null,
                                };
                            case 'metadata':
                                return {
                                    ...prev,
                                    latencyMs: data.latency_ms ?? null,
                                    modelUsed: data.model_used ?? null,
                                    cacheHit: data.cache_hit ?? false,
                                };
                            case 'error':
                                return { ...prev, status: 'error', error: data.message ?? 'Search failed' };
                            default:
                                return prev;
                        }
                    });
                } catch { /* ignore malformed frames */ }
            };

            ws.onclose = () => {
                if (reconnectRef.current < 3) {
                    const delay = 1000 * Math.pow(2, reconnectRef.current++);
                    setTimeout(connect, delay);
                } else {
                    setState(prev => {
                        if (prev.status === 'complete' || prev.status === 'error') return prev;
                        if (prev.finalAnswer || prev.streamingAnswer || prev.sources.length > 0) {
                            return { ...prev, status: 'complete' };
                        }
                        return {
                            ...prev,
                            status: 'error',
                            error: 'Could not connect to the Gravity backend (port 8000). Make sure the API is running.',
                        };
                    });
                }
            };

            ws.onerror = () => { /* onclose handles reconnect */ };
        }

        connect();
    }, []);

    const cancel = useCallback(() => {
        wsRef.current?.close();
        wsRef.current = null;
        setState(prev => ({ ...prev, status: 'idle' }));
    }, []);

    // The text to display: streaming tokens while in-flight, final answer when done
    const displayAnswer = state.finalAnswer || state.streamingAnswer;

    return { state, displayAnswer, search, cancel, reset };
}
