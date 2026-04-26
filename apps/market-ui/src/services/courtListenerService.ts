// CourtListener — free public access to U.S. court opinions + RECAP dockets
//
// Plan §4 build-vs-buy: "Court filings | Hybrid | CourtListener (free) +
// PACER monitor | $0–$20K". This commit closes the free half — the PACER
// daily-monitor sidecar would be the paid extension if/when needed.
//
// Why finance research touches court data:
//   • SEC enforcement (SEC v. Coinbase / Ripple / Binance)
//   • Antitrust (FTC v. Microsoft-Activision, US v. Google)
//   • Patent litigation (Apple v. Samsung; Moderna v. Pfizer)
//   • Securities class actions (10-K Item 3 disclosures)
//   • M&A disputes / poison-pill cases
//
// CourtListener is free, no key required for read-only search at moderate
// volumes. Optional VITE_COURTLISTENER_TOKEN raises the rate limit.

export const COURTLISTENER_BASE = 'https://www.courtlistener.com/api/rest/v4';
const COURTLISTENER_TOKEN = import.meta.env.VITE_COURTLISTENER_TOKEN || '';

// ─── Opinion search (judicial decisions) ──────────────────────────────────

export interface OpinionResult {
    id: number;
    caseName: string;             // e.g. "Securities and Exchange Commission v. Coinbase Inc."
    court: string;                // court id (e.g. "ca9", "nysd")
    courtFull: string;            // full name (e.g. "Court of Appeals for the Ninth Circuit")
    dateFiled: string;            // YYYY-MM-DD
    citation: string;             // primary reporter citation
    snippet: string;              // search snippet from the body text
    url: string;                  // absolute CourtListener URL for the opinion
    docketNumber: string;
}

export interface OpinionSearchOptions {
    query: string;
    court?: string;               // restrict to a single court (e.g. "nysd")
    dateFiledAfter?: string;      // YYYY-MM-DD
    dateFiledBefore?: string;
    limit?: number;               // default 10, max 20
}

export function buildOpinionSearchUrl(opts: OpinionSearchOptions): string {
    const url = new URL(`${COURTLISTENER_BASE}/search/`);
    url.searchParams.set('type', 'o');                       // o = opinions
    url.searchParams.set('q', opts.query);
    url.searchParams.set('order_by', 'dateFiled desc');
    if (opts.court) url.searchParams.set('court', opts.court);
    if (opts.dateFiledAfter) url.searchParams.set('filed_after', opts.dateFiledAfter);
    if (opts.dateFiledBefore) url.searchParams.set('filed_before', opts.dateFiledBefore);
    return url.toString();
}

export function parseOpinionSearchResponse(json: unknown): OpinionResult[] {
    if (!json || typeof json !== 'object') return [];
    const rows = (json as any).results;
    if (!Array.isArray(rows)) return [];
    const out: OpinionResult[] = [];
    for (const r of rows as any[]) {
        if (!r) continue;
        const id = Number(r.id) || Number(r.cluster_id) || 0;
        if (!id) continue;
        // CourtListener exposes the snippet via `snippet` (highlighted) or
        // `text` truncated; absolute_url is the canonical web path.
        const path = String(r.absolute_url ?? '');
        const url = path
            ? (path.startsWith('http') ? path : `https://www.courtlistener.com${path}`)
            : '';
        out.push({
            id,
            caseName: String(r.caseName ?? r.case_name ?? '').trim(),
            court: String(r.court_id ?? r.court ?? '').trim(),
            courtFull: String(r.court_citation_string ?? r.court_full ?? '').trim(),
            dateFiled: String(r.dateFiled ?? r.date_filed ?? '').slice(0, 10),
            citation: Array.isArray(r.citation) && r.citation.length
                ? String(r.citation[0])
                : String(r.citation ?? ''),
            snippet: String(r.snippet ?? r.text ?? '').replace(/<\/?[^>]+>/g, '').replace(/\s+/g, ' ').slice(0, 600),
            url,
            docketNumber: String(r.docketNumber ?? r.docket_number ?? '').trim(),
        });
    }
    return out;
}

export async function searchOpinions(opts: OpinionSearchOptions): Promise<OpinionResult[]> {
    if (!opts.query || !opts.query.trim()) return [];
    const limit = Math.max(1, Math.min(opts.limit ?? 10, 20));
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (COURTLISTENER_TOKEN) headers.Authorization = `Token ${COURTLISTENER_TOKEN}`;
    const res = await fetch(buildOpinionSearchUrl(opts), { headers });
    if (!res.ok) {
        if (res.status === 429) return [];   // rate-limit → empty, never throw
        throw new Error(`CourtListener opinions: HTTP ${res.status}`);
    }
    const json = await res.json();
    return parseOpinionSearchResponse(json).slice(0, limit);
}

// ─── Docket search (RECAP — federal court filings) ────────────────────────

export interface DocketResult {
    id: number;
    caseName: string;
    court: string;
    docketNumber: string;
    dateFiled: string;            // YYYY-MM-DD
    dateLastFiling: string;
    natureOfSuit: string;         // FRCP nature-of-suit code description
    cause: string;                // e.g. "15:78m(a) Securities Exchange Act"
    url: string;
    parties: string[];            // when expanded; otherwise empty
}

export interface DocketSearchOptions {
    query: string;
    court?: string;
    natureOfSuit?: string;        // partial match
    limit?: number;
}

export function buildDocketSearchUrl(opts: DocketSearchOptions): string {
    const url = new URL(`${COURTLISTENER_BASE}/search/`);
    url.searchParams.set('type', 'r');                       // r = RECAP dockets
    url.searchParams.set('q', opts.query);
    url.searchParams.set('order_by', 'dateFiled desc');
    if (opts.court) url.searchParams.set('court', opts.court);
    if (opts.natureOfSuit) url.searchParams.set('nature_of_suit', opts.natureOfSuit);
    return url.toString();
}

export function parseDocketSearchResponse(json: unknown): DocketResult[] {
    if (!json || typeof json !== 'object') return [];
    const rows = (json as any).results;
    if (!Array.isArray(rows)) return [];
    const out: DocketResult[] = [];
    for (const r of rows as any[]) {
        if (!r) continue;
        const id = Number(r.id) || Number(r.docket_id) || 0;
        if (!id) continue;
        const path = String(r.absolute_url ?? '');
        const url = path
            ? (path.startsWith('http') ? path : `https://www.courtlistener.com${path}`)
            : '';
        const parties = Array.isArray(r.party)
            ? (r.party as any[]).map(p => String(p?.name ?? p ?? '').trim()).filter(Boolean)
            : [];
        out.push({
            id,
            caseName: String(r.caseName ?? r.case_name ?? '').trim(),
            court: String(r.court_id ?? '').trim(),
            docketNumber: String(r.docketNumber ?? r.docket_number ?? '').trim(),
            dateFiled: String(r.dateFiled ?? r.date_filed ?? '').slice(0, 10),
            dateLastFiling: String(r.dateLastFiling ?? r.date_last_filing ?? '').slice(0, 10),
            natureOfSuit: String(r.natureOfSuit ?? r.nature_of_suit ?? '').trim(),
            cause: String(r.cause ?? '').trim(),
            url,
            parties,
        });
    }
    return out;
}

export async function searchDockets(opts: DocketSearchOptions): Promise<DocketResult[]> {
    if (!opts.query || !opts.query.trim()) return [];
    const limit = Math.max(1, Math.min(opts.limit ?? 10, 20));
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (COURTLISTENER_TOKEN) headers.Authorization = `Token ${COURTLISTENER_TOKEN}`;
    const res = await fetch(buildDocketSearchUrl(opts), { headers });
    if (!res.ok) {
        if (res.status === 429) return [];
        throw new Error(`CourtListener dockets: HTTP ${res.status}`);
    }
    const json = await res.json();
    return parseDocketSearchResponse(json).slice(0, limit);
}

// ─── Litigation summary for prompt injection ──────────────────────────────
// Mirror the macro / crypto / innovation summary text helpers. Used by
// Deep Research Stage 2 to surface litigation context for queries that
// touch SEC enforcement, antitrust, patents, or securities class actions.

export async function getLitigationSummaryText(opts: {
    query: string;                 // e.g. "Coinbase SEC enforcement" or "AAPL antitrust"
    court?: string;
    dateFiledAfter?: string;       // restrict to recent filings
} = { query: '' }): Promise<string> {
    if (!opts.query || !opts.query.trim()) return '';

    const [opinionsR, docketsR] = await Promise.allSettled([
        searchOpinions({
            query: opts.query, court: opts.court,
            dateFiledAfter: opts.dateFiledAfter, limit: 5,
        }),
        searchDockets({ query: opts.query, court: opts.court, limit: 5 }),
    ]);

    const opinions = opinionsR.status === 'fulfilled' ? opinionsR.value : [];
    const dockets = docketsR.status === 'fulfilled' ? docketsR.value : [];
    const blocks: string[] = [];

    if (opinions.length > 0) {
        const lines = opinions.map(o => {
            const date = o.dateFiled || 'undated';
            const court = o.court ? ` (${o.court})` : '';
            const cite = o.citation ? ` · ${o.citation}` : '';
            return `• ${date}${court}: ${o.caseName}${cite}`;
        });
        blocks.push(`COURT OPINIONS (CourtListener):\n${lines.join('\n')}`);
    }
    if (dockets.length > 0) {
        const lines = dockets.map(d => {
            const date = d.dateFiled || 'undated';
            const cause = d.cause ? ` — ${d.cause}` : (d.natureOfSuit ? ` — ${d.natureOfSuit}` : '');
            return `• ${date}: ${d.caseName} (${d.court || 'unknown court'}, ${d.docketNumber})${cause}`;
        });
        blocks.push(`ACTIVE / RECENT DOCKETS (CourtListener RECAP):\n${lines.join('\n')}`);
    }
    return blocks.join('\n\n');
}
