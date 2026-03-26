export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });
  try {
    const all = await Promise.all(
      String(symbols).split(',').map(async (sym) => {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${sym.trim()}?interval=1d&range=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        const d = await r.json();
        const q = d?.chart?.result?.[0]?.meta;
        if (!q) return null;
        return {
          symbol: sym.trim(),
          regularMarketPrice: q.regularMarketPrice,
          regularMarketChangePercent: ((q.regularMarketPrice - q.chartPreviousClose) / q.chartPreviousClose) * 100,
          marketCap: q.marketCap || 0,
          regularMarketVolume: q.regularMarketVolume || 0,
        };
      })
    );
    res.json({ quoteResponse: { result: all.filter(Boolean) } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
