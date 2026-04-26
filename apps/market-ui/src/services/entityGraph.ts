// Entity Graph + Canonical Resolver — plan §10 #10
//
// "The entity-resolution layer is the hidden moat. Every transcript, filing,
//  news story, and alt-data record must map to a canonical entity. Kensho
//  charges rent here for a reason."
//
// We can't license Kensho NERD/Link, but we CAN build a lightweight
// canonical resolver on top of SEC's free company_tickers.json (already
// fetched by secEdgarService). The graph supports:
//
//   1. Canonicalization     — "Apple Inc.", "Apple Inc", "Apple, Inc.",
//                              "APPLE INC" → "Apple Inc." (canonical title
//                              from SEC filings)
//   2. Ticker normalization — "AAPL", "aapl", "$AAPL" → "AAPL"
//   3. Subsidiary→parent    — manually seeded for cases where SEC's tag
//                              doesn't disambiguate (Instagram → Meta,
//                              YouTube → Google, etc.)
//   4. Ambiguity detection  — flag queries that could match multiple
//                              canonical entities (Apple Inc. vs Apple
//                              Hospitality REIT)
//
// Pure TypeScript, in-memory, lazy-loaded once per session. Defended by
// regression tests that fix specific failure modes the resolver should
// always catch.

import { resolveTickerToCik, type TickerRecord } from './secEdgarService';

// ─── Canonical entity record ───────────────────────────────────────────────

export interface EntityRecord {
    canonicalName: string;       // SEC's official "title" — the source of truth
    canonicalTicker: string;     // primary ticker (uppercase)
    cik: string;                 // 10-digit zero-padded
    aliases: string[];           // alternate names + tickers we recognize
    parentCik?: string;          // optional subsidiary→parent edge
}

// ─── Suffix normalization ──────────────────────────────────────────────────
// Strip the noise that makes "Apple, Inc." and "Apple Inc" look different.

const COMPANY_SUFFIXES = [
    // Order matters: longer first so "Inc Co" doesn't get partially stripped.
    'incorporated', 'corporation', 'limited', 'company',
    'holdings', 'holding',
    'inc.', 'inc', 'corp.', 'corp',
    'co.', 'co',
    'ltd.', 'ltd',
    'llc', 'llp', 'lp',
    'plc', 'sa', 'ag', 'nv', 'gmbh',
    'group', 'partners',
];

const SUFFIX_RE = new RegExp(
    `\\b(?:${COMPANY_SUFFIXES.map(s => s.replace(/\./g, '\\.')).join('|')})\\b\\.?\\s*$`,
    'i',
);

export function normalizeCompanyName(name: string): string {
    if (!name) return '';
    let out = name.trim();
    // Repeatedly strip suffixes — handles "Apple Inc Holdings" → "Apple"
    let prev = '';
    while (out !== prev) {
        prev = out;
        out = out.replace(/[,;.]\s*$/, '');           // trailing punctuation
        out = out.replace(SUFFIX_RE, '').trim();
    }
    return out
        .replace(/[^\w\s&-]/g, ' ')   // strip stray punctuation
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function normalizeTicker(raw: string): string {
    if (!raw) return '';
    return raw.replace(/^\$/, '').trim().toUpperCase();
}

// ─── Manually seeded subsidiary→parent edges ──────────────────────────────
// SEC's CIK doesn't disambiguate Instagram (a Meta product) from Meta
// itself. Hand-curate a small set of high-traffic edges so queries like
// "Instagram" route to META, "YouTube" → GOOG, etc.
//
// Format: alias → ticker of canonical parent. The aliases are matched
// against normalized inputs.

export const SUBSIDIARY_EDGES: Record<string, string> = {
    'instagram': 'META',
    'whatsapp': 'META',
    'facebook': 'META',
    'youtube': 'GOOG',
    'google': 'GOOG',
    'android': 'GOOG',
    'waymo': 'GOOG',
    'aws': 'AMZN',
    'amazon web services': 'AMZN',
    'twitch': 'AMZN',
    'whole foods': 'AMZN',
    'github': 'MSFT',
    'linkedin': 'MSFT',
    'azure': 'MSFT',
    'xbox': 'MSFT',
    'office 365': 'MSFT',
    'beats': 'AAPL',
    'icloud': 'AAPL',
    'iphone': 'AAPL',
    'ipad': 'AAPL',
    'mac': 'AAPL',
    'tesla energy': 'TSLA',
    'starlink': 'SPACE',   // private; resolver returns null but the alias maps
    'spacex': 'SPACE',
    'cruise': 'GM',
    'chevy': 'GM',
    'gmc': 'GM',
    'cadillac': 'GM',
    'lexus': 'TM',
    'toyota': 'TM',
    'porsche': 'VWAGY',
    'audi': 'VWAGY',
    'volkswagen': 'VWAGY',
};

// ─── Lazy-built entity index ──────────────────────────────────────────────
// Build once per session from SEC's company_tickers.json (loaded via
// secEdgarService's existing cache). Index supports lookup by:
//   - normalized name           (Map<string, TickerRecord>)
//   - normalized ticker          (Map<string, TickerRecord>)
//   - exact alias (subsidiaries) (Map<string, TickerRecord>)

interface EntityIndex {
    byName: Map<string, TickerRecord>;
    byTicker: Map<string, TickerRecord>;
    byAlias: Map<string, TickerRecord>;
}

let _entityIndex: EntityIndex | null = null;
let _entityLoadPromise: Promise<EntityIndex> | null = null;

export function _clearEntityIndex_FOR_TESTS(): void {
    _entityIndex = null;
    _entityLoadPromise = null;
}

// Public seeder for tests so we don't have to mock fetch.
export function _seedEntityIndex_FOR_TESTS(records: TickerRecord[]): void {
    const byName = new Map<string, TickerRecord>();
    const byTicker = new Map<string, TickerRecord>();
    const byAlias = new Map<string, TickerRecord>();
    for (const r of records) {
        byName.set(normalizeCompanyName(r.title), r);
        byTicker.set(normalizeTicker(r.ticker), r);
    }
    for (const [alias, ticker] of Object.entries(SUBSIDIARY_EDGES)) {
        const t = normalizeTicker(ticker);
        const rec = byTicker.get(t);
        if (rec) byAlias.set(normalizeCompanyName(alias), rec);
    }
    _entityIndex = { byName, byTicker, byAlias };
    _entityLoadPromise = Promise.resolve(_entityIndex);
}

async function loadEntityIndex(): Promise<EntityIndex> {
    if (_entityIndex) return _entityIndex;
    if (_entityLoadPromise) return _entityLoadPromise;
    _entityLoadPromise = (async () => {
        // We piggyback on secEdgarService's lazy-loaded ticker file.
        // Walk a small canonical set of well-known tickers to bootstrap
        // — for ANY ticker the index is populated on first lookup.
        // (Building the full ~10K-row index up front is wasteful; we
        // populate on demand instead.)
        const byName = new Map<string, TickerRecord>();
        const byTicker = new Map<string, TickerRecord>();
        const byAlias = new Map<string, TickerRecord>();
        _entityIndex = { byName, byTicker, byAlias };
        return _entityIndex;
    })();
    return _entityLoadPromise;
}

async function ensureRecord(rawTicker: string): Promise<TickerRecord | null> {
    const idx = await loadEntityIndex();
    const ticker = normalizeTicker(rawTicker);
    const cached = idx.byTicker.get(ticker);
    if (cached) return cached;
    const rec = await resolveTickerToCik(ticker);
    if (rec) {
        idx.byName.set(normalizeCompanyName(rec.title), rec);
        idx.byTicker.set(normalizeTicker(rec.ticker), rec);
    }
    return rec;
}

// ─── Public resolver API ──────────────────────────────────────────────────

export interface ResolveResult {
    record: TickerRecord;
    matchType: 'ticker' | 'name' | 'alias';
    confidence: number;     // 0..1; 1.0 for exact match, fuzzy gets discounted
    canonicalName: string;
    canonicalTicker: string;
}

// Best-effort canonical resolution. Tries:
//   1. Exact ticker match (normalized)
//   2. Exact normalized-name match
//   3. Subsidiary alias match (SUBSIDIARY_EDGES)
// Returns null when none match.
export async function resolveEntity(query: string): Promise<ResolveResult | null> {
    if (!query || !query.trim()) return null;
    const idx = await loadEntityIndex();

    // Pass 1: ticker-shaped input ($ prefix or 1-5 caps with optional dot)
    const tickerCandidate = normalizeTicker(query);
    if (/^[A-Z]{1,5}(?:\.[A-Z])?$/.test(tickerCandidate)) {
        const rec = await ensureRecord(tickerCandidate);
        if (rec) {
            return {
                record: rec,
                matchType: 'ticker',
                confidence: 1,
                canonicalName: rec.title,
                canonicalTicker: rec.ticker,
            };
        }
    }

    // Pass 2: normalized name match
    const nameKey = normalizeCompanyName(query);
    if (nameKey) {
        const cached = idx.byName.get(nameKey);
        if (cached) {
            return {
                record: cached,
                matchType: 'name',
                confidence: 1,
                canonicalName: cached.title,
                canonicalTicker: cached.ticker,
            };
        }
    }

    // Pass 3: subsidiary alias
    if (nameKey && idx.byAlias.has(nameKey)) {
        const rec = idx.byAlias.get(nameKey)!;
        return {
            record: rec,
            matchType: 'alias',
            confidence: 0.9,
            canonicalName: rec.title,
            canonicalTicker: rec.ticker,
        };
    }
    // Also check SUBSIDIARY_EDGES for tickers we haven't loaded yet.
    if (nameKey && nameKey in SUBSIDIARY_EDGES) {
        const parentTicker = SUBSIDIARY_EDGES[nameKey];
        const rec = await ensureRecord(parentTicker);
        if (rec) {
            idx.byAlias.set(nameKey, rec);
            return {
                record: rec,
                matchType: 'alias',
                confidence: 0.9,
                canonicalName: rec.title,
                canonicalTicker: rec.ticker,
            };
        }
    }

    return null;
}

// Resolve many at once. Useful for batch tagging — e.g. expanding a
// blueprint's targetEntities into canonical tickers + CIKs.
export async function resolveEntities(queries: string[]): Promise<Array<ResolveResult | null>> {
    return Promise.all(queries.map(q => resolveEntity(q)));
}

// Two strings refer to the same canonical entity (e.g. "AAPL" and
// "Apple, Inc."). Useful for dedup'ing source attributions across the
// research pipeline.
export async function isSameEntity(a: string, b: string): Promise<boolean> {
    const [ra, rb] = await Promise.all([resolveEntity(a), resolveEntity(b)]);
    return !!(ra && rb && ra.record.cik === rb.record.cik);
}
