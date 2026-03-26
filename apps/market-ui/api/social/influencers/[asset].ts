const COIN_NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'Binance', XRP: 'Ripple',
  ADA: 'Cardano', DOGE: 'Dogecoin', AVAX: 'Avalanche', DOT: 'Polkadot', MATIC: 'Polygon',
};

const DEFAULT_INFLUENCERS = [
  { handle: 'TheMoonCarl',      name: 'The Moon'       },
  { handle: 'AltcoinSherpa',    name: 'Altcoin Sherpa' },
  { handle: 'CredibleCrypto',   name: 'Credible Crypto'},
  { handle: 'Pentosh1',         name: 'Pentoshi'       },
  { handle: 'CryptoKaleo',      name: 'Kaleo'          },
  { handle: 'inversebrah',      name: 'Inverse Brah'   },
  { handle: 'rektcapital',      name: 'Rekt Capital'   },
  { handle: 'CryptoTony__',     name: 'Crypto Tony'    },
];

function detectSentiment(text: string): string {
  const t = text.toLowerCase();
  const bullish = ['bullish','moon','pump','buy','breakout','support','long','accumulate','up','green'].some(w => t.includes(w));
  const bearish = ['bearish','dump','sell','short','crash','down','red','drop','resistance','reject'].some(w => t.includes(w));
  if (bullish && !bearish) return 'bullish';
  if (bearish && !bullish) return 'bearish';
  return 'neutral';
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const asset = String(req.query.asset || '').toUpperCase();
  const coinName = COIN_NAMES[asset] || asset;
  const TAVILY_KEY = process.env.VITE_TAVILY_API_KEY || process.env.TAVILY_API_KEY;

  if (!TAVILY_KEY) {
    return res.json(DEFAULT_INFLUENCERS.map(inf => ({
      handle: inf.handle, name: inf.name, sentiment: 'neutral',
      avatar: `https://unavatar.io/twitter/${inf.handle}`,
      tweets: [],
    })));
  }

  const results = await Promise.allSettled(
    DEFAULT_INFLUENCERS.slice(0, 4).map(async (inf) => {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_KEY,
          query: `from:${inf.handle} ${coinName} ${asset}`,
          search_depth: 'basic',
          max_results: 3,
          include_domains: ['x.com', 'twitter.com'],
        }),
      });
      const data = await r.json();
      const tweets = (data.results || []).map((item: any, i: number) => {
        const urlParts = (item.url || '').split('/');
        const tweetId = urlParts[urlParts.length - 1].split('?')[0] || String(i);
        return {
          tweetId, username: inf.handle, handle: inf.handle,
          content: item.content || item.title || '',
          publishedDate: item.published_date || null,
          xUrl: item.url || `https://x.com/${inf.handle}`,
          avatar: `https://unavatar.io/twitter/${inf.handle}`,
        };
      });
      const allText = tweets.map((t: any) => t.content).join(' ');
      return {
        handle: inf.handle, name: inf.name,
        sentiment: detectSentiment(allText),
        avatar: `https://unavatar.io/twitter/${inf.handle}`,
        tweets,
      };
    })
  );

  res.json(results.filter(r => r.status === 'fulfilled').map((r: any) => r.value));
}
