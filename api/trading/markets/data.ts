import { VercelRequest, VercelResponse } from '@vercel/node';

const GRAVITY_API_URL = process.env.GRAVITY_API_URL || 'https://antigravity.fly.dev';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { asset = 'BTC', limit = '50', sort = 'volume_24h', order = 'desc' } = req.query;

    const url = new URL(`${GRAVITY_API_URL}/api/trading/markets/data`);
    url.searchParams.set('asset', String(asset));
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('sort', String(sort));
    url.searchParams.set('order', String(order));

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Gravity API error: ${response.statusText}`,
      });
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    console.error('API proxy error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to fetch market data',
    });
  }
}
