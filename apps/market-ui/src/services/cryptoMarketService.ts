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
