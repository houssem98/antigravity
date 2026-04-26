// CoinGecko Free API — no API key required (30 req/min limit)

const BASE = 'https://api.coingecko.com/api/v3';

export interface CoinMarket {
    id: string;
    symbol: string;
    name: string;
    image: string;
    current_price: number;
    market_cap: number;
    market_cap_rank: number;
    total_volume: number;
    price_change_percentage_1h_in_currency: number | null;
    price_change_percentage_24h_in_currency: number | null;
    price_change_percentage_7d_in_currency: number | null;
    circulating_supply: number;
    total_supply: number | null;
    ath: number;
    ath_change_percentage: number;
    sparkline_in_7d: { price: number[] } | null;
}

export interface GlobalStats {
    total_market_cap: { usd: number };
    total_volume: { usd: number };
    market_cap_percentage: { btc: number; eth: number };
    market_cap_change_percentage_24h_usd: number;
    active_cryptocurrencies: number;
}

export interface TrendingCoin {
    item: {
        id: string;
        name: string;
        symbol: string;
        thumb: string;
        market_cap_rank: number;
        data: { price_change_percentage_24h: { usd: number } | null };
    };
}

export const cryptoMarketService = {
    async getTopCoins(page = 1, perPage = 100): Promise<CoinMarket[]> {
        const url = `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=true&price_change_percentage=1h,24h,7d`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
        return res.json();
    },

    async getGlobalStats(): Promise<GlobalStats> {
        const res = await fetch(`${BASE}/global`);
        if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
        const data = await res.json();
        return data.data as GlobalStats;
    },

    async getTrending(): Promise<TrendingCoin[]> {
        const res = await fetch(`${BASE}/search/trending`);
        if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
        const data = await res.json();
        return data.coins as TrendingCoin[];
    },

    async getCoinOHLC(id: string, days = 7): Promise<[number, number, number, number, number][]> {
        const res = await fetch(`${BASE}/coins/${id}/ohlc?vs_currency=usd&days=${days}`);
        if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
        return res.json();
    },
};

// ─── Formatters (shared) ──────────────────────────────────────────────────────

export function fmtPrice(n: number): string {
    if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    if (n >= 1) return `$${n.toFixed(4)}`;
    if (n >= 0.001) return `$${n.toFixed(6)}`;
    return `$${n.toFixed(10)}`;
}

export function fmtLarge(n: number): string {
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    return `$${n.toLocaleString()}`;
}

export function fmtPct(n: number | null): string {
    if (n === null || isNaN(n)) return '—';
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function pctColor(n: number | null): string {
    if (n === null) return 'text-[#A7B0C8]';
    return n >= 0 ? 'text-emerald-400' : 'text-red-400';
}

// ─── DefiLlama — free DeFi TVL + stablecoin metrics (plan §6.8) ───────────
// No API key. Rate limit unspecified but generous; the site itself runs
// on these endpoints. Useful for cross-asset / DeFi research.

export const DEFILLAMA_BASE = 'https://api.llama.fi';
export const DEFILLAMA_STABLES_BASE = 'https://stablecoins.llama.fi';

export interface DefiProtocol {
    name: string;
    slug: string;
    category: string;
    chain: string;        // primary chain
    tvl: number;          // current USD TVL
    chainTvls?: Record<string, number>;
    change_1d?: number | null;
    change_7d?: number | null;
}

export interface ChainTvl {
    name: string;
    tvl: number;
    tokenSymbol?: string;
    chainId?: number;
}

export interface StablecoinTotal {
    name: string;
    symbol: string;
    pegType: string;
    circulating: number;       // USD (or peg-currency) circulating supply
    chainCirculating?: Record<string, number>;
}

// Fetch top N DeFi protocols by current TVL.
export async function fetchTopDefiProtocols(limit = 25): Promise<DefiProtocol[]> {
    const res = await fetch(`${DEFILLAMA_BASE}/protocols`);
    if (!res.ok) throw new Error(`DefiLlama protocols: HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return (data as any[])
        .filter(p => p && typeof p.tvl === 'number')
        .map(p => ({
            name: String(p.name ?? ''),
            slug: String(p.slug ?? p.name ?? ''),
            category: String(p.category ?? ''),
            chain: String(p.chain ?? ''),
            tvl: Number(p.tvl) || 0,
            chainTvls: p.chainTvls && typeof p.chainTvls === 'object' ? p.chainTvls : undefined,
            change_1d: typeof p.change_1d === 'number' ? p.change_1d : null,
            change_7d: typeof p.change_7d === 'number' ? p.change_7d : null,
        }))
        .sort((a, b) => b.tvl - a.tvl)
        .slice(0, limit);
}

// Fetch TVL aggregated by chain (Ethereum, Solana, BSC, …).
export async function fetchChainTvls(): Promise<ChainTvl[]> {
    const res = await fetch(`${DEFILLAMA_BASE}/v2/chains`);
    if (!res.ok) throw new Error(`DefiLlama chains: HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return (data as any[])
        .filter(c => c && typeof c.tvl === 'number')
        .map(c => ({
            name: String(c.name ?? ''),
            tvl: Number(c.tvl) || 0,
            tokenSymbol: typeof c.tokenSymbol === 'string' ? c.tokenSymbol : undefined,
            chainId: typeof c.chainId === 'number' ? c.chainId : undefined,
        }))
        .sort((a, b) => b.tvl - a.tvl);
}

// Fetch stablecoin issuance totals. Returns top N by circulating supply.
export async function fetchStablecoinTotals(limit = 10): Promise<StablecoinTotal[]> {
    const res = await fetch(`${DEFILLAMA_STABLES_BASE}/stablecoins?includePrices=true`);
    if (!res.ok) throw new Error(`DefiLlama stablecoins: HTTP ${res.status}`);
    const data = await res.json();
    const rows = data?.peggedAssets;
    if (!Array.isArray(rows)) return [];
    return (rows as any[])
        .filter(p => p && typeof p.circulating?.peggedUSD === 'number')
        .map(p => ({
            name: String(p.name ?? ''),
            symbol: String(p.symbol ?? ''),
            pegType: String(p.pegType ?? ''),
            circulating: Number(p.circulating?.peggedUSD) || 0,
            chainCirculating: p.chainCirculating && typeof p.chainCirculating === 'object'
                ? Object.fromEntries(
                    Object.entries(p.chainCirculating as Record<string, any>)
                        .map(([chain, v]) => [chain, Number(v?.current?.peggedUSD) || 0]),
                )
                : undefined,
        }))
        .sort((a, b) => b.circulating - a.circulating)
        .slice(0, limit);
}

// ─── CoinPaprika — free coin metadata + global stats, no key ──────────────
// Useful as a redundant data source so a CoinGecko outage doesn't take
// out the entire crypto data path.

export const COINPAPRIKA_BASE = 'https://api.coinpaprika.com/v1';

export interface PaprikaGlobal {
    market_cap_usd: number;
    volume_24h_usd: number;
    bitcoin_dominance_percentage: number;
    cryptocurrencies_number: number;
    market_cap_ath_value?: number;
    market_cap_ath_date?: string;
}

export interface PaprikaTicker {
    id: string;
    name: string;
    symbol: string;
    rank: number;
    quotes: {
        USD: {
            price: number;
            volume_24h: number;
            market_cap: number;
            percent_change_1h?: number | null;
            percent_change_24h?: number | null;
            percent_change_7d?: number | null;
        };
    };
}

export async function fetchPaprikaGlobal(): Promise<PaprikaGlobal | null> {
    const res = await fetch(`${COINPAPRIKA_BASE}/global`);
    if (!res.ok) throw new Error(`CoinPaprika global: HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    return data as PaprikaGlobal;
}

export async function fetchPaprikaTopTickers(limit = 10): Promise<PaprikaTicker[]> {
    const res = await fetch(`${COINPAPRIKA_BASE}/tickers?limit=${limit}`);
    if (!res.ok) throw new Error(`CoinPaprika tickers: HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return (data as any[])
        .map(t => ({
            id: String(t.id ?? ''),
            name: String(t.name ?? ''),
            symbol: String(t.symbol ?? ''),
            rank: Number(t.rank) || 0,
            quotes: {
                USD: {
                    price: Number(t.quotes?.USD?.price) || 0,
                    volume_24h: Number(t.quotes?.USD?.volume_24h) || 0,
                    market_cap: Number(t.quotes?.USD?.market_cap) || 0,
                    percent_change_1h: typeof t.quotes?.USD?.percent_change_1h === 'number' ? t.quotes.USD.percent_change_1h : null,
                    percent_change_24h: typeof t.quotes?.USD?.percent_change_24h === 'number' ? t.quotes.USD.percent_change_24h : null,
                    percent_change_7d: typeof t.quotes?.USD?.percent_change_7d === 'number' ? t.quotes.USD.percent_change_7d : null,
                },
            },
        }))
        .sort((a, b) => a.rank - b.rank);
}

// ─── Cross-source crypto snapshot for prompt injection ─────────────────────
// Mirror getMacroSummaryText in fredService — produces a single text block
// suitable for Deep Research Stage 2 to inject into thematic / sector
// research that touches crypto.

export async function getCryptoSummaryText(): Promise<string> {
    const [defi, chains, stables, paprika] = await Promise.allSettled([
        fetchTopDefiProtocols(8),
        fetchChainTvls(),
        fetchStablecoinTotals(5),
        fetchPaprikaGlobal(),
    ]);

    const blocks: string[] = [];

    if (paprika.status === 'fulfilled' && paprika.value) {
        const g = paprika.value;
        blocks.push(
            `CRYPTO MARKET (CoinPaprika):\n• Total market cap: ${fmtLarge(g.market_cap_usd)}\n• 24h volume: ${fmtLarge(g.volume_24h_usd)}\n• BTC dominance: ${g.bitcoin_dominance_percentage.toFixed(1)}%\n• Active cryptocurrencies: ${g.cryptocurrencies_number}`,
        );
    }
    if (defi.status === 'fulfilled' && defi.value.length > 0) {
        const lines = defi.value.slice(0, 5).map(p =>
            `• ${p.name} (${p.category}, ${p.chain}): ${fmtLarge(p.tvl)}${p.change_7d !== null ? ` (${fmtPct(p.change_7d ?? null)} 7d)` : ''}`,
        );
        blocks.push(`DEFI PROTOCOLS BY TVL (DefiLlama):\n${lines.join('\n')}`);
    }
    if (chains.status === 'fulfilled' && chains.value.length > 0) {
        const lines = chains.value.slice(0, 5).map(c =>
            `• ${c.name}: ${fmtLarge(c.tvl)}`,
        );
        blocks.push(`TVL BY CHAIN (DefiLlama):\n${lines.join('\n')}`);
    }
    if (stables.status === 'fulfilled' && stables.value.length > 0) {
        const lines = stables.value.slice(0, 4).map(s =>
            `• ${s.name} (${s.symbol}): ${fmtLarge(s.circulating)} circulating`,
        );
        blocks.push(`STABLECOIN ISSUANCE (DefiLlama):\n${lines.join('\n')}`);
    }
    return blocks.join('\n\n');
}
