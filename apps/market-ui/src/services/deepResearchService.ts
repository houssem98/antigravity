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

import {
    searchMultipleQueriesParallel,
    classifyAuthority,
    authorityWeight,
    classifyRecency,
    type TavilySearchResult,
    type RecencyBucket,
} from './tavilyService';
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

// ─── Pre-built Agentic Workflows (plan §7 Phase 3) ─────────────────────────
// One-click research presets for common institutional tasks. Each workflow:
//   1. Pins the report template (no template drift from intent inference)
//   2. Injects guaranteed research angles into the blueprint, merged with
//      whatever the Chief Analyst generated from the raw query
//   3. Injects must-track key metrics (so e.g. "M&A Screen" always reports
//      EV/EBITDA and precedent-transaction multiples)
//   4. Appends a workflow-specific directive to the Chief Analyst prompt so
//      the generated blueprint frames the research with the right lens
//
// Workflows reuse existing templates to avoid cascading TemplateKey changes.
// The differentiation is in the angle/metric injection + the prompt suffix.

export type WorkflowId =
    | 'earnings_reaction'
    | 'swot_analysis'
    | 'company_profile'
    | 'ma_screen'
    | 'channel_check';

export interface WorkflowPreset {
    id: WorkflowId;
    label: string;
    description: string;
    template: TemplateKey;
    injectAngles: string[];
    injectMetrics: string[];
    systemSuffix: string;
}

export const WORKFLOW_PRESETS: Record<WorkflowId, WorkflowPreset> = {
    earnings_reaction: {
        id: 'earnings_reaction',
        label: 'Earnings Reaction',
        description: 'Print vs consensus, stock reaction, guidance revisions, and buyside pushback.',
        template: 'earnings_recap',
        injectAngles: [
            'Print vs consensus delta on revenue, EPS, segment revenue',
            'Stock reaction magnitude and options-implied move context',
            'Forward guidance revisions and management tone shift',
            'Buyside pushback themes and sellside rating-change catalysts',
        ],
        injectMetrics: ['revenue', 'EPS', 'operating margin', 'guidance', 'consensus', 'segment revenue'],
        systemSuffix: 'Frame this as an EARNINGS REACTION workflow: start from the reported print, contrast against consensus, and trace how the guidance and stock reaction reshape the investment thesis.',
    },
    swot_analysis: {
        id: 'swot_analysis',
        label: 'SWOT Analysis',
        description: 'Strengths, Weaknesses, Opportunities, Threats — framed for investment decisions.',
        template: 'investment_memo',
        injectAngles: [
            'Structural strengths: moats, scale advantages, proprietary assets',
            'Structural weaknesses: cost disadvantages, strategic blind spots',
            'Growth opportunities: adjacent markets, product expansion, M&A',
            'Competitive and regulatory threats with probability weighting',
        ],
        injectMetrics: ['market share', 'gross margin', 'ROIC', 'revenue growth', 'capex intensity'],
        systemSuffix: 'Frame this as a SWOT workflow: organize findings into Strengths / Weaknesses / Opportunities / Threats. Each bucket should have 3–5 specific, evidenced claims with probability-weighted impact.',
    },
    company_profile: {
        id: 'company_profile',
        label: 'Company Profile',
        description: 'Comprehensive institutional primer: business, financials, management, valuation.',
        template: 'company_primer',
        injectAngles: [
            'Business segments, revenue mix, and geographic footprint',
            'Historical revenue / margin / FCF trajectory (5-year)',
            'Management team track record and capital-allocation history',
            'Valuation framework: peer multiples, DCF sensitivities, SOTP where applicable',
        ],
        injectMetrics: ['revenue', 'EBITDA margin', 'FCF', 'ROIC', 'EV/EBITDA', 'P/E', 'debt/EBITDA'],
        systemSuffix: 'Frame this as a COMPANY PROFILE workflow: produce a comprehensive primer suitable for an analyst new to the name. Cover business, financials, management, competitive position, and valuation in equal depth.',
    },
    ma_screen: {
        id: 'ma_screen',
        label: 'M&A Screen',
        description: 'Identify plausible acquirers or targets; synergies and precedent-transaction multiples.',
        template: 'thematic',
        injectAngles: [
            'Strategic rationale: who benefits most from owning or selling this asset',
            'Likely acquirer profile: strategic vs PE, geographic fit, antitrust posture',
            'Potential target profile: undervalued peers with asset synergies',
            'Precedent transactions: EV/EBITDA and EV/Sales multiples for comparable deals',
            'Deal feasibility: balance-sheet capacity, regulatory risk, financing backdrop',
        ],
        injectMetrics: ['EV/EBITDA', 'EV/Sales', 'debt/EBITDA', 'synergy potential', 'control premium'],
        systemSuffix: 'Frame this as an M&A SCREEN workflow: focus on strategic fit, feasibility, and precedent-transaction multiples. Produce a ranked list of plausible acquirers or targets with named rationale per candidate.',
    },
    channel_check: {
        id: 'channel_check',
        label: 'Channel Check',
        description: 'Synthesize competitive dynamics from interviews, transcripts, and primary-source commentary.',
        template: 'thematic',
        injectAngles: [
            'Competitive dynamics from customer / reseller / supplier commentary',
            'Pricing trends, discounting, and channel inventory signals',
            'Product traction vs competitive substitutes',
            'Go-to-market effectiveness and sales-force productivity signals',
            'Churn, renewal, and satisfaction qualitative signals',
        ],
        injectMetrics: ['net retention', 'gross retention', 'CAC payback', 'win rate', 'pricing'],
        systemSuffix: 'Frame this as a CHANNEL CHECK workflow: weight interview-style sources (earnings transcripts, expert networks, industry-conference commentary) above generic news. Aggregate the qualitative signal into quantitative directional calls (accelerating / decelerating / stable).',
    },
};

export function dedupeMerge(a: string[], b: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of [...a, ...b]) {
        const k = v.trim().toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(v.trim());
    }
    return out;
}

// Apply a workflow preset to an already-generated blueprint. Injected
// angles/metrics are PREPENDED (workflow priorities lead; Chief Analyst's
// free-form suggestions follow) and deduped case-insensitively.
export function applyWorkflowToBlueprint(
    bp: ResearchBlueprint,
    workflowId: WorkflowId,
): { blueprint: ResearchBlueprint; anglesInjected: number; metricsInjected: number } {
    const preset = WORKFLOW_PRESETS[workflowId];
    const beforeAngles = bp.researchAngles.length;
    const beforeMetrics = bp.keyMetrics.length;
    const mergedAngles = dedupeMerge(preset.injectAngles, bp.researchAngles);
    const mergedMetrics = dedupeMerge(preset.injectMetrics, bp.keyMetrics);
    return {
        blueprint: {
            ...bp,
            researchAngles: mergedAngles,
            keyMetrics: mergedMetrics,
        },
        anglesInjected: mergedAngles.length - beforeAngles,
        metricsInjected: mergedMetrics.length - beforeMetrics,
    };
}

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
            multiSourceClaims: number;
            singleSourceClaims: string[];
            unsupportedClaims: string[];
        };
        claimAudit?: {
            audited: number;
            supported: number;
            partial: number;
            unsupported: number;
            flags: ClaimVerdict[];
        };
        citationDensity?: {
            totalFactSentences: number;
            citedSentences: number;
            density: number;  // 0..1
            uncitedSamples: string[];
        };
        factInference?: {
            totalForwardLooking: number;
            hedgedCount: number;
            hedgingRate: number;  // 0..1
            unhedgedSamples: string[];
        };
        confidence?: Confidence;
        methodology?: {
            searchQueries: number;
            rounds: number;
            subQuestions: string[];
        };
        sectionFanout?: {
            used: boolean;             // true = per-section fanout; false = monolith fallback
            planned: number;            // template.sections.length
            completed: number;          // sections that returned a body
            failed: number;             // sections that errored or came back empty
        };
        contextualRetrieval?: {
            used: boolean;
            total: number;
            enriched: number;
            llmBatches: number;
            deterministicBatches: number;
            cacheHits: number;
        };
        distillation?: {
            used: boolean;
            inputChars: number;
            outputChars: number;
            compressionRatio: number;
            fallback: boolean;
        };
        revisions?: {
            used: boolean;
            issuesBefore: number;
            issuesAfter: number;
            editsProposed: number;
            editsApplied: number;
            accepted: boolean;
            fallback: boolean;
        };
        injectionDefense?: {
            scanned: number;
            flagged: number;
            patternHits: Record<string, number>;
        };
        readers?: {
            totalReaders: number;
            succeeded: number;
            failed: number;
            noRelevantFacts: number;
            cacheHits: number;
            fallbackRounds: number;
        };
        recency?: {
            total: number;
            fresh: number;       // ≤90 days
            recent: number;      // ≤365 days
            stale: number;       // ≤3 years
            archival: number;    // >3 years
            undated: number;
        };
        workflow?: {
            id: WorkflowId;
            label: string;
            template: TemplateKey;
            anglesInjected: number;
            metricsInjected: number;
        };
        limitations?: {
            count: number;
            topics: string[];
        };
        hitl?: {
            used: boolean;     // onBlueprintReady was supplied and invoked
            modified: boolean; // user returned an edited blueprint (not just accepted)
            cancelled: boolean; // run was stopped at review (never true in a returned report, kept for symmetry with telemetry)
        };
    };
}

// ─── Internal Blueprint Type ──────────────────────────────────────────────────

export interface ResearchBlueprint {
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

// Human-in-the-loop plan approval (plan §6.1 P0 — Gemini-DR's editable-blueprint pattern).
// Callback receives the auto-generated blueprint; return `undefined` to accept as-is,
// a mutated `ResearchBlueprint` to run with user edits, or `null` to cancel the whole run.
export type BlueprintReviewCallback = (
    blueprint: ResearchBlueprint,
) => Promise<ResearchBlueprint | null | undefined> | ResearchBlueprint | null | undefined;

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

// ─── Prompt-Injection Defense (plan §6.12) ──────────────────────────────────
// Web content fetched via Tavily is UNTRUSTED — a malicious page can
// embed strings that try to hijack the LLM ("ignore previous instructions",
// role-header spoofing, instruct tokens). We sanitize each snippet before
// it's concatenated into any LLM prompt.
//
// Design choices:
//   - Conservative patterns only (low false-positive): role-headers at line
//     start, literal instruct tokens, explicit "ignore previous instructions"
//     phrasing, jailbreak keywords, override-safety phrasing. NOT "you are
//     now" / "act as" — those trip legitimate news copy too often.
//   - Replace with "[REDACTED]" — clear signal to the LLM that content was
//     removed, not silent deletion.
//   - Track hits in a module-level stats ref (matches _activeBudget
//     pattern) so the pipeline can surface defense activity in metadata
//     without threading an extra parameter through every prompt builder.

export interface InjectionDefenseStats {
    scanned: number;                         // total untrusted snippets passed through the sanitizer
    flagged: number;                         // snippets where ≥1 pattern fired
    patternHits: Record<string, number>;     // pattern name → number of times it matched
}

export function newInjectionStats(): InjectionDefenseStats {
    return { scanned: 0, flagged: 0, patternHits: {} };
}

interface InjectionPattern {
    name: string;
    re: RegExp;
}

// Each regex below has been hand-picked to minimize false positives on
// financial news / SEC prose. "ignore previous instructions" is specific
// enough; "you are now" is not.
const INJECTION_PATTERNS: InjectionPattern[] = [
    // Chat role headers at line start — rare in articles, common in injection.
    { name: 'role_header',
      re: /^[ \t]*(?:SYSTEM|ASSISTANT|HUMAN|USER)\s*:\s*/gmi },
    // Literal instruct tokens from various LLM chat templates.
    { name: 'instruct_token',
      re: /\[\/?(?:INST|SYS|INSTRUCT)\]|<\|(?:im_start|im_end|system|user|assistant|start_header_id|end_header_id|eot_id)\|>/gi },
    // "Ignore previous/prior/above instructions/prompts/rules" — classic PI.
    { name: 'ignore_previous',
      re: /\b(?:please\s+)?(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier|preceding|preceding\s+above|any|your)\s+(?:instructions?|prompts?|rules?|guidelines?|system\s+(?:prompt|message)s?)\b/gi },
    // Jailbreak handles.
    { name: 'jailbreak',
      re: /\b(?:DAN\s+mode|jailbreak\s+mode|developer\s+mode\s+(?:enabled|on)|do\s+anything\s+now)\b/gi },
    // "Override/bypass safety/guardrails/rules". `\w*` picks up common verb
    // inflections (bypassing / overrides / disabled) without a full list.
    { name: 'override_safety',
      re: /\b(?:override|bypass|disable)\w*\s+(?:your\s+)?(?:safety|guardrails?|restrictions?|filters?)\b/gi },
    // Reveal-system-prompt probes.
    { name: 'reveal_system',
      re: /\b(?:reveal|show|print|output|repeat|echo)\s+(?:your|the)\s+(?:system\s+(?:prompt|message)|initial\s+(?:prompt|instructions?)|hidden\s+instructions?)\b/gi },
];

export interface SanitizationResult {
    clean: string;
    flagged: boolean;
    patternsFound: string[];
}

// Pure sanitizer. Replaces injection patterns with [REDACTED] and returns
// the cleaned text plus which patterns fired. Does NOT truncate — callers
// keep their own length caps.
export function sanitizeUntrustedContent(raw: string): SanitizationResult {
    if (!raw) return { clean: '', flagged: false, patternsFound: [] };
    const patternsFound: string[] = [];
    let out = raw;
    for (const { name, re } of INJECTION_PATTERNS) {
        // Reset regex lastIndex in case a previous call left stateful progress.
        re.lastIndex = 0;
        if (re.test(out)) {
            patternsFound.push(name);
            re.lastIndex = 0;
            out = out.replace(re, '[REDACTED]');
        }
    }
    return { clean: out, flagged: patternsFound.length > 0, patternsFound };
}

let _activeInjectionStats: InjectionDefenseStats | null = null;

// Sanitize + update the active stats counter (if any). Used at prompt-
// construction sites so downstream LLMs never see raw untrusted text.
export function sanitizeAndTrack(raw: string): string {
    const r = sanitizeUntrustedContent(raw);
    const stats = _activeInjectionStats;
    if (stats) {
        stats.scanned += 1;
        if (r.flagged) {
            stats.flagged += 1;
            for (const p of r.patternsFound) {
                stats.patternHits[p] = (stats.patternHits[p] || 0) + 1;
            }
        }
    }
    return r.clean;
}

// Test-only hooks so phase-2 can assert the module-level state isolates
// correctly across runs.
export function _setActiveInjectionStats_FOR_TESTS(s: InjectionDefenseStats | null): void {
    _activeInjectionStats = s;
}
export function _getActiveInjectionStats_FOR_TESTS(): InjectionDefenseStats | null {
    return _activeInjectionStats;
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
    model?: ResearchModelId,
    workflowId?: WorkflowId,
): Promise<ResearchBlueprint> {
    const workflowSuffix = workflowId ? `\n\nWORKFLOW DIRECTIVE: ${WORKFLOW_PRESETS[workflowId].systemSuffix}` : '';
    const prompt = `You are the Chief Research Strategist at a top-tier institutional asset manager (Goldman Sachs Asset Management, Bridgewater, Two Sigma).

A client has submitted this research request: "${query}"${workflowSuffix}

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
// Blends Tavily's semantic score with the authority classifier in tavilyService
// (primary > premium_news > mainstream > aggregator > other) plus a freshness
// bump. Single source of truth for domain weighting lives in tavilyService.

function scoreSource(s: TavilySearchResult): number {
    const base = s.score ?? 0.5;
    const auth = authorityWeight(classifyAuthority(s.url));
    let score = 0.4 * base + 0.5 * auth;
    if (s.publishedDate) {
        const daysSince = (Date.now() - new Date(s.publishedDate).getTime()) / 86400000;
        if (daysSince < 7) score += 0.10;
        else if (daysSince < 30) score += 0.05;
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

// ─── Context Distillation ──────────────────────────────────────────────────
// Plan §6.1 P0: "every sub-agent must return a cleaned summary, not raw
// scraped content." The per-round Extractor already produces bullet-form
// extraction, but across 2–4 rounds the accumulated knowledgeBase can
// exceed 20K chars — at which point the final analyzeSources call silently
// truncates with `substring(0, 5000)`, dropping early-round intelligence.
// We replace that silent slice with an explicit compression pass that
// preserves ALL numeric facts and quotes while compressing narrative prose.

export const KB_DISTILL_THRESHOLD = 7000;   // compress if accumulated KB exceeds this
export const KB_DISTILL_TARGET = 4500;      // target size after compression
export const KB_DISTILL_MIN_SHRINK = 0.15;  // accept distillation only if it saved ≥15%

export interface DistillationResult {
    used: boolean;            // whether compression actually ran
    inputChars: number;       // size of knowledgeBase before compression
    outputChars: number;      // size after (equals inputChars when used=false)
    compressionRatio: number; // outputChars / inputChars, 0..1 (1 when skipped)
    fallback: boolean;        // true if LLM returned garbage and we kept the pre-distill KB
}

export function buildKbDistillationPrompt(
    kb: string,
    blueprint: ResearchBlueprint,
    targetChars: number,
): string {
    return `You are the supervising research analyst. Compress the accumulated intelligence below to roughly ${targetChars} characters WITHOUT losing any specific numeric fact, date, or named quote.

RESEARCH TOPIC: ${blueprint.targetEntities.join(', ') || blueprint.subtopics[0] || 'see angles'}
KEY METRICS: ${blueprint.keyMetrics.join(', ') || '(none specified)'}
RESEARCH ANGLES: ${blueprint.researchAngles.join(' | ') || '(none)'}

ACCUMULATED INTELLIGENCE (from multiple search rounds):
${kb}

Compression rules:
1. PRESERVE every specific number (revenue, EPS, growth %, margins, price targets, headcount, dates) verbatim
2. PRESERVE direct named quotes with attribution
3. PRESERVE conflicting figures — flag them with "(conflicts: …)"
4. MERGE duplicate facts that appear across rounds
5. DROP marketing adjectives, hedging, narrative filler
6. Format as tight bullet points grouped by theme (financials, guidance, competitive, risks)
7. Do NOT invent or extrapolate — only rephrase what's there

Return ONLY the compressed brief. No preamble, no closing commentary.`;
}

// Sanity-check the LLM's compressed output — reject if it's empty, longer
// than the input, or clearly non-text garbage. Keeping the original KB is
// strictly safer than accepting a malformed compression.
export function isAcceptableDistillation(input: string, output: string): boolean {
    if (!output || output.trim().length < 200) return false;
    if (output.length >= input.length) return false;
    // Require the compression to actually save space (not just shave whitespace).
    const shrink = 1 - output.length / input.length;
    if (shrink < KB_DISTILL_MIN_SHRINK) return false;
    return true;
}

export async function distillKnowledgeBase(
    kb: string,
    blueprint: ResearchBlueprint,
    options: {
        model?: ResearchModelId;
        callLLM?: (prompt: string) => Promise<string>;
        threshold?: number;
        target?: number;
    } = {},
): Promise<{ kb: string; stats: DistillationResult }> {
    const threshold = options.threshold ?? KB_DISTILL_THRESHOLD;
    const target = options.target ?? KB_DISTILL_TARGET;
    const inputChars = kb.length;

    // Skip compression when the base is already small enough — a single LLM
    // call to "compress 4K→4K" would be pure cost, no signal.
    if (inputChars <= threshold) {
        return {
            kb,
            stats: { used: false, inputChars, outputChars: inputChars, compressionRatio: 1, fallback: false },
        };
    }

    const prompt = buildKbDistillationPrompt(kb, blueprint, target);
    // Defer model resolution to callDriver so tests don't need real providers.
    const call = options.callLLM ?? ((p: string) => callDriver(p, 'standard', options.model));

    let compressed = '';
    try {
        compressed = await call(prompt);
    } catch {
        // LLM failure → keep the raw KB (silent truncation downstream is still
        // better than an empty string).
        return {
            kb,
            stats: { used: true, inputChars, outputChars: inputChars, compressionRatio: 1, fallback: true },
        };
    }

    const trimmed = compressed.trim();
    if (!isAcceptableDistillation(kb, trimmed)) {
        return {
            kb,
            stats: { used: true, inputChars, outputChars: inputChars, compressionRatio: 1, fallback: true },
        };
    }

    return {
        kb: trimmed,
        stats: {
            used: true,
            inputChars,
            outputChars: trimmed.length,
            compressionRatio: trimmed.length / inputChars,
            fallback: false,
        },
    };
}

// ─── Reader / Extractor sub-agents (plan §6.1) ────────────────────────────
// Replaces the single monolithic "extract intelligence" LLM call per round
// with a two-stage pipeline:
//
//   Stage A (Reader):    N parallel per-source summarizers. Each Reader
//                         gets ONE source + the blueprint focus, returns
//                         a tight 3–6 bullet fact list or the sentinel
//                         "NO_RELEVANT_FACTS". Cached by url+queryHash so
//                         repeat runs and cross-session queries benefit.
//
//   Stage B (Extractor): cross-source synthesizer. Takes the N Reader
//                         outputs, merges duplicates, flags conflicts,
//                         produces the round's intelligence bullet brief.
//
// Why this matters:
//   1. Parallelism — 12 sources in parallel (~2s) vs one mega prompt (~6s)
//   2. Fault isolation — one noisy source doesn't poison the round
//   3. Cleaner prompts — each Reader sees 700 chars, not 8400
//   4. Per-source attribution — Extractor output can cite by source index
//   5. Matches "every sub-agent returns a cleaned summary" (plan §6.1)
//
// Fallback: if fewer than READER_FALLBACK_THRESHOLD Readers succeed, fall
// back to the monolithic prompt for safety.

export const READER_FALLBACK_THRESHOLD = 3;   // need ≥3 Reader summaries to trust the Extractor
const READER_NO_FACTS_SENTINEL = 'NO_RELEVANT_FACTS';

export interface ReaderResult {
    url: string;
    title: string;
    summary: string;        // bullets, or "" if failed / no facts
    cacheHit: boolean;
    failed: boolean;        // LLM threw or returned empty
    noRelevantFacts: boolean; // Reader explicitly said source had nothing
}

export interface ReaderStats {
    totalReaders: number;      // sum across all rounds
    succeeded: number;         // produced a non-empty summary
    failed: number;            // LLM threw or returned empty
    noRelevantFacts: number;   // Reader said source was irrelevant
    cacheHits: number;
    fallbackRounds: number;    // rounds that fell back to monolithic due to Reader attrition
}

export function newReaderStats(): ReaderStats {
    return {
        totalReaders: 0,
        succeeded: 0,
        failed: 0,
        noRelevantFacts: 0,
        cacheHits: 0,
        fallbackRounds: 0,
    };
}

// Session-scoped Reader cache. Key format: `${url}::${queryHash}`.
// `queryHash` is a short lowercase prefix of the research query — two
// different queries should get different Reader summaries for the same
// URL (different focus extracts different facts).
const _readerCache = new Map<string, string>();

export function _clearReaderCache_FOR_TESTS(): void {
    _readerCache.clear();
}

export function buildReaderPrompt(
    source: { title: string; content: string; url: string },
    query: string,
    blueprint: ResearchBlueprint,
): string {
    const focus = [
        blueprint.targetEntities.join(', '),
        blueprint.researchAngles.slice(0, 3).join(' | '),
    ].filter(Boolean).join(' — ');
    const metrics = blueprint.keyMetrics.slice(0, 6).join(', ') || '(none specified)';
    const safeTitle = sanitizeAndTrack(source.title);
    const safeContent = sanitizeAndTrack(source.content).substring(0, 1200);
    return `You are one of several parallel research readers. Extract ALL specific facts from THIS ONE source that are relevant to the research focus. No interpretation, no narrative — just verifiable facts.

RESEARCH FOCUS: ${focus || query}
KEY METRICS: ${metrics}
QUERY: ${query}

SOURCE:
<source url="${source.url}">
title: ${safeTitle}
content: ${safeContent}
</source>

Rules:
1. Emit 3–6 tight bullet points, one fact per bullet.
2. PRESERVE every specific number (revenue, growth %, margins, dates, headcount) verbatim.
3. PRESERVE direct named quotes with attribution.
4. Skip marketing language, generic filler, and anything not tied to the focus.
5. If the source has NO relevant facts for this focus, return exactly: ${READER_NO_FACTS_SENTINEL}

Return ONLY the bullets (or the sentinel). No preamble, no closing commentary.`;
}

export function parseReaderResponse(raw: string): { summary: string; noRelevantFacts: boolean } {
    const trimmed = (raw || '').trim();
    if (!trimmed) return { summary: '', noRelevantFacts: false };
    // Explicit no-facts sentinel
    if (trimmed === READER_NO_FACTS_SENTINEL || trimmed.toUpperCase().startsWith(READER_NO_FACTS_SENTINEL)) {
        return { summary: '', noRelevantFacts: true };
    }
    // Clamp to a reasonable ceiling to prevent runaway Readers from bloating KB
    const clamped = trimmed.length > 1800 ? trimmed.slice(0, 1800) + '…' : trimmed;
    return { summary: clamped, noRelevantFacts: false };
}

// Fire one Reader for one source. Used by runReaders; exported for tests.
export async function runSingleReader(
    source: TavilySearchResult,
    query: string,
    blueprint: ResearchBlueprint,
    options: {
        model?: ResearchModelId;
        callLLM?: (prompt: string) => Promise<string>;
    } = {},
): Promise<ReaderResult> {
    const queryHash = (query || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 48);
    const cacheKey = `${source.url}::${queryHash}`;
    const cached = _readerCache.get(cacheKey);
    if (cached !== undefined) {
        const isNoFacts = cached === READER_NO_FACTS_SENTINEL;
        return {
            url: source.url,
            title: source.title,
            summary: isNoFacts ? '' : cached,
            cacheHit: true,
            failed: false,
            noRelevantFacts: isNoFacts,
        };
    }

    const prompt = buildReaderPrompt(source, query, blueprint);
    const call = options.callLLM ?? ((p: string) => callDriver(p, 'lite', options.model));

    let raw = '';
    try {
        raw = await call(prompt);
    } catch {
        return {
            url: source.url,
            title: source.title,
            summary: '',
            cacheHit: false,
            failed: true,
            noRelevantFacts: false,
        };
    }

    const { summary, noRelevantFacts } = parseReaderResponse(raw);
    if (noRelevantFacts) {
        _readerCache.set(cacheKey, READER_NO_FACTS_SENTINEL);
        return { url: source.url, title: source.title, summary: '', cacheHit: false, failed: false, noRelevantFacts: true };
    }
    if (summary) {
        _readerCache.set(cacheKey, summary);
        return { url: source.url, title: source.title, summary, cacheHit: false, failed: false, noRelevantFacts: false };
    }
    // Empty non-sentinel response → failed
    return { url: source.url, title: source.title, summary: '', cacheHit: false, failed: true, noRelevantFacts: false };
}

// Fire N Readers in parallel. Updates stats in-place on the passed accumulator.
export async function runReaders(
    sources: TavilySearchResult[],
    query: string,
    blueprint: ResearchBlueprint,
    stats: ReaderStats,
    options: {
        model?: ResearchModelId;
        callLLM?: (prompt: string) => Promise<string>;
    } = {},
): Promise<ReaderResult[]> {
    const results = await Promise.all(
        sources.map(s => runSingleReader(s, query, blueprint, options).catch(() => ({
            url: s.url,
            title: s.title,
            summary: '',
            cacheHit: false,
            failed: true,
            noRelevantFacts: false,
        } as ReaderResult))),
    );
    for (const r of results) {
        stats.totalReaders += 1;
        if (r.cacheHit) stats.cacheHits += 1;
        if (r.failed) stats.failed += 1;
        else if (r.noRelevantFacts) stats.noRelevantFacts += 1;
        else if (r.summary) stats.succeeded += 1;
    }
    return results;
}

export function buildExtractorPrompt(
    readers: ReaderResult[],
    blueprint: ResearchBlueprint,
    round: number,
): string {
    const usable = readers.filter(r => r.summary && !r.failed && !r.noRelevantFacts);
    const sourceBlock = usable.map((r, i) =>
        `[${i + 1}] url=${r.url}\n    title="${r.title}"\n    facts:\n${r.summary.split('\n').map(l => '      ' + l.replace(/^\s*[-*]\s*/, '• ')).join('\n')}`
    ).join('\n\n');
    return `You are the supervising research analyst. Merge the per-source fact summaries below into the round ${round + 1} intelligence brief.

RESEARCH FOCUS: ${blueprint.targetEntities.join(', ') || blueprint.subtopics[0] || 'see angles'}
RESEARCH ANGLES: ${blueprint.researchAngles.join(' | ') || '(none)'}
KEY METRICS: ${blueprint.keyMetrics.join(', ') || '(none specified)'}

PER-SOURCE SUMMARIES (${usable.length} sources):
${sourceBlock}

Rules:
1. MERGE duplicate facts that appear across sources (e.g., Q4 revenue figure cited by three sources → one bullet, "$94.9B [1][3][5]").
2. FLAG conflicting numbers with "(conflicts: source [X] says A, [Y] says B)".
3. PRESERVE every specific number and named quote verbatim.
4. GROUP by theme (financials, guidance, competitive, risks) where useful.
5. Do NOT invent facts not present in the per-source summaries.
6. Use inline [N] tags referring to the source indices above so downstream consumers can trace attribution.

Return ONLY the merged bullet brief. No preamble, no closing commentary.`;
}

// Orchestrate the Reader → Extractor flow for one round. Returns the round
// intelligence string (to append to knowledgeBase) plus updated stats.
// Falls back to the monolithic prompt if too few Readers succeed.
export async function extractRoundIntelligence(
    sources: TavilySearchResult[],
    query: string,
    blueprint: ResearchBlueprint,
    round: number,
    stats: ReaderStats,
    options: {
        model?: ResearchModelId;
        readerCallLLM?: (prompt: string) => Promise<string>;
        extractorCallLLM?: (prompt: string) => Promise<string>;
        monolithicCallLLM?: (prompt: string) => Promise<string>;
    } = {},
): Promise<{ intelligence: string; fellBack: boolean; readerResults: ReaderResult[] }> {
    const sliced = sources.slice(0, 12);
    const readerResults = await runReaders(sliced, query, blueprint, stats, {
        model: options.model,
        callLLM: options.readerCallLLM,
    });
    const usable = readerResults.filter(r => r.summary && !r.failed && !r.noRelevantFacts);

    // Too few usable Reader outputs → fall back to the monolithic prompt.
    if (usable.length < READER_FALLBACK_THRESHOLD) {
        stats.fallbackRounds += 1;
        const monolithPrompt = `You are a senior analyst. Extract ALL specific facts, figures, quotes, and data points from these sources relevant to: ${blueprint.targetEntities.join(', ')} — ${blueprint.researchAngles.slice(0, 3).join(' | ')}

Sources:
${sliced.map((s, i) => `[${i + 1}] ${sanitizeAndTrack(s.title)}\n${sanitizeAndTrack(s.content).substring(0, 700)}`).join('\n\n---\n\n')}

Extract as bullet points. Be specific with numbers, dates, and source attribution. Skip marketing language.`;
        const call = options.monolithicCallLLM ?? ((p: string) => callDriver(p, 'standard', options.model));
        const intelligence = await call(monolithPrompt);
        return { intelligence, fellBack: true, readerResults };
    }

    const extractorPrompt = buildExtractorPrompt(readerResults, blueprint, round);
    const call = options.extractorCallLLM ?? ((p: string) => callDriver(p, 'standard', options.model));
    const intelligence = await call(extractorPrompt);
    return { intelligence, fellBack: false, readerResults };
}

// Active stats ref — iterativeSearch reads this to thread Reader stats
// back out to performDeepResearch for metadata surfacing.
let _activeReaderStats: ReaderStats | null = null;

export function _setActiveReaderStats_FOR_TESTS(s: ReaderStats | null): void {
    _activeReaderStats = s;
}

// ─── Iterative Search: Main loop ──────────────────────────────────────────────

async function iterativeSearch(
    blueprint: ResearchBlueprint,
    query: string,
    model: ResearchModelId | undefined,
    onProgress: (p: ResearchProgress) => void,
    maxRounds = 4,
): Promise<{ sources: TavilySearchResult[]; knowledgeBase: string; roundsRun: number; distillation: DistillationResult }> {
    let allSources: TavilySearchResult[] = [];
    let knowledgeBase = '';
    let roundsRun = 0;
    const seenUrls = new Set<string>();

    for (let round = 0; round < maxRounds; round++) {
        roundsRun = round + 1;
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

        // Extract intelligence via Reader → Extractor sub-agents (plan §6.1).
        // Falls back to monolithic prompt if too few Readers succeed.
        const readerStats = _activeReaderStats ?? newReaderStats();
        onProgress({
            stage: 'searching',
            message: `Round ${round + 1}: ${fresh.length} parallel Readers extracting per-source facts…`,
            progress: 17 + round * 8,
            sourcesFound: allSources.length,
        });
        const { intelligence: roundIntelligence, fellBack } = await extractRoundIntelligence(
            fresh, query, blueprint, round, readerStats, { model },
        );
        if (fellBack) {
            onProgress({
                stage: 'searching',
                message: `Round ${round + 1}: Readers degraded — fell back to monolithic extractor`,
                progress: 18 + round * 8,
                sourcesFound: allSources.length,
            });
        }

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

    // ── Post-rounds distillation (plan §6.1) ──────────────────────────────
    // Compress accumulated intelligence to a bounded size BEFORE analyzeSources
    // slices it to 5000 chars. The explicit pass preserves numeric facts and
    // named quotes that `substring(0, 5000)` would silently drop from rounds 3–4.
    const { kb: distilled, stats: distillation } = await distillKnowledgeBase(
        knowledgeBase,
        blueprint,
        { model },
    );
    if (distillation.used && !distillation.fallback) {
        const pct = Math.round(distillation.compressionRatio * 100);
        onProgress({
            stage: 'searching',
            message: `Knowledge base distilled: ${distillation.inputChars.toLocaleString()} → ${distillation.outputChars.toLocaleString()} chars (${pct}%)`,
            progress: 42,
            sourcesFound: allSources.length,
        });
    }

    return {
        sources: allSources.sort((a, b) => scoreSource(b) - scoreSource(a)),
        knowledgeBase: distilled,
        roundsRun,
        distillation,
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
        .map((s, i) => {
            const ctxLine = s.context ? `    context: ${s.context}\n` : '';
            return `[Source ${i + 1}] "${sanitizeAndTrack(s.title)}" (${s.publishedDate || 'recent'})\n${ctxLine}${sanitizeAndTrack(s.content || '').substring(0, 900)}`;
        })
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

    // Tier-4: Web sources (narrative / analyst consensus). Contextual
    // Retrieval tags (when present) are prepended in parens so the Writer
    // sees *what each source is* before deciding whether to cite it.
    const webCitationIndex = webSources.slice(0, 35)
        .map((s, i) => {
            const tag = s.context ? `(${s.context}) ` : '';
            return `[${i + 1}] ${tag}${s.title} — ${s.url}`;
        })
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
CRITICAL WRITING STANDARDS — PER-SENTENCE CITATION DISCIPLINE
════════════════════════════════════════════
✓ NEVER fabricate figures — every number must trace to a cited source
✓ **Every sentence that states a fact, figure, forecast, quote, or attributed claim MUST end with one or more [n] or [RAG-n] tags** before the period. Uncited factual sentences will be rejected by the post-generation verifier and flagged as hallucinations.
✓ Only transition/narrative sentences that carry no specific claim (e.g. "We now turn to the bear case.") may omit citations. When in doubt, cite.
✓ MINIMUM 40 inline citations [n] or [RAG-n] distributed throughout — aim for ≥85% sentence-level citation density in factual paragraphs.
✓ Tier 1 (RAG) figures take priority — mark them [RAG-n] so the reader knows they are verified.
✓ If a claim cannot be cited from the provided evidence, OMIT it entirely rather than guess.
✓ **Fact vs inference — hedge your forecasts.** Forward-looking claims (forecasts, projections, guidance, targets, "will [do X]") MUST include a hedging qualifier (~, est., likely, could, should, we estimate) OR a clear attribution (management guided, consensus expects, analysts forecast). "Revenue will reach $50B" is flagged as speculation; "Management guided to ~$50B [1]" is correctly hedged. Past/reported events should NOT be hedged — state plainly.
✓ Tone: institutional, direct, zero marketing language
✓ Specific beats vague: "$2.47B in free cash flow [3]" not "strong cash generation"
✓ Every required table must be populated — no placeholder rows
✓ Report target: 3,500–4,500 words`;

    return callLLM(prompt, synthesisModel);
}

// ─── Stage 5b: Template-Driven Section Fanout ───────────────────────────────
// Splits the Writer monolith into one LLM call per template section, each
// seeing only its relevant evidence slice. Plan §6.1 P0: parallel per-section
// calls give focused evidence, shorter prompts, tighter citation discipline,
// and lower end-to-end latency.
//
// Failure mode: if ≥40% of sections fail, the caller falls back to the
// monolith Writer. Partial successes still produce a usable report.

const STOPWORDS = new Set([
    'the','and','for','with','from','into','of','a','an','is','are','be','to',
    'in','on','at','by','as','it','vs','its','their','our','this','that','these',
    'those','amp','or','but','how','why','what','which','who','when','where',
    'over','under','up','down','than','then','so','if','case','key','top',
]);

export function keywordsFromSection(title: string, extra: string[] = []): string[] {
    const raw = [...title.split(/[\s\W]+/), ...extra.flatMap(s => s.split(/[\s\W]+/))];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const w of raw) {
        const k = w.trim().toLowerCase();
        if (k.length < 3) continue;
        if (STOPWORDS.has(k)) continue;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(k);
    }
    return out;
}

export function scoreSourceForSection(
    s: TavilySearchResult,
    keywords: string[],
): number {
    if (keywords.length === 0) return 0;
    const hay = `${s.title} ${s.content}`.toLowerCase();
    let hits = 0;
    for (const k of keywords) if (hay.includes(k)) hits += 1;
    const kw = hits / keywords.length;
    const auth = authorityWeight(classifyAuthority(s.url));
    const semantic = typeof s.score === 'number' ? s.score : 0.5;
    return 0.5 * kw + 0.3 * auth + 0.2 * semantic;
}

export function sliceEvidenceForSection(
    section: string,
    sources: TavilySearchResult[],
    extraKeywords: string[],
    limit = 15,
): TavilySearchResult[] {
    if (sources.length === 0) return [];
    const keywords = keywordsFromSection(section, extraKeywords);
    if (keywords.length === 0) return sources.slice(0, limit);
    const scored = sources
        .map(s => ({ s, score: scoreSourceForSection(s, keywords), kwHits: countHits(s, keywords) }))
        .sort((a, b) => b.score - a.score);
    // Prefer sources that hit ≥1 section keyword — off-topic high-semantic
    // sources (e.g., aggregators SEO'd into the search result set) should
    // not leak into a focused section just because of their Tavily score.
    // Fall back to authority-ranked top only when NO source matches any
    // keyword (rare — means the section title is disjoint from all evidence).
    const keyworded = scored.filter(x => x.kwHits > 0);
    const pool = keyworded.length > 0 ? keyworded : scored;
    return pool.slice(0, limit).map(x => x.s);
}

function countHits(s: TavilySearchResult, keywords: string[]): number {
    const hay = `${s.title} ${s.content}`.toLowerCase();
    let n = 0;
    for (const k of keywords) if (hay.includes(k)) n += 1;
    return n;
}

export function buildReportTitle(blueprint: ResearchBlueprint, template: ReportTemplate): string {
    const entities = blueprint.targetEntities.slice(0, 3).join(', ');
    const timeframe = blueprint.timeframe || '';
    if (entities && timeframe) return `${template.label}: ${entities} — ${timeframe}`;
    if (entities) return `${template.label}: ${entities}`;
    return template.label;
}

// Which template-required table (if any) belongs with this section title.
// Heuristic: shared tokens ≥ 1. Keeps table placement deterministic without
// asking the LLM to guess.
export function requiredTableForSection(section: string, requiredTables: string[]): string | null {
    const sTokens = new Set(keywordsFromSection(section));
    for (const t of requiredTables) {
        const tTokens = keywordsFromSection(t);
        if (tTokens.some(k => sTokens.has(k))) return t;
    }
    return null;
}

// ─── Stage 4b: Anthropic-style Contextual Retrieval ──────────────────────────
// Plan §10.1: prepending a short LLM-generated context summary to each source
// before it flows into evidence blocks reduces retrieval failure ~49% on
// Anthropic's benchmarks. True ingestion-layer contextual retrieval lives in
// gravity-api (chunks prefixed before embedding). Here in market-ui we apply
// the *same spirit* at the web-source layer: one cheap LLM call per batch of
// 10 sources emits a 50–100 token self-describing tag (source type, primary
// entity, date, relevance-to-query) which the Writer + verifiers then see
// alongside the raw content. Deterministic URL-based fallback covers any
// batch that fails to parse, and a session-level cache avoids redundant work
// across retries.

export interface ContextualRetrievalResult {
    used: boolean;           // did we attempt enrichment?
    total: number;           // sources inspected
    enriched: number;        // sources that received a context tag
    llmBatches: number;      // successful LLM batch calls
    deterministicBatches: number; // batches that fell back to URL-based inference
    cacheHits: number;       // sources answered from the session cache
}

export const CONTEXT_BATCH_SIZE = 10;

// Session-level cache: reused across retries within the same browser tab so a
// Writer retry or a second "related" query doesn't pay to re-contextualize
// URLs we've already seen.
const _contextCache = new Map<string, string>();

export function _clearContextCache_FOR_TESTS(): void {
    _contextCache.clear();
}

// Deterministic URL → source-type classifier. Used as a fallback when the
// LLM batch fails (parse error, rate limit, budget exhausted) so we always
// ship *some* context, never empty strings.
export function inferBasicSourceContext(s: TavilySearchResult): string {
    const host = (() => {
        try { return new URL(s.url).hostname.replace(/^www\./, ''); }
        catch { return ''; }
    })();
    let kind = 'web article';
    if (/\bsec\.gov\b/.test(host)) kind = 'SEC filing';
    else if (/^ir\.|^investor\.|\binvestor\.|\binvestors\./.test(host)) kind = 'issuer IR page';
    else if (/reuters\.com|bloomberg\.com|ft\.com|wsj\.com|nytimes\.com|economist\.com|barrons\.com/.test(host)) kind = 'premium financial news';
    else if (/cnbc\.com|marketwatch\.com|forbes\.com|businessinsider\.com|axios\.com/.test(host)) kind = 'mainstream financial news';
    else if (/seekingalpha\.com|finance\.yahoo|benzinga\.com|fool\.com|zacks\.com|investorplace\.com/.test(host)) kind = 'financial aggregator';
    else if (/substack\.com|medium\.com|reddit\.com|twitter\.com|x\.com/.test(host)) kind = 'social / blog';
    else if (/press|prnewswire\.com|businesswire\.com|globenewswire\.com/.test(host)) kind = 'press release';
    const date = s.publishedDate ? ` (${s.publishedDate.slice(0, 10)})` : '';
    const titleSnippet = s.title ? ` on "${s.title.slice(0, 80)}"` : '';
    return `${kind}${date}${titleSnippet}`.trim();
}

// Batch several sources into one LLM prompt. 10 is the sweet spot: short
// enough for a cheap-tier call (~1500 input tokens), wide enough that a
// typical 25-source research run costs ≤3 batches.
export function buildContextEnrichmentPrompt(
    sources: TavilySearchResult[],
    query: string,
    blueprint: ResearchBlueprint,
): string {
    const sourceLines = sources.map((s, i) => {
        const date = s.publishedDate ? `published ${s.publishedDate.slice(0, 10)}` : 'undated';
        const excerpt = sanitizeAndTrack(s.content || '').replace(/\s+/g, ' ').slice(0, 180);
        const safeTitle = sanitizeAndTrack(s.title);
        return `[${i + 1}] url=${s.url}\n    title="${safeTitle}" — ${date}\n    excerpt="${excerpt}"`;
    }).join('\n\n');

    return `You are tagging financial research sources for a retrieval pipeline.

QUERY: "${query}"
FOCUS: ${blueprint.targetEntities.join(', ') || 'broad'} — ${blueprint.researchAngles.slice(0, 4).join(' | ') || 'n/a'}

For EACH source below, emit ONE short "context tag" (40–80 tokens, single line) that captures:
  • source type (SEC 10-K/10-Q/8-K, earnings transcript, IR page, analyst note, press release, premium news, aggregator, blog/social)
  • primary entity (ticker or company) when identifiable
  • recency signal (year, or "undated")
  • which angle of the QUERY this source covers (what claim it supports)

Output STRICTLY a JSON array with one object per input source, in the same order:
[
  {"url": "<exact url>", "context": "<one-line tag>"},
  ...
]
No prose before or after, no markdown fence, no comments. Every url in my input MUST appear in your output.

SOURCES:
${sourceLines}`;
}

// Robust JSON extractor — LLMs on 'lite' tier occasionally wrap output in
// markdown fences or add a preamble despite the instruction. We strip those
// then parse; on any failure we return an empty map so the caller can fall
// back to deterministic inference.
export function parseContextEnrichmentResponse(
    raw: string,
    expectedUrls: string[],
): Map<string, string> {
    const out = new Map<string, string>();
    if (!raw) return out;
    let cleaned = raw.trim();
    // Strip ```json ... ``` or ``` ... ``` fences
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();
    // Find the first [ ... ] block
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) return out;
    const jsonSlice = cleaned.slice(firstBracket, lastBracket + 1);
    let parsed: unknown;
    try { parsed = JSON.parse(jsonSlice); } catch { return out; }
    if (!Array.isArray(parsed)) return out;
    const expected = new Set(expectedUrls);
    for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        const url = typeof obj.url === 'string' ? obj.url : null;
        const ctx = typeof obj.context === 'string' ? obj.context.trim() : null;
        if (!url || !ctx) continue;
        if (!expected.has(url)) continue;  // reject hallucinated urls
        // Clamp to a sane length — guards against runaway LLM responses
        out.set(url, ctx.slice(0, 280));
    }
    return out;
}

// Main async driver. Budget-aware: each batch checks the tracker before
// firing; if the cap is hit we stop calling the LLM and let remaining
// sources take the deterministic fallback.
export async function contextualizeSources(
    sources: TavilySearchResult[],
    query: string,
    blueprint: ResearchBlueprint,
    options?: {
        model?: ResearchModelId;
        callLLM?: (prompt: string) => Promise<string>;
        tracker?: BudgetTracker | null;
    },
): Promise<{ enriched: TavilySearchResult[]; stats: ContextualRetrievalResult }> {
    const stats: ContextualRetrievalResult = {
        used: false,
        total: sources.length,
        enriched: 0,
        llmBatches: 0,
        deterministicBatches: 0,
        cacheHits: 0,
    };
    if (sources.length === 0) {
        return { enriched: sources, stats };
    }

    stats.used = true;
    const call = options?.callLLM ?? ((p: string) => callDriver(p, 'lite'));
    const tracker = options?.tracker ?? _activeBudget;

    // Short per-query digest so cache keys are query-aware. Two different
    // queries hitting the same URL should get different context tags.
    const queryHash = (query || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 48);

    const result: TavilySearchResult[] = sources.map(s => ({ ...s }));
    const pending: number[] = [];

    // Pass 1: drain the session cache
    for (let i = 0; i < result.length; i++) {
        const cacheKey = `${result[i].url}::${queryHash}`;
        const cached = _contextCache.get(cacheKey);
        if (cached) {
            result[i].context = cached;
            stats.cacheHits += 1;
            stats.enriched += 1;
        } else {
            pending.push(i);
        }
    }

    // Pass 2: batch the rest through the LLM (or deterministic fallback
    // when the budget is tight)
    for (let start = 0; start < pending.length; start += CONTEXT_BATCH_SIZE) {
        const batchIdxs = pending.slice(start, start + CONTEXT_BATCH_SIZE);
        const batch = batchIdxs.map(i => result[i]);
        const urls = batch.map(s => s.url);

        // Budget guard — if we'd blow the cap, stop LLM enrichment and let
        // the rest fall through to the deterministic path below.
        let useLLM = true;
        if (tracker) {
            try { tracker.checkBeforeCall(); } catch { useLLM = false; }
        }

        let contextMap = new Map<string, string>();
        if (useLLM) {
            const prompt = buildContextEnrichmentPrompt(batch, query, blueprint);
            try {
                const raw = await call(prompt);
                contextMap = parseContextEnrichmentResponse(raw, urls);
                if (tracker) tracker.recordCall(prompt.length, raw.length);
                if (contextMap.size > 0) {
                    stats.llmBatches += 1;
                }
            } catch {
                // LLM failed — fall through to deterministic fallback below
            }
        }

        // Fill any missing URLs in this batch with deterministic inference
        let usedDeterministic = false;
        for (let k = 0; k < batchIdxs.length; k++) {
            const i = batchIdxs[k];
            const src = result[i];
            let ctx = contextMap.get(src.url);
            if (!ctx) {
                ctx = inferBasicSourceContext(src);
                usedDeterministic = true;
            }
            src.context = ctx;
            stats.enriched += 1;
            _contextCache.set(`${src.url}::${queryHash}`, ctx);
        }
        if (usedDeterministic && contextMap.size === 0) {
            stats.deterministicBatches += 1;
        }
    }

    return { enriched: result, stats };
}

export interface SectionWriterContext {
    blueprint: ResearchBlueprint;
    template: ReportTemplate;
    section: string;
    sectionIndex: number;
    totalSections: number;
    relevantSources: TavilySearchResult[];
    citationMap: Map<string, number>;
    verifiedFactsBlock: string;
    sourceAnalysisExcerpt: string;
    companyData: CompanyOverview[];
    secFilings: SECFiling[];
    bullCase: string;
    bearCase: string;
    macroText?: string;
    ragCitationIndex: string;
}

export function buildSectionWriterPrompt(ctx: SectionWriterContext): string {
    const isBullSection = /bull case|path to outperformance|bull surprise|bull scenario/i.test(ctx.section);
    const isBearSection = /bear case|downside risk|bear surprise|bear scenario|\brisks?\b|risk matrix/i.test(ctx.section);
    const table = requiredTableForSection(ctx.section, ctx.template.requiredTables);

    const marketDataBlock = ctx.companyData.length > 0
        ? ctx.companyData.map(c =>
            `${c.name} (${c.symbol}): Sector=${c.sector} | Mkt Cap=$${(c.marketCap / 1e9).toFixed(1)}B | P/E=${c.peRatio} | 52wk Hi=$${c.fiftyTwoWeekHigh} / Lo=$${c.fiftyTwoWeekLow}`
        ).join('\n')
        : 'N/A';

    const secIndex = ctx.secFilings.length > 0
        ? ctx.secFilings.map((f, i) =>
            `[SEC-${i + 1}] ${f.company} ${f.filingType} (${f.filingDate})`
        ).join('\n')
        : 'N/A';

    const relevantCitations = ctx.relevantSources.length > 0
        ? ctx.relevantSources
            .map(s => {
                const n = ctx.citationMap.get(s.url);
                if (!n) return null;
                const tag = s.context ? `(${s.context}) ` : '';
                return `[${n}] ${tag}${s.title} — ${s.url}`;
            })
            .filter((x): x is string => x !== null)
            .join('\n')
        : 'None — rely on Tier 1 / Tier 3 evidence.';

    const adversarialBlock = isBullSection
        ? `\nPRE-GENERATED BULL CASE — WEAVE INTO THIS SECTION:\n${ctx.bullCase.substring(0, 1600)}\n`
        : isBearSection
            ? `\nPRE-GENERATED BEAR CASE — WEAVE INTO THIS SECTION:\n${ctx.bearCase.substring(0, 1600)}\n`
            : '';

    return `You are a Managing Director of Equity Research writing ONE SECTION of a Goldman Sachs flagship research note.

RESEARCH MANDATE
Type: ${ctx.blueprint.intent.replace(/_/g, ' ').toUpperCase()}
Universe: ${ctx.blueprint.targetEntities.join(', ') || 'Broad Market'}
Tickers: ${ctx.blueprint.tickers.join(', ') || 'N/A'}
Timeframe: ${ctx.blueprint.timeframe} | Horizon: ${ctx.blueprint.investmentHorizon}

YOU ARE WRITING JUST THIS ONE SECTION (${ctx.sectionIndex + 1} of ${ctx.totalSections}):
${ctx.section}
${table ? `\nREQUIRED: include a populated markdown table for "${table}" with ≥6 rows, real figures only, each cell cited.\n` : ''}
════════════════════════════════════════════
DATA HIERARCHY — FOCUSED ON THIS SECTION
════════════════════════════════════════════
TIER 1 — RAG verified facts (highest authority, use [RAG-n]):
${ctx.verifiedFactsBlock || '⚠ RAG database offline — rely on Tier 3/4 for this section'}

TIER 2 — Live market data:
${marketDataBlock}
${ctx.macroText ? `\nTIER 2b — Macro (FRED):\n${ctx.macroText}\n` : ''}
TIER 3 — SEC filings (authoritative):
${secIndex}

TIER 4 — Relevant web sources for this section (cite inline as [n]):
${ctx.ragCitationIndex ? ctx.ragCitationIndex + '\n' : ''}${relevantCitations}

ANALYST SYNTHESIS (excerpt):
${ctx.sourceAnalysisExcerpt.substring(0, 2500)}
${adversarialBlock}
════════════════════════════════════════════
OUTPUT CONTRACT — SECTION BODY ONLY
════════════════════════════════════════════
✗ Do NOT output "## ${ctx.section}" or any other header — the pipeline prepends the header.
✗ Do NOT output a report title, table of contents, or "Key Finding" quote.
✗ Do NOT recap other sections; stay tightly on THIS section's scope.

✓ 3–4 paragraphs, 400–800 words for this section.
✓ Every factual sentence ends with [n] or [RAG-n] citation tag — uncited claims are rejected by the downstream verifier.
✓ Only use citation IDs listed in TIER 4 above, or RAG-n IDs from TIER 1.
✓ If a claim cannot be cited from the provided evidence, OMIT it entirely.
✓ Specific beats vague: "$2.47B in free cash flow [3]" not "strong cash generation".
✓ **Fact vs inference — hedge forecasts.** Forward-looking claims (will, forecasts, projections, targets, guidance) need a hedging qualifier (~, est., likely, could, we estimate) or attribution (management guided, consensus expects, analysts forecast). Past/reported facts are stated plainly. Unhedged forecasts are flagged as speculation by the downstream verifier.
✓ Institutional tone, zero marketing language.
${table ? '✓ Populate the required table with real figures — no placeholder rows.\n' : ''}`;
}

export interface SectionFanoutResult {
    sections: Array<{ title: string; body: string; ok: boolean; error?: string }>;
    completed: number;
    failed: number;
}

async function synthesizeReportBySections(
    blueprint: ResearchBlueprint,
    webSources: TavilySearchResult[],
    secFilings: SECFiling[],
    companyData: CompanyOverview[],
    sourceAnalysis: string,
    bullCase: string,
    bearCase: string,
    template: ReportTemplate,
    model: ResearchModelId | undefined,
    ragResult: GravityRAGResult | undefined,
    macroText: string | undefined,
    onSectionDone?: (done: number, total: number, title: string) => void,
): Promise<SectionFanoutResult> {
    const synthesisModel = await pickDriver('premium', model);
    const top = webSources.slice(0, 35);
    const citationMap = new Map<string, number>();
    top.forEach((s, i) => citationMap.set(s.url, i + 1));

    const verifiedFactsBlock = ragResult ? buildVerifiedFactsBlock(ragResult) : '';
    const ragCitationIndex = ragResult?.available && ragResult.sources.length > 0
        ? `TIER-1 RAG CITATIONS:\n${ragResult.sources.slice(0, 10).map((s, i) =>
            `[RAG-${i + 1}] ${s.ticker ? s.ticker + ' ' : ''}${s.title}${s.section ? ' — ' + s.section : ''}`
          ).join('\n')}`
        : '';

    const extraKeywords = [
        ...blueprint.targetEntities,
        ...blueprint.tickers,
        ...blueprint.keyMetrics.slice(0, 4),
        ...blueprint.researchAngles.slice(0, 4),
    ];

    const results: SectionFanoutResult['sections'] = template.sections.map(s => ({
        title: s, body: '', ok: false,
    }));

    const queue = template.sections.map((s, i) => ({ s, i }));
    const CONCURRENCY = 3;
    let doneCount = 0;

    async function worker() {
        while (queue.length > 0) {
            const item = queue.shift();
            if (!item) return;
            const relevant = sliceEvidenceForSection(item.s, top, extraKeywords, 15);
            const prompt = buildSectionWriterPrompt({
                blueprint,
                template,
                section: item.s,
                sectionIndex: item.i,
                totalSections: template.sections.length,
                relevantSources: relevant,
                citationMap,
                verifiedFactsBlock,
                sourceAnalysisExcerpt: sourceAnalysis,
                companyData,
                secFilings,
                bullCase,
                bearCase,
                macroText,
                ragCitationIndex,
            });
            try {
                const body = await callLLM(prompt, synthesisModel);
                results[item.i] = { title: item.s, body: body.trim(), ok: true };
            } catch (e: any) {
                results[item.i] = {
                    title: item.s,
                    body: '',
                    ok: false,
                    error: (e?.message || String(e)).substring(0, 200),
                };
            }
            doneCount += 1;
            onSectionDone?.(doneCount, template.sections.length, item.s);
        }
    }

    const workerCount = Math.min(CONCURRENCY, template.sections.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return {
        sections: results,
        completed: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
    };
}

// Pick the first citation-bearing sentence from the lead section as the "Key
// Finding" — matches the monolith Writer's `> **Key Finding:**` block
// without spending another LLM call.
export function extractKeyFinding(firstSectionBody: string): string | null {
    if (!firstSectionBody) return null;
    const stripped = firstSectionBody
        .replace(/^#+\s.*$/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/\|[^\n]*\|/g, '')
        .replace(/`[^`]*`/g, '');
    const sentences = stripped
        .split(/(?<=[.!?])\s+(?=[A-Z(])|\n{2,}/)
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(s => s.length >= 40 && s.length <= 400);
    for (const s of sentences) {
        if (!/\[(?:RAG-)?\d+\]/.test(s)) continue;
        if (!CLAIM_TRIGGERS.test(s)) continue;
        return s.length > 380 ? s.slice(0, 377) + '…' : s;
    }
    return null;
}

export function assembleSectionedReport(
    blueprint: ResearchBlueprint,
    template: ReportTemplate,
    sections: SectionFanoutResult['sections'],
    webSources: TavilySearchResult[],
): string {
    const title = buildReportTitle(blueprint, template);
    const body = sections
        .filter(s => s.ok && s.body.trim().length > 0)
        .map(s => `## ${s.title}\n\n${s.body.trim()}`)
        .join('\n\n');

    const firstOk = sections.find(s => s.ok && s.body.trim().length > 0);
    const keyFinding = firstOk ? extractKeyFinding(firstOk.body) : null;
    const keyFindingBlock = keyFinding
        ? `\n\n---\n\n> **Key Finding:** ${keyFinding}\n`
        : '';

    const webSourcesFooter = webSources.length > 0
        ? `\n\n---\n\n### Web Sources\n\n${
            webSources.slice(0, 35)
                .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`)
                .join('\n')
          }`
        : '';

    return `# ${title}\n\n${body}${keyFindingBlock}${webSourcesFooter}`;
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
    // Cross-reference signal (deep-research skill rule): "if only one source
    // says it, flag it". multiSourceClaims are those found in ≥2 distinct
    // evidence items; singleSourceClaims are grounded but in one item only.
    multiSourceClaims: number;
    singleSourceClaims: string[];
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

// ─── Sentence-level claim extraction for LLM-judge ──────────────────────────
// A "claim sentence" is one that makes a quantitative or named assertion worth
// checking: contains a number, a dollar/percent/multiple, a named entity in
// quotes, or a tell-tale verb of attribution. We skip pure narrative sentences
// (headers, transitions) to keep the verifier budget tight.

const CLAIM_TRIGGERS = /(\$|%|bps|basis\s?points|million|billion|trillion|\d+(?:\.\d+)?\s?x\b|guidance|reported|announced|raised|cut|beat|missed|consensus|target\b|forecast|estimate)/i;

export function extractClaimSentences(markdown: string, limit = 40): string[] {
    // Strip markdown syntax that confuses sentence splitting.
    const stripped = markdown
        .replace(/^#+\s.*$/gm, '')           // headers
        .replace(/^\s*>\s?/gm, '')           // blockquotes
        .replace(/\|[^\n]*\|/g, '')          // table rows
        .replace(/\[\d+\]/g, '')             // citation markers
        .replace(/\[RAG-\d+\]/g, '')
        .replace(/\*+/g, '')                 // bold/italic marks
        .replace(/`[^`]*`/g, '');            // inline code

    // Split on sentence boundaries but keep decimals like $35.1B intact by
    // requiring the period to be followed by whitespace and a capital/newline.
    const sentences = stripped
        .split(/(?<=[.!?])\s+(?=[A-Z(])|\n{2,}/)
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(s => s.length >= 25 && s.length <= 400);

    const seen = new Set<string>();
    const claims: string[] = [];
    for (const s of sentences) {
        if (!CLAIM_TRIGGERS.test(s)) continue;
        const key = s.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (seen.has(key)) continue;
        seen.add(key);
        claims.push(s);
        if (claims.length >= limit) break;
    }
    return claims;
}

// ─── LLM-Judge Verifier (cheap NLI proxy) ───────────────────────────────────
// Batches claims into a single lite-tier LLM call. The judge returns a verdict
// per claim grounded in the evidence block we provide. Cheaper than a true NLI
// model (DeBERTa-v3-MNLI) and requires no extra infra — good enough to catch
// the 80% of hallucinations that slip past the numeric verifier.

export type ClaimStatus = 'supported' | 'partial' | 'unsupported';

export interface ClaimVerdict {
    claim: string;
    status: ClaimStatus;
    reason?: string;
}

export function buildClaimJudgePrompt(claims: string[], evidence: string): string {
    const numbered = claims.map((c, i) => `[${i + 1}] ${c}`).join('\n');
    return `You are a fact-checking auditor for an institutional research report. For each claim below, decide whether the evidence block supports it.

EVIDENCE (verbatim excerpts from source material):
${evidence.substring(0, 8000)}

CLAIMS TO AUDIT:
${numbered}

For each claim, return one verdict:
- "supported"   — the evidence clearly entails the claim (same figures / facts appear)
- "partial"     — the evidence is related but doesn't fully confirm (e.g., covers the topic but lacks the exact number)
- "unsupported" — the evidence does not contain the claim's key fact; treat as a hallucination risk

Return ONLY valid JSON (no markdown, no prose):
{"verdicts": [{"i": 1, "status": "supported|partial|unsupported", "reason": "<10 words"}, ...]}

Rules:
- Judge each claim independently.
- If the claim is qualitative/narrative and the evidence broadly covers the topic, mark "supported".
- Never invent evidence — if the claim asks about something absent from the evidence, mark "unsupported".`;
}

export function parseClaimVerdicts(
    llmText: string,
    claims: string[],
): ClaimVerdict[] {
    const match = llmText.match(/\{[\s\S]*\}/);
    if (!match) return [];
    let parsed: any;
    try { parsed = JSON.parse(match[0]); } catch { return []; }
    const raw = Array.isArray(parsed?.verdicts) ? parsed.verdicts : [];
    const out: ClaimVerdict[] = [];
    for (const v of raw) {
        const idx = Number(v?.i);
        if (!Number.isInteger(idx) || idx < 1 || idx > claims.length) continue;
        const status = (v?.status === 'supported' || v?.status === 'partial' || v?.status === 'unsupported')
            ? v.status as ClaimStatus
            : 'unsupported';
        out.push({
            claim: claims[idx - 1],
            status,
            reason: typeof v?.reason === 'string' ? v.reason.slice(0, 120) : undefined,
        });
    }
    return out;
}

export async function auditClaimsWithLLM(
    markdown: string,
    inputs: VerificationInputs,
    options: { maxClaims?: number; callLLM?: (prompt: string) => Promise<string> } = {},
): Promise<ClaimVerdict[]> {
    const claims = extractClaimSentences(markdown, options.maxClaims ?? 30);
    if (claims.length === 0) return [];

    const evidence = [
        inputs.knowledgeBase,
        inputs.sourceAnalysis,
        ...inputs.webSources.slice(0, 20).map(s => `${s.title}: ${s.content}`),
        ...(inputs.ragResult?.available ? inputs.ragResult.sources.slice(0, 10).map(s => s.text) : []),
    ].join('\n\n').slice(0, 8000);

    const prompt = buildClaimJudgePrompt(claims, evidence);
    const call = options.callLLM ?? ((p: string) => callDriver(p, 'lite'));

    try {
        const text = await call(prompt);
        return parseClaimVerdicts(text, claims);
    } catch {
        return [];   // verifier is best-effort — never block the report
    }
}

// ─── Citation-Density Verifier ──────────────────────────────────────────────
// Post-generation sweep that flags factual sentences missing an inline [n] /
// [RAG-n] tag. Paired with the tightened Writer prompt, this turns the plan's
// §6.2 "per-sentence inline citations enforced via prompt + post-gen verifier"
// into an actual metric we can report and gate on.
//
// Scope: only sentences whose *content after citations are stripped* matches
// CLAIM_TRIGGERS count as "factual." Pure narrative transitions are ignored.

const CITATION_TAG = /\[(?:RAG-)?\d+\]/;

export interface CitationDensityResult {
    totalFactSentences: number;
    citedSentences: number;
    density: number;
    uncitedSamples: string[];
}

export function verifyCitationDensity(markdown: string): CitationDensityResult {
    const stripped = markdown
        .replace(/^#+\s.*$/gm, '')        // headers
        .replace(/^\s*>\s?/gm, '')        // blockquotes
        .replace(/\|[^\n]*\|/g, '')       // table rows (cited in caption/footnote)
        .replace(/`[^`]*`/g, '')          // inline code
        .replace(/^\s*[-*]\s+/gm, '');    // list bullets, keep content

    const sentences = stripped
        .split(/(?<=[.!?])\s+(?=[A-Z(])|\n{2,}/)
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(s => s.length >= 20 && s.length <= 500);

    let total = 0;
    let cited = 0;
    const uncited: string[] = [];
    for (const s of sentences) {
        const withoutCites = s.replace(/\[(?:RAG-)?\d+\]/g, '').trim();
        if (!CLAIM_TRIGGERS.test(withoutCites)) continue;   // non-factual transition
        total += 1;
        if (CITATION_TAG.test(s)) {
            cited += 1;
        } else if (uncited.length < 10) {
            uncited.push(s.length > 180 ? s.slice(0, 177) + '…' : s);
        }
    }
    return {
        totalFactSentences: total,
        citedSentences: cited,
        density: total > 0 ? cited / total : 1,
        uncitedSamples: uncited,
    };
}

// ─── Fact vs Inference Separation ───────────────────────────────────────────
// Flags forward-looking sentences that present forecasts/projections as facts
// without a hedging qualifier or attribution. Plan §6.2: "every forecast
// clearly labeled as such — hedged or attributed — so readers can distinguish
// reported figures from analyst inference."
//
// Approach: a sentence containing a forward-looking trigger (will/expects/
// forecasts/projects/targets/guides/anticipates) must also contain a hedging
// marker (~, est., likely, could, we estimate, consensus expects, management
// guided, analysts forecast, etc.). Unhedged forward-looking sentences are
// "speculation risks" and downgrade the Confidence banner.

const FORWARD_LOOKING = /\b(will\s+\w+|expects?\b|expected\b|forecasts?\b|forecasted\b|projects?\b|projected\b|projections?\b|targets?\b|targeted\b|guides?\b|guided\b|guidance\b|anticipates?\b|anticipated\b|predicts?\b|predicted\b|foresees?\b|foreseeable\b)/i;

const HEDGE_MARKERS = /(~\s*\d|\bapprox(?:imately)?\b|\broughly\b|\best\.(?!\w)|\bestimated?\b|\bestimates?\b|\blikely\b|\bunlikely\b|\bprobable\b|\bprobably\b|\bpotentially\b|\bpotential\b|\bcould\b|\bmay\b|\bmight\b|\bshould\b|\bwe (?:expect|forecast|project|anticipate|estimate|believe|see|think)\w*\b|\bour (?:expectation|forecast|projection|estimate|view|model|base case)\b|\bconsensus\b|\banalysts?\b|\bmanagement (?:guided|expects|forecasts|projects|anticipates|sees|expects)\b|\baccording to\b|\bas per\b|\bbase case\b|\bbull case\b|\bbear case\b|\bscenario\b|\bassumes?\b|\bassumption\b|\bimplied\b|\bimplies\b)/i;

// Verbs that often LOOK forward-looking but are actually past/factual and
// should NOT trip the verifier: "the company reported it will pay a dividend"
// is attribution; past tense is factual.
const ATTRIBUTION_LEAD = /\b(reported|announced|disclosed|filed|stated|said|told|confirmed|noted|indicated|revealed|said\s+that|guided\s+(?:to|for))\b/i;

export interface FactInferenceResult {
    totalForwardLooking: number;
    hedgedCount: number;
    hedgingRate: number;                      // hedged / total, 1.0 if no forward-looking sentences
    unhedgedSamples: string[];
}

export function verifyFactInferenceSeparation(markdown: string): FactInferenceResult {
    const stripped = markdown
        .replace(/^#+\s.*$/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/\|[^\n]*\|/g, '')
        .replace(/`[^`]*`/g, '')
        .replace(/^\s*[-*]\s+/gm, '');

    const sentences = stripped
        .split(/(?<=[.!?])\s+(?=[A-Z(])|\n{2,}/)
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(s => s.length >= 20 && s.length <= 500);

    let total = 0;
    let hedged = 0;
    const unhedged: string[] = [];

    for (const s of sentences) {
        const withoutCites = s.replace(/\[(?:RAG-)?\d+\]/g, '').trim();
        if (!FORWARD_LOOKING.test(withoutCites)) continue;
        // "The company reported it will pay…" — attribution lead exempts the
        // sentence: the forward-looking claim is explicitly sourced.
        if (ATTRIBUTION_LEAD.test(withoutCites)) {
            total += 1;
            hedged += 1;
            continue;
        }
        total += 1;
        if (HEDGE_MARKERS.test(withoutCites)) {
            hedged += 1;
        } else if (unhedged.length < 20) {
            unhedged.push(s.length > 200 ? s.slice(0, 197) + '…' : s);
        }
    }

    return {
        totalForwardLooking: total,
        hedgedCount: hedged,
        hedgingRate: total > 0 ? hedged / total : 1,
        unhedgedSamples: unhedged,
    };
}

export function verifyNumericConsistency(
    markdown: string,
    inputs: VerificationInputs,
): VerificationResult {
    const claims = extractClaims(markdown);

    // Build evidence as a *list of distinct items* so we can cross-reference
    // each claim against multiple sources. Collapsing to a single concatenated
    // string (the prior approach) hides whether a claim appears in 1 vs. many
    // sources — which is exactly the multi-source signal the deep-research
    // skill calls out ("if only one source says it, flag it").
    const evidenceItems: string[] = [
        inputs.knowledgeBase,
        inputs.sourceAnalysis,
        ...inputs.webSources.map(s => `${s.title} ${s.content}`),
        ...(inputs.ragResult?.available ? inputs.ragResult.sources.map(s => s.text) : []),
        ...inputs.companyData.map(c =>
            `${c.marketCap} ${c.peRatio} ${c.fiftyTwoWeekHigh} ${c.fiftyTwoWeekLow}`
        ),
    ].filter(s => typeof s === 'string' && s.length > 0);

    const normalizedItems = evidenceItems.map(normalizeNumber);

    const unsupported: string[] = [];
    const singleSource: string[] = [];
    let grounded = 0;
    let multiSource = 0;

    for (const claim of claims) {
        const norm = normalizeNumber(claim);
        const numericCore = norm.replace(/[a-z%]/g, '');
        if (numericCore.length < 2) {
            grounded += 1;
            multiSource += 1;   // trivially short claims are treated as safe
            continue;
        }
        let hits = 0;
        for (const item of normalizedItems) {
            if (item.includes(numericCore)) {
                hits += 1;
                if (hits >= 2) break;   // short-circuit — we only need ≥2
            }
        }
        if (hits === 0) {
            unsupported.push(claim);
        } else if (hits === 1) {
            grounded += 1;
            singleSource.push(claim);
        } else {
            grounded += 1;
            multiSource += 1;
        }
    }

    return {
        totalClaims: claims.length,
        groundedClaims: grounded,
        multiSourceClaims: multiSource,
        singleSourceClaims: singleSource.slice(0, 30),
        unsupportedClaims: unsupported.slice(0, 50),
    };
}

// ─── Critic → Revisor Loop (plan §6.1 / §6.8) ──────────────────────────────
// Detect-then-fix stage. We already RUN the three verifiers (citation
// density, fact-inference, numeric grounding) but, until now, we only
// SURFACED the issues in the methodology footer. The Revisor takes the
// concrete issue samples each verifier produces and asks the LLM for
// surgical line-level edits: add a citation, hedge a forecast, remove an
// unsupported claim. Each edit is a {find, replace} pair that we apply only
// when `find` is unique in the draft — no full regeneration, no risk of
// rewriting unrelated sentences. After application we re-run the verifiers
// and accept the revision only if the aggregate issue count drops.

export interface RevisionEdit {
    find: string;       // exact substring to locate (must be unique in draft)
    replace: string;    // surgical replacement
    reason: 'add_citation' | 'hedge_forecast' | 'remove_unsupported' | 'other';
}

export interface RevisionResult {
    used: boolean;              // whether the Revisor ran (issues present AND draft big enough)
    issuesBefore: number;       // uncited + unhedged + unsupported count pre-revision
    issuesAfter: number;        // same count post-revision
    editsProposed: number;      // LLM returned this many edits
    editsApplied: number;       // edits that matched unique substrings and passed safety
    accepted: boolean;          // true if we actually kept the revised draft
    fallback: boolean;          // LLM threw / returned garbage → original kept
}

// Collect the ≤5 worst issues from each verifier. Revisor gets a focused
// worklist rather than the whole report.
export function selectRevisionTargets(
    verification: VerificationResult,
    citationDensity: CitationDensityResult,
    factInference: FactInferenceResult,
    maxPerCategory = 5,
): { uncited: string[]; unhedged: string[]; unsupported: string[]; total: number } {
    const uncited = citationDensity.uncitedSamples.slice(0, maxPerCategory);
    const unhedged = factInference.unhedgedSamples.slice(0, maxPerCategory);
    const unsupported = verification.unsupportedClaims.slice(0, maxPerCategory);
    return { uncited, unhedged, unsupported, total: uncited.length + unhedged.length + unsupported.length };
}

export function buildRevisionPrompt(
    markdown: string,
    targets: { uncited: string[]; unhedged: string[]; unsupported: string[] },
    maxEdits = 10,
): string {
    const sections = [
        targets.uncited.length > 0
            ? `UNCITED FACTUAL SENTENCES (need an inline [n] citation referencing an existing source id used elsewhere in the draft):\n${targets.uncited.map((s, i) => `  U${i + 1}. ${s}`).join('\n')}`
            : '',
        targets.unhedged.length > 0
            ? `UNHEDGED FORWARD-LOOKING CLAIMS (need a hedge such as "we expect", "likely", "could", "approximately", or attribution to a named analyst/management):\n${targets.unhedged.map((s, i) => `  H${i + 1}. ${s}`).join('\n')}`
            : '',
        targets.unsupported.length > 0
            ? `UNSUPPORTED NUMERIC CLAIMS (not found in any source — either remove the figure, attribute it to "internal estimate", or replace with a source-supported number):\n${targets.unsupported.map((c, i) => `  N${i + 1}. ${c}`).join('\n')}`
            : '',
    ].filter(Boolean).join('\n\n');

    return `You are the senior reviewer on an institutional research team. The junior analyst's draft has been flagged by three automated verifiers. Your job is to produce SURGICAL line-level edits — NOT a rewrite.

DRAFT:
${markdown}

ISSUES TO FIX:
${sections}

Rules:
1. Return AT MOST ${maxEdits} edits, ordered by severity (unsupported numerics first, then unhedged forecasts, then uncited sentences).
2. Each edit is a {find, replace} pair. \`find\` must be a verbatim substring of the draft (copy-paste exact). \`replace\` is the surgical fix — same meaning, typically within 50–150% of the original length.
3. For UNCITED sentences: append an appropriate [n] tag, reusing a source id that already appears elsewhere in the draft for a related claim. Never invent a new source id.
4. For UNHEDGED forecasts: add a hedge ("we expect", "likely", "~", "could") or attribute ("according to management/consensus/analysts") — do NOT change the substantive claim unless the claim itself is speculative.
5. For UNSUPPORTED numerics: EITHER remove the figure ("grew 12%" → "grew") OR qualify as internal estimate ("12% [internal estimate]").
6. Do NOT introduce new facts or new numbers.
7. Do NOT edit headings, tables, or the methodology footer.

Return ONLY a JSON array, no prose:
[
  {"find": "<verbatim substring>", "replace": "<fixed version>", "reason": "add_citation" | "hedge_forecast" | "remove_unsupported" | "other"},
  ...
]`;
}

export function parseRevisionEdits(raw: string): RevisionEdit[] {
    // Strip optional ```json fence
    const cleaned = raw
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(match[0]);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    const out: RevisionEdit[] = [];
    for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const e = item as Record<string, unknown>;
        const find = typeof e.find === 'string' ? e.find : '';
        const replace = typeof e.replace === 'string' ? e.replace : '';
        const reasonRaw = typeof e.reason === 'string' ? e.reason : 'other';
        const reason: RevisionEdit['reason'] =
            reasonRaw === 'add_citation' || reasonRaw === 'hedge_forecast' || reasonRaw === 'remove_unsupported'
                ? reasonRaw
                : 'other';
        if (find.length < 10) continue;          // too short → ambiguous match risk
        if (!replace || replace.length === 0) continue;
        out.push({ find, replace, reason });
    }
    return out;
}

// Apply edits sequentially, in order. Safety rules per edit:
//   1. `find` must occur EXACTLY ONCE in the current draft (ambiguous → skip)
//   2. `replace.length` within [0.4 × find.length, 2.5 × find.length] (bloat/deletion guard)
//   3. Citations (ids) in `replace` must not introduce brand-new ids — must exist in draft
//   4. Any edit inside the methodology footer (`## Methodology & Confidence` onward) is rejected
export function applyRevisionEdits(
    markdown: string,
    edits: RevisionEdit[],
): { markdown: string; applied: number } {
    let out = markdown;
    let applied = 0;

    // Existing citation ids — collected once from the pre-revision draft so
    // added-via-edit ids don't silently become "valid" for later edits.
    const existingIds = new Set<string>();
    for (const m of markdown.matchAll(/\[((?:RAG-)?\d+)\]/g)) existingIds.add(m[1]);

    for (const e of edits) {
        if (!e.find || !e.replace) continue;

        // Recompute the methodology boundary each iteration — prior edits may
        // have shifted offsets if they grew or shrank the draft.
        const methodologyStart = out.search(/^##\s+Methodology\s*&\s*Confidence/m);
        const editableEnd = methodologyStart >= 0 ? methodologyStart : out.length;

        // Occurrence count within the editable region only.
        const editable = out.slice(0, editableEnd);
        const first = editable.indexOf(e.find);
        if (first === -1) continue;
        const second = editable.indexOf(e.find, first + 1);
        if (second !== -1) continue;   // ambiguous — multiple matches, skip

        // Length guard: surgical edits should be within 0.4× – 2.5× of the source span.
        const ratio = e.replace.length / Math.max(1, e.find.length);
        if (ratio < 0.4 || ratio > 2.5) continue;

        // Veto invented citation ids — only ids already present in the draft are allowed.
        const newIds = Array.from(e.replace.matchAll(/\[((?:RAG-)?\d+)\]/g)).map(m => m[1]);
        if (newIds.some(id => !existingIds.has(id))) continue;

        out = out.slice(0, first) + e.replace + out.slice(first + e.find.length);
        applied += 1;
    }

    return { markdown: out, applied };
}

export interface RevisionInputs {
    markdown: string;
    verification: VerificationResult;
    citationDensity: CitationDensityResult;
    factInference: FactInferenceResult;
}

export async function reviseReport(
    inputs: RevisionInputs,
    options: {
        model?: ResearchModelId;
        callLLM?: (prompt: string) => Promise<string>;
        tracker?: BudgetTracker | null;
        maxEdits?: number;
    } = {},
): Promise<{ markdown: string; stats: RevisionResult }> {
    const targets = selectRevisionTargets(
        inputs.verification, inputs.citationDensity, inputs.factInference,
    );
    const issuesBefore = targets.total;

    // No issues → skip entirely.
    if (issuesBefore === 0) {
        return {
            markdown: inputs.markdown,
            stats: {
                used: false, issuesBefore: 0, issuesAfter: 0,
                editsProposed: 0, editsApplied: 0, accepted: false, fallback: false,
            },
        };
    }

    // Budget guard — skip if next LLM call would blow the cap.
    const tracker = options.tracker ?? _activeBudget;
    if (tracker && tracker.llmCalls >= tracker.budget.maxLLMCalls) {
        return {
            markdown: inputs.markdown,
            stats: {
                used: false, issuesBefore, issuesAfter: issuesBefore,
                editsProposed: 0, editsApplied: 0, accepted: false, fallback: false,
            },
        };
    }

    const maxEdits = options.maxEdits ?? 10;
    const prompt = buildRevisionPrompt(inputs.markdown, targets, maxEdits);
    const call = options.callLLM ?? ((p: string) => callDriver(p, 'standard', options.model));

    let raw = '';
    try {
        raw = await call(prompt);
    } catch {
        return {
            markdown: inputs.markdown,
            stats: {
                used: true, issuesBefore, issuesAfter: issuesBefore,
                editsProposed: 0, editsApplied: 0, accepted: false, fallback: true,
            },
        };
    }

    const edits = parseRevisionEdits(raw);
    if (edits.length === 0) {
        return {
            markdown: inputs.markdown,
            stats: {
                used: true, issuesBefore, issuesAfter: issuesBefore,
                editsProposed: 0, editsApplied: 0, accepted: false, fallback: false,
            },
        };
    }

    const { markdown: revised, applied } = applyRevisionEdits(inputs.markdown, edits.slice(0, maxEdits));

    // Re-run the three deterministic verifiers on the revised draft.
    const revCitation = verifyCitationDensity(revised);
    const revFactInf = verifyFactInferenceSeparation(revised);
    // Numeric consistency is the expensive one — we already have the evidence
    // bundle via inputs.verification; re-verify against the same evidence by
    // re-extracting claims from the revised draft and comparing to the
    // existing `groundedClaims`/`unsupportedClaims` split is out of scope
    // here. We conservatively assume unsupported count didn't increase (the
    // Revisor only edits flagged spans; it can't add new unsupported figures
    // given the "do not introduce new facts" rule — untrusted LLM output is
    // guarded by the length + citation-id checks in applyRevisionEdits).
    const issuesAfter =
        revCitation.uncitedSamples.length
        + revFactInf.unhedgedSamples.length
        + inputs.verification.unsupportedClaims.length;

    // Accept revision only if issue count strictly drops. Tie or increase →
    // keep the original (no risk of silently making the report worse).
    const accepted = applied > 0 && issuesAfter < issuesBefore;

    return {
        markdown: accepted ? revised : inputs.markdown,
        stats: {
            used: true,
            issuesBefore,
            issuesAfter: accepted ? issuesAfter : issuesBefore,
            editsProposed: edits.length,
            editsApplied: applied,
            accepted,
            fallback: false,
        },
    };
}

// ─── Confidence Derivation ──────────────────────────────────────────────────
// Maps three grounding signals — numeric-grounding rate, cross-reference
// rate, citation-density — onto a High/Medium/Low banner. Thresholds match
// the deep-research skill's rules ("every claim needs a source; flag single-
// source data") and our own §10.5 production-grounding discipline.

export type Confidence = 'High' | 'Medium' | 'Low';

export interface ConfidenceInputs {
    numericGroundingRate: number;     // grounded / total, 0..1
    multiSourceRate: number;          // multiSource / grounded, 0..1
    citationDensity: number;          // cited / factSentences, 0..1
    totalClaims: number;              // for sanity — <5 claims → downgrade
    factInferenceRate?: number;       // hedged forecasts / total forecasts, 0..1 (optional)
}

export function deriveConfidence(i: ConfidenceInputs): Confidence {
    // Too few claims to trust the other signals — report as Medium at best.
    const lowSignal = i.totalClaims < 5;
    // If factInferenceRate isn't provided, assume the report has no unhedged
    // forecasts (backwards-compat for callers that pre-date this signal).
    const fi = typeof i.factInferenceRate === 'number' ? i.factInferenceRate : 1;
    const high = !lowSignal
        && i.numericGroundingRate >= 0.85
        && i.citationDensity      >= 0.85
        && i.multiSourceRate      >= 0.60
        && fi                     >= 0.75;
    const medium = i.numericGroundingRate >= 0.65
        && i.citationDensity      >= 0.65
        && fi                     >= 0.50;
    if (high)   return 'High';
    if (medium) return 'Medium';
    return 'Low';
}

// ─── Methodology Section Builder ────────────────────────────────────────────
// Appended to the Writer's markdown output so PDF/CSV/XLSX exports carry
// reproducibility metadata (rounds, queries, source breakdown, confidence).
// Keeps the LLM output uncontaminated — the section is always appended,
// never asked-for mid-generation.

export interface MethodologyInputs {
    searchQueries: number;
    rounds: number;
    webSources: number;
    secFilings: number;
    ragSources: number;
    subQuestions: string[];
    verification: VerificationResult;
    citationDensity: CitationDensityResult;
    confidence: Confidence;
    sectionFanout?: { used: boolean; planned: number; completed: number; failed: number };
    factInference?: FactInferenceResult;
    contextualRetrieval?: ContextualRetrievalResult;
    distillation?: DistillationResult;
    revisions?: RevisionResult;
    injectionDefense?: InjectionDefenseStats;
    readers?: ReaderStats;
    recency?: RecencyDistribution;
    workflow?: { id: WorkflowId; label: string; template: TemplateKey; anglesInjected: number; metricsInjected: number };
    hitl?: { used: boolean; modified: boolean };
}

// ─── Recency distribution helper ──────────────────────────────────────────
// Count web sources by freshness bucket. Used for the methodology bullet,
// the UI badge, and downstream pass/fail thresholds on freshness-sensitive
// queries (earnings previews should skew "fresh"; company primers can
// tolerate "recent").

export interface RecencyDistribution {
    total: number;
    fresh: number;
    recent: number;
    stale: number;
    archival: number;
    undated: number;
}

export function summarizeRecency(
    sources: TavilySearchResult[],
    nowMs: number = Date.now(),
): RecencyDistribution {
    const out: RecencyDistribution = {
        total: sources.length,
        fresh: 0, recent: 0, stale: 0, archival: 0, undated: 0,
    };
    for (const s of sources) {
        const bucket: RecencyBucket = classifyRecency(s.publishedDate, nowMs);
        out[bucket] += 1;
    }
    return out;
}

// ─── Limitations & Unknowns (plan §10.3 — epistemic honesty) ──────────────
// Institutional research reports ALWAYS end with an explicit "here's what
// we couldn't verify" section. Commercial peers (Perplexity, ChatGPT) just
// stop when they hit unknowns — which looks decisive but quietly hides
// shaky claims. Real analyst memos list:
//   • research angles where the retrieval produced no strong citation
//   • numeric claims that the verifier could not ground
//   • forward-looking statements that slipped through without hedging
//   • signals of retrieval weakness (fallback rounds, stale sources)
//
// All of this data is already computed by the existing verifiers, so the
// Limitations section is a PURE deterministic render — no new LLM call.

export interface LimitationsInputs {
    markdown: string;                         // to detect unreferenced angles
    blueprint: Pick<ResearchBlueprint, 'researchAngles' | 'subtopics'>;
    verification: VerificationResult;
    factInference?: FactInferenceResult;
    readers?: ReaderStats;
    recency?: RecencyDistribution;
    confidence: Confidence;
}

export interface LimitationsResult {
    section: string;        // rendered markdown block, or '' if no limitations
    count: number;          // total distinct limitation items surfaced
    topics: string[];       // short labels for each limitation (for metadata badge)
}

// An angle is "under-explored" when no meaningful keyword from it appears
// in the final report body. Heuristic only — keywords >4 chars, at least
// ONE must appear in the markdown for the angle to count as covered.
function findUnderexploredAngles(angles: string[], markdown: string): string[] {
    if (!angles.length) return [];
    const body = markdown.toLowerCase();
    const out: string[] = [];
    for (const a of angles) {
        const keywords = a
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(w => w.length >= 5);
        if (keywords.length === 0) continue;
        const anyHit = keywords.some(k => body.includes(k));
        if (!anyHit) out.push(a);
    }
    return out;
}

export function buildLimitationsSection(inp: LimitationsInputs): LimitationsResult {
    const parts: string[] = [];
    const topics: string[] = [];
    let count = 0;

    // ── 1. Under-explored research angles ──────────────────────────────
    const angles = [...(inp.blueprint.researchAngles || []), ...(inp.blueprint.subtopics || [])];
    const underexplored = findUnderexploredAngles(angles, inp.markdown);
    if (underexplored.length > 0) {
        parts.push(`**Under-explored angles (${underexplored.length})** — planned research angles that did not surface meaningful citations in the final report:\n${underexplored.slice(0, 6).map(a => `- ${a}`).join('\n')}`);
        topics.push(`${underexplored.length} under-explored angle${underexplored.length === 1 ? '' : 's'}`);
        count += underexplored.length;
    }

    // ── 2. Unsupported numeric claims ──────────────────────────────────
    const unsupported = inp.verification.unsupportedClaims ?? [];
    if (unsupported.length > 0) {
        parts.push(`**Unsupported numeric claims (${unsupported.length})** — numbers present in the report that the source-matching verifier could not ground. Treat as analyst inference, not verified fact:\n${unsupported.slice(0, 6).map(c => `- ${c.length > 140 ? c.slice(0, 137) + '…' : c}`).join('\n')}`);
        topics.push(`${unsupported.length} unsupported claim${unsupported.length === 1 ? '' : 's'}`);
        count += unsupported.length;
    }

    // ── 3. Unhedged forecasts ──────────────────────────────────────────
    const unhedged = inp.factInference?.unhedgedSamples ?? [];
    if (unhedged.length > 0) {
        parts.push(`**Unhedged forecasts (${unhedged.length})** — forward-looking statements presented without a hedge or attribution. The Revisor may have fixed most; anything below remained after surgical edits:\n${unhedged.slice(0, 4).map(s => `- ${s}`).join('\n')}`);
        topics.push(`${unhedged.length} unhedged forecast${unhedged.length === 1 ? '' : 's'}`);
        count += unhedged.length;
    }

    // ── 4. Retrieval weakness signals ──────────────────────────────────
    const retrievalSignals: string[] = [];
    if (inp.readers && inp.readers.fallbackRounds > 0) {
        retrievalSignals.push(`${inp.readers.fallbackRounds} search round${inp.readers.fallbackRounds === 1 ? '' : 's'} fell back to monolithic extraction — parallel Readers degraded, evidence from those rounds is less finely attributed`);
    }
    if (inp.readers && inp.readers.totalReaders > 0) {
        const failRate = inp.readers.failed / inp.readers.totalReaders;
        if (failRate >= 0.25) {
            retrievalSignals.push(`${inp.readers.failed}/${inp.readers.totalReaders} per-source Readers failed (${Math.round(failRate * 100)}%) — some source content was not cleanly extracted`);
        }
    }
    if (inp.recency && inp.recency.total > 0) {
        const staleOrOlder = inp.recency.stale + inp.recency.archival + inp.recency.undated;
        const oldRate = staleOrOlder / inp.recency.total;
        if (oldRate >= 0.4) {
            retrievalSignals.push(`${staleOrOlder}/${inp.recency.total} web sources are stale (>1y), archival (>3y), or undated (${Math.round(oldRate * 100)}%) — market/consensus may have shifted since publication`);
        }
    }
    if (retrievalSignals.length > 0) {
        parts.push(`**Retrieval weakness signals** — caveats on the source set itself:\n${retrievalSignals.map(s => `- ${s}`).join('\n')}`);
        topics.push(`${retrievalSignals.length} retrieval signal${retrievalSignals.length === 1 ? '' : 's'}`);
        count += retrievalSignals.length;
    }

    if (parts.length === 0) return { section: '', count: 0, topics: [] };

    // ── Confidence calibration footer ──────────────────────────────────
    const calibration = inp.confidence === 'High'
        ? 'Despite the limitations above, primary grounding signals cleared the High-confidence threshold. The report is suitable as a citation-grounded first draft.'
        : inp.confidence === 'Medium'
            ? 'With the limitations above, the report is at Medium confidence — re-verify the flagged claims and under-explored angles before any publication or investment decision.'
            : 'With the limitations above, the report is at Low confidence — treat as a research starting point, not a deliverable. Primary-source verification is required on all flagged items.';

    const section = `

---

## Limitations & Unknowns

${parts.join('\n\n')}

${calibration}`;

    return { section, count, topics };
}

export function buildMethodologySection(m: MethodologyInputs): string {
    const v = m.verification;
    const d = m.citationDensity;
    const numericRate = v.totalClaims > 0 ? Math.round((v.groundedClaims / v.totalClaims) * 100) : 100;
    const multiRate = v.groundedClaims > 0 ? Math.round((v.multiSourceClaims / v.groundedClaims) * 100) : 100;
    const densityPct = d.totalFactSentences > 0 ? Math.round(d.density * 100) : 100;

    const bullets = [
        `**Search:** ${m.searchQueries} queries dispatched across ${m.rounds} adaptive round${m.rounds === 1 ? '' : 's'}`,
        `**Sources analyzed:** ${m.webSources} web · ${m.secFilings} SEC filings · ${m.ragSources} RAG passages`,
        `**Sub-questions:** ${m.subQuestions.length} research angle${m.subQuestions.length === 1 ? '' : 's'} investigated`,
        `**Grounding:** ${v.groundedClaims}/${v.totalClaims} numeric claims matched source evidence (${numericRate}%); ${v.multiSourceClaims} corroborated by ≥2 sources (${multiRate}%)`,
        `**Citation density:** ${d.citedSentences}/${d.totalFactSentences} factual sentences cited (${densityPct}%)`,
    ];
    if (m.sectionFanout) {
        const f = m.sectionFanout;
        bullets.push(
            f.used
                ? `**Synthesis:** parallel section fanout — ${f.completed}/${f.planned} sections written concurrently${f.failed > 0 ? ` (${f.failed} retried via monolith)` : ''}`
                : `**Synthesis:** monolith Writer (section fanout skipped — budget-constrained or fallback triggered)`,
        );
    }
    if (m.factInference && m.factInference.totalForwardLooking > 0) {
        const fi = m.factInference;
        const fiPct = Math.round(fi.hedgingRate * 100);
        bullets.push(
            `**Fact vs inference:** ${fi.hedgedCount}/${fi.totalForwardLooking} forward-looking claims hedged or attributed (${fiPct}%)`,
        );
    }
    if (m.contextualRetrieval && m.contextualRetrieval.used && m.contextualRetrieval.total > 0) {
        const cr = m.contextualRetrieval;
        const cacheTail = cr.cacheHits > 0 ? `, ${cr.cacheHits} from cache` : '';
        const detTail = cr.deterministicBatches > 0 ? `, ${cr.deterministicBatches} deterministic fallback` : '';
        bullets.push(
            `**Contextual Retrieval:** ${cr.enriched}/${cr.total} sources tagged (${cr.llmBatches} LLM batch${cr.llmBatches === 1 ? '' : 'es'}${cacheTail}${detTail})`,
        );
    }
    if (m.distillation && m.distillation.used && !m.distillation.fallback) {
        const dd = m.distillation;
        const savedPct = Math.round((1 - dd.compressionRatio) * 100);
        bullets.push(
            `**Context distillation:** knowledge base compressed ${dd.inputChars.toLocaleString()} → ${dd.outputChars.toLocaleString()} chars (${savedPct}% saved), preserving numeric facts and named quotes`,
        );
    }
    if (m.revisions && m.revisions.used && m.revisions.accepted) {
        const rv = m.revisions;
        bullets.push(
            `**Self-revision:** senior reviewer applied ${rv.editsApplied} surgical edit${rv.editsApplied === 1 ? '' : 's'} — flagged issues reduced from ${rv.issuesBefore} to ${rv.issuesAfter}`,
        );
    } else if (m.revisions && m.revisions.used && !m.revisions.accepted && m.revisions.issuesBefore > 0 && !m.revisions.fallback) {
        bullets.push(
            `**Self-revision:** reviewer examined ${m.revisions.issuesBefore} flagged issue${m.revisions.issuesBefore === 1 ? '' : 's'} but produced no accepted surgical edits — original draft retained`,
        );
    }
    if (m.workflow) {
        const w = m.workflow;
        const parts: string[] = [];
        if (w.anglesInjected > 0) parts.push(`${w.anglesInjected} preset angle${w.anglesInjected === 1 ? '' : 's'} added`);
        if (w.metricsInjected > 0) parts.push(`${w.metricsInjected} preset metric${w.metricsInjected === 1 ? '' : 's'} added`);
        const tail = parts.length > 0 ? ` — ${parts.join(', ')}` : ' — all preset angles/metrics already inferred by the Chief Analyst';
        bullets.push(`**Workflow:** ${w.label} (pinned template: ${w.template})${tail}`);
    }
    if (m.recency && m.recency.total > 0) {
        const rc = m.recency;
        const parts: string[] = [];
        if (rc.fresh > 0) parts.push(`${rc.fresh} fresh (≤90d)`);
        if (rc.recent > 0) parts.push(`${rc.recent} recent (≤1y)`);
        if (rc.stale > 0) parts.push(`${rc.stale} stale (1–3y)`);
        if (rc.archival > 0) parts.push(`${rc.archival} archival (>3y)`);
        if (rc.undated > 0) parts.push(`${rc.undated} undated`);
        bullets.push(`**Source recency:** ${rc.total} web source${rc.total === 1 ? '' : 's'} — ${parts.join(' · ')}`);
    }
    if (m.readers && m.readers.totalReaders > 0) {
        const rd = m.readers;
        const parts: string[] = [`${rd.succeeded}/${rd.totalReaders} per-source Readers succeeded`];
        if (rd.cacheHits > 0) parts.push(`${rd.cacheHits} from cache`);
        if (rd.noRelevantFacts > 0) parts.push(`${rd.noRelevantFacts} returned "no relevant facts"`);
        if (rd.failed > 0) parts.push(`${rd.failed} failed`);
        if (rd.fallbackRounds > 0) parts.push(`${rd.fallbackRounds} round${rd.fallbackRounds === 1 ? '' : 's'} fell back to monolithic extractor`);
        bullets.push(`**Reader/Extractor:** ${parts.join(' · ')}`);
    }
    if (m.injectionDefense && m.injectionDefense.scanned > 0 && m.injectionDefense.flagged > 0) {
        const ij = m.injectionDefense;
        const topPatterns = Object.entries(ij.patternHits)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([k, v]) => `${k}×${v}`)
            .join(', ');
        bullets.push(
            `**Prompt-injection defense:** ${ij.flagged} of ${ij.scanned} untrusted snippet${ij.scanned === 1 ? '' : 's'} contained injection-attempt patterns — redacted before reaching any LLM (${topPatterns})`,
        );
    }
    if (m.hitl && m.hitl.used) {
        bullets.push(
            m.hitl.modified
                ? `**Plan review:** human-in-the-loop enabled — analyst edited the research blueprint before retrieval`
                : `**Plan review:** human-in-the-loop enabled — analyst accepted the auto-generated blueprint as-is`,
        );
    }

    const caveat = m.confidence === 'High'
        ? 'All three grounding signals cleared the High threshold. Report is suitable as a citation-grounded first draft; an analyst review is still recommended before investment-committee distribution.'
        : m.confidence === 'Medium'
            ? 'Numeric grounding and citation density cleared the Medium threshold but one signal is below the High bar. Re-verify single-source figures and any uncited factual sentences before publication.'
            : 'One or more grounding signals fell below acceptable thresholds. Treat this report as a research starting point, not a publication-ready deliverable. Primary-source verification is required before distribution.';

    return `

---

## Methodology & Confidence

**Confidence: ${m.confidence}**

${bullets.map(b => '- ' + b).join('\n')}

${caveat}`;
}

// ─── Main Export: performDeepResearch ────────────────────────────────────────

export const performDeepResearch = async (
    query: string,
    onProgress: (progress: ResearchProgress) => void,
    model?: ResearchModelId,
    budget: ResearchBudget = DEFAULT_BUDGET,
    signal?: AbortSignal,
    onBlueprintReady?: BlueprintReviewCallback,
    workflow?: WorkflowId,
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
    // Per-query injection-defense counter: web snippets sanitized during this
    // run accumulate here so the final report can surface defense activity.
    const injectionStats = newInjectionStats();
    _activeInjectionStats = injectionStats;
    // Per-query Reader/Extractor telemetry (plan §6.1). iterativeSearch reads
    // this to attribute per-round Reader success/failure/cache/fallback.
    const readerStats = newReaderStats();
    _activeReaderStats = readerStats;
    throwIfAborted(signal);

    const driverModel = await pickDriver('premium', model);

    // ── Stage 1: Blueprint (0–10%) ─────────────────────────────────────────
    onProgress({ stage: 'planning', message: 'Chief Analyst building research blueprint…', progress: 3 });

    let blueprint = await buildResearchBlueprint(query, driverModel, workflow);

    // Apply workflow preset — prepend guaranteed angles + metrics and record
    // how many fresh ones were injected vs already present in the Chief
    // Analyst's draft. Template is pinned later (after selectTemplate).
    let workflowStats: { id: WorkflowId; label: string; template: TemplateKey; anglesInjected: number; metricsInjected: number } | null = null;
    if (workflow) {
        const applied = applyWorkflowToBlueprint(blueprint, workflow);
        blueprint = applied.blueprint;
        workflowStats = {
            id: workflow,
            label: WORKFLOW_PRESETS[workflow].label,
            template: WORKFLOW_PRESETS[workflow].template,
            anglesInjected: applied.anglesInjected,
            metricsInjected: applied.metricsInjected,
        };
    }

    // ── Stage 1b: Human-in-the-loop plan approval (optional) ──────────────
    // Plan §6.1 P0: before firing 12+ web queries + SEC targets, offer the
    // analyst a chance to edit the blueprint (Gemini-DR pattern). Skipped
    // silently when no callback is wired, so existing callers stay on the
    // auto-path.
    const hitl = { used: false, modified: false, cancelled: false };
    if (onBlueprintReady) {
        hitl.used = true;
        onProgress({
            stage: 'planning',
            message: 'Plan ready — awaiting analyst review…',
            progress: 6,
        });
        const review = await onBlueprintReady(blueprint);
        if (review === null) {
            hitl.cancelled = true;
            throw new ResearchCancelledError('Research cancelled at plan review');
        }
        if (review) {
            // Shallow JSON comparison is sufficient — blueprint is plain data.
            hitl.modified = JSON.stringify(review) !== JSON.stringify(blueprint);
            blueprint = review;
        }
    }

    onProgress({
        stage: 'planning',
        message: hitl.modified
            ? `Blueprint (edited): ${blueprint.intent.replace(/_/g, ' ')} · ${blueprint.targetEntities.length} entities · ${blueprint.searchQueries.length} queries`
            : `Blueprint: ${blueprint.intent.replace(/_/g, ' ')} · ${blueprint.targetEntities.length} entities · ${blueprint.searchQueries.length} queries`,
        progress: 10,
    });

    throwIfAborted(signal);

    // ── Stage 2: Iterative Search + Parallel Data (10–45%) ───────────────
    // Fire all data sources in parallel: web search, RAG, SEC, market data, FRED macro
    let [
        { sources: webSources, knowledgeBase, roundsRun, distillation },
        ragResult,
        macroText,
        ...secAndCompanyArrays
    ] = await Promise.all([
        // Iterative adaptive web search (up to 4 rounds)
        iterativeSearch(blueprint, query, driverModel, onProgress, 4),

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
    ]) as [{ sources: TavilySearchResult[]; knowledgeBase: string; roundsRun: number; distillation: DistillationResult }, GravityRAGResult, string, ...(SECFiling[] | CompanyOverview | null)[]];

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

    // ── Stage 2b: Contextual Retrieval (45–48%) ───────────────────────────
    // Before sources flow into Tier-4 evidence blocks or the analyst
    // synthesis, tag each one with a 40–80 token self-describing context
    // (source type, entity, recency, relevance). Plan §10.1 — highest-ROI
    // single retrieval intervention. Budget-aware: falls back to
    // deterministic URL-based inference if the LLM cap would be exceeded.
    onProgress({
        stage: 'analyzing',
        message: 'Contextualizing sources for retrieval…',
        progress: 46,
        sourcesFound: totalSources,
    });
    throwIfAborted(signal);
    const { enriched: enrichedWebSources, stats: contextualRetrieval } =
        await contextualizeSources(webSources, query, blueprint, { model: driverModel });
    webSources = enrichedWebSources;

    // ── Stage 3: Source Intelligence (48–65%) ─────────────────────────────
    onProgress({
        stage: 'analyzing',
        message: `Analyst team extracting intelligence · ${contextualRetrieval.enriched}/${contextualRetrieval.total} sources tagged`,
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
    // expand each template section with retrieved data. Fanout mode runs one
    // LLM call per section in parallel (plan §6.1 P0); falls back to the
    // monolith Writer if budget is tight or too many sections fail.
    // Workflow (when set) pins the template — skips intent-based selection
    // so e.g. "SWOT Analysis" always produces an investment_memo regardless
    // of whether the blueprint inferred the intent as company_analysis or
    // thematic.
    const templateKey: TemplateKey = workflow
        ? WORKFLOW_PRESETS[workflow].template
        : selectTemplate(blueprint.intent, query);
    const template = REPORT_TEMPLATES[templateKey];

    const sectionCount = template.sections.length;
    const remainingLLMCalls = tracker.budget.maxLLMCalls - tracker.llmCalls;
    // Reserve a few calls for the post-gen claim audit and any stragglers.
    const RESERVE = 3;
    const canFanout = sectionCount > 0 && remainingLLMCalls >= sectionCount + RESERVE;

    let markdown: string;
    let sectionFanout: { used: boolean; planned: number; completed: number; failed: number } = {
        used: false,
        planned: sectionCount,
        completed: 0,
        failed: 0,
    };

    if (canFanout) {
        onProgress({
            stage: 'synthesizing',
            message: `Fanning out to ${sectionCount} parallel section writers…`,
            progress: 77,
            sourcesFound: totalSources,
        });
        try {
            const fan = await synthesizeReportBySections(
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
                (done, total, title) => {
                    onProgress({
                        stage: 'synthesizing',
                        message: `Section ${done}/${total} drafted — ${title}`,
                        progress: 77 + Math.round((done / total) * 15),
                        sourcesFound: totalSources,
                    });
                },
            );
            // Accept the fanout if ≥60% of sections came back. Below that,
            // fall back to the monolith so we don't ship a gutted report.
            const threshold = Math.ceil(sectionCount * 0.6);
            if (fan.completed >= threshold) {
                markdown = assembleSectionedReport(blueprint, template, fan.sections, webSources);
                sectionFanout = {
                    used: true,
                    planned: sectionCount,
                    completed: fan.completed,
                    failed: fan.failed,
                };
            } else {
                throw new Error(
                    `Fanout too incomplete (${fan.completed}/${sectionCount}) — falling back to monolith Writer`,
                );
            }
        } catch (e) {
            console.warn('Section fanout failed, falling back to monolith:', e);
            markdown = await synthesizeInstitutionalReport(
                blueprint, webSources, secFilings, companyData, sourceAnalysis,
                bullCase, bearCase, template, driverModel, ragResult, macroText,
            );
        }
    } else {
        markdown = await synthesizeInstitutionalReport(
            blueprint, webSources, secFilings, companyData, sourceAnalysis,
            bullCase, bearCase, template, driverModel, ragResult, macroText,
        );
    }

    // ── Stage 6: Numeric-Consistency Verifier (96–100%) ───────────────────
    onProgress({
        stage: 'synthesizing',
        message: 'Verifying numeric claims against source evidence…',
        progress: 97,
        sourcesFound: totalSources,
    });

    let verification = verifyNumericConsistency(markdown, {
        webSources,
        ragResult,
        companyData,
        knowledgeBase,
        sourceAnalysis,
    });

    // Web-source recency distribution — counted once over the final
    // webSources set so staleness is visible in the methodology footer.
    const recency = summarizeRecency(webSources);

    // Deterministic citation-density sweep — flags factual sentences missing
    // an inline [n]/[RAG-n] tag. Cheap (no LLM), so always run.
    let citationDensity = verifyCitationDensity(markdown);

    // Fact vs inference sweep — flags unhedged forward-looking sentences.
    // Forecasts must be hedged or attributed; unhedged predictions downgrade
    // the Confidence banner.
    let factInference = verifyFactInferenceSeparation(markdown);

    // ── Stage 6b: Revisor (self-critique + surgical edits) ────────────────
    // Plan §6.1/§6.8: once the three verifiers have flagged concrete issues,
    // ask the senior-reviewer LLM for line-level fixes (add citation, hedge
    // forecast, drop unsupported figure). Each edit is a {find, replace}
    // pair applied only when `find` is unique in the draft. Accepted only
    // if aggregate issue count strictly drops.
    onProgress({
        stage: 'synthesizing',
        message: 'Senior reviewer applying surgical edits…',
        progress: 98,
        sourcesFound: totalSources,
    });
    const revisionOutcome = await reviseReport(
        { markdown, verification, citationDensity, factInference },
        { model: driverModel },
    );
    const revisions = revisionOutcome.stats;
    if (revisions.accepted) {
        markdown = revisionOutcome.markdown;
        // Re-run verifiers on the revised draft so the Confidence banner and
        // methodology reflect the fixes, not the pre-revision state.
        verification = verifyNumericConsistency(markdown, {
            webSources, ragResult, companyData, knowledgeBase, sourceAnalysis,
        });
        citationDensity = verifyCitationDensity(markdown);
        factInference = verifyFactInferenceSeparation(markdown);
    }

    // Second-pass LLM-judge audit on sentence-level claims. Budget-gated: skip
    // if the tracker would blow past its cap. Failure is silent — the numeric
    // verifier above is the primary gate.
    let claimAudit: ResearchReport['metadata']['claimAudit'];
    try {
        const remaining = tracker.budget.maxLLMCalls - tracker.llmCalls;
        if (remaining >= 1) {
            const verdicts = await auditClaimsWithLLM(markdown, {
                webSources,
                ragResult,
                companyData,
                knowledgeBase,
                sourceAnalysis,
            });
            if (verdicts.length > 0) {
                claimAudit = {
                    audited: verdicts.length,
                    supported:   verdicts.filter(v => v.status === 'supported').length,
                    partial:     verdicts.filter(v => v.status === 'partial').length,
                    unsupported: verdicts.filter(v => v.status === 'unsupported').length,
                    flags: verdicts.filter(v => v.status !== 'supported').slice(0, 20),
                };
            }
        }
    } catch { /* verifier is advisory — never block */ }

    // ── Confidence derivation + methodology footer ────────────────────────
    // Rolls the three grounding signals (numeric rate, multi-source rate,
    // citation density) into a single banner for the report header, then
    // appends a reproducibility block so exports carry the provenance too.
    const numericRate = verification.totalClaims > 0
        ? verification.groundedClaims / verification.totalClaims
        : 1;
    const multiSourceRate = verification.groundedClaims > 0
        ? verification.multiSourceClaims / verification.groundedClaims
        : 1;
    const confidence = deriveConfidence({
        numericGroundingRate: numericRate,
        multiSourceRate,
        citationDensity: citationDensity.density,
        totalClaims: verification.totalClaims,
        factInferenceRate: factInference.hedgingRate,
    });

    const subQuestions = blueprint.researchAngles.length > 0
        ? blueprint.researchAngles
        : blueprint.subtopics;
    const methodologyMd = buildMethodologySection({
        searchQueries: blueprint.searchQueries.length,
        rounds: roundsRun,
        webSources: webSources.length,
        secFilings: secFilings.length,
        ragSources: ragSourceCount,
        subQuestions,
        verification,
        citationDensity,
        confidence,
        sectionFanout,
        factInference,
        contextualRetrieval,
        distillation,
        revisions: revisions.used ? revisions : undefined,
        injectionDefense: injectionStats.scanned > 0 ? injectionStats : undefined,
        readers: readerStats.totalReaders > 0 ? readerStats : undefined,
        recency: recency.total > 0 ? recency : undefined,
        workflow: workflowStats ?? undefined,
        hitl: hitl.used ? { used: hitl.used, modified: hitl.modified } : undefined,
    });

    // Limitations & Unknowns block — deterministic render of verifier
    // outputs + blueprint. Always runs; emits nothing when no limitations
    // found. Sits BETWEEN the report body and the methodology footer so
    // analysts see it in the natural reading flow, not below the fold.
    const limitations = buildLimitationsSection({
        markdown, blueprint,
        verification, factInference,
        readers: readerStats.totalReaders > 0 ? readerStats : undefined,
        recency: recency.total > 0 ? recency : undefined,
        confidence,
    });

    const finalMarkdown = markdown + limitations.section + methodologyMd;

    const auditTail = claimAudit
        ? ` · ${claimAudit.supported}/${claimAudit.audited} claims supported`
        : '';
    const densityTail = citationDensity.totalFactSentences > 0
        ? ` · ${Math.round(citationDensity.density * 100)}% citation density`
        : '';
    const fanoutTail = sectionFanout.used
        ? ` · ${sectionFanout.completed}/${sectionFanout.planned} sections fanned out`
        : '';
    const hedgeTail = factInference.totalForwardLooking > 0
        ? ` · ${Math.round(factInference.hedgingRate * 100)}% forecasts hedged`
        : '';
    const ctxTail = contextualRetrieval.used && contextualRetrieval.total > 0
        ? ` · ${contextualRetrieval.enriched}/${contextualRetrieval.total} sources tagged`
        : '';
    const revTail = revisions.accepted && revisions.editsApplied > 0
        ? ` · ${revisions.editsApplied} surgical edit${revisions.editsApplied === 1 ? '' : 's'} applied`
        : '';
    const injTail = injectionStats.flagged > 0
        ? ` · ${injectionStats.flagged} injection attempt${injectionStats.flagged === 1 ? '' : 's'} blocked`
        : '';
    const readerTail = readerStats.totalReaders > 0
        ? ` · ${readerStats.succeeded}/${readerStats.totalReaders} readers`
        : '';
    const workflowTail = workflowStats
        ? ` · ${workflowStats.label} workflow`
        : '';
    const limitationsTail = limitations.count > 0
        ? ` · ${limitations.count} limitation${limitations.count === 1 ? '' : 's'} flagged`
        : '';
    const hitlTail = hitl.used
        ? (hitl.modified ? ' · plan edited by analyst' : ' · plan approved by analyst')
        : '';
    onProgress({
        stage: 'complete',
        message: `Confidence ${confidence} · ${verification.groundedClaims}/${verification.totalClaims} numeric grounded${auditTail}${densityTail}${hedgeTail}${fanoutTail}${readerTail}${ctxTail}${revTail}${injTail}${workflowTail}${limitationsTail}${hitlTail}`,
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
    // Title / summary pulled from the *original* markdown — the appended
    // methodology footer is structural, not part of the report body.
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const summaryMatch = markdown.match(/^#\s+.+\n\n([\s\S]+?)(?=\n##)/);
    const wordCount = finalMarkdown.split(/\s+/).length;

    const report: ResearchReport = {
        query,
        title: titleMatch ? titleMatch[1].replace(/\*\*/g, '').trim() : query,
        summary: summaryMatch ? summaryMatch[1].trim().substring(0, 500) : '',
        markdown: finalMarkdown,
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
            claimAudit,
            citationDensity,
            factInference,
            confidence,
            methodology: {
                searchQueries: blueprint.searchQueries.length,
                rounds: roundsRun,
                subQuestions,
            },
            sectionFanout,
            contextualRetrieval,
            distillation: distillation.used ? {
                used: true,
                inputChars: distillation.inputChars,
                outputChars: distillation.outputChars,
                compressionRatio: distillation.compressionRatio,
                fallback: distillation.fallback,
            } : undefined,
            revisions: revisions.used ? { ...revisions } : undefined,
            injectionDefense: injectionStats.scanned > 0 ? {
                scanned: injectionStats.scanned,
                flagged: injectionStats.flagged,
                patternHits: { ...injectionStats.patternHits },
            } : undefined,
            readers: readerStats.totalReaders > 0 ? { ...readerStats } : undefined,
            recency: recency.total > 0 ? { ...recency } : undefined,
            workflow: workflowStats ?? undefined,
            limitations: limitations.count > 0
                ? { count: limitations.count, topics: [...limitations.topics] }
                : undefined,
            hitl: hitl.used ? { used: true, modified: hitl.modified, cancelled: false } : undefined,
        },
    };

    _activeBudget = null;
    _activeSignal = null;
    _activeInjectionStats = null;
    _activeReaderStats = null;
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
