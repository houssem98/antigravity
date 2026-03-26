export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const modules = 'defaultKeyStatistics,financialData,summaryDetail';
    const r = await fetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=${modules}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const data = await r.json();
    res.json({ quoteSummary: { result: [data?.quoteSummary?.result?.[0] || {}] } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
