// Tavily Web Search Proxy — keeps the Tavily API key server-side.
// Browser sends: { query, max_results?, search_depth? }
// Server reads TAVILY_API_KEY from env, calls api.tavily.com, returns raw response.

import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';

export const tavilyRouter = Router();

tavilyRouter.use(authMiddleware);

tavilyRouter.get('/status', (_req, res) => {
    res.json({ available: !!process.env.TAVILY_API_KEY });
});

tavilyRouter.post('/search', async (req, res) => {
    const key = process.env.TAVILY_API_KEY;
    if (!key) {
        res.status(503).json({ error: 'Tavily API key not configured on server' });
        return;
    }

    const { query, max_results = 10, search_depth = 'advanced' } = req.body ?? {};
    if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Required: query (string)' });
        return;
    }

    try {
        const upstream = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: key,
                query,
                max_results,
                search_depth,
                include_answer: false,
                include_raw_content: false,
                include_images: false,
            }),
        });
        if (!upstream.ok) {
            const text = await upstream.text();
            res.status(502).json({ error: `Tavily ${upstream.status}: ${text.substring(0, 200)}` });
            return;
        }
        const data = await upstream.json();
        res.json(data);
    } catch (error: any) {
        res.status(502).json({ error: error?.message || 'Tavily call failed' });
    }
});
