// API Key Management Service
// Reads from .env file (VITE_ prefixed), with localStorage overrides

export interface ApiKeys {
    gemini: string;
    tavily: string;
    alphaVantage: string;
    anthropic: string;
    deepseek: string;
}

const STORAGE_KEY = 'market_intelligence_api_keys';

// Environment defaults from .env file
const ENV_KEYS: ApiKeys = {
    gemini: import.meta.env.VITE_GEMINI_API_KEY || '',
    tavily: import.meta.env.VITE_TAVILY_API_KEY || '',
    alphaVantage: import.meta.env.VITE_ALPHA_VANTAGE_API_KEY || '',
    anthropic: import.meta.env.VITE_ANTHROPIC_API_KEY || '',
    deepseek: import.meta.env.VITE_DEEPSEEK_API_KEY || '',
};

export const getApiKeys = (): ApiKeys => {
    // Check localStorage for user overrides first
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            // Merge: use localStorage values if set, otherwise fall back to .env
            return {
                gemini: parsed.gemini || ENV_KEYS.gemini,
                tavily: parsed.tavily || ENV_KEYS.tavily,
                alphaVantage: parsed.alphaVantage || ENV_KEYS.alphaVantage,
                anthropic: parsed.anthropic || ENV_KEYS.anthropic,
                deepseek: parsed.deepseek || ENV_KEYS.deepseek,
            };
        } catch {
            return { ...ENV_KEYS };
        }
    }
    return { ...ENV_KEYS };
};

export const saveApiKeys = (keys: ApiKeys): void => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
};

export const hasRequiredKeys = (): boolean => {
    const keys = getApiKeys();
    return !!(keys.gemini && keys.tavily && keys.alphaVantage);
};

export const validateGeminiKey = async (apiKey: string): Promise<boolean> => {
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
        return response.ok;
    } catch {
        return false;
    }
};

export const validateTavilyKey = async (apiKey: string): Promise<boolean> => {
    try {
        const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: apiKey,
                query: 'test',
                max_results: 1,
            }),
        });
        return response.ok;
    } catch {
        return false;
    }
};

export const validateAlphaVantageKey = async (apiKey: string): Promise<boolean> => {
    try {
        const response = await fetch(
            `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=IBM&apikey=${apiKey}`
        );
        const data = await response.json();
        return !data['Error Message'] && !data['Note'];
    } catch {
        return false;
    }
};
