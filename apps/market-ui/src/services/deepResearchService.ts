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

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getApiKeys } from './apiKeys';
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
] as const;

export type ResearchModelId = typeof RESEARCH_MODELS[number]['id'];

// Backward compat alias (SearchPage imports GEMINI_MODELS)
export const GEMINI_MODELS = RESEARCH_MODELS;
export type GeminiModelId = ResearchModelId;

const MODEL_IDS = GEMINI_MODELS.map(m => m.id);

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

// ─── LLM Layer ────────────────────────────────────────────────────────────────

async function callGemini(
    apiKey: string,
    prompt: string,
    opts: { preferredModel?: GeminiModelId; maxRetries?: number } = {}
): Promise<string> {
    const { preferredModel, maxRetries = 3 } = opts;
    const genAI = new GoogleGenerativeAI(apiKey);

    const modelsToTry: GeminiModelId[] = preferredModel
        ? [preferredModel, ...MODEL_IDS.filter(m => m !== preferredModel) as GeminiModelId[]]
        : [...MODEL_IDS as unknown as GeminiModelId[]];

    for (const modelName of modelsToTry) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                return result.response.text();
            } catch (error: any) {
                const is429 = error?.message?.includes('429') || error?.message?.includes('Resource exhausted');
                const is404 = error?.message?.includes('404') || error?.message?.includes('not found');

                if (is404) break;
                if (is429 && attempt < maxRetries - 1) {
                    const wait = Math.pow(2, attempt + 1) * 1000;
                    console.warn(`Rate limited on ${modelName}, retrying in ${wait / 1000}s…`);
                    await new Promise(r => setTimeout(r, wait));
                    continue;
                }
                if (!is429) throw error;
            }
        }
    }
    throw new Error('All Gemini models exhausted');
}

// ─── Claude (Anthropic) ───────────────────────────────────────────────────────

async function callClaude(
    apiKey: string,
    prompt: string,
    modelId: string = 'claude-sonnet-4-6',
    maxRetries = 3,
): Promise<string> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    model: modelId,
                    max_tokens: 8192,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });
            if (!res.ok) {
                const err = await res.text();
                if (res.status === 529 && attempt < maxRetries - 1) {
                    await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * 1000));
                    continue;
                }
                throw new Error(`Claude API error ${res.status}: ${err}`);
            }
            const data = await res.json();
            return data.content?.[0]?.text ?? '';
        } catch (e) {
            if (attempt === maxRetries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
    }
    throw new Error('Claude: all retries exhausted');
}

// ─── DeepSeek (OpenAI-compatible) ────────────────────────────────────────────

async function callDeepSeek(
    apiKey: string,
    prompt: string,
    modelId: string = 'deepseek-chat',
    maxRetries = 3,
): Promise<string> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const res = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: modelId,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 8192,
                    temperature: 0.7,
                }),
            });
            if (!res.ok) {
                const err = await res.text();
                if (res.status === 429 && attempt < maxRetries - 1) {
                    await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * 1000));
                    continue;
                }
                throw new Error(`DeepSeek API error ${res.status}: ${err}`);
            }
            const data = await res.json();
            return data.choices?.[0]?.message?.content ?? '';
        } catch (e) {
            if (attempt === maxRetries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
    }
    throw new Error('DeepSeek: all retries exhausted');
}

// ─── Unified LLM Router ───────────────────────────────────────────────────────
// Routes to the right provider based on the selected model ID.
// Falls back gracefully: Claude → Gemini, DeepSeek → Gemini.

async function callLLM(
    prompt: string,
    modelId: ResearchModelId | undefined,
    apiKeys: { gemini: string; anthropic?: string; deepseek?: string },
    opts: { preferredGemini?: GeminiModelId } = {},
): Promise<string> {
    const model = RESEARCH_MODELS.find(m => m.id === modelId);
    const provider = model?.provider ?? 'gemini';

    if (provider === 'anthropic') {
        if (apiKeys.anthropic) {
            try {
                return await callClaude(apiKeys.anthropic, prompt, modelId!);
            } catch (e) {
                console.warn('Claude failed, falling back to Gemini:', e);
            }
        }
        // Fallback to best available Gemini
        return callGemini(apiKeys.gemini, prompt, { preferredModel: 'gemini-2.5-pro' });
    }

    if (provider === 'deepseek') {
        if (apiKeys.deepseek) {
            try {
                return await callDeepSeek(apiKeys.deepseek, prompt, modelId!);
            } catch (e) {
                console.warn('DeepSeek failed, falling back to Gemini:', e);
            }
        }
        return callGemini(apiKeys.gemini, prompt, { preferredModel: 'gemini-2.5-flash' });
    }

    // Gemini provider
    return callGemini(apiKeys.gemini, prompt, {
        preferredModel: (modelId as GeminiModelId) ?? opts.preferredGemini ?? 'gemini-2.5-flash',
    });
}

// Kept for backward compatibility (used by generateResearchPlan / generateReport below)
async function callGeminiWithRetry(
    apiKey: string,
    prompt: string,
    maxRetries = 3,
    preferredModel?: GeminiModelId
): Promise<string> {
    return callGemini(apiKey, prompt, { preferredModel, maxRetries });
}

// ─── Stage 1: Research Blueprint ─────────────────────────────────────────────

async function buildResearchBlueprint(
    query: string,
    apiKey: string,
    model?: GeminiModelId
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

    const text = await callGemini(apiKey, prompt, { preferredModel: model || 'gemini-2.5-pro' });
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
    apiKey: string,
    model?: GeminiModelId
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

    const text = await callGemini(apiKey, prompt, { preferredModel: model || 'gemini-2.5-flash' });
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
    apiKey: string,
    model?: GeminiModelId
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

    const text = await callGemini(apiKey, prompt, { preferredModel: model || 'gemini-2.5-flash' });
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
    apiKey: string,
    model: GeminiModelId | undefined,
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
            : await generateAdaptiveQueries(blueprint, knowledgeBase, round, apiKey, model);

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
        const roundIntelligence = await callGemini(apiKey,
            `You are a senior analyst. Extract ALL specific facts, figures, quotes, and data points from these sources relevant to: ${blueprint.targetEntities.join(', ')} — ${blueprint.researchAngles.slice(0, 3).join(' | ')}

Sources:
${fresh.slice(0, 12).map((s, i) => `[${i + 1}] ${s.title}\n${s.content.substring(0, 700)}`).join('\n\n---\n\n')}

Extract as bullet points. Be specific with numbers, dates, and source attribution. Skip marketing language.`,
            { preferredModel: model || 'gemini-2.5-flash' }
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

            const { sufficient } = await evaluateCoverage(knowledgeBase, blueprint, apiKey, model);
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

type ApiKeysSubset = { gemini: string; anthropic?: string; deepseek?: string };

async function analyzeSources(
    sources: TavilySearchResult[],
    blueprint: ResearchBlueprint,
    apiKeys: ApiKeysSubset,
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

        // Use Claude Sonnet for synthesis if available (superior extraction), else Gemini Flash
        const synthModel: ResearchModelId = apiKeys.anthropic
            ? 'claude-sonnet-4-6'
            : (model ?? 'gemini-2.5-flash');
        return callLLM(prompt, synthModel, apiKeys, { preferredGemini: 'gemini-2.5-flash' });
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

    const synthModel: ResearchModelId = apiKeys.anthropic
        ? 'claude-sonnet-4-6'
        : (model ?? 'gemini-2.5-flash');
    return callLLM(prompt, synthModel, apiKeys, { preferredGemini: 'gemini-2.5-flash' });
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
    apiKeys: ApiKeysSubset,
    model?: ResearchModelId,
    ragResult?: GravityRAGResult,
): Promise<{ bullCase: string; bearCase: string }> {
    const verifiedFacts = ragResult ? buildVerifiedFactsBlock(ragResult) : '';

    const context = `Research Focus: ${blueprint.intent} — ${blueprint.targetEntities.join(', ') || 'Market theme'}
Key Metrics: ${blueprint.keyMetrics.join(', ')}
Timeframe: ${blueprint.timeframe}

${verifiedFacts ? `${verifiedFacts}\n\n` : ''}WEB + MARKET INTELLIGENCE SYNTHESIS:
${sourceAnalysis.substring(0, 2800)}`.trim();

    // DeepSeek R1 chain-of-thought is ideal for adversarial reasoning.
    // If not available, Claude Sonnet; fall back to Gemini Pro.
    const adversarialModel: ResearchModelId = apiKeys.deepseek
        ? 'deepseek-reasoner'
        : apiKeys.anthropic
            ? 'claude-sonnet-4-6'
            : (model ?? 'gemini-2.5-pro');

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
            apiKeys,
            { preferredGemini: 'gemini-2.5-pro' },
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
            apiKeys,
            { preferredGemini: 'gemini-2.5-flash' },
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
    apiKeys: ApiKeysSubset,
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
    // fall back to Gemini 2.5 Pro.
    const synthesisModel: ResearchModelId = apiKeys.anthropic
        ? 'claude-opus-4-6'
        : (model ?? 'gemini-2.5-pro');

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
WRITE THIS REPORT — EXACT STRUCTURE REQUIRED
════════════════════════════════════════════

# [Compelling, Specific Title — ticker/theme + timeframe + the core investment insight in the title]

## Executive Summary
[4 paragraphs. Para 1: Conviction call (BUY/SELL/HOLD/OW/UW) + the most powerful data point from Tier 1. Para 2: The non-consensus insight — what the market is mispricing. Para 3: The 2–3 most critical near-term catalysts with dates. Para 4: Key risk to the thesis.]

## Investment Thesis
[3 paragraphs. The central analytical argument built on verified data. What does Tier 1 data reveal that web consensus is missing? Quantify the gap between intrinsic value and current pricing. Explain the timing edge.]

## ${blueprint.researchAngles[0] || 'Financial Performance Analysis'}
[4 paragraphs. Lead with the most important Tier 1 verified fact. Build deep analysis around it. Include specific %, $, bps figures. Compare to prior periods and peer benchmarks. Cite [n] and [RAG-n] inline throughout.]

## ${blueprint.researchAngles[1] || 'Competitive Position & Market Share'}
[4 paragraphs + at least one markdown table with real comparative data from sources.]

## ${blueprint.researchAngles[2] || 'Growth Drivers & Catalysts'}
[3–4 paragraphs. Include forward-looking analysis based on management guidance or analyst forecasts found in sources.]

${blueprint.researchAngles.slice(3).map(angle => `## ${angle}\n[3 paragraphs. Ground in specific data from verified sources. Zero filler.]\n`).join('\n')}

## Financial Scorecard

| Metric | Value | Period | vs. Prior Year | vs. Consensus | Source |
|--------|-------|--------|----------------|---------------|--------|
[MINIMUM 8 rows. Fill ONLY with real figures from Tier 1 or cited web sources. Use "N/A" sparingly — only if truly absent from all sources.]

[2 paragraphs of commentary: what the numbers tell you that the market isn't appreciating]

## Bull Case — Path to Outperformance
${bullCase.substring(0, 500)}

**Upside catalysts (next 12 months):**
[3 specific catalysts with expected timeline and magnitude]

**What would force bear capitulation:** [1–2 sentences, data-specific]

## Bear Case — Key Downside Risks
${bearCase.substring(0, 500)}

**Downside scenarios:**
[3 specific scenarios with severity, probability estimate, and timeline]

**What would invalidate the bull thesis:** [1–2 sentences, data-specific]

## Risk Matrix

| Risk Factor | Probability | Impact | Time Horizon | Hedge / Mitigation |
|-------------|-------------|--------|--------------|---------------------|
[8 rows. Each risk must be specific: "NVIDIA H100 export restrictions expand to Tier 2 countries" not "regulatory risk". Include probability estimate (High/Med/Low) and realistic impact.]

## Macro Context & Cross-Asset Implications
[3 paragraphs. Rate environment, dollar strength, geopolitical overlays. How does sector rotation affect positioning? Relative value versus peers and index. Any regime-change risks?]

## Outlook: Catalysts & Monitoring Dashboard

### Near-Term (0–6 months)
- [Bullet 1: specific event/date + expected market impact]
- [Bullet 2]
- [Bullet 3]
- [Bullet 4]

### Medium-Term (6–18 months)
- [Bullet 1: structural driver + magnitude]
- [Bullet 2]
- [Bullet 3]

### Thesis Invalidation Criteria
[3 specific, measurable conditions that would trigger a rating downgrade]

## Conclusion & Conviction Rating

[3 paragraphs. Final recommendation stated clearly. Conviction: HIGH / MEDIUM / LOW + specific rationale. Expected return range or price target where data supports. Single most important thing to monitor in the next 90 days.]

---
> **Key Finding:** [Non-consensus, data-backed insight in bold — the one thing a reader should remember. Must reference a specific figure from Tier 1 or a verified source.]

════════════════════════════════════════════
CRITICAL WRITING STANDARDS
════════════════════════════════════════════
✓ NEVER fabricate figures — every number must trace to a cited source
✓ MINIMUM 30 inline citations [n] or [RAG-n] distributed throughout
✓ Tier 1 (RAG) figures take priority — mark them [RAG-n] so the reader knows they are verified
✓ Tone: institutional, direct, zero marketing language
✓ Specific beats vague: "$2.47B in free cash flow" not "strong cash generation"
✓ Every table must be populated — no placeholder rows
✓ Report target: 3,500–4,500 words`;

    return callLLM(prompt, synthesisModel, apiKeys, { preferredGemini: 'gemini-2.5-pro' });
}

// ─── Main Export: performDeepResearch ────────────────────────────────────────

export const performDeepResearch = async (
    query: string,
    onProgress: (progress: ResearchProgress) => void,
    model?: GeminiModelId
): Promise<ResearchReport> => {
    const rawKeys = getApiKeys();
    const { gemini } = rawKeys;
    if (!gemini) throw new Error('Gemini API key not configured');
    const apiKeys: ApiKeysSubset = {
        gemini,
        anthropic: rawKeys.anthropic || undefined,
        deepseek: rawKeys.deepseek || undefined,
    };

    // ── Stage 1: Blueprint (0–10%) ─────────────────────────────────────────
    onProgress({ stage: 'planning', message: 'Chief Analyst building research blueprint…', progress: 3 });

    const blueprint = await buildResearchBlueprint(query, gemini, model);

    onProgress({
        stage: 'planning',
        message: `Blueprint: ${blueprint.intent.replace(/_/g, ' ')} · ${blueprint.targetEntities.length} entities · ${blueprint.searchQueries.length} queries`,
        progress: 10,
    });

    // ── Stage 2: Iterative Search + Parallel Data (10–45%) ───────────────
    // Fire all data sources in parallel: web search, RAG, SEC, market data, FRED macro
    const [
        { sources: webSources, knowledgeBase },
        ragResult,
        macroText,
        ...secAndCompanyArrays
    ] = await Promise.all([
        // Iterative adaptive web search (up to 4 rounds)
        iterativeSearch(blueprint, gemini, model, onProgress, 4),

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

    const sourceAnalysis = await analyzeSources(webSources, blueprint, apiKeys, model, ragResult, knowledgeBase);

    onProgress({
        stage: 'analyzing',
        message: 'Running adversarial bull/bear analysis in parallel…',
        progress: 63,
        sourcesFound: totalSources,
    });

    // ── Stage 4: Adversarial Analysis (65–75%) ────────────────────────────
    const { bullCase, bearCase } = await generateAdversarialAnalysis(
        blueprint, sourceAnalysis, apiKeys, model, ragResult
    );

    onProgress({
        stage: 'synthesizing',
        message: 'Senior analyst writing institutional report…',
        progress: 75,
        sourcesFound: totalSources,
    });

    // ── Stage 5: Report Synthesis (75–96%) ────────────────────────────────
    const markdown = await synthesizeInstitutionalReport(
        blueprint,
        webSources,
        secFilings,
        companyData,
        sourceAnalysis,
        bullCase,
        bearCase,
        apiKeys,
        model,
        ragResult,
        macroText,
    );

    onProgress({
        stage: 'complete',
        message: 'Institutional research report finalized',
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

    return {
        query,
        title: titleMatch ? titleMatch[1].replace(/\*\*/g, '').trim() : query,
        summary: summaryMatch ? summaryMatch[1].trim().substring(0, 500) : '',
        markdown,
        citations,
        metadata: {
            sourcesAnalyzed: totalSources,
            generatedAt: new Date().toISOString(),
            estimatedReadTime: Math.ceil(wordCount / 200),
            modelUsed: model || 'gemini-2.5-pro',
            intent: blueprint.intent,
        },
    };
};

// ─── Legacy Exports (backward compat for any callers) ────────────────────────

export const generateResearchPlan = async (
    query: string,
    model?: GeminiModelId
): Promise<ResearchPlan> => {
    const { gemini } = getApiKeys();
    if (!gemini) throw new Error('Gemini API key not configured');

    const prompt = `You are a research planning assistant. Given a user's research query, generate a comprehensive research plan.

User Query: "${query}"

Return ONLY valid JSON:
{
  "subtopics": ["subtopic 1", "subtopic 2", "subtopic 3", "subtopic 4", "subtopic 5"],
  "searchQueries": ["query 1", "query 2", "query 3", "query 4", "query 5", "query 6", "query 7", "query 8"]
}`;

    const text = await callGeminiWithRetry(gemini, prompt, 3, model);
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
    model?: GeminiModelId
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
