// World-Class Multi-LLM Orchestrated Finance Research Engine (Server-Side)
// Architecture: AlphaSense × Goldman Sachs Research × Bloomberg Intelligence
//
// 6-Stage Pipeline:
//   1. Blueprint   — Gemini 2.5 Pro: query intent, entities, 12 search angles
//   2. Parallel    — All Tavily + SEC + Alpha Vantage simultaneously
//   3. Synthesis   — Gemini 2.5 Flash: structured fact/figure extraction
//   4. Adversarial — Gemini 2.5 Pro (bull) + Gemini 2.5 Flash (bear) in PARALLEL
//   5. Report      — Gemini 2.5 Pro: Goldman Sachs-style 3000+ word report
//   6. Output      — Structured ResearchReport with citations

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import {
    searchGravityParallel,
    fetchGravityStructured,
    isGravityAvailable,
    type GravitySource,
} from './gravityClient';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResearchPlan {
    query: string;
    subtopics: string[];
    searchQueries: string[];
    estimatedSources: number;
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

export interface ResearchProgress {
    stage: 'planning' | 'searching' | 'analyzing' | 'synthesizing' | 'complete';
    message: string;
    progress: number;
    sourcesFound?: number;
}

// ─── Model Registry ───────────────────────────────────────────────────────────

export const GEMINI_MODELS = [
    { id: 'gemini-2.5-pro',        name: 'Gemini 2.5 Pro',        desc: 'Most capable — deep reasoning, long context',   tier: 'premium'  },
    { id: 'gemini-2.5-flash',      name: 'Gemini 2.5 Flash',      desc: 'Fast & smart — best balance of speed/quality', tier: 'standard' },
    { id: 'gemini-2.0-flash',      name: 'Gemini 2.0 Flash',      desc: 'Ultra-fast — quick analysis and drafts',        tier: 'standard' },
    { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', desc: 'Lightweight — fastest responses, lower cost',   tier: 'lite'     },
] as const;

export type GeminiModelId = typeof GEMINI_MODELS[number]['id'];

const MODEL_IDS = GEMINI_MODELS.map(m => m.id);

// ─── Internal Blueprint ───────────────────────────────────────────────────────

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

interface TavilyResult {
    title: string;
    url: string;
    content: string;
    score: number;
    published_date?: string;
}

interface SECFiling {
    company: string;
    filingType: string;
    filingDate: string;
    url: string;
}

interface CompanyOverview {
    symbol: string;
    name: string;
    sector: string;
    industry: string;
    marketCap: number;
    peRatio: number;
    fiftyTwoWeekHigh: number;
    fiftyTwoWeekLow: number;
}

// ─── LLM Layer ────────────────────────────────────────────────────────────────

async function callGemini(
    prompt: string,
    opts: { preferredModel?: GeminiModelId; maxRetries?: number } = {}
): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

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

// Kept for backward compat
async function callGeminiWithRetry(prompt: string, maxRetries = 3, preferredModel?: GeminiModelId): Promise<string> {
    return callGemini(prompt, { preferredModel, maxRetries });
}

// ─── Financial Skills Loader ──────────────────────────────────────────────────

interface FinancialSkillEntry {
    name: string;
    vertical: string;
    contentTruncated: string;
}

const SKILL_KEYWORDS: Record<string, string[]> = {
    'comps-analysis':       ['comps', 'comparable', 'peer', 'valuation', 'trading multiples', 'ev/ebitda'],
    'dcf-model':            ['dcf', 'discounted cash flow', 'wacc', 'intrinsic value'],
    'lbo-model':            ['lbo', 'leveraged buyout', 'buyout'],
    'earnings-analysis':    ['earnings', 'quarterly results', 'eps', 'revenue beat', 'earnings call'],
    'sector-overview':      ['sector', 'industry overview', 'market size', 'industry analysis', 'thematic'],
    'competitive-analysis': ['competitive', 'competition', 'market share', 'competitive landscape'],
    'thesis-tracker':       ['investment thesis', 'thesis', 'catalyst', 'conviction'],
    'initiating-coverage':  ['initiation', 'initiating coverage', 'new coverage'],
    'merger-model':         ['merger', 'm&a', 'accretion dilution', 'acquisition'],
    'ic-memo':              ['ic memo', 'investment committee', 'investment memo'],
    'returns-analysis':     ['irr', 'moic', 'returns analysis', 'fund returns'],
};

let _cachedSkills: FinancialSkillEntry[] | null = null;

function loadFinancialSkills(): FinancialSkillEntry[] {
    if (_cachedSkills) return _cachedSkills;
    _cachedSkills = [];

    const pluginsDir = path.resolve(__dirname, '..', '..', '..', '..', 'financial-services-main', 'plugins', 'vertical-plugins');
    if (!fs.existsSync(pluginsDir)) {
        console.warn('[FinancialSkills] Plugin directory not found:', pluginsDir);
        return _cachedSkills;
    }

    try {
        for (const vertical of fs.readdirSync(pluginsDir)) {
            const skillsDir = path.join(pluginsDir, vertical, 'skills');
            if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) continue;

            for (const skillName of fs.readdirSync(skillsDir)) {
                const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
                if (!fs.existsSync(skillFile)) continue;

                try {
                    const raw = fs.readFileSync(skillFile, 'utf-8');
                    // Strip frontmatter
                    const body = raw.replace(/^---[\s\S]*?---\s*\n/, '');
                    _cachedSkills.push({
                        name: skillName,
                        vertical,
                        contentTruncated: body.substring(0, 1500),
                    });
                } catch { /* skip unreadable files */ }
            }
        }
        console.log(`[FinancialSkills] Loaded ${_cachedSkills.length} skills`);
    } catch (e) {
        console.warn('[FinancialSkills] Failed to load skills:', e);
    }

    return _cachedSkills;
}

function getRelevantSkillContext(query: string, maxChars = 3000): string {
    const skills = loadFinancialSkills();
    const queryLower = query.toLowerCase();

    const scored: { score: number; skill: FinancialSkillEntry }[] = [];
    for (const skill of skills) {
        const keywords = SKILL_KEYWORDS[skill.name] || [];
        let score = 0;
        for (const kw of keywords) {
            if (queryLower.includes(kw)) score += kw.split(' ').length * 2;
        }
        if (score > 0) scored.push({ score, skill });
    }

    scored.sort((a, b) => b.score - a.score);
    const topSkills = scored.slice(0, 2);

    if (topSkills.length === 0) return '';

    let context = '\n\n## Financial Analysis Methodology (institutional reference library)\n';
    let remaining = maxChars - context.length;

    for (const { skill } of topSkills) {
        const header = `\n### ${skill.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} (${skill.vertical})\n`;
        const content = skill.contentTruncated.substring(0, Math.max(0, remaining - header.length - 50));
        if (!content) break;
        context += header + content + '\n';
        remaining -= header.length + content.length;
    }

    return context;
}

// ─── Data Layer ───────────────────────────────────────────────────────────────

async function searchTavilyParallel(queries: string[], maxResults = 6): Promise<TavilyResult[]> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return [];

    const settled = await Promise.allSettled(
        queries.slice(0, 12).map(async (query) => {
            const res = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: apiKey,
                    query,
                    max_results: maxResults,
                    search_depth: 'advanced',
                    include_answer: false,
                }),
            });
            if (!res.ok) return [] as TavilyResult[];
            const data = await res.json();
            return (data.results || []) as TavilyResult[];
        })
    );

    const allResults: TavilyResult[] = [];
    const seenUrls = new Set<string>();
    for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        for (const item of r.value) {
            if (!seenUrls.has(item.url)) {
                seenUrls.add(item.url);
                allResults.push(item);
            }
        }
    }
    return allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
}

async function fetchSECFilings(companies: string[]): Promise<SECFiling[]> {
    const settled = await Promise.allSettled(
        companies.slice(0, 5).map(async (company): Promise<SECFiling[]> => {
            try {
                const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${company}"`)}&dateRange=custom&startdt=2024-01-01&forms=10-K,10-Q,8-K`;
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'MarketIntelligence AI research@marketintelligence.ai' },
                });
                if (!res.ok) return [];
                const data = await res.json();
                return (data.hits?.hits || []).slice(0, 3).map((h: any) => ({
                    company,
                    filingType: h._source?.file_type || 'SEC Filing',
                    filingDate: h._source?.file_date || '',
                    url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(company)}&type=10-K&dateb=&owner=include&count=10`,
                }));
            } catch {
                return [];
            }
        })
    );
    return settled
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => (r as PromiseFulfilledResult<SECFiling[]>).value);
}

async function fetchCompanyOverviews(tickers: string[]): Promise<CompanyOverview[]> {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey || !tickers.length) return [];

    const settled = await Promise.allSettled(
        tickers.slice(0, 4).map(async (symbol): Promise<CompanyOverview | null> => {
            try {
                const res = await fetch(
                    `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${apiKey}`
                );
                if (!res.ok) return null;
                const d = await res.json();
                if (!d.Symbol) return null;
                return {
                    symbol: d.Symbol,
                    name: d.Name,
                    sector: d.Sector,
                    industry: d.Industry,
                    marketCap: parseInt(d.MarketCapitalization) || 0,
                    peRatio: parseFloat(d.PERatio) || 0,
                    fiftyTwoWeekHigh: parseFloat(d['52WeekHigh']) || 0,
                    fiftyTwoWeekLow: parseFloat(d['52WeekLow']) || 0,
                };
            } catch {
                return null;
            }
        })
    );
    return settled
        .filter(r => r.status === 'fulfilled' && r.value !== null)
        .map(r => (r as PromiseFulfilledResult<CompanyOverview>).value);
}

// ─── Stage 1: Research Blueprint ─────────────────────────────────────────────

async function buildResearchBlueprint(query: string, model?: GeminiModelId): Promise<ResearchBlueprint> {
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
    "query 1", "query 2", "query 3", "query 4", "query 5",
    "query 6", "query 7", "query 8", "query 9", "query 10",
    "query 11", "query 12"
  ],
  "secTargets": ["Company Name for SEC 10-K/10-Q"],
  "timeframe": "Q4 2024 / FY2025 outlook",
  "investmentHorizon": "12 months",
  "researchAngles": ["angle 1", "angle 2", "angle 3", "angle 4", "angle 5"]
}`;

    const text = await callGemini(prompt, { preferredModel: model || 'gemini-2.5-pro' });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Failed to parse research blueprint');

    const p = JSON.parse(match[0]);
    return {
        intent:            p.intent            || 'thematic',
        targetEntities:    p.targetEntities    || [],
        tickers:           p.tickers           || [],
        keyMetrics:        p.keyMetrics        || [],
        subtopics:         p.subtopics         || [],
        searchQueries:     p.searchQueries     || [],
        secTargets:        p.secTargets        || [],
        timeframe:         p.timeframe         || 'Current',
        investmentHorizon: p.investmentHorizon || '12 months',
        researchAngles:    p.researchAngles    || p.subtopics || [],
    };
}

// ─── Stage 3: Source Intelligence Extraction ──────────────────────────────────

async function analyzeSources(
    sources: GravitySource[],
    blueprint: ResearchBlueprint,
    model?: GeminiModelId
): Promise<string> {
    const top20 = sources.slice(0, 20);
    const sourceText = top20
        .map((s, i) =>
            `[Source ${i + 1}] "${s.title}" (${s.published_date || 'recent'})${s.ticker ? ` [${s.ticker}]` : ''}\n${(s.content || '').substring(0, 900)}`
        )
        .join('\n\n---\n\n');

    const prompt = `You are a senior financial research analyst at a bulge-bracket bank. Extract and synthesize intelligence from these source documents for a team of institutional analysts.

Research Question: ${blueprint.subtopics[0] || 'See research angles below'}
Research Angles: ${blueprint.researchAngles.join(' | ')}
Key Metrics to Track: ${blueprint.keyMetrics.join(', ')}
Entities of Interest: ${blueprint.targetEntities.join(', ')}

SOURCE DOCUMENTS:
${sourceText}

Your tasks:
1. Extract ALL specific data points: revenue figures, EPS, growth rates, market share %, price targets, analyst ratings, guidance
2. Identify the dominant market narratives and any narrative conflicts
3. Note conflicting analyst views or divergent forecasts with source attribution
4. Flag recent developments that could be market-moving (earnings beats/misses, regulatory, M&A, product launches)
5. Extract direct verbatim quotes from executives or named analysts (with attribution and source number)
6. Identify sector-specific risk factors and opportunities

Format as structured analyst notes. Be SPECIFIC with numbers and dates. Never invent data absent from sources.`;

    return callGemini(prompt, { preferredModel: model || 'gemini-2.5-flash' });
}

// ─── Stage 4: Adversarial Bull/Bear Analysis ──────────────────────────────────

async function generateAdversarialAnalysis(
    blueprint: ResearchBlueprint,
    sourceAnalysis: string,
    model?: GeminiModelId
): Promise<{ bullCase: string; bearCase: string }> {
    const context = `
Research Focus: ${blueprint.intent} — ${blueprint.targetEntities.join(', ') || 'Market theme'}
Key Metrics: ${blueprint.keyMetrics.join(', ')}
Timeframe: ${blueprint.timeframe}

Source Intelligence Summary:
${sourceAnalysis.substring(0, 3000)}`.trim();

    // Load relevant financial methodology for adversarial analysis
    const skillContext = getRelevantSkillContext(blueprint.targetEntities.join(' ') + ' ' + blueprint.researchAngles.join(' '));

    const [bullResult, bearResult] = await Promise.allSettled([
        callGemini(
            `You are a BULL-CASE analyst at a top-tier long/long equity fund. You are presenting the upside thesis to the Investment Committee.
${skillContext}

${context}

Write a compelling BULL CASE (3–4 paragraphs) for why this investment/sector/theme will OUTPERFORM:
- Lead with the #1 most powerful upside catalyst
- Include specific price targets or return potential where available from sources
- Reference specific data points and quote executives where possible
- Directly address why the bear argument is wrong or overstated
- State Conviction Level: High / Medium / Low and explain why

Write as a senior PM would: direct, data-driven, no hedging on the core thesis.`,
            { preferredModel: model || 'gemini-2.5-pro' }
        ),
        callGemini(
            `You are a BEAR-CASE analyst / short-seller at a top hedge fund presenting the downside thesis to your short-selling committee.
${skillContext}

${context}

Write a rigorous BEAR CASE (3–4 paragraphs) for why this investment/sector/theme will UNDERPERFORM:
- Lead with the single most dangerous downside risk
- Include specific downside price scenarios or risk factors from sources
- Reference data points that the consensus is ignoring or underweighting
- Explain why the bull case is dangerously complacent or consensus-wrong
- State Risk Level: Critical / High / Medium and quantify the downside

Write as a top short-seller would: incisive, skeptical, forensically rigorous.`,
            { preferredModel: model || 'gemini-2.5-flash' }
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
    webSources: GravitySource[],
    secFilings: SECFiling[],
    companyData: CompanyOverview[],
    sourceAnalysis: string,
    bullCase: string,
    bearCase: string,
    model?: GeminiModelId,
    structuredData: { metric: string; value: string | number; unit?: string; period?: string; ticker?: string }[] = [],
): Promise<string> {
    const structuredSection = structuredData.length > 0
        ? `\nSTRUCTURED FINANCIAL DATA (from TimescaleDB — verified figures):\n${
            structuredData.slice(0, 30).map(r =>
                `${r.ticker ? `[${r.ticker}] ` : ''}${r.metric}: ${r.value}${r.unit ? ' ' + r.unit : ''}${r.period ? ' (' + r.period + ')' : ''}`
            ).join('\n')
          }\n`
        : '';

    const marketDataSection = companyData.length > 0
        ? `\nCOMPANY DATA:\n${companyData.map(c =>
            `${c.name} (${c.symbol}): Sector=${c.sector} | Industry=${c.industry} | Mkt Cap=$${(c.marketCap / 1e9).toFixed(1)}B | P/E=${c.peRatio} | 52w Hi/Lo=$${c.fiftyTwoWeekHigh}/$${c.fiftyTwoWeekLow}`
          ).join('\n')}\n`
        : '';

    const citationIndex = webSources.slice(0, 35)
        .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`)
        .join('\n');

    const secIndex = secFilings.length > 0
        ? `\nSEC EDGAR FILINGS:\n${secFilings.map((f, i) =>
            `[SEC-${i + 1}] ${f.company} ${f.filingType} (${f.filingDate}) — ${f.url}`
          ).join('\n')}`
        : '';

    const prompt = `You are a Managing Director of Equity Research at Goldman Sachs / Morgan Stanley. You are writing a flagship institutional research report for the most sophisticated investors in the world — sovereign wealth funds, top-tier hedge funds, and multi-family offices. Your work will be cited in Bloomberg terminals and investment committee presentations.
${getRelevantSkillContext(query, 2000)}

═══════════════════════════════════════
RESEARCH MANDATE
═══════════════════════════════════════
Research Type: ${blueprint.intent.replace(/_/g, ' ').toUpperCase()}
Coverage Universe: ${blueprint.targetEntities.join(', ') || 'Broad Market'}
Ticker Focus: ${blueprint.tickers.join(', ') || 'N/A'}
Timeframe: ${blueprint.timeframe}
Investment Horizon: ${blueprint.investmentHorizon}
Research Angles: ${blueprint.researchAngles.join(' | ')}
Key Metrics: ${blueprint.keyMetrics.join(', ')}

═══════════════════════════════════════
INTELLIGENCE INPUTS
═══════════════════════════════════════
ANALYST TEAM SOURCE SYNTHESIS:
${sourceAnalysis.substring(0, 4500)}
${structuredSection}
BULL CASE ANALYSIS:
${bullCase.substring(0, 1800)}

BEAR CASE ANALYSIS:
${bearCase.substring(0, 1800)}
${marketDataSection}
═══════════════════════════════════════
CITATION INDEX (use [n] inline)
═══════════════════════════════════════
${citationIndex}
${secIndex}

═══════════════════════════════════════
REPORT INSTRUCTIONS
═══════════════════════════════════════
Write a COMPREHENSIVE institutional research report (3,000–4,000 words) in this EXACT structure:

# [Compelling, Specific Title — Include Key Ticker/Theme and Timeframe]

## Executive Summary
[3–4 paragraphs. Lead with the most critical investment insight or recommendation. State conviction: BUY / HOLD / SELL / OVERWEIGHT / UNDERWEIGHT with rationale. Include the single most important statistic from sources. Reference key near-term catalysts.]

## Investment Thesis
[2–3 paragraphs. The central analytical argument. What is the market currently pricing in that is WRONG? What is the "edge" — the non-consensus insight? Why does the risk/reward favor action NOW?]

## [Research Angle 1 — use actual angle from blueprint]
[3–4 paragraphs of deep analysis. Cite sources inline [1][2]. Include specific numbers: percentages, dollar figures, growth rates, market share data. Compare to peers/history.]

## [Research Angle 2]
[Same depth. Include a markdown comparison table if data permits.]

## [Research Angle 3]
[Same depth.]

## [Additional sections for remaining research angles]

## Financial Analysis & Key Metrics

| Metric | Current | Prior Year | vs. Consensus | Source |
|--------|---------|------------|---------------|--------|
[Fill with REAL figures from sources. At minimum 6 rows. Use "N/A" only if truly unavailable.]

[2 paragraphs of commentary on the financial data.]

## Bull Case — Path to Outperformance
${bullCase.substring(0, 600)}

[Expand with: 3 specific upside catalysts with timeline, probability-weighted upside target, what would force bears to cover]

## Bear Case — Key Downside Risks
${bearCase.substring(0, 600)}

[Expand with: 3 specific downside scenarios with severity, what would invalidate the bull thesis]

## Risk Matrix

| Risk Factor | Probability | Impact | Time Horizon | Mitigation |
|-------------|-------------|--------|--------------|------------|
[6 rows minimum. Be specific: "Rising 10-year Treasury yields >5%" not "interest rate risk"]

## Macro Context & Sector Positioning
[2–3 paragraphs. How does the macro backdrop (rates, inflation, geopolitics, dollar) affect this thesis? Sector rotation dynamics. Relative value vs. peers.]

## Outlook & Key Catalysts

### Near-term (0–6 months)
[3–4 bullet points with specific dates or events]

### Medium-term (6–18 months)
[3–4 bullet points]

### Key Monitoring Criteria
[3–4 metrics/events that would cause a thesis revision]

## Conclusion & Conviction Rating
[2–3 paragraphs. Final recommendation with conviction: HIGH / MEDIUM / LOW. Price target or return expectation if data supports it. What to watch to upgrade/downgrade conviction.]

---
> **Key Finding:** [Single most important analytical insight — bold and prominent. Should be non-consensus and data-backed.]

═══════════════════════════════════════
WRITING STANDARDS — CRITICAL
═══════════════════════════════════════
- Use REAL data from sources only — never fabricate or estimate figures not present in source material
- Cite frequently with [n] — AIM FOR 25+ UNIQUE CITATIONS throughout the report
- Professional institutional tone — you are writing for CIOs and PMs, not retail investors
- Specific > Vague: "$47.5 billion" not "significant revenue"; "Q3 2024 earnings" not "recent results"
- Tables wherever comparative data exists
- Bold critical data points and insights
- Every section must add analytical value — zero filler prose
- Report must be 3,000+ words`;

    return callGemini(prompt, { preferredModel: model || 'gemini-2.5-pro' });
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function performDeepResearch(
    query: string,
    onProgress: (progress: ResearchProgress) => void,
    model?: GeminiModelId
): Promise<ResearchReport> {
    // ── Stage 1: Blueprint (0–10%) ─────────────────────────────────────────
    onProgress({ stage: 'planning', message: 'Chief Analyst building research blueprint…', progress: 3 });

    const blueprint = await buildResearchBlueprint(query, model);

    onProgress({
        stage: 'planning',
        message: `Blueprint: ${blueprint.intent.replace(/_/g, ' ')} · ${blueprint.targetEntities.length} entities · ${blueprint.searchQueries.length} queries`,
        progress: 10,
    });

    // ── Stage 2: Parallel Retrieval (10–45%) ──────────────────────────────
    onProgress({ stage: 'searching', message: 'Dispatching parallel research team…', progress: 12 });

    // Stage 2: prefer Gravity's pre-indexed corpus; fall back to Tavily if unavailable
    const gravityAvailable = await isGravityAvailable();

    const [webSources, secFilings, companyData] = await Promise.all([
        gravityAvailable
            ? searchGravityParallel(blueprint.searchQueries, blueprint.tickers, 6)
            : searchTavilyParallel(blueprint.searchQueries, 6),
        fetchSECFilings(blueprint.secTargets),
        fetchCompanyOverviews(blueprint.tickers),
    ]);

    // Also pull structured financial metrics from Gravity when available
    const structuredData = gravityAvailable
        ? await fetchGravityStructured(query, blueprint.tickers)
        : [];

    const totalSources = webSources.length + secFilings.length;

    onProgress({
        stage: 'searching',
        message: `Retrieved ${webSources.length} ${gravityAvailable ? 'indexed' : 'web'} sources · ${secFilings.length} SEC filings · ${companyData.length} company profiles`,
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

    const sourceAnalysis = await analyzeSources(webSources, blueprint, model);

    onProgress({
        stage: 'analyzing',
        message: 'Running adversarial bull/bear analysis in parallel…',
        progress: 63,
        sourcesFound: totalSources,
    });

    // ── Stage 4: Adversarial Analysis (65–75%) ────────────────────────────
    const { bullCase, bearCase } = await generateAdversarialAnalysis(blueprint, sourceAnalysis, model);

    onProgress({
        stage: 'synthesizing',
        message: 'Senior analyst writing institutional report…',
        progress: 75,
        sourcesFound: totalSources,
    });

    // ── Stage 5: Report Synthesis (75–96%) ────────────────────────────────
    const markdown = await synthesizeInstitutionalReport(
        blueprint, webSources, secFilings, companyData,
        sourceAnalysis, bullCase, bearCase, model, structuredData
    );

    onProgress({ stage: 'complete', message: 'Institutional research report finalized', progress: 100, sourcesFound: totalSources });

    // ── Build Citations ────────────────────────────────────────────────────
    const citations: Citation[] = [];
    let id = 1;

    for (const s of webSources.slice(0, 50)) {
        citations.push({
            id: id++,
            title: s.title,
            url: s.url,
            source: 'Web',
            publishedDate: s.published_date,
        });
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
}
