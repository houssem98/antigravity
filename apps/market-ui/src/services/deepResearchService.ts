// World-Class Multi-LLM Orchestrated Finance Research Engine
// Architecture: AlphaSense × Goldman Sachs Research × Bloomberg Intelligence
//
// 6-Stage Pipeline:
//   1. Blueprint   — Gemini 2.5 Pro (Chief Analyst): query intent, entities, 12 search angles
//   2. Parallel    — All Tavily + SEC + Alpha Vantage simultaneously
//   3. Synthesis   — Gemini 2.5 Flash: structured fact/figure extraction from top-20 sources
//   4. Adversarial — Gemini 2.5 Pro (bull) + Gemini 2.5 Flash (bear) in PARALLEL
//   5. Report      — Gemini 2.5 Pro: Goldman Sachs-style 3000+ word institutional report
//   6. Output      — Structured ResearchReport with citations

import { searchMultipleQueriesParallel, type TavilySearchResult } from './tavilyService';
import { queryGravityRAG, formatRAGSourcesForPrompt, formatRAGStructuredData, type GravityRAGResult } from './gravitySearchService';
import { searchFilings, type SECFiling } from './secEdgarService';
import { getCompanyOverview, type CompanyOverview } from './marketData';
import { getMacroSummaryText } from './fredService';

// ─── Model Registry ───────────────────────────────────────────────────────────

export const RESEARCH_MODELS = [
    // ── Gemini ──────────────────────────────────────────────────────────────
    { id: 'gemini-2.5-pro',       name: 'Gemini 2.5 Pro',       provider: 'gemini',    desc: 'Most capable — deep reasoning, long context',         tier: 'premium'  },
    { id: 'gemini-2.5-flash',     name: 'Gemini 2.5 Flash',     provider: 'gemini',    desc: 'Fast & smart — best balance of speed and quality',    tier: 'standard' },
    { id: 'gemini-2.0-flash',     name: 'Gemini 2.0 Flash',     provider: 'gemini',    desc: 'Ultra-fast — quick analysis and drafts',              tier: 'standard' },
    { id: 'gemini-2.0-flash-lite',name: 'Gemini 2.0 Flash Lite',provider: 'gemini',    desc: 'Lightweight — fastest responses, lower cost',         tier: 'lite'     },
    // ── Claude (Anthropic) ──────────────────────────────────────────────────
    { id: 'claude-opus-4-6',      name: 'Claude Opus 4.6',      provider: 'anthropic', desc: 'Best synthesis — institutional-grade long reports',   tier: 'premium'  },
    { id: 'claude-sonnet-4-6',    name: 'Claude Sonnet 4.6',    provider: 'anthropic', desc: 'Fast & sharp — analysis and extraction',             tier: 'standard' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', desc: 'Lightweight Claude — fastest, lowest cost',        tier: 'lite'     },
    // ── DeepSeek ────────────────────────────────────────────────────────────
    { id: 'deepseek-chat',        name: 'DeepSeek V3',          provider: 'deepseek',  desc: 'Strong reasoning — cost-efficient at scale',         tier: 'standard' },
    { id: 'deepseek-reasoner',    name: 'DeepSeek R1',          provider: 'deepseek',  desc: 'Chain-of-thought reasoning — best for bull/bear',    tier: 'premium'  },
    // ── Groq (fast inference, free tier) ────────────────────────────────────
    { id: 'openai/gpt-oss-120b',                       name: 'GPT-OSS 120B (Groq)',      provider: 'groq', desc: 'Open-weights 120B — deep synthesis, free tier',     tier: 'premium'  },
    { id: 'qwen/qwen3-32b',                            name: 'Qwen3 32B (Groq)',         provider: 'groq', desc: 'Chain-of-thought reasoning — free tier bull/bear',  tier: 'premium'  },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B (Groq)', provider: 'groq', desc: 'Llama 4 — fast analysis, long context',             tier: 'standard' },
    { id: 'llama-3.3-70b-versatile',                   name: 'Llama 3.3 70B (Groq)',     provider: 'groq', desc: 'Fast 70B synthesis — free tier',                    tier: 'standard' },
    { id: 'llama-3.1-8b-instant',                      name: 'Llama 3.1 8B Instant (Groq)', provider: 'groq', desc: 'Lightning-fast — lite summarization',           tier: 'lite'     },
] as const;

export type ResearchModelId = typeof RESEARCH_MODELS[number]['id'];

// Backward compat alias (SearchPage imports GEMINI_MODELS)
export const GEMINI_MODELS = RESEARCH_MODELS;
export type GeminiModelId = ResearchModelId;

// ─── Report Templates (outline-first) ────────────────────────────────────────
// Each template is a sectioned outline. The synthesis stage expands each
// section into prose grounded in the retrieved data.

export type TemplateKey =
    | 'investment_memo'
    | 'earnings_preview'
    | 'earnings_recap'
    | 'thematic'
    | 'company_primer'
    | 'comparative';

interface ReportTemplate {
    key: TemplateKey;
    label: string;
    sections: string[];
    requiredTables: string[];
}

export const REPORT_TEMPLATES: Record<TemplateKey, ReportTemplate> = {
    investment_memo: {
        key: 'investment_memo',
        label: 'Investment Memo',
        sections: [
            'Executive Summary',
            'Investment Thesis',
            'Financial Performance',
            'Competitive Position & Market Share',
            'Growth Drivers & Catalysts',
            'Bull Case — Path to Outperformance',
            'Bear Case — Key Downside Risks',
            'Risk Matrix',
            'Macro Context & Cross-Asset Implications',
            'Outlook: Catalysts & Monitoring Dashboard',
            'Conclusion & Conviction Rating',
        ],
        requiredTables: ['Financial Scorecard', 'Risk Matrix'],
    },
    earnings_preview: {
        key: 'earnings_preview',
        label: 'Earnings Preview',
        sections: [
            'Executive Summary & Print Expectations',
            'Consensus Estimates vs Our View',
            'Key Segments to Watch',
            'Likely Bull Surprises',
            'Likely Bear Surprises',
            'Options-Implied Move & Positioning',
            'Post-Earnings Scenarios (Beat / In-line / Miss)',
            'What Would Change Our View',
        ],
        requiredTables: ['Consensus Scorecard', 'Segment Expectations'],
    },
    earnings_recap: {
        key: 'earnings_recap',
        label: 'Earnings Recap',
        sections: [
            'Headline Summary & Stock Reaction',
            'Print vs Consensus Scorecard',
            'Segment & Geographic Breakdown',
            'Guidance Changes & Tone',
            'Management Commentary Highlights',
            'Buyside Pushback',
            'Revised Thesis & Rating',
            'Thesis Invalidation Criteria',
        ],
        requiredTables: ['Print vs Consensus', 'Guidance Revisions'],
    },
    thematic: {
        key: 'thematic',
        label: 'Thematic Research',
        sections: [
            'Executive Summary',
            'Theme Definition & Market Size',
            'Value-Chain Mapping',
            'Winners & Losers',
            'Capital Flows & Positioning',
            'Regulatory / Policy Landscape',
            'Bull Scenario',
            'Bear Scenario',
            'Top Trade Expressions',
            'Key Risks & Monitoring Points',
        ],
        requiredTables: ['Winners/Losers Map', 'Trade Expressions'],
    },
    company_primer: {
        key: 'company_primer',
        label: 'Company Primer',
        sections: [
            'Executive Summary',
            'Business Overview & Segments',
            'Revenue & Margin Profile',
            'Capital Structure & Balance Sheet',
            'Management & Governance',
            'Competitive Landscape',
            'Historical Financial Performance',
            'Valuation Framework',
            'Key Risks',
        ],
        requiredTables: ['Segment Financials', 'Valuation Multiples'],
    },
    comparative: {
        key: 'comparative',
        label: 'Comparative Analysis',
        sections: [
            'Executive Summary & Ranking',
            'Side-by-Side Financial Comparison',
            'Unit Economics & Margin Bridge',
            'Growth Trajectories',
            'Balance Sheet & Capital Return',
            'Valuation Comparison',
            'Relative Strengths & Weaknesses',
            'Preferred Pair-Trade Expression',
            'Risks by Name',
        ],
        requiredTables: ['Peer Comp Table', 'Valuation Spread'],
    },
};

export function selectTemplate(intent: ResearchBlueprint['intent'], query: string): TemplateKey {
    const q = query.toLowerCase();
    if (/earnings preview|expectations for.*q[1-4]|before earnings/.test(q)) return 'earnings_preview';
    if (/earnings recap|results|q[1-4] results|earnings reaction/.test(q)) return 'earnings_recap';
    if (/primer|introduction to|overview of/.test(q)) return 'company_primer';
    if (intent === 'comparative') return 'comparative';
    if (intent === 'thematic' || intent === 'sector_analysis' || intent === 'macro_analysis') return 'thematic';
    return 'investment_memo';
}

// ─── Exported Types ───────────────────────────────────────────────────────────

export interface ResearchPlan {
    query: string;
    subtopics: string[];
    searchQueries: string[];
    estimatedSources: number;
}

export interface ResearchProgress {
    stage: 'planning' | 'searching' | 'analyzing' | 'synthesizing' | 'complete';
    message: string;
    progress: number;
    sourcesFound?: number;
    currentSource?: string;
}

export interface Citation {
    id: number;
    title: string;
    url: string;
    source: string;
    publishedDate?: string;
}

export interface ResearchReport {
    query: string;
    title: string;
    summary: string;
    markdown: string;
    citations: Citation[];
    metadata: {
        sourcesAnalyzed: number;
        generatedAt: string;
        estimatedReadTime: number;
        modelUsed?: string;
        intent?: string;
        template?: TemplateKey;
        budget?: { llmCalls: number; estimatedTokens: number };
        verification?: {
            totalClaims: number;
            groundedClaims: number;
            unsupportedClaims: string[];
        };
    };
}

// ─── Internal Blueprint Type ──────────────────────────────────────────────────

interface ResearchBlueprint {
    intent: 'company_analysis' | 'sector_analysis' | 'macro_analysis' | 'thematic' | 'comparative';
    targetEntities: string[];
    tickers: string[];
    keyMetrics: string[];
    subtopics: string[];
    searchQueries: string[];
    secTargets: string[];
    timeframe: string;
    investmentHorizon: string;
    researchAngles: string[];
}

// ─── Budget Tracking ─────────────────────────────────────────────────────────
// Hard caps protect against runaway costs on a single query.

interface ResearchBudget {
    maxLLMCalls: number;
    maxEstimatedTokens: number;
    maxSearchRounds: number;
}

export const DEFAULT_BUDGET: ResearchBudget = {
    maxLLMCalls: 30,
    maxEstimatedTokens: 800_000,
    maxSearchRounds: 4,
};

export class BudgetTracker {
    llmCalls = 0;
    estimatedTokens = 0;
    budget: ResearchBudget;

    constructor(budget: ResearchBudget) {
        this.budget = budget;
    }

    recordCall(promptLen: number, responseLen: number) {
        this.llmCalls += 1;
        this.estimatedTokens += Math.ceil((promptLen + responseLen) / 4);
    }

    checkBeforeCall() {
        if (this.llmCalls >= this.budget.maxLLMCalls) {
            throw new Error(`Budget exhausted: ${this.llmCalls}/${this.budget.maxLLMCalls} LLM calls`);
        }
        if (this.estimatedTokens >= this.budget.maxEstimatedTokens) {
            throw new Error(`Budget exhausted: ~${this.estimatedTokens} tokens (cap ${this.budget.maxEstimatedTokens})`);
        }
    }

    snapshot() {
        return { llmCalls: this.llmCalls, estimatedTokens: this.estimatedTokens };
    }
}

// Module-level active tracker. performDeepResearch sets this per-query.
let _activeBudget: BudgetTracker | null = null;

// ─── Cancellation ────────────────────────────────────────────────────────────
// AbortSignal plumbed through stage boundaries AND fetch calls so the user can
// stop a running query mid-flight without orphaning pending LLM work.

export class ResearchCancelledError extends Error {
    constructor(message = 'Research cancelled by user') {
        super(message);
        this.name = 'ResearchCancelledError';
    }
}

let _activeSignal: AbortSignal | null = null;

export function throwIfAborted(signal?: AbortSignal | null) {
    const s = signal ?? _activeSignal;
    if (s?.aborted) throw new ResearchCancelledError();
}

// ─── LLM Layer — Server Proxy ────────────────────────────────────────────────
// All LLM calls route through market-server (/api/llm/chat).
// API keys stay server-side. Browser never touches them.

const LLM_PROXY_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/llm/chat`;

async function callLLMProxy(
    provider: string,
    model: string,
    prompt: string,
): Promise<string> {
    throwIfAborted();
    _activeBudget?.checkBeforeCall();
    const res = await fetch(LLM_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, prompt, max_tokens: 8192 }),
        signal: _activeSignal ?? undefined,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `${provider}/${model} failed (${res.status})`);
    }
    const data = await res.json();
    const text = data.text ?? '';
    _activeBudget?.recordCall(prompt.length, text.length);
    return text;
}

// ─── Unified LLM Router (Server-Proxied) ─────────────────────────────────────
// All LLM calls go through market-server. The server handles API keys and
// provider availability. The browser only needs to know which model to request.
// Fallback chain: if the requested model's provider fails, try next available.

type Provider = 'anthropic' | 'gemini' | 'deepseek' | 'groq';

// Cache of available providers — fetched once from server on first call.
let _serverProviders: Provider[] | null = null;

async function getServerProviders(): Promise<Provider[]> {
    if (_serverProviders) return _serverProviders;
    try {
        const url = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/llm/providers`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            _serverProviders = (data.providers || [])
                .filter((p: any) => p.available)
                .map((p: any) => p.id as Provider);
        }
    } catch {
        // Server unreachable — empty list
    }
    return _serverProviders || [];
}

type Tier = 'premium' | 'standard' | 'lite';

export function defaultModelFor(provider: Provider, tier: Tier): ResearchModelId {
    if (provider === 'anthropic') {
        if (tier === 'premium') return 'claude-opus-4-6';
        if (tier === 'standard') return 'claude-sonnet-4-6';
        return 'claude-haiku-4-5-20251001';
    }
    if (provider === 'gemini') {
        if (tier === 'premium') return 'gemini-2.5-pro';
        if (tier === 'standard') return 'gemini-2.5-flash';
        return 'gemini-2.0-flash-lite';
    }
    if (provider === 'deepseek') {
        if (tier === 'premium') return 'deepseek-reasoner';
        return 'deepseek-chat';
    }
    // groq
    if (tier === 'premium') return 'openai/gpt-oss-120b';
    if (tier === 'standard') return 'llama-3.3-70b-versatile';
    return 'llama-3.1-8b-instant';
}

async function pickDriver(tier: Tier, preferred?: ResearchModelId): Promise<ResearchModelId> {
    const available = await getServerProviders();
    if (available.length === 0) {
        throw new Error('No LLM providers configured on server — check market-server .env');
    }
    if (preferred) {
        const model = RESEARCH_MODELS.find(m => m.id === preferred);
        if (model && available.includes(model.provider as Provider)) return preferred;
    }
    return defaultModelFor(available[0], tier);
}

async function callDriver(
    prompt: string,
    tier: Tier = 'standard',
    preferredModel?: ResearchModelId,
): Promise<string> {
    const modelId = await pickDriver(tier, preferredModel);
    return callLLM(prompt, modelId);
}

async function callLLM(
    prompt: string,
    modelId: ResearchModelId | undefined,
): Promise<string> {
    const requested = RESEARCH_MODELS.find(m => m.id === modelId);
    const requestedProvider = (requested?.provider ?? 'groq') as Provider;

    // Build fallback chain: requested provider first, then remaining available
    const available = await getServerProviders();
    const providerChain: Provider[] = available.includes(requestedProvider)
        ? [requestedProvider, ...available.filter(p => p !== requestedProvider)]
        : available;

    if (providerChain.length === 0) {
        throw new Error('No LLM providers configured on server — check market-server .env');
    }

    // Build a full model-level fallback chain.
    // For each provider: try the requested/default model first, then all other models for that provider.
    const modelChain: Array<{ provider: Provider; model: string }> = [];
    for (const provider of providerChain) {
        const primaryModel = (requestedProvider === provider && modelId)
            ? modelId
            : defaultModelFor(provider, 'standard');
        modelChain.push({ provider, model: primaryModel as string });

        // Add remaining models for this provider as fallbacks
        const otherModels = RESEARCH_MODELS
            .filter(m => m.provider === provider && m.id !== primaryModel)
            .map(m => m.id);
        for (const alt of otherModels) {
            modelChain.push({ provider, model: alt as string });
        }
    }

    const failures: string[] = [];
    for (const { provider, model } of modelChain) {
        try {
            return await callLLMProxy(provider, model, prompt);
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            failures.push(`${provider}/${model}: ${msg.substring(0, 100)}`);
            console.warn(`LLM ${provider}/${model} failed, trying next…`, e);
        }
    }
    throw new Error(`All LLM providers failed — ${failures.join(' | ')}`);
}

// ─── Stage 1: Research Blueprint ─────────────────────────────────────────────

async function buildResearchBlueprint(
    query: string,
    model?: ResearchModelId
): Promise<ResearchBlueprint> {
    const prompt = `You are the Chief Research Strategist at a top-tier institutional asset manager (Goldman Sachs Asset Management, Bridgewater, Two Sigma).

A client has submitted this research request: "${query}"

Produce a comprehensive research blueprint. Think step-by-step:
1. What is the core research intent?
2. Which companies/sectors/indices are involved?
3. What financial metrics matter most?
4. What search queries would yield the highest-quality sources?
5. Which companies warrant SEC filing review?

Return ONLY valid JSON (no markdown, no explanation):
{
  "intent": "company_analysis" | "sector_analysis" | "macro_analysis" | "thematic" | "comparative",
  "targetEntities": ["entity1", "entity2"],
  "tickers": ["AAPL", "NVDA"],
  "keyMetrics": ["Revenue Growth", "EBITDA Margin", "P/E Ratio", "EPS"],
  "subtopics": ["subtopic 1", "subtopic 2", "subtopic 3", "subtopic 4", "subtopic 5"],
  "searchQueries": [
    "query 1 — highly specific, analyst-grade",
    "query 2",
    "query 3",
    "query 4",
    "query 5",
    "query 6",
    "query 7",
    "query 8",
    "query 9",
    "query 10",
    "query 11",
    "query 12"
  ],
  "secTargets": ["Company Name for SEC 10-K/10-Q"],
  "timeframe": "Q4 2024 / FY2025 outlook",
  "investmentHorizon": "12 months",
  "researchAngles": ["angle 1", "angle 2", "angle 3", "angle 4", "angle 5"]
}`;

    const text = await callDriver(prompt, 'premium', model);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Failed to parse research blueprint');

    const p = JSON.parse(match[0]);
    return {
        intent: p.intent || 'thematic',
        targetEntities: p.targetEntities || [],
        tickers: p.tickers || [],
        keyMetrics: p.keyMetrics || [],
        subtopics: p.subtopics || [],
        searchQueries: p.searchQueries || [],
        secTargets: p.secTargets || [],
        timeframe: p.timeframe || 'Current',
        investmentHorizon: p.investmentHorizon || '12 months',
        researchAngles: p.researchAngles || p.subtopics || [],
    };
}

// ─── Source Quality Scorer ────────────────────────────────────────────────────

const PREMIUM_DOMAINS = ['reuters.com', 'bloomberg.com', 'wsj.com', 'ft.com', 'sec.gov', 'federalreserve.gov'];
const GOOD_DOMAINS = ['cnbc.com', 'marketwatch.com', 'seekingalpha.com', 'barrons.com', 'economist.com', 'forbes.com', 'businessinsider.com'];

function scoreSource(s: TavilySearchResult): number {
    let score = s.score ?? 0.5;
    if (PREMIUM_DOMAINS.some(d => s.url.includes(d))) score += 0.3;
    else if (GOOD_DOMAINS.some(d => s.url.includes(d))) score += 0.15;
    if (s.publishedDate) {
        const daysSince = (Date.now() - new Date(s.publishedDate).getTime()) / 86400000;
        if (daysSince < 7) score += 0.2;
        else if (daysSince < 30) score += 0.1;
    }
    return Math.min(score, 1.0);
}

// ─── Iterative Search: Round N adaptive query generator ───────────────────────

async function generateAdaptiveQueries(
    blueprint: ResearchBlueprint,
    knowledgeBase: string,
    round: number,
    model?: ResearchModelId
): Promise<string[]> {
    const prompt = `You are a research director at a top-tier asset management firm conducting iterative deep research.

RESEARCH TOPIC: ${blueprint.targetEntities.join(', ') || blueprint.subtopics[0]}
RESEARCH ANGLES: ${blueprint.researchAngles.join(' | ')}
KEY METRICS NEEDED: ${blueprint.keyMetrics.join(', ')}
SEARCH ROUND: ${round + 1}

KNOWLEDGE ACCUMULATED SO FAR:
${knowledgeBase.substring(0, 3000)}

TASK: Identify the CRITICAL GAPS in the above knowledge. What specific information is still missing that would materially change the investment analysis? Generate exactly 6 highly targeted search queries to fill these gaps.

Focus on:
- Specific numbers not yet found (earnings figures, market share %, price targets)
- Recent events not yet covered (earnings calls, regulatory actions, product launches)
- Analyst perspectives not yet represented
- Risks not yet quantified
- Competitive dynamics not yet analyzed

Return ONLY a JSON array of 6 search query strings, no explanation:
["query 1", "query 2", "query 3", "query 4", "query 5", "query 6"]`;

    const text = await callDriver(prompt, 'standard', model);
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
        const queries: string[] = JSON.parse(match[0]);
        return queries.filter(q => typeof q === 'string' && q.trim().length > 0).slice(0, 6);
    } catch {
        return [];
    }
}

// ─── Iterative Search: Coverage evaluator ─────────────────────────────────────

async function evaluateCoverage(
    knowledgeBase: string,
    blueprint: ResearchBlueprint,
    model?: ResearchModelId
): Promise<{ sufficient: boolean; gaps: string[] }> {
    const prompt = `You are a research quality reviewer at an institutional asset manager.

RESEARCH TOPIC: ${blueprint.targetEntities.join(', ') || blueprint.subtopics[0]}
REQUIRED COVERAGE: ${blueprint.researchAngles.join(' | ')}
REQUIRED METRICS: ${blueprint.keyMetrics.join(', ')}

CURRENT KNOWLEDGE BASE:
${knowledgeBase.substring(0, 2500)}

Assess: Is this knowledge base SUFFICIENT to write a comprehensive institutional research report?

Return ONLY valid JSON:
{
  "sufficient": true | false,
  "coverage_score": 0.0-1.0,
  "gaps": ["specific gap 1", "specific gap 2", "specific gap 3"]
}

Mark sufficient=true only if coverage_score >= 0.75 AND all major research angles have data.`;

    // Coverage eval is a classification task — use the cheapest tier.
    const text = await callDriver(prompt, 'lite', model);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { sufficient: false, gaps: [] };
    try {
        const result = JSON.parse(match[0]);
        return {
            sufficient: result.sufficient ?? false,
            gaps: result.gaps ?? [],
        };
    } catch {
        return { sufficient: false, gaps: [] };
    }
}

// ─── Iterative Search: Main loop ──────────────────────────────────────────────

async function iterativeSearch(
    blueprint: ResearchBlueprint,
    model: ResearchModelId | undefined,
    onProgress: (p: ResearchProgress) => void,
    maxRounds = 4,
): Promise<{ sources: TavilySearchResult[]; knowledgeBase: string }> {
    let allSources: TavilySearchResult[] = [];
    let knowledgeBase = '';
    const seenUrls = new Set<string>();

    for (let round = 0; round < maxRounds; round++) {
        const isFirstRound = round === 0;

        // Generate queries: use blueprint on round 0, adaptive on subsequent rounds
        const queries = isFirstRound
            ? blueprint.searchQueries
            : await generateAdaptiveQueries(blueprint, knowledgeBase, round, model);

        if (queries.length === 0) break;

        onProgress({
            stage: 'searching',
            message: isFirstRound
                ? `Round 1: Dispatching ${queries.length} queries across the web…`
                : `Round ${round + 1}: Filling ${queries.length} knowledge gaps…`,
            progress: 12 + round * 8,
            sourcesFound: allSources.length,
        });

        // Search
        const newResults = await searchMultipleQueriesParallel(queries, 6);

        // Deduplicate by URL and score
        const fresh = newResults
            .filter(s => !seenUrls.has(s.url))
            .sort((a, b) => scoreSource(b) - scoreSource(a));

        fresh.forEach(s => seenUrls.add(s.url));
        allSources.push(...fresh);

        onProgress({
            stage: 'searching',
            message: `Round ${round + 1} complete: +${fresh.length} new sources (${allSources.length} total)`,
            progress: 16 + round * 8,
            sourcesFound: allSources.length,
        });

        // Extract intelligence from this round's sources
        const roundIntelligence = await callDriver(
            `You are a senior analyst. Extract ALL specific facts, figures, quotes, and data points from these sources relevant to: ${blueprint.targetEntities.join(', ')} — ${blueprint.researchAngles.slice(0, 3).join(' | ')}

Sources:
${fresh.slice(0, 12).map((s, i) => `[${i + 1}] ${s.title}\n${s.content.substring(0, 700)}`).join('\n\n---\n\n')}

Extract as bullet points. Be specific with numbers, dates, and source attribution. Skip marketing language.`,
            'standard',
            model,
        );

        knowledgeBase += `\n\n=== ROUND ${round + 1} INTELLIGENCE ===\n${roundIntelligence}`;

        // Evaluate if we have enough (skip on last round)
        if (round < maxRounds - 1) {
            onProgress({
                stage: 'searching',
                message: `Evaluating coverage depth…`,
                progress: 20 + round * 8,
                sourcesFound: allSources.length,
            });

            const { sufficient } = await evaluateCoverage(knowledgeBase, blueprint, model);
            if (sufficient) {
                onProgress({
                    stage: 'searching',
                    message: `Coverage sufficient after ${round + 1} round${round > 0 ? 's' : ''} — proceeding to analysis`,
                    progress: 40,
                    sourcesFound: allSources.length,
                });
                break;
            }
        }
    }

    return {
        sources: allSources.sort((a, b) => scoreSource(b) - scoreSource(a)),
        knowledgeBase,
    };
}

// ─── Stage 3: Source Intelligence Extraction ──────────────────────────────────

async function analyzeSources(
    sources: TavilySearchResult[],
    blueprint: ResearchBlueprint,
    model?: ResearchModelId,
    ragResult?: GravityRAGResult,
    knowledgeBase?: string,
): Promise<string> {
    // If we already have an accumulated knowledge base from iterative search, use it directly
    // and only supplement with RAG data — avoids re-processing the same sources
    const ragSection = ragResult ? formatRAGSourcesForPrompt(ragResult) : '';
    const ragDataSection = ragResult ? formatRAGStructuredData(ragResult) : '';

    if (knowledgeBase && knowledgeBase.trim().length > 200) {
        const prompt = `You are a senior financial research analyst at a bulge-bracket bank.

You have already extracted intelligence across ${sources.length} sources in multiple research rounds. Now synthesize this into a final structured analyst brief.

Research Focus: ${blueprint.targetEntities.join(', ')} — ${blueprint.researchAngles.join(' | ')}
Key Metrics: ${blueprint.keyMetrics.join(', ')}

ACCUMULATED INTELLIGENCE (from ${sources.length} web sources across multiple search rounds):
${knowledgeBase.substring(0, 5000)}

${ragSection ? `HIGH-AUTHORITY DATABASE SOURCES (SEC filings index):\n${ragSection}\n\n${ragDataSection}\n` : ''}

Synthesize into a final structured analyst brief:
1. Consolidate all specific data points (revenue, EPS, margins, growth rates, market share)
2. Resolve any conflicting data — flag where sources disagree
3. Highlight the 3–5 most market-moving recent developments
4. Compile executive and analyst quotes with attribution
5. Summarize the dominant bull and bear narratives
6. List key risks and opportunities with probability weighting

Be specific with numbers. Never invent data. Cross-reference conflicting figures.`;

        // Use Claude Sonnet for synthesis if available (superior extraction), else whatever driver is configured
        const synthModel = await pickDriver('standard', model);
        return callLLM(prompt, synthModel);
    }

    // Fallback: extract fresh from raw sources (used if iterative search wasn't run)
    const top20 = sources.slice(0, 20);
    const sourceText = top20
        .map((s, i) =>
            `[Source ${i + 1}] "${s.title}" (${s.publishedDate || 'recent'})\n${(s.content || '').substring(0, 900)}`
        )
        .join('\n\n---\n\n');

    const prompt = `You are a senior financial research analyst at a bulge-bracket bank. Extract and synthesize intelligence from these source documents for a team of institutional analysts.

Research Question: ${blueprint.subtopics[0] || 'See research angles below'}
Research Angles: ${blueprint.researchAngles.join(' | ')}
Key Metrics to Track: ${blueprint.keyMetrics.join(', ')}
Entities of Interest: ${blueprint.targetEntities.join(', ')}

${ragSection ? `HIGH-AUTHORITY SOURCES (from indexed SEC filings database):\n${ragSection}\n\n${ragDataSection}\n\n` : ''}WEB SOURCE DOCUMENTS:
${sourceText}

Your tasks:
1. Extract ALL specific data points: revenue figures, EPS, growth rates, market share %, price targets, analyst ratings, guidance
2. Identify the dominant market narratives and any narrative conflicts
3. Note conflicting analyst views or divergent forecasts with source attribution
4. Flag recent developments that could be market-moving (earnings beats/misses, regulatory, M&A, product launches)
5. Extract direct verbatim quotes from executives or named analysts (with attribution and source number)
6. Identify sector-specific risk factors and opportunities

Format as structured analyst notes. Be SPECIFIC with numbers and dates. Never invent data absent from sources.`;

    const synthModel = await pickDriver('standard', model);
    return callLLM(prompt, synthModel);
}

// ─── RAG Verified Facts Formatter ─────────────────────────────────────────────
// Formats RAG passages as a high-authority "verified facts" block.
// RAG = indexed SEC filings → ground truth that overrides web narrative.

function buildVerifiedFactsBlock(ragResult: GravityRAGResult): string {
    if (!ragResult.available || ragResult.sources.length === 0) return '';

    const passages = ragResult.sources.slice(0, 12).map((s, i) =>
        `[RAG-${i + 1}] ${s.ticker ? `${s.ticker} ` : ''}${s.title}${s.section ? ` — ${s.section}` : ''} (${s.date ?? 'N/A'}):\n"${s.text.substring(0, 600)}"`
    ).join('\n\n');

    const structuredData = formatRAGStructuredData(ragResult);

    return `
╔══════════════════════════════════════════════════════╗
║  TIER-1 VERIFIED FACTS — SEC FILING DATABASE         ║
║  These are verbatim excerpts from indexed SEC         ║
║  filings (10-K, 10-Q, 8-K, earnings transcripts).    ║
║  When this data conflicts with web sources, TRUST     ║
║  THIS — it is the authoritative primary source.       ║
╚══════════════════════════════════════════════════════╝
${structuredData ? `STRUCTURED FINANCIAL METRICS (from SEC filings):\n${structuredData}\n` : ''}
VERIFIED FILING PASSAGES:
${passages}`.trim();
}

// ─── Stage 4: Adversarial Bull/Bear Analysis ──────────────────────────────────

async function generateAdversarialAnalysis(
    blueprint: ResearchBlueprint,
    sourceAnalysis: string,
    model?: ResearchModelId,
    ragResult?: GravityRAGResult,
): Promise<{ bullCase: string; bearCase: string }> {
    const verifiedFacts = ragResult ? buildVerifiedFactsBlock(ragResult) : '';

    const context = `Research Focus: ${blueprint.intent} — ${blueprint.targetEntities.join(', ') || 'Market theme'}
Key Metrics: ${blueprint.keyMetrics.join(', ')}
Timeframe: ${blueprint.timeframe}

${verifiedFacts ? `${verifiedFacts}\n\n` : ''}WEB + MARKET INTELLIGENCE SYNTHESIS:
${sourceAnalysis.substring(0, 2800)}`.trim();

    // pickDriver automatically selects the best provider for premium tier.
    // Priority order configured on server: anthropic > gemini > deepseek > groq.
    const adversarialModel = await pickDriver('premium', model);

    const [bullResult, bearResult] = await Promise.allSettled([
        callLLM(
            `You are a BULL-CASE analyst at a top-tier long/long equity fund presenting the upside thesis to the Investment Committee.

${context}

Write a compelling BULL CASE (4–5 paragraphs) for why this investment/sector/theme will OUTPERFORM:
1. Lead with the single most powerful upside catalyst — ground it in a specific verified data point
2. Build the financial case: revenue trajectory, margin expansion, EPS beat potential with figures
3. Identify the market mispricing — what is consensus getting wrong that your data shows differently?
4. Address the top 2 bear arguments directly and refute them with evidence
5. State Conviction Level: High / Medium / Low with specific price target or return target where data supports

Anchor every claim to specific facts from the verified data above. Write as a senior PM: direct, non-consensus, data-driven.`,
            adversarialModel,
        ),
        callLLM(
            `You are a BEAR-CASE analyst / short-seller at a top hedge fund presenting the downside thesis to your short book committee.

${context}

Write a rigorous BEAR CASE (4–5 paragraphs) for why this investment/sector/theme will UNDERPERFORM:
1. Lead with the single most dangerous downside risk — ground it in a specific red flag from the verified data
2. Build the financial forensics: what metrics are deteriorating that the market is ignoring?
3. Stress-test the bull thesis: what assumptions break first and what is the downside scenario?
4. Identify what the consensus is dangerously over-extrapolating
5. State Risk Level: Critical / High / Medium — with downside target or % drawdown estimate where data supports

Anchor every claim to specific facts from the verified data above. Write as a top short-seller: incisive, skeptical, forensically precise.`,
            adversarialModel,
        ),
    ]);

    return {
        bullCase: bullResult.status === 'fulfilled' ? bullResult.value : 'Bull case analysis unavailable.',
        bearCase: bearResult.status === 'fulfilled' ? bearResult.value : 'Bear case analysis unavailable.',
    };
}

// ─── Stage 5: Goldman Sachs-Style Report Synthesis ────────────────────────────

async function synthesizeInstitutionalReport(
    blueprint: ResearchBlueprint,
    webSources: TavilySearchResult[],
    secFilings: SECFiling[],
    companyData: CompanyOverview[],
    sourceAnalysis: string,
    bullCase: string,
    bearCase: string,
    template: ReportTemplate,
    model?: ResearchModelId,
    ragResult?: GravityRAGResult,
    macroText?: string,
): Promise<string> {
    // Tier-1: RAG verified facts (SEC filings database — ground truth)
    const verifiedFactsBlock = ragResult ? buildVerifiedFactsBlock(ragResult) : '';

    // Tier-2: Market data (Alpha Vantage live quotes)
    const marketDataSection = companyData.length > 0
        ? `LIVE MARKET DATA (Alpha Vantage):\n${companyData.map(c =>
            `${c.name} (${c.symbol}): Sector=${c.sector} | Mkt Cap=$${(c.marketCap / 1e9).toFixed(1)}B | P/E=${c.peRatio} | 52wk Hi=$${c.fiftyTwoWeekHigh} / Lo=$${c.fiftyTwoWeekLow}`
        ).join('\n')}\n`
        : '';

    // Tier-3: SEC EDGAR real-time filings
    const secIndex = secFilings.length > 0
        ? `SEC EDGAR REAL-TIME FILINGS:\n${secFilings.map((f, i) =>
            `[SEC-${i + 1}] ${f.company} ${f.filingType} (${f.filingDate}) — ${f.url}`
        ).join('\n')}\n`
        : '';

    // Tier-4: Web sources (narrative / analyst consensus)
    const webCitationIndex = webSources.slice(0, 35)
        .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`)
        .join('\n');

    // RAG citation index for inline reference
    const ragCitationIndex = ragResult?.available && ragResult.sources.length > 0
        ? `TIER-1 DATABASE CITATIONS:\n${ragResult.sources.slice(0, 10).map((s, i) =>
            `[RAG-${i + 1}] ${s.ticker ? s.ticker + ' ' : ''}${s.title}${s.section ? ' — ' + s.section : ''} [${s.date ?? 'N/A'}]`
        ).join('\n')}\n`
        : '';

    // Claude Opus is the best long-form synthesis model. If not available, use user's model,
    // fall back to whichever premium-tier driver is configured.
    const synthesisModel = await pickDriver('premium', model);

    const prompt = `You are a Managing Director of Equity Research at Goldman Sachs / Morgan Stanley. You are producing a flagship institutional research note for the world's most sophisticated investors — sovereign wealth funds, top-tier hedge funds, and CIOs of major family offices. This report will be cited in Bloomberg terminal conversations and investment committee memos.

Your job is synthesis + insight, not summary. Every paragraph must contain non-obvious analysis grounded in the data provided.

════════════════════════════════════════════
RESEARCH MANDATE
════════════════════════════════════════════
Type: ${blueprint.intent.replace(/_/g, ' ').toUpperCase()}
Universe: ${blueprint.targetEntities.join(', ') || 'Broad Market'}
Tickers: ${blueprint.tickers.join(', ') || 'N/A'}
Timeframe: ${blueprint.timeframe} | Horizon: ${blueprint.investmentHorizon}
Angles: ${blueprint.researchAngles.join(' | ')}
Key Metrics: ${blueprint.keyMetrics.join(', ')}

════════════════════════════════════════════
DATA HIERARCHY — READ THIS CAREFULLY
════════════════════════════════════════════
TIER 1 (highest authority — primary source, verified):
${verifiedFactsBlock || '⚠ RAG database offline — using web sources only for financials'}

TIER 2 (market data — live):
${marketDataSection || 'N/A'}
${macroText ? `\nTIER 2b (macro environment — FRED / Federal Reserve):\n${macroText}` : ''}

TIER 3 (regulatory filings — authoritative):
${secIndex || 'N/A'}

TIER 4 (web intelligence — analyst narrative, news, market consensus):
ANALYST TEAM SYNTHESIS:
${sourceAnalysis.substring(0, 4000)}

When Tier 1 and Tier 4 conflict: TRUST TIER 1. When Tier 4 has more recent narrative: note both.

════════════════════════════════════════════
ADVERSARIAL ANALYSIS (pre-generated)
════════════════════════════════════════════
BULL CASE:
${bullCase.substring(0, 1600)}

BEAR CASE:
${bearCase.substring(0, 1600)}

════════════════════════════════════════════
CITATION INDEX — use [n] and [RAG-n] inline
════════════════════════════════════════════
${ragCitationIndex}
WEB SOURCES:
${webCitationIndex}

════════════════════════════════════════════
WRITE THIS REPORT — OUTLINE-FIRST, FIXED STRUCTURE
════════════════════════════════════════════
Report template: **${template.label}**

# [Compelling, Specific Title — ticker/theme + timeframe + the core insight]

${template.sections.map(s => `## ${s}\n[3–4 paragraphs. Ground every claim in Tier 1 verified facts or cited web sources. Use specific numbers ($, %, bps). Cite [n] and [RAG-n] inline. Zero filler.]`).join('\n\n')}

${template.requiredTables.length > 0 ? `\n════════════════════════════════════════════
REQUIRED TABLES — MUST APPEAR IN THE REPORT
════════════════════════════════════════════
${template.requiredTables.map(t => `- **${t}** — populated markdown table with ≥6 rows, real figures only, each cell traceable to a cited source.`).join('\n')}` : ''}

${template.key === 'investment_memo' ? `
PRE-GENERATED BULL CASE (incorporate into relevant section):
${bullCase.substring(0, 500)}

PRE-GENERATED BEAR CASE (incorporate into relevant section):
${bearCase.substring(0, 500)}
` : ''}

---
> **Key Finding:** [Non-consensus, data-backed insight in bold — the single thing a reader must remember. Must reference a specific figure from Tier 1 or a verified source.]

════════════════════════════════════════════
CRITICAL WRITING STANDARDS
════════════════════════════════════════════
✓ NEVER fabricate figures — every number must trace to a cited source
✓ MINIMUM 30 inline citations [n] or [RAG-n] distributed throughout
✓ Tier 1 (RAG) figures take priority — mark them [RAG-n] so the reader knows they are verified
✓ Tone: institutional, direct, zero marketing language
✓ Specific beats vague: "$2.47B in free cash flow" not "strong cash generation"
✓ Every required table must be populated — no placeholder rows
✓ Report target: 3,500–4,500 words`;

    return callLLM(prompt, synthesisModel);
}

// ─── Stage 6: Numeric-Consistency Verifier ──────────────────────────────────
// Deterministic check that every number in the report appears in some
// source evidence. Catches the most common finance-RAG hallucination:
// invented figures. Not a substitute for NLI entailment, but orders of
// magnitude cheaper and highly effective on the biggest failure mode.

interface VerificationInputs {
    webSources: TavilySearchResult[];
    ragResult?: GravityRAGResult;
    companyData: CompanyOverview[];
    knowledgeBase: string;
    sourceAnalysis: string;
}

interface VerificationResult {
    totalClaims: number;
    groundedClaims: number;
    unsupportedClaims: string[];
}

// Number patterns: currency ($1.2B, $500M), percentages (12.5%, -3%),
// basis points (150 bps), multiples (14.5x), ratios (2.3:1), and plain
// figures with optional suffixes (1.2B, 500M, 3.4K). Excludes simple small
// integers like "3 analysts" by requiring scale suffix or decimal/%/$/x.
const NUMERIC_PATTERNS: RegExp[] = [
    /\$\s?\d+(?:,\d{3})*(?:\.\d+)?\s?(?:[BMK]|billion|million|thousand|trillion|T)\b/gi,
    /\d+(?:\.\d+)?\s?(?:%|percent|bps|basis\s?points)/gi,
    /\d+(?:\.\d+)?\s?x\b/g,  // multiples: 14.5x P/E, 2.3x revenue
    /\$\s?\d+(?:,\d{3})*(?:\.\d{2})?\b/g,  // plain dollar amounts
    /\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g,  // large numbers with commas
];

export function extractClaims(markdown: string): string[] {
    const claims = new Set<string>();
    for (const pattern of NUMERIC_PATTERNS) {
        const matches = markdown.match(pattern) || [];
        for (const m of matches) {
            claims.add(m.trim().replace(/\s+/g, ' '));
        }
    }
    return Array.from(claims);
}

function normalizeNumber(s: string): string {
    // Strip whitespace, lowercase, collapse separators for loose matching.
    return s.toLowerCase().replace(/[\s,$]/g, '').replace(/basis\s?points/g, 'bps');
}

export function verifyNumericConsistency(
    markdown: string,
    inputs: VerificationInputs,
): VerificationResult {
    const claims = extractClaims(markdown);

    // Build an evidence corpus from all source material.
    const evidence: string[] = [
        inputs.knowledgeBase,
        inputs.sourceAnalysis,
        ...inputs.webSources.map(s => `${s.title} ${s.content}`),
        ...(inputs.ragResult?.available ? inputs.ragResult.sources.map(s => s.text) : []),
        ...inputs.companyData.map(c =>
            `${c.marketCap} ${c.peRatio} ${c.fiftyTwoWeekHigh} ${c.fiftyTwoWeekLow}`
        ),
    ];
    const normalizedEvidence = evidence.map(normalizeNumber).join(' ');

    const unsupported: string[] = [];
    let grounded = 0;

    for (const claim of claims) {
        const norm = normalizeNumber(claim);
        // Match the numeric core — strip unit suffix for loose matching.
        const numericCore = norm.replace(/[a-z%]/g, '');
        if (numericCore.length < 2) {
            grounded += 1;  // too short to meaningfully verify
            continue;
        }
        if (normalizedEvidence.includes(numericCore)) {
            grounded += 1;
        } else {
            unsupported.push(claim);
        }
    }

    return {
        totalClaims: claims.length,
        groundedClaims: grounded,
        unsupportedClaims: unsupported.slice(0, 50),  // cap to avoid metadata bloat
    };
}

// ─── Main Export: performDeepResearch ────────────────────────────────────────

export const performDeepResearch = async (
    query: string,
    onProgress: (progress: ResearchProgress) => void,
    model?: ResearchModelId,
    budget: ResearchBudget = DEFAULT_BUDGET,
    signal?: AbortSignal,
): Promise<ResearchReport> => {
    // Pre-fetch server providers to validate availability and resolve driver model.
    const providers = await getServerProviders();
    if (providers.length === 0) {
        throw new Error('No LLM providers configured on server — check market-server .env');
    }

    // Per-query budget: resets on every call so the module-level ref is safe.
    const tracker = new BudgetTracker(budget);
    _activeBudget = tracker;
    _activeSignal = signal ?? null;
    throwIfAborted(signal);

    const driverModel = await pickDriver('premium', model);

    // ── Stage 1: Blueprint (0–10%) ─────────────────────────────────────────
    onProgress({ stage: 'planning', message: 'Chief Analyst building research blueprint…', progress: 3 });

    const blueprint = await buildResearchBlueprint(query, driverModel);

    onProgress({
        stage: 'planning',
        message: `Blueprint: ${blueprint.intent.replace(/_/g, ' ')} · ${blueprint.targetEntities.length} entities · ${blueprint.searchQueries.length} queries`,
        progress: 10,
    });

    throwIfAborted(signal);

    // ── Stage 2: Iterative Search + Parallel Data (10–45%) ───────────────
    // Fire all data sources in parallel: web search, RAG, SEC, market data, FRED macro
    const [
        { sources: webSources, knowledgeBase },
        ragResult,
        macroText,
        ...secAndCompanyArrays
    ] = await Promise.all([
        // Iterative adaptive web search (up to 4 rounds)
        iterativeSearch(blueprint, driverModel, onProgress, 4),

        // Gravity RAG: agentic retrieval from local databases
        queryGravityRAG(query),

        // FRED macro snapshot — free Federal Reserve data (never blocks)
        getMacroSummaryText(),

        // SEC EDGAR filings (one Promise per company target)
        ...blueprint.secTargets.slice(0, 5).map(company =>
            searchFilings(company, ['10-K', '10-Q', '8-K'], 3).catch(() => [] as SECFiling[])
        ),

        // Company overviews from Alpha Vantage (one Promise per ticker)
        ...blueprint.tickers.slice(0, 4).map(ticker =>
            getCompanyOverview(ticker).catch(() => null)
        ),
    ]) as [{ sources: TavilySearchResult[]; knowledgeBase: string }, GravityRAGResult, string, ...(SECFiling[] | CompanyOverview | null)[]];

    // Separate SEC filings from company overviews
    const numSecTargets = blueprint.secTargets.slice(0, 5).length;
    const secFilings: SECFiling[] = (secAndCompanyArrays.slice(0, numSecTargets) as SECFiling[][]).flat();
    const companyData: CompanyOverview[] = (secAndCompanyArrays.slice(numSecTargets) as (CompanyOverview | null)[])
        .filter((c): c is CompanyOverview => c !== null);

    const ragSourceCount = ragResult.available ? ragResult.sources.length : 0;
    const totalSources = webSources.length + secFilings.length + ragSourceCount;

    const ragStatus = ragResult.available
        ? `${ragSourceCount} RAG passages (${ragResult.latency_ms}ms)`
        : 'RAG unavailable (web-only mode)';
    const macroStatus = macroText ? '· FRED macro ✓' : '';

    onProgress({
        stage: 'searching',
        message: `Retrieved ${webSources.length} web · ${secFilings.length} SEC · ${ragStatus} ${macroStatus}`.trim(),
        progress: 45,
        sourcesFound: totalSources,
    });

    // ── Stage 3: Source Intelligence (45–65%) ─────────────────────────────
    onProgress({
        stage: 'analyzing',
        message: 'Analyst team extracting intelligence from sources…',
        progress: 48,
        sourcesFound: totalSources,
    });

    throwIfAborted(signal);
    const sourceAnalysis = await analyzeSources(webSources, blueprint, driverModel, ragResult, knowledgeBase);

    onProgress({
        stage: 'analyzing',
        message: 'Running adversarial bull/bear analysis in parallel…',
        progress: 63,
        sourcesFound: totalSources,
    });

    throwIfAborted(signal);

    // ── Stage 4: Adversarial Analysis (65–75%) ────────────────────────────
    const { bullCase, bearCase } = await generateAdversarialAnalysis(
        blueprint, sourceAnalysis, driverModel, ragResult
    );

    onProgress({
        stage: 'synthesizing',
        message: 'Senior analyst writing institutional report…',
        progress: 75,
        sourcesFound: totalSources,
    });

    throwIfAborted(signal);

    // ── Stage 5: Report Synthesis (75–96%) ────────────────────────────────
    // Outline-first: select a fixed template from the query/intent, then
    // expand each template section with retrieved data.
    const templateKey = selectTemplate(blueprint.intent, query);
    const template = REPORT_TEMPLATES[templateKey];

    const markdown = await synthesizeInstitutionalReport(
        blueprint,
        webSources,
        secFilings,
        companyData,
        sourceAnalysis,
        bullCase,
        bearCase,
        template,
        driverModel,
        ragResult,
        macroText,
    );

    // ── Stage 6: Numeric-Consistency Verifier (96–100%) ───────────────────
    onProgress({
        stage: 'synthesizing',
        message: 'Verifying numeric claims against source evidence…',
        progress: 97,
        sourcesFound: totalSources,
    });

    const verification = verifyNumericConsistency(markdown, {
        webSources,
        ragResult,
        companyData,
        knowledgeBase,
        sourceAnalysis,
    });

    onProgress({
        stage: 'complete',
        message: `Report finalized · ${verification.groundedClaims}/${verification.totalClaims} numeric claims grounded`,
        progress: 100,
        sourcesFound: totalSources,
    });

    // ── Build Citations ────────────────────────────────────────────────────
    const citations: Citation[] = [];
    let id = 1;

    for (const s of webSources.slice(0, 50)) {
        citations.push({ id: id++, title: s.title, url: s.url, source: 'Web', publishedDate: s.publishedDate });
    }
    for (const f of secFilings) {
        citations.push({
            id: id++,
            title: `${f.company} ${f.filingType} — ${f.filingDate}`,
            url: f.url,
            source: 'SEC EDGAR',
            publishedDate: f.filingDate,
        });
    }
    // RAG sources from local database (highest authority)
    if (ragResult.available) {
        for (const s of ragResult.sources) {
            citations.push({
                id: id++,
                title: `${s.ticker ? s.ticker + ' ' : ''}${s.title}${s.section ? ' — ' + s.section : ''}`,
                url: '',
                source: 'Gravity RAG',
                publishedDate: s.date,
            });
        }
    }

    // ── Extract Metadata ───────────────────────────────────────────────────
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const summaryMatch = markdown.match(/^#\s+.+\n\n([\s\S]+?)(?=\n##)/);
    const wordCount = markdown.split(/\s+/).length;

    const report: ResearchReport = {
        query,
        title: titleMatch ? titleMatch[1].replace(/\*\*/g, '').trim() : query,
        summary: summaryMatch ? summaryMatch[1].trim().substring(0, 500) : '',
        markdown,
        citations,
        metadata: {
            sourcesAnalyzed: totalSources,
            generatedAt: new Date().toISOString(),
            estimatedReadTime: Math.ceil(wordCount / 200),
            modelUsed: driverModel,
            intent: blueprint.intent,
            template: templateKey,
            budget: tracker.snapshot(),
            verification,
        },
    };

    _activeBudget = null;
    _activeSignal = null;
    return report;
};

// ─── Legacy Exports (backward compat for any callers) ────────────────────────

export const generateResearchPlan = async (
    query: string,
    model?: ResearchModelId
): Promise<ResearchPlan> => {
    const prompt = `You are a research planning assistant. Given a user's research query, generate a comprehensive research plan.

User Query: "${query}"

Return ONLY valid JSON:
{
  "subtopics": ["subtopic 1", "subtopic 2", "subtopic 3", "subtopic 4", "subtopic 5"],
  "searchQueries": ["query 1", "query 2", "query 3", "query 4", "query 5", "query 6", "query 7", "query 8"]
}`;

    const text = await callDriver(prompt, 'standard', model);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Failed to parse research plan');
    const parsed = JSON.parse(match[0]);

    return {
        query,
        subtopics: parsed.subtopics || [],
        searchQueries: parsed.searchQueries || [],
        estimatedSources: (parsed.searchQueries?.length || 0) * 5,
    };
};

export const generateReport = async (
    plan: ResearchPlan,
    _sources: { webSources: TavilySearchResult[]; secFilings: SECFiling[]; companyData: CompanyOverview[] },
    onProgress: (progress: ResearchProgress) => void,
    model?: ResearchModelId
): Promise<ResearchReport> => {
    // Delegate to the full orchestrated pipeline via a fresh performDeepResearch call
    return performDeepResearch(plan.query, onProgress, model);
};

export const executeResearch = async (
    plan: ResearchPlan,
    onProgress: (progress: ResearchProgress) => void
): Promise<{ webSources: TavilySearchResult[]; secFilings: SECFiling[]; companyData: CompanyOverview[] }> => {
    onProgress({ stage: 'searching', message: 'Searching sources…', progress: 10 });
    const webSources = await searchMultipleQueriesParallel(plan.searchQueries, 6);
    onProgress({ stage: 'searching', message: `Found ${webSources.length} sources`, progress: 40, sourcesFound: webSources.length });
    return { webSources, secFilings: [], companyData: [] };
};
