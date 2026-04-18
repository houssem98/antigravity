// Settings Page - API Key Configuration

import { useState, useEffect } from 'react';
import { Key, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import {
    getApiKeys,
    saveApiKeys,
    validateGeminiKey,
    validateTavilyKey,
    validateAlphaVantageKey,
    type ApiKeys,
} from '../services/apiKeys';

export default function SettingsPage() {
    const [keys, setKeys] = useState<ApiKeys>({ gemini: '', tavily: '', alphaVantage: '', anthropic: '', deepseek: '', groq: '' });
    const [validation, setValidation] = useState<Record<string, 'idle' | 'validating' | 'valid' | 'invalid'>>({
        gemini: 'idle',
        tavily: 'idle',
        alphaVantage: 'idle',
        anthropic: 'idle',
        deepseek: 'idle',
        groq: 'idle',
    });
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const storedKeys = getApiKeys();
        setKeys(storedKeys);
    }, []);

    const handleValidate = async (keyType: keyof ApiKeys) => {
        setValidation(prev => ({ ...prev, [keyType]: 'validating' }));

        let isValid = false;
        try {
            switch (keyType) {
                case 'gemini':
                    isValid = await validateGeminiKey(keys.gemini);
                    break;
                case 'tavily':
                    isValid = await validateTavilyKey(keys.tavily);
                    break;
                case 'alphaVantage':
                    isValid = await validateAlphaVantageKey(keys.alphaVantage);
                    break;
            }
        } catch (error) {
            isValid = false;
        }

        setValidation(prev => ({ ...prev, [keyType]: isValid ? 'valid' : 'invalid' }));
    };

    const handleSave = () => {
        saveApiKeys(keys);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    };

    const renderValidationIcon = (status: string) => {
        switch (status) {
            case 'validating':
                return <Loader2 className="w-4 h-4 text-[#A7B0C8] animate-spin" />;
            case 'valid':
                return <CheckCircle className="w-4 h-4 text-green-500" />;
            case 'invalid':
                return <XCircle className="w-4 h-4 text-red-500" />;
            default:
                return null;
        }
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold mb-2">Settings</h1>
                <p className="text-[#A7B0C8]">Configure your API keys to enable real-time data and AI research</p>
            </div>

            <div className="panel-bg panel-border rounded-2xl p-6 space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-[rgba(0,240,255,0.1)]">
                    <Key className="w-5 h-5 text-[#00F0FF]" />
                    <h2 className="text-xl font-semibold">API Keys</h2>
                </div>

                {/* Gemini API Key */}
                <div>
                    <label className="block text-sm font-medium mb-2">
                        Gemini API Key
                        <a
                            href="https://ai.google.dev"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-xs text-[#00F0FF] hover:underline"
                        >
                            Get free key →
                        </a>
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="password"
                            value={keys.gemini}
                            onChange={(e) => setKeys({ ...keys, gemini: e.target.value })}
                            placeholder="AIza..."
                            className="flex-1 bg-[#070A12]/60 border border-[rgba(0,240,255,0.15)] rounded-xl px-4 py-3 text-sm text-[#F4F6FF] placeholder:text-[#A7B0C8]/40 outline-none focus:border-[#00F0FF]/40 transition-colors"
                        />
                        <button
                            onClick={() => handleValidate('gemini')}
                            disabled={!keys.gemini || validation.gemini === 'validating'}
                            className="px-4 py-3 rounded-xl border border-[rgba(0,240,255,0.2)] text-sm text-[#A7B0C8] hover:text-[#F4F6FF] hover:border-[#00F0FF]/40 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                            Test
                            {renderValidationIcon(validation.gemini)}
                        </button>
                    </div>
                    <p className="text-xs text-[#A7B0C8] mt-1">
                        Used for AI research planning and report generation (1,000 req/day free)
                    </p>
                </div>

                {/* Tavily API Key */}
                <div>
                    <label className="block text-sm font-medium mb-2">
                        Tavily API Key
                        <a
                            href="https://tavily.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-xs text-[#00F0FF] hover:underline"
                        >
                            Get free key →
                        </a>
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="password"
                            value={keys.tavily}
                            onChange={(e) => setKeys({ ...keys, tavily: e.target.value })}
                            placeholder="tvly-..."
                            className="flex-1 bg-[#070A12]/60 border border-[rgba(0,240,255,0.15)] rounded-xl px-4 py-3 text-sm text-[#F4F6FF] placeholder:text-[#A7B0C8]/40 outline-none focus:border-[#00F0FF]/40 transition-colors"
                        />
                        <button
                            onClick={() => handleValidate('tavily')}
                            disabled={!keys.tavily || validation.tavily === 'validating'}
                            className="px-4 py-3 rounded-xl border border-[rgba(0,240,255,0.2)] text-sm text-[#A7B0C8] hover:text-[#F4F6FF] hover:border-[#00F0FF]/40 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                            Test
                            {renderValidationIcon(validation.tavily)}
                        </button>
                    </div>
                    <p className="text-xs text-[#A7B0C8] mt-1">
                        Used for web research and content extraction (1,000 credits/month free)
                    </p>
                </div>

                {/* Alpha Vantage API Key */}
                <div>
                    <label className="block text-sm font-medium mb-2">
                        Alpha Vantage API Key
                        <a
                            href="https://www.alphavantage.co/support/#api-key"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-xs text-[#00F0FF] hover:underline"
                        >
                            Get free key →
                        </a>
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="password"
                            value={keys.alphaVantage}
                            onChange={(e) => setKeys({ ...keys, alphaVantage: e.target.value })}
                            placeholder="demo"
                            className="flex-1 bg-[#070A12]/60 border border-[rgba(0,240,255,0.15)] rounded-xl px-4 py-3 text-sm text-[#F4F6FF] placeholder:text-[#A7B0C8]/40 outline-none focus:border-[#00F0FF]/40 transition-colors"
                        />
                        <button
                            onClick={() => handleValidate('alphaVantage')}
                            disabled={!keys.alphaVantage || validation.alphaVantage === 'validating'}
                            className="px-4 py-3 rounded-xl border border-[rgba(0,240,255,0.2)] text-sm text-[#A7B0C8] hover:text-[#F4F6FF] hover:border-[#00F0FF]/40 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                            Test
                            {renderValidationIcon(validation.alphaVantage)}
                        </button>
                    </div>
                    <p className="text-xs text-[#A7B0C8] mt-1">
                        Used for real-time stock quotes and company data (25 req/day free)
                    </p>
                </div>

                {/* Anthropic API Key */}
                <div>
                    <label className="block text-sm font-medium mb-2">
                        Anthropic API Key
                        <span className="ml-2 text-xs text-[#7B8FC0]">Optional — enables Claude Opus for final synthesis</span>
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="password"
                            value={keys.anthropic}
                            onChange={(e) => setKeys({ ...keys, anthropic: e.target.value })}
                            placeholder="sk-ant-..."
                            className="flex-1 bg-[#070A12]/60 border border-[rgba(0,240,255,0.15)] rounded-xl px-4 py-3 text-sm text-[#F4F6FF] placeholder:text-[#A7B0C8]/40 outline-none focus:border-[#00F0FF]/40 transition-colors"
                        />
                    </div>
                    <p className="text-xs text-[#A7B0C8] mt-1">
                        If set: Claude Opus 4.6 writes the final report, Claude Sonnet extracts intelligence (highest quality synthesis)
                    </p>
                </div>

                {/* DeepSeek API Key */}
                <div>
                    <label className="block text-sm font-medium mb-2">
                        DeepSeek API Key
                        <span className="ml-2 text-xs text-[#7B8FC0]">Optional — enables DeepSeek R1 for bull/bear analysis</span>
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="password"
                            value={keys.deepseek}
                            onChange={(e) => setKeys({ ...keys, deepseek: e.target.value })}
                            placeholder="sk-..."
                            className="flex-1 bg-[#070A12]/60 border border-[rgba(0,240,255,0.15)] rounded-xl px-4 py-3 text-sm text-[#F4F6FF] placeholder:text-[#A7B0C8]/40 outline-none focus:border-[#00F0FF]/40 transition-colors"
                        />
                    </div>
                    <p className="text-xs text-[#A7B0C8] mt-1">
                        If set: DeepSeek R1 chain-of-thought reasoning powers adversarial bull/bear analysis (best for stress-testing theses)
                    </p>
                </div>

                {/* Groq API Key */}
                <div>
                    <label className="block text-sm font-medium mb-2">
                        Groq API Key
                        <a
                            href="https://console.groq.com/keys"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-xs text-[#00F0FF] hover:underline"
                        >
                            Get free key →
                        </a>
                        <span className="ml-2 text-xs text-[#7B8FC0]">Free tier — Llama 3.3 70B, GPT-OSS 120B, DeepSeek R1 Distill</span>
                    </label>
                    <div className="flex gap-2">
                        <input
                            type="password"
                            value={keys.groq}
                            onChange={(e) => setKeys({ ...keys, groq: e.target.value })}
                            placeholder="gsk_..."
                            className="flex-1 bg-[#070A12]/60 border border-[rgba(0,240,255,0.15)] rounded-xl px-4 py-3 text-sm text-[#F4F6FF] placeholder:text-[#A7B0C8]/40 outline-none focus:border-[#00F0FF]/40 transition-colors"
                        />
                    </div>
                    <p className="text-xs text-[#A7B0C8] mt-1">
                        If set: Groq-hosted open models drive the pipeline on generous free tier — fastest fallback when paid providers are out of credit
                    </p>
                </div>

                {/* Save Button */}
                <div className="pt-4 border-t border-[rgba(0,240,255,0.1)]">
                    <button
                        onClick={handleSave}
                        className={`w-full py-3 rounded-xl font-medium text-sm transition-all ${saved
                                ? 'bg-green-500 text-white'
                                : 'bg-[#00F0FF] text-[#070A12] hover:bg-[#00F0FF]/90'
                            }`}
                    >
                        {saved ? '✓ Saved Successfully' : 'Save API Keys'}
                    </button>
                </div>
            </div>

            {/* Info Panel */}
            <div className="mt-6 panel-bg panel-border rounded-xl p-4">
                <h3 className="text-sm font-medium mb-2">Privacy & Security</h3>
                <p className="text-xs text-[#A7B0C8] leading-relaxed">
                    API keys are stored locally in your browser's localStorage. They are never sent to any server
                    except the respective API providers (Google, Tavily, Alpha Vantage, Anthropic, DeepSeek) when making requests.
                </p>
            </div>
        </div>
    );
}
