export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { id } = req.query;
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${String(id).toUpperCase()}USDT&interval=2h&limit=84`);
    if (!r.ok) throw new Error('Binance error');
    const data = await r.json();
    res.json(data.map((d: any[]) => parseFloat(d[4])));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
