// Express Server Entry Point
import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { researchRouter } from './routes/research.js';
import { marketRouter } from './routes/market.js';
import { tradingRouter } from './routes/trading.js';
import { socialRouter } from './routes/social.js';
import { predictionsRouter } from './routes/predictions.js';
import { llmRouter } from './routes/llm.js';
import { tavilyRouter } from './routes/tavily.js';
import { orgsRouter } from './routes/orgs.js';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3002;

// WebSocket for real-time stock data
const wss = new WebSocketServer({ server, path: '/ws' });

const activeSubscriptions = new Map<string, Set<WebSocket>>();
const pollingIntervals = new Map<string, NodeJS.Timeout>();

const startPolling = (symbol: string) => {
    if (pollingIntervals.has(symbol)) return;
    const intervalId = setInterval(async () => {
        try {
            const res = await fetch(
                `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`
            );
            const json = await res.json();
            if (!json.chart?.result?.[0]) return;
            const result = json.chart.result[0];
            const quote = result.indicators.quote[0];
            const timestamp = result.timestamp[result.timestamp.length - 1];
            const open = quote.open[quote.open.length - 1];
            const high = quote.high[quote.high.length - 1];
            const low = quote.low[quote.low.length - 1];
            const close = quote.close[quote.close.length - 1];
            const volume = quote.volume[quote.volume.length - 1];
            const previousClose = result.meta.chartPreviousClose;
            const change = previousClose ? ((close - previousClose) / previousClose) * 100 : null;
            if (close) {
                const message = JSON.stringify({ type: 'trade', symbol, open, high, low, close, volume, change, time: timestamp });
                activeSubscriptions.get(symbol)?.forEach(ws => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(message);
                });
            }
        } catch { /* ignore */ }
    }, 2000);
    pollingIntervals.set(symbol, intervalId);
};

const stopPolling = (symbol: string) => {
    const id = pollingIntervals.get(symbol);
    if (id) { clearInterval(id); pollingIntervals.delete(symbol); }
};

wss.on('connection', (ws) => {
    let currentSymbol = '';
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            if (data.type === 'subscribe') {
                if (currentSymbol) {
                    const subs = activeSubscriptions.get(currentSymbol);
                    if (subs) {
                        subs.delete(ws);
                        if (subs.size === 0) { stopPolling(currentSymbol); activeSubscriptions.delete(currentSymbol); }
                    }
                }
                currentSymbol = data.symbol;
                if (!activeSubscriptions.has(currentSymbol)) activeSubscriptions.set(currentSymbol, new Set());
                activeSubscriptions.get(currentSymbol)!.add(ws);
                startPolling(currentSymbol);
            }
        } catch (e) { console.error('WS message error:', e); }
    });
    ws.on('close', () => {
        if (currentSymbol) {
            const subs = activeSubscriptions.get(currentSymbol);
            if (subs) {
                subs.delete(ws);
                if (subs.size === 0) { stopPolling(currentSymbol); activeSubscriptions.delete(currentSymbol); }
            }
        }
    });
});

// Middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176', 'http://localhost:5177', 'http://localhost:4173'],
    credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root handler
app.get('/', (_req, res) => {
    res.send(`
        <h1>AlphaSense AI Server</h1>
        <p>Server is running. API endpoints available at <code>/api/research</code> and <code>/api/market</code>.</p>
        <p>Health check: <a href="/api/health">/api/health</a></p>
    `);
});

// Routes
app.use('/api/research', researchRouter);
app.use('/api/market', marketRouter);
app.use('/api/social', socialRouter);
app.use('/api/predictions', predictionsRouter);
app.use('/api', tradingRouter);
app.use('/api/llm', llmRouter);
app.use('/api/tavily', tavilyRouter);
app.use('/api/orgs', orgsRouter);

// Start server
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`   LLM Providers:`);
    console.log(`     Anthropic: ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗'}`);
    console.log(`     Gemini:    ${process.env.GEMINI_API_KEY ? '✓' : '✗'}`);
    console.log(`     DeepSeek:  ${process.env.DEEPSEEK_API_KEY ? '✓' : '✗'}`);
    console.log(`     Groq:      ${process.env.GROQ_API_KEY ? '✓' : '✗'}`);
    console.log(`   Data APIs:`);
    console.log(`     Tavily:    ${process.env.TAVILY_API_KEY ? '✓' : '✗'}`);
    console.log(`     AlphaVant: ${process.env.ALPHA_VANTAGE_API_KEY ? '✓' : '✗'}`);
    console.log(`     Supabase:  ${process.env.SUPABASE_URL ? '✓' : '✗'}`);
});
