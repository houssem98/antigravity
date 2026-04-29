// LLM Proxy — routes browser LLM requests through the server so API keys stay server-side.
// Browser sends: { provider, model, prompt, max_tokens? }
// Server reads key from env, calls provider, returns text.
//
// §6.10 P0: Anthropic prompt caching (prompt-caching-2024-07-31).
// Long prompts (>4096 chars ≈ >1024 tokens) are split at a paragraph
// boundary: the stable system prefix carries cache_control: {type:"ephemeral"}
// and is reused across calls within the 5-minute Anthropic cache TTL.
// Cache hit savings: ~90% of stable-prefix input tokens at ~10% of list price.
// Cache stats are returned as cacheStats:{created,read} in the response body
// so the client BudgetTracker can compute the true cost.

import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const llmRouter = Router();

// ─── Provider Config ─────────────────────────────────────────────────────────

interface ProviderInfo {
    name: string;
    keyEnv: string;
    available: boolean;
}

function getProviders(): Record<string, ProviderInfo> {
    return {
        anthropic: { name: 'Anthropic', keyEnv: 'ANTHROPIC_API_KEY', available: !!process.env.ANTHROPIC_API_KEY },
        gemini:    { name: 'Gemini',    keyEnv: 'GEMINI_API_KEY',    available: !!process.env.GEMINI_API_KEY },
        deepseek:  { name: 'DeepSeek',  keyEnv: 'DEEPSEEK_API_KEY',  available: !!process.env.DEEPSEEK_API_KEY },
        groq:      { name: 'Groq',      keyEnv: 'GROQ_API_KEY',      available: !!process.env.GROQ_API_KEY },
    };
}

// ─── GET /api/llm/providers — What's available ───────────────────────────────

llmRouter.get('/providers', (_req, res) => {
    const providers = getProviders();
    const models = [
        // Gemini
        { id: 'gemini-2.5-pro',       provider: 'gemini',    name: 'Gemini 2.5 Pro',       tier: 'premium',  available: providers.gemini.available },
        { id: 'gemini-2.5-flash',     provider: 'gemini',    name: 'Gemini 2.5 Flash',     tier: 'standard', available: providers.gemini.available },
        { id: 'gemini-2.0-flash',     provider: 'gemini',    name: 'Gemini 2.0 Flash',     tier: 'standard', available: providers.gemini.available },
        { id: 'gemini-2.0-flash-lite',provider: 'gemini',    name: 'Gemini 2.0 Flash Lite',tier: 'lite',     available: providers.gemini.available },
        // Anthropic
        { id: 'claude-opus-4-6',           provider: 'anthropic', name: 'Claude Opus 4.6',      tier: 'premium',  available: providers.anthropic.available },
        { id: 'claude-sonnet-4-6',         provider: 'anthropic', name: 'Claude Sonnet 4.6',    tier: 'standard', available: providers.anthropic.available },
        { id: 'claude-haiku-4-5-20251001', provider: 'anthropic', name: 'Claude Haiku 4.5',     tier: 'lite',     available: providers.anthropic.available },
        // DeepSeek
        { id: 'deepseek-chat',      provider: 'deepseek',  name: 'DeepSeek V3',    tier: 'standard', available: providers.deepseek.available },
        { id: 'deepseek-reasoner',  provider: 'deepseek',  name: 'DeepSeek R1',    tier: 'premium',  available: providers.deepseek.available },
        // Groq
        { id: 'openai/gpt-oss-120b',                       provider: 'groq', name: 'GPT-OSS 120B (Groq)',      tier: 'premium',  available: providers.groq.available },
        { id: 'qwen/qwen3-32b',                            provider: 'groq', name: 'Qwen3 32B (Groq)',         tier: 'premium',  available: providers.groq.available },
        { id: 'meta-llama/llama-4-scout-17b-16e-instruct', provider: 'groq', name: 'Llama 4 Scout 17B (Groq)', tier: 'standard', available: providers.groq.available },
        { id: 'llama-3.3-70b-versatile',                   provider: 'groq', name: 'Llama 3.3 70B (Groq)',     tier: 'standard', available: providers.groq.available },
        { id: 'llama-3.1-8b-instant',                      provider: 'groq', name: 'Llama 3.1 8B (Groq)',      tier: 'lite',     available: providers.groq.available },
    ];

    res.json({
        providers: Object.entries(providers).map(([id, info]) => ({
            id, name: info.name, available: info.available,
        })),
        models: models.filter(m => m.available),
        dataProviders: {
            tavily:       !!process.env.TAVILY_API_KEY,
            alphaVantage: !!process.env.ALPHA_VANTAGE_API_KEY,
        },
    });
});

// ─── POST /api/llm/chat — Proxy a single LLM call ───────────────────────────

llmRouter.post('/chat', async (req, res) => {
    const { provider, model, prompt, max_tokens = 8192 } = req.body;

    if (!provider || !model || !prompt) {
        res.status(400).json({ error: 'Required: provider, model, prompt' });
        return;
    }

    try {
        let result: { text: string; cacheStats?: { created: number; read: number } };

        switch (provider) {
            case 'anthropic': {
                const key = process.env.ANTHROPIC_API_KEY;
                if (!key) { res.status(503).json({ error: 'Anthropic API key not configured on server' }); return; }
                result = await callAnthropic(key, model, prompt, max_tokens);
                break;
            }
            case 'gemini': {
                const key = process.env.GEMINI_API_KEY;
                if (!key) { res.status(503).json({ error: 'Gemini API key not configured on server' }); return; }
                result = { text: await callGeminiAPI(key, model, prompt) };
                break;
            }
            case 'deepseek': {
                const key = process.env.DEEPSEEK_API_KEY;
                if (!key) { res.status(503).json({ error: 'DeepSeek API key not configured on server' }); return; }
                result = { text: await callOpenAICompatible('https://api.deepseek.com/chat/completions', key, model, prompt, max_tokens) };
                break;
            }
            case 'groq': {
                const key = process.env.GROQ_API_KEY;
                if (!key) { res.status(503).json({ error: 'Groq API key not configured on server' }); return; }
                result = { text: await callOpenAICompatible('https://api.groq.com/openai/v1/chat/completions', key, model, prompt, max_tokens) };
                break;
            }
            default:
                res.status(400).json({ error: `Unknown provider: ${provider}` });
                return;
        }

        res.json({ text: result.text, model, provider, cacheStats: result.cacheStats });
    } catch (error: any) {
        console.error(`LLM proxy error (${provider}/${model}):`, error.message);
        res.status(502).json({ error: error.message || 'LLM call failed', provider, model });
    }
});

// ─── Anthropic prompt-split helpers ──────────────────────────────────────────
// Anthropic caches content blocks whose token count exceeds the model minimum
// (1024 tokens for Claude 3.x/4.x, 2048 for older Claude 2). We approximate
// with a char threshold of 4096 chars (~1024 tokens at 4 chars/token).
//
// Split strategy: scan backwards from the 80% mark to find the last paragraph
// break (double newline). Everything before the break → system block with
// cache_control:ephemeral. Everything after → user message (variable part).
// On cache hit the stable prefix is re-used from the 5-minute in-memory
// cache, saving ~90% of the input-token cost for the system block.

const CACHE_MIN_CHARS = 4096;  // ~1024 tokens

export function splitPromptForCache(prompt: string): { system: string; user: string } | null {
    if (prompt.length < CACHE_MIN_CHARS) return null;

    // Scan back from the 80% mark to find a paragraph boundary.
    const searchEnd = Math.floor(prompt.length * 0.80);
    const searchStart = Math.floor(prompt.length * 0.20);   // don't split too early

    let splitAt = -1;
    for (let i = searchEnd; i >= searchStart; i--) {
        if (prompt[i] === '\n' && prompt[i - 1] === '\n') {
            splitAt = i + 1;
            break;
        }
    }
    if (splitAt < 0) {
        // No paragraph break found — fall back to 75% hard split
        splitAt = Math.floor(prompt.length * 0.75);
    }

    const system = prompt.slice(0, splitAt).trimEnd();
    const user   = prompt.slice(splitAt).trimStart();
    if (!system || !user) return null;
    return { system, user };
}

// ─── Provider Implementations ────────────────────────────────────────────────

async function callAnthropic(
    apiKey: string,
    model: string,
    prompt: string,
    maxTokens: number,
): Promise<{ text: string; cacheStats: { created: number; read: number } }> {
    // Attempt to split the prompt for caching. Falls back to a plain user
    // message when the prompt is too short or can't be split cleanly.
    const split = splitPromptForCache(prompt);

    const body: Record<string, unknown> = { model, max_tokens: maxTokens };

    if (split) {
        body.system = [{
            type: 'text',
            text: split.system,
            cache_control: { type: 'ephemeral' },
        }];
        body.messages = [{ role: 'user', content: split.user }];
    } else {
        body.messages = [{ role: 'user', content: prompt }];
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            // Enable prompt caching beta for all Anthropic calls.
            'anthropic-beta': 'prompt-caching-2024-07-31',
            'content-type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Anthropic ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    return {
        text: data.content?.[0]?.text ?? '',
        cacheStats: {
            created: data.usage?.cache_creation_input_tokens ?? 0,
            read:    data.usage?.cache_read_input_tokens    ?? 0,
        },
    };
}

async function callGeminiAPI(apiKey: string, model: string, prompt: string): Promise<string> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const m = genAI.getGenerativeModel({ model });
    const result = await m.generateContent(prompt);
    return result.response.text();
}

async function callOpenAICompatible(url: string, apiKey: string, model: string, prompt: string, maxTokens: number): Promise<string> {
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: maxTokens,
            temperature: 0.7,
        }),
    });
    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`${model} ${resp.status}: ${err}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? '';
}
