// Market Data API Routes
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';

export const marketRouter = Router();

marketRouter.use(authMiddleware);

const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';

// Get stock quote
marketRouter.get('/quote/:symbol', async (req, res) => {
    try {
        const response = await fetch(
            `${ALPHA_VANTAGE_BASE}?function=GLOBAL_QUOTE&symbol=${req.params.symbol}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`
        );
        const data = await response.json();
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get company overview
marketRouter.get('/overview/:symbol', async (req, res) => {
    try {
        const response = await fetch(
            `${ALPHA_VANTAGE_BASE}?function=OVERVIEW&symbol=${req.params.symbol}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`
        );
        const data = await response.json();
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Search tickers
marketRouter.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        const response = await fetch(
            `${ALPHA_VANTAGE_BASE}?function=SYMBOL_SEARCH&keywords=${q}&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`
        );
        const data = await response.json();
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
