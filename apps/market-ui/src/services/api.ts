// API Client — calls backend with auth token, idempotency keys, W3C trace
// context, and exponential-backoff retries on transient failures.
//
// Plan §6.13:
//   • Idempotency keys on POST endpoints (long-running research queries
//     can be retried safely without duplicate work)
//   • W3C trace context (traceparent) so request traces stitch end-to-end
//     into Langfuse / OTel
//   • Exponential backoff with circuit-breaker-lite per host

import { getAccessToken } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3002';

// ─── W3C Trace Context (traceparent) helpers ───────────────────────────────
// version-traceId-spanId-flags
//   traceparent: 00-{32-hex-traceId}-{16-hex-spanId}-01

const HEX = '0123456789abcdef';
function randomHex(bytes: number): string {
    let out = '';
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const buf = new Uint8Array(bytes);
        crypto.getRandomValues(buf);
        for (const b of buf) out += b.toString(16).padStart(2, '0');
        return out;
    }
    for (let i = 0; i < bytes * 2; i++) out += HEX[Math.floor(Math.random() * 16)];
    return out;
}

export function newTraceId(): string {
    return randomHex(16);   // 32 hex chars
}
export function newSpanId(): string {
    return randomHex(8);    // 16 hex chars
}
export function newTraceparent(): string {
    return `00-${newTraceId()}-${newSpanId()}-01`;
}

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-(00|01)$/i;
export function isValidTraceparent(s: string): boolean {
    return typeof s === 'string' && TRACEPARENT_RE.test(s)
        // Reject all-zero trace/span ids (W3C spec).
        && !/^00-0{32}-/.test(s) && !/-0{16}-/.test(s);
}

// ─── Idempotency keys ──────────────────────────────────────────────────────
// UUID-style client-generated key. The same key replayed within the
// server's idempotency window must yield the same result; safe to retry.

export function newIdempotencyKey(): string {
    if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
        return (crypto as any).randomUUID();
    }
    // RFC 4122 v4 fallback.
    const t = randomHex(16);
    return `${t.slice(0, 8)}-${t.slice(8, 12)}-4${t.slice(13, 16)}-${(((parseInt(t.slice(16, 17), 16) & 0x3) | 0x8)).toString(16)}${t.slice(17, 20)}-${t.slice(20, 32)}`;
}

const NON_IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ─── Retry policy + circuit-breaker-lite ───────────────────────────────────
// Retry on: network error, 408, 429, 500, 502, 503, 504. Retry on:
// idempotent methods always; non-idempotent only when an idempotency key
// is present (server-side dedupe is what makes the retry safe).

export const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface RetryOptions {
    attempts?: number;        // total attempts (including the first); default 3
    baseMs?: number;          // base backoff; default 250
    maxMs?: number;           // ceiling per backoff; default 4000
}

export function backoffDelayMs(attempt: number, opts: RetryOptions = {}): number {
    // attempt is 1-indexed (1 = first retry, i.e. after the initial failure)
    const base = opts.baseMs ?? 250;
    const max = opts.maxMs ?? 4000;
    const exp = Math.min(base * Math.pow(2, attempt - 1), max);
    // ±25% jitter so concurrent clients don't synchronize their retries.
    const jitter = exp * (0.75 + Math.random() * 0.5);
    return Math.round(jitter);
}

// Per-host circuit breaker. Trip after N consecutive failures; cool down
// for COOLDOWN_MS before allowing a probe through. Tripped breakers
// short-circuit with a synthetic 503 instead of waiting on the network.

interface BreakerState {
    failures: number;
    openedAt: number;          // timestamp; 0 if closed
}
const BREAKER_TRIP_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 30_000;
const _breakers = new Map<string, BreakerState>();

export function _resetBreakers_FOR_TESTS(): void {
    _breakers.clear();
}

function hostKey(url: string): string {
    try { return new URL(url, API_BASE).host; }
    catch { return 'unknown'; }
}

export function isBreakerOpen(host: string, nowMs: number = Date.now()): boolean {
    const b = _breakers.get(host);
    if (!b || b.openedAt === 0) return false;
    return (nowMs - b.openedAt) < BREAKER_COOLDOWN_MS;
}

function recordSuccess(host: string): void {
    _breakers.set(host, { failures: 0, openedAt: 0 });
}

function recordFailure(host: string, nowMs: number = Date.now()): void {
    const b = _breakers.get(host) ?? { failures: 0, openedAt: 0 };
    b.failures += 1;
    if (b.failures >= BREAKER_TRIP_THRESHOLD) b.openedAt = nowMs;
    _breakers.set(host, b);
}

// ─── Hardened fetch ────────────────────────────────────────────────────────

export interface AuthFetchOptions extends RequestInit {
    retry?: RetryOptions | false;     // pass false to disable retry
    idempotencyKey?: string;          // explicit override; auto-generated otherwise
    traceparent?: string;             // explicit override; auto-generated otherwise
}

async function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

async function authFetch(path: string, options: AuthFetchOptions = {}): Promise<Response> {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const url = `${API_BASE}${path}`;
    const host = hostKey(url);

    // Circuit breaker — short-circuit fast when the host is in cooldown.
    if (isBreakerOpen(host)) {
        throw new Error(`Circuit open for ${host} — retry after cooldown`);
    }

    const method = (options.method ?? 'GET').toUpperCase();
    const isWrite = NON_IDEMPOTENT_METHODS.has(method);

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        traceparent: options.traceparent ?? newTraceparent(),
        ...(options.headers as Record<string, string> | undefined),
    };
    if (isWrite) {
        headers['Idempotency-Key'] = options.idempotencyKey ?? newIdempotencyKey();
    }

    const retryOpts = options.retry === false ? null : (options.retry ?? {});
    const attempts = retryOpts ? (retryOpts.attempts ?? 3) : 1;

    let lastErr: Error | null = null;
    for (let i = 0; i < attempts; i++) {
        try {
            const response = await fetch(url, { ...options, method, headers });
            if (response.ok) {
                recordSuccess(host);
                return response;
            }
            // Non-retryable HTTP error → throw immediately.
            if (!RETRYABLE_STATUSES.has(response.status)) {
                recordFailure(host);
                const err = await response.json().catch(() => ({ error: 'Request failed' }));
                throw new Error(err.error || `HTTP ${response.status}`);
            }
            // Retryable: only retry write methods when idempotency key is present.
            if (isWrite && !headers['Idempotency-Key']) {
                recordFailure(host);
                throw new Error(`HTTP ${response.status}`);
            }
            recordFailure(host);
            lastErr = new Error(`HTTP ${response.status}`);
        } catch (e: any) {
            recordFailure(host);
            lastErr = e instanceof Error ? e : new Error(String(e));
        }
        if (i < attempts - 1) {
            await sleep(backoffDelayMs(i + 1, retryOpts ?? {}));
        }
    }
    throw lastErr ?? new Error('Request failed');
}

// ─── Existing endpoints ────────────────────────────────────────────────────

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
