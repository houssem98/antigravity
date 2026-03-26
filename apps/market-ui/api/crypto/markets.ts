export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const r = await fetch('https://api.coinlore.net/api/tickers/?start=0&limit=100');
    const data = await r.json();
    if (!data?.data) return res.status(500).json({ error: 'Invalid data' });
    res.json(data.data.map((c: any) => ({
      id: c.nameid, symbol: c.symbol, name: c.name, rank: c.rank,
      priceUsd: c.price_usd,
      changePercent1Hr: c.percent_change_1h || '0',
      changePercent24Hr: c.percent_change_24h || '0',
      changePercent7d: c.percent_change_7d || '0',
      marketCapUsd: c.market_cap_usd || '0',
      volumeUsd24Hr: c.volume24?.toString() || '0',
      csupply: c.csupply || '0', tsupply: c.tsupply || '0', msupply: c.msupply || '0',
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
