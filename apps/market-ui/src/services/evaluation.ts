// Evaluation Harness — Phase 2 capability-gate foundation.
// Score a ResearchReport against a golden entry on 5 dimensions:
//   • template match      — did the routing pick the expected outline?
//   • ticker coverage     — what fraction of expected tickers appear in the report?
//   • metric coverage     — what fraction of expected metrics are referenced?
//   • section coverage    — what fraction of expected section headings are present?
//   • grounding rate      — from the existing numeric verifier
//
// No LLM calls. No network. Pure functions over a finished ResearchReport so
// the same harness can run in CI, offline, or against cached reports.

import type { ResearchReport } from './deepResearchService';
import type { TemplateKey } from './deepResearchService';

export interface GoldenEntry {
    id: string;
    query: string;
    expectedTemplate: TemplateKey;
    expectedTickers: string[];
    expectedMetrics: string[];       // e.g. ["revenue", "operating margin", "FCF"]
    expectedSections: string[];      // H2/H3 headings that must appear
    minGroundingRate?: number;       // default 0.7
}

export interface EvalScore {
    id: string;
    query: string;
    templateMatch: boolean;
    tickerCoverage: number;          // 0–1
    metricCoverage: number;          // 0–1
    sectionCoverage: number;         // 0–1
    groundingRate: number;           // 0–1 (from report.metadata.verification)
    overall: number;                 // weighted avg
    passed: boolean;                 // overall >= 0.7 AND groundingRate >= minGroundingRate
    notes: string[];
}

export interface EvalSummary {
    total: number;
    passed: number;
    failed: number;
    avgOverall: number;
    avgGrounding: number;
    templateMatchRate: number;
    scores: EvalScore[];
}

const WEIGHTS = {
    template: 0.15,
    ticker: 0.2,
    metric: 0.25,
    section: 0.2,
    grounding: 0.2,
};

function fractionPresent(needles: string[], haystack: string): number {
    if (needles.length === 0) return 1;
    const lower = haystack.toLowerCase();
    let hits = 0;
    for (const n of needles) {
        if (lower.includes(n.toLowerCase())) hits += 1;
    }
    return hits / needles.length;
}

export function scoreReport(report: ResearchReport, golden: GoldenEntry): EvalScore {
    const notes: string[] = [];
    const md = report.markdown || '';

    const templateMatch = report.metadata.template === golden.expectedTemplate;
    if (!templateMatch) {
        notes.push(`template=${report.metadata.template}, expected=${golden.expectedTemplate}`);
    }

    const tickerCoverage = fractionPresent(golden.expectedTickers, md);
    if (tickerCoverage < 1) {
        const missing = golden.expectedTickers.filter(t => !md.toLowerCase().includes(t.toLowerCase()));
        notes.push(`missing tickers: ${missing.join(', ')}`);
    }

    const metricCoverage = fractionPresent(golden.expectedMetrics, md);
    if (metricCoverage < 0.5) {
        notes.push(`low metric coverage: ${(metricCoverage * 100).toFixed(0)}%`);
    }

    const sectionCoverage = fractionPresent(golden.expectedSections, md);

    const v = report.metadata.verification;
    const groundingRate = v && v.totalClaims > 0 ? v.groundedClaims / v.totalClaims : 1;
    const minGrounding = golden.minGroundingRate ?? 0.7;
    if (groundingRate < minGrounding) {
        notes.push(`grounding ${(groundingRate * 100).toFixed(0)}% < ${(minGrounding * 100).toFixed(0)}% floor`);
    }

    const overall =
        WEIGHTS.template * (templateMatch ? 1 : 0) +
        WEIGHTS.ticker * tickerCoverage +
        WEIGHTS.metric * metricCoverage +
        WEIGHTS.section * sectionCoverage +
        WEIGHTS.grounding * groundingRate;

    const passed = overall >= 0.7 && groundingRate >= minGrounding;

    return {
        id: golden.id,
        query: golden.query,
        templateMatch,
        tickerCoverage,
        metricCoverage,
        sectionCoverage,
        groundingRate,
        overall,
        passed,
        notes,
    };
}

export function summarize(scores: EvalScore[]): EvalSummary {
    const total = scores.length;
    const passed = scores.filter(s => s.passed).length;
    const avgOverall = total > 0 ? scores.reduce((a, s) => a + s.overall, 0) / total : 0;
    const avgGrounding = total > 0 ? scores.reduce((a, s) => a + s.groundingRate, 0) / total : 0;
    const templateMatchRate = total > 0 ? scores.filter(s => s.templateMatch).length / total : 0;
    return {
        total,
        passed,
        failed: total - passed,
        avgOverall,
        avgGrounding,
        templateMatchRate,
        scores,
    };
}

// Runner: given a generator fn, runs the whole golden set and scores each.
// Caller supplies the generator so tests can pass a mock and production can
// pass performDeepResearch bound with a specific model/budget.
export async function runGolden(
    entries: GoldenEntry[],
    generate: (query: string) => Promise<ResearchReport>,
    onProgress?: (done: number, total: number, current: GoldenEntry) => void,
): Promise<EvalSummary> {
    const scores: EvalScore[] = [];
    for (let i = 0; i < entries.length; i += 1) {
        const g = entries[i];
        onProgress?.(i, entries.length, g);
        try {
            const report = await generate(g.query);
            scores.push(scoreReport(report, g));
        } catch (e: any) {
            scores.push({
                id: g.id,
                query: g.query,
                templateMatch: false,
                tickerCoverage: 0,
                metricCoverage: 0,
                sectionCoverage: 0,
                groundingRate: 0,
                overall: 0,
                passed: false,
                notes: [`threw: ${e?.message || String(e)}`],
            });
        }
    }
    return summarize(scores);
}

// ─── Seed Golden Set (10 entries) ────────────────────────────────────────────
// Covers: earnings preview/recap, company primer, comparative, thematic,
// macro, investment memo across MAG-7 + crossover tickers.

export const SEED_GOLDEN: GoldenEntry[] = [
    {
        id: 'nvda-earnings-preview',
        query: 'earnings preview for NVDA Q4',
        expectedTemplate: 'earnings_preview',
        expectedTickers: ['NVDA'],
        expectedMetrics: ['revenue', 'data center', 'guidance', 'consensus'],
        expectedSections: ['Consensus Estimates', 'Segments to Watch', 'Scenarios'],
    },
    {
        id: 'aapl-earnings-recap',
        query: 'Q4 results for AAPL',
        expectedTemplate: 'earnings_recap',
        expectedTickers: ['AAPL'],
        expectedMetrics: ['revenue', 'services', 'iPhone', 'gross margin'],
        expectedSections: ['Stock Reaction', 'Print vs Consensus', 'Guidance'],
    },
    {
        id: 'stripe-primer',
        query: 'overview of Stripe',
        expectedTemplate: 'company_primer',
        expectedTickers: [],
        expectedMetrics: ['revenue', 'gross margin', 'valuation'],
        expectedSections: ['Business Overview', 'Competitive Landscape', 'Key Risks'],
    },
    {
        id: 'aapl-vs-msft',
        query: 'which is better to own, AAPL or MSFT',
        expectedTemplate: 'investment_memo',        // comparative intent comes from blueprint
        expectedTickers: ['AAPL', 'MSFT'],
        expectedMetrics: ['revenue', 'margin', 'valuation'],
        expectedSections: ['Thesis', 'Bull Case', 'Bear Case'],
    },
    {
        id: 'ai-capex-thematic',
        query: 'AI capex cycle through 2026',
        expectedTemplate: 'investment_memo',        // default; may upgrade to thematic via intent
        expectedTickers: [],
        expectedMetrics: ['capex', 'hyperscaler', 'GPU'],
        expectedSections: ['Executive Summary', 'Catalysts', 'Risks'],
    },
    {
        id: 'nvda-thesis',
        query: 'investment thesis on NVDA',
        expectedTemplate: 'investment_memo',
        expectedTickers: ['NVDA'],
        expectedMetrics: ['revenue', 'data center', 'margin'],
        expectedSections: ['Thesis', 'Bull Case', 'Bear Case', 'Risk'],
    },
    {
        id: 'tsla-primer',
        query: 'overview of Tesla',
        expectedTemplate: 'company_primer',
        expectedTickers: ['TSLA'],
        expectedMetrics: ['deliveries', 'automotive margin', 'FSD'],
        expectedSections: ['Business Overview', 'Competitive Landscape'],
    },
    {
        id: 'msft-q1-preview',
        query: 'earnings preview for MSFT Q1',
        expectedTemplate: 'earnings_preview',
        expectedTickers: ['MSFT'],
        expectedMetrics: ['Azure', 'Office', 'revenue'],
        expectedSections: ['Consensus Estimates', 'Segments to Watch'],
    },
    {
        id: 'googl-earnings-recap',
        query: 'Q3 results for GOOGL',
        expectedTemplate: 'earnings_recap',
        expectedTickers: ['GOOGL'],
        expectedMetrics: ['search', 'cloud', 'YouTube', 'margin'],
        expectedSections: ['Stock Reaction', 'Guidance'],
    },
    {
        id: 'amzn-thesis',
        query: 'investment thesis on AMZN',
        expectedTemplate: 'investment_memo',
        expectedTickers: ['AMZN'],
        expectedMetrics: ['AWS', 'retail margin', 'advertising'],
        expectedSections: ['Thesis', 'Bull Case', 'Bear Case'],
    },
];
