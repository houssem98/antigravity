import { Router, Request, Response } from 'express';
import YahooFinance from 'yahoo-finance2';

const router = Router();
const yahooFinance = new YahooFinance();

// Crypto markets cache
let cryptoMarketsCache: any = null;
let cryptoMarketsLastFetch = 0;
const CRYPTO_CACHE_TTL = 10000;

// Sparkline cache
const sparklineCache = new Map<string, { data: number[]; timestamp: number }>();
const SPARKLINE_TTL = 3600000;

router.get('/history', async (req: Request, res: Response) => {
  const { symbol, interval, range } = req.query;
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Symbol is required' });
  }
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval || '1d'}&range=${range || '2y'}`
    );
    const data = await response.json();
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

router.get('/fundamentals', async (req: Request, res: Response) => {
  const { symbol } = req.query;
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Symbol is required' });
  }
  try {
    const data = await yahooFinance.quoteSummary(symbol, {
      modules: ['defaultKeyStatistics', 'financialData', 'summaryDetail'],
    });
    res.json({ quoteSummary: { result: [data] } });
  } catch (err) {
    console.error('Fundamentals error:', err);
    res.status(500).json({ error: 'Failed to fetch fundamentals' });
  }
});

router.get('/financials', async (req: Request, res: Response) => {
  const { symbol } = req.query;
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Symbol is required' });
  }
  try {
    const data = await yahooFinance.quoteSummary(symbol, {
      modules: ['incomeStatementHistory', 'balanceSheetHistory', 'cashflowStatementHistory'],
    });
    res.json({ quoteSummary: { result: [data] } });
  } catch (err) {
    console.error('Financials error:', err);
    res.status(500).json({ error: 'Failed to fetch financials' });
  }
});

router.get('/quote', async (req: Request, res: Response) => {
  const { symbols } = req.query;
  if (!symbols || typeof symbols !== 'string') {
    return res.status(400).json({ error: 'Symbols are required' });
  }
  try {
    const symbolsArray = symbols.split(',');
    const data = await yahooFinance.quote(symbolsArray);
    res.json({ quoteResponse: { result: Array.isArray(data) ? data : [data] } });
  } catch (err) {
    console.error('Quote error:', err);
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

router.get('/crypto/depth', async (req: Request, res: Response) => {
  const { symbol } = req.query;
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Symbol is required' });
  }
  try {
    const response = await fetch(
      `https://api.binance.com/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=15`
    );
    if (!response.ok) {
      if (response.status === 400) return res.status(400).json(await response.json());
      const fallback = await fetch(
        `https://api.binance.us/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=15`
      );
      if (!fallback.ok) {
        if (fallback.status === 400) return res.status(400).json(await fallback.json());
        throw new Error('Binance API failed');
      }
      return res.json(await fallback.json());
    }
    res.json(await response.json());
  } catch (err) {
    console.error('Depth error:', err);
    res.status(500).json({ error: 'Failed to fetch depth' });
  }
});

router.get('/crypto/ticker', async (req: Request, res: Response) => {
  const { symbol } = req.query;
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Symbol is required' });
  }
  try {
    const response = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol.toUpperCase()}`
    );
    if (!response.ok) {
      const fallback = await fetch(
        `https://api.binance.us/api/v3/ticker/24hr?symbol=${symbol.toUpperCase()}`
      );
      if (!fallback.ok) throw new Error('Binance API failed');
      return res.json(await fallback.json());
    }
    res.json(await response.json());
  } catch (err) {
    console.error('Ticker error:', err);
    res.status(500).json({ error: 'Failed to fetch ticker' });
  }
});

router.get('/crypto/klines', async (req: Request, res: Response) => {
  const { symbol, interval, limit } = req.query;
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Symbol is required' });
  }
  try {
    const params = `symbol=${symbol.toUpperCase()}&interval=${interval || '1d'}&limit=${limit || 1}`;
    const response = await fetch(`https://api.binance.com/api/v3/klines?${params}`);
    if (!response.ok) {
      const fallback = await fetch(`https://api.binance.us/api/v3/klines?${params}`);
      if (!fallback.ok) throw new Error('Binance API failed');
      return res.json(await fallback.json());
    }
    res.json(await response.json());
  } catch (err) {
    console.error('Klines error:', err);
    res.status(500).json({ error: 'Failed to fetch klines' });
  }
});

router.get('/crypto/markets', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (cryptoMarketsCache && now - cryptoMarketsLastFetch < CRYPTO_CACHE_TTL) {
      return res.json(cryptoMarketsCache);
    }
    const response = await fetch('https://api.coinlore.net/api/tickers/?start=0&limit=100');
    const data = await response.json();
    if (!data?.data || !Array.isArray(data.data)) {
      throw new Error('Invalid data format from Coinlore');
    }
    cryptoMarketsCache = data.data.map((coin: any) => ({
      id: coin.nameid,
      symbol: coin.symbol,
      name: coin.name,
      rank: coin.rank,
      priceUsd: coin.price_usd,
      changePercent1Hr: coin.percent_change_1h || '0',
      changePercent24Hr: coin.percent_change_24h || '0',
      changePercent7d: coin.percent_change_7d || '0',
      marketCapUsd: coin.market_cap_usd || '0',
      volumeUsd24Hr: coin.volume24?.toString() || '0',
      csupply: coin.csupply || '0',
      tsupply: coin.tsupply || '0',
      msupply: coin.msupply || '0',
    }));
    cryptoMarketsLastFetch = now;
    res.json(cryptoMarketsCache);
  } catch (err) {
    console.error('Crypto markets error:', err);
    res.status(500).json({ error: 'Failed to fetch crypto markets' });
  }
});

router.get('/crypto/sparkline/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const now = Date.now();
    const cached = sparklineCache.get(id);
    if (cached && now - cached.timestamp < SPARKLINE_TTL) {
      return res.json(cached.data);
    }
    let prices: number[] = [];
    try {
      const response = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${id.toUpperCase()}USDT&interval=2h&limit=84`
      );
      if (response.ok) {
        prices = (await response.json()).map((d: any[]) => parseFloat(d[4]));
      } else {
        const fallback = await fetch(
          `https://api.binance.us/api/v3/klines?symbol=${id.toUpperCase()}USDT&interval=2h&limit=84`
        );
        if (fallback.ok) {
          prices = (await fallback.json()).map((d: any[]) => parseFloat(d[4]));
        } else {
          throw new Error('Binance failed');
        }
      }
    } catch {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${id.toUpperCase()}-USD?interval=1h&range=7d`
      );
      if (response.ok) {
        const data = await response.json();
        const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
        if (closes) prices = closes.filter((p: number | null) => p !== null);
      }
    }
    if (prices.length === 0) return res.status(404).json({ error: 'No history found' });
    sparklineCache.set(id, { data: prices, timestamp: now });
    res.json(prices);
  } catch (err) {
    console.error('Sparkline error:', err);
    res.status(500).json({ error: 'Failed to fetch sparkline' });
  }
});

// Real influencer tweets via Tavily — search by handle + coin
const influencerTweetCache = new Map<string, { data: any; timestamp: number }>();
const TWEET_TTL = 180000; // 3 minutes

const COIN_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB', XRP: 'XRP',
  ADA: 'Cardano', DOGE: 'Dogecoin', DOT: 'Polkadot', AVAX: 'Avalanche',
  LINK: 'Chainlink', MATIC: 'Polygon', SHIB: 'Shiba Inu', LTC: 'Litecoin',
  UNI: 'Uniswap', ATOM: 'Cosmos',
};

// Known crypto influencers
const DEFAULT_INFLUENCERS = [
  { handle: 'TheMoonCarl',    name: 'Carl Runefelt',     sentiment: 'bullish' },
  { handle: 'AltcoinSherpa', name: 'AltcoinSherpa',     sentiment: 'bullish' },
  { handle: 'CredibleCrypto',name: 'CredibleCrypto',    sentiment: 'neutral'  },
  { handle: 'Pentosh1',      name: 'Pentosh1',           sentiment: 'bullish' },
  { handle: 'CryptoKaleo',   name: 'Kaleo',              sentiment: 'bullish' },
  { handle: 'inversebrah',   name: 'Inverse Brah',       sentiment: 'bearish' },
  { handle: 'rektcapital',   name: 'Rekt Capital',       sentiment: 'neutral' },
  { handle: 'CryptoTony__',  name: 'Crypto Tony',        sentiment: 'bullish' },
];

async function fetchInfluencerTweets(handle: string, coinName: string, asset: string, apiKey: string): Promise<any[]> {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: `from:${handle} ${coinName} ${asset}`,
        search_depth: 'basic',
        include_domains: ['x.com', 'twitter.com'],
        max_results: 5,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((r: any) => {
      const urlMatch = r.url?.match(/(?:x\.com|twitter\.com)\/([^\/]+)\/status\/(\d+)/);
      if (!urlMatch) return null;
      return {
        tweetId: urlMatch[2],
        username: urlMatch[1],
        handle,
        content: r.content || r.title || '',
        publishedDate: r.published_date || null,
        xUrl: `https://x.com/${urlMatch[1]}/status/${urlMatch[2]}`,
        avatar: `https://unavatar.io/twitter/${urlMatch[1]}`,
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// GET /api/social/influencers/:asset — returns all tracked influencers + their real tweets
router.get('/social/influencers/:asset', async (req: Request, res: Response) => {
  const { asset } = req.params;
  const handlesParam = req.query.handles as string | undefined;
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Tavily API not configured' });

  const cacheKey = `${asset}:${handlesParam || 'default'}`;
  const now = Date.now();
  const cached = influencerTweetCache.get(cacheKey);
  if (cached && now - cached.timestamp < TWEET_TTL) {
    return res.json(cached.data);
  }

  const coinName = COIN_NAMES[asset] || asset;
  const influencers = handlesParam
    ? handlesParam.split(',').map(h => ({ handle: h.trim(), name: h.trim(), sentiment: 'neutral' }))
    : DEFAULT_INFLUENCERS;

  // Fetch tweets for all influencers in parallel (max 4 at a time to not blast API)
  const results = await Promise.allSettled(
    influencers.slice(0, 4).map(inf =>
      fetchInfluencerTweets(inf.handle, coinName, asset, apiKey).then(tweets => ({
        ...inf,
        avatar: `https://unavatar.io/twitter/${inf.handle}`,
        tweets,
      }))
    )
  );

  const data = results
    .filter(r => r.status === 'fulfilled')
    .map(r => (r as PromiseFulfilledResult<any>).value);

  influencerTweetCache.set(cacheKey, { data, timestamp: now });
  res.json(data);
});

export { router as tradingRouter };
