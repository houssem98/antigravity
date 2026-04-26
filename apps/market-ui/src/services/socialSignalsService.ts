// Social Signals Service — Reddit + StockTwits
//
// Plan §6.9: "Treat influencer signals as context, never a citation source —
//             compliance will reject it otherwise. Tag retrieval results as
//             'sentiment, unverified.'"
//
// Two free public read APIs. Both return aggregate-only views that we
// surface as METADATA / CONTEXT in research reports — the calling layer
// must enforce that posts NEVER end up in the citation list.

// ─── Reddit (public read-only JSON) ────────────────────────────────────────
// /r/{sub}/search.json?q=X&restrict_sr=1 — no auth required, rate-limited
// to ~10 req/min anonymous. We send a research-tool User-Agent so Reddit's
// abuse system can fingerprint us cleanly.

export const REDDIT_BASE = 'https://www.reddit.com';
export const REDDIT_USER_AGENT = 'market-ui/1.0 deep-research client (+https://github.com/houssem98/antigravity)';

export interface RedditPost {
    subreddit: string;
    id: string;
    title: string;
    selftext: string;       // truncated to 600 chars
    author: string;
    score: number;
    numComments: number;
    createdAt: string;      // ISO date
    permalink: string;      // https://reddit.com/{permalink}
}

export interface RedditSearchOptions {
    subreddits?: string[];  // default: high-traffic equity subs
    query: string;
    limit?: number;         // default 10, max 25
    sort?: 'relevance' | 'new' | 'top';
    timeframe?: 'day' | 'week' | 'month' | 'year' | 'all';
}

const DEFAULT_EQUITY_SUBS = ['wallstreetbets', 'stocks', 'investing', 'StockMarket', 'options'];

export function buildRedditSearchUrl(opts: RedditSearchOptions): string {
    const subs = opts.subreddits && opts.subreddits.length > 0 ? opts.subreddits : DEFAULT_EQUITY_SUBS;
    const subPath = subs.length === 1 ? subs[0] : subs.join('+');
    const url = new URL(`${REDDIT_BASE}/r/${subPath}/search.json`);
    url.searchParams.set('q', opts.query);
    url.searchParams.set('restrict_sr', '1');
    url.searchParams.set('limit', String(Math.max(1, Math.min(opts.limit ?? 10, 25))));
    url.searchParams.set('sort', opts.sort ?? 'relevance');
    url.searchParams.set('t', opts.timeframe ?? 'week');
    return url.toString();
}

export function parseRedditResponse(json: unknown): RedditPost[] {
    if (!json || typeof json !== 'object') return [];
    const children = (json as any)?.data?.children;
    if (!Array.isArray(children)) return [];
    const out: RedditPost[] = [];
    for (const c of children as any[]) {
        const d = c?.data;
        if (!d) continue;
        const id = String(d.id ?? '');
        const title = String(d.title ?? '').trim();
        if (!id || !title) continue;
        const selftext = String(d.selftext ?? '');
        out.push({
            subreddit: String(d.subreddit ?? ''),
            id,
            title,
            selftext: selftext.length > 600 ? selftext.slice(0, 597) + '…' : selftext,
            author: String(d.author ?? ''),
            score: Number(d.score) || 0,
            numComments: Number(d.num_comments) || 0,
            createdAt: typeof d.created_utc === 'number'
                ? new Date(d.created_utc * 1000).toISOString()
                : '',
            permalink: d.permalink ? `${REDDIT_BASE}${d.permalink}` : '',
        });
    }
    return out.sort((a, b) => b.score - a.score);
}

export async function searchReddit(opts: RedditSearchOptions): Promise<RedditPost[]> {
    if (!opts.query || !opts.query.trim()) return [];
    const url = buildRedditSearchUrl(opts);
    const res = await fetch(url, { headers: { 'User-Agent': REDDIT_USER_AGENT } });
    if (!res.ok) {
        // Reddit serves 429 / 403 with surprising frequency; treat them as
        // "no signal" rather than throwing. Network outages still throw.
        if (res.status === 403 || res.status === 429) return [];
        throw new Error(`Reddit: HTTP ${res.status}`);
    }
    const json = await res.json();
    return parseRedditResponse(json);
}

// ─── StockTwits (public read-only) ────────────────────────────────────────
// /api/2/streams/symbol/{symbol}.json — free, no auth needed.
// Posts include built-in sentiment classification when the user opted in:
// entities.sentiment.basic = "Bullish" | "Bearish" | null.

export const STOCKTWITS_BASE = 'https://api.stocktwits.com/api/2/streams/symbol';

export type StockTwitSentiment = 'Bullish' | 'Bearish' | null;

export interface StockTwitMessage {
    id: number;
    body: string;          // truncated to 600 chars
    sentiment: StockTwitSentiment;
    createdAt: string;
    user: {
        username: string;
        followers: number;
    };
}

export interface StockTwitStream {
    symbol: string;
    messages: StockTwitMessage[];
    sentiment: {
        bullish: number;       // count of bullish messages in stream
        bearish: number;
        unrated: number;
        bullishPct: number;    // 0..1, of rated messages only
    };
}

export function parseStockTwitsResponse(json: unknown, symbol: string): StockTwitStream | null {
    if (!json || typeof json !== 'object') return null;
    const root = json as any;
    if (root.response?.status && root.response.status !== 200) return null;
    const msgs = root.messages;
    if (!Array.isArray(msgs)) return null;

    const messages: StockTwitMessage[] = [];
    let bullish = 0, bearish = 0, unrated = 0;

    for (const m of msgs as any[]) {
        if (!m) continue;
        const body = String(m.body ?? '');
        const id = Number(m.id) || 0;
        // Skip messages that lack BOTH a numeric id and a non-empty body —
        // StockTwits occasionally returns placeholder records whose
        // sentiment classification would otherwise be miscounted.
        if (id === 0 && body.length === 0) continue;
        const sentRaw = m.entities?.sentiment?.basic;
        const sent: StockTwitSentiment = sentRaw === 'Bullish' || sentRaw === 'Bearish'
            ? sentRaw : null;
        if (sent === 'Bullish') bullish += 1;
        else if (sent === 'Bearish') bearish += 1;
        else unrated += 1;
        messages.push({
            id,
            body: body.length > 600 ? body.slice(0, 597) + '…' : body,
            sentiment: sent,
            createdAt: String(m.created_at ?? ''),
            user: {
                username: String(m.user?.username ?? ''),
                followers: Number(m.user?.followers) || 0,
            },
        });
    }

    const rated = bullish + bearish;
    return {
        symbol: symbol.toUpperCase(),
        messages,
        sentiment: {
            bullish, bearish, unrated,
            bullishPct: rated > 0 ? bullish / rated : 0,
        },
    };
}

export async function fetchStockTwitsStream(symbol: string): Promise<StockTwitStream | null> {
    const sym = (symbol || '').replace(/^\$/, '').trim().toUpperCase();
    if (!sym) return null;
    const url = `${STOCKTWITS_BASE}/${encodeURIComponent(sym)}.json`;
    const res = await fetch(url);
    if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`StockTwits: HTTP ${res.status}`);
    }
    const json = await res.json();
    return parseStockTwitsResponse(json, sym);
}

// ─── Unified social-sentiment summary (compliance-tagged) ──────────────────
// Plan §6.9: "Tag retrieval results as 'sentiment, unverified.'"
//
// Returns a prompt-ready text block that the Deep Research synthesizer
// can inject as CONTEXT only. The header explicitly disclaims that this
// content is unverified user-generated commentary, suitable for
// gauging market temperature but NOT as a citation source.

export interface SocialSummary {
    text: string;              // formatted block, empty when no signal
    redditPosts: number;
    stockTwitsMessages: number;
    bullishPct: number | null; // null when no rated messages
}

export async function getSocialSentimentSummary(opts: {
    ticker?: string;
    query?: string;            // defaults to ticker if not set
    redditLimit?: number;
} = {}): Promise<SocialSummary> {
    const ticker = (opts.ticker ?? '').trim().toUpperCase();
    const query = opts.query ?? ticker;
    if (!query) return { text: '', redditPosts: 0, stockTwitsMessages: 0, bullishPct: null };

    const [redditR, stR] = await Promise.allSettled([
        searchReddit({ query, limit: opts.redditLimit ?? 5, sort: 'top', timeframe: 'week' }),
        ticker ? fetchStockTwitsStream(ticker) : Promise.resolve(null),
    ]);

    const reddit = redditR.status === 'fulfilled' ? redditR.value : [];
    const st = stR.status === 'fulfilled' ? stR.value : null;

    const blocks: string[] = [];
    if (reddit.length > 0) {
        const lines = reddit.slice(0, 5).map(p =>
            `• r/${p.subreddit} · ${p.score}↑ ${p.numComments}💬 — "${p.title.slice(0, 140)}"`,
        );
        blocks.push(`REDDIT TOP POSTS (last week, unverified user commentary — DO NOT cite):\n${lines.join('\n')}`);
    }
    if (st && st.messages.length > 0) {
        const totalRated = st.sentiment.bullish + st.sentiment.bearish;
        const sentimentLine = totalRated > 0
            ? `${Math.round(st.sentiment.bullishPct * 100)}% bullish / ${Math.round((1 - st.sentiment.bullishPct) * 100)}% bearish across ${totalRated} rated messages`
            : `${st.messages.length} messages, none classified`;
        blocks.push(`STOCKTWITS $${st.symbol} (unverified retail sentiment — DO NOT cite):\n• ${sentimentLine}\n• ${st.sentiment.bullish} bullish · ${st.sentiment.bearish} bearish · ${st.sentiment.unrated} unrated`);
    }

    const text = blocks.length > 0
        ? `SOCIAL SIGNALS (CONTEXT ONLY — sentiment is unverified user-generated content; never use as a citation source or numeric evidence):\n\n${blocks.join('\n\n')}`
        : '';

    return {
        text,
        redditPosts: reddit.length,
        stockTwitsMessages: st?.messages.length ?? 0,
        bullishPct: st && (st.sentiment.bullish + st.sentiment.bearish) > 0 ? st.sentiment.bullishPct : null,
    };
}
