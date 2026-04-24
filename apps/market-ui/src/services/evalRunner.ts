// Eval Runner — CI quality gate for deep research.
//
// Modes:
//   fixtures (default) — load frozen ResearchReport JSONs from eval/fixtures/,
//                        score each against its matching SEED_GOLDEN entry,
//                        exit non-zero if aggregate thresholds fail.
//   synthetic           — score a hand-constructed minimal report against
//                         SEED_GOLDEN[0]; validates the harness wiring itself.
//                         Useful when no fixtures exist yet.
//
// Run:  node <bundled-eval.mjs> [fixtures|synthetic]
//
// Thresholds (configurable via env):
//   EVAL_PASS_RATE_FLOOR   (default 0.80)  — fraction of fixtures that must pass
//   EVAL_AVG_OVERALL_FLOOR (default 0.70)  — mean weighted score
//   EVAL_AVG_GROUNDING_FLOOR (default 0.70) — mean numeric-grounding rate
//
// No network, no API keys — pure scoring over cached reports.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ResearchReport } from './deepResearchService';
import {
    scoreReport,
    summarize,
    SEED_GOLDEN,
    type GoldenEntry,
    type EvalScore,
} from './evaluation';

interface Fixture {
    goldenId: string;
    report: ResearchReport;
}

function envFloor(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

function formatTable(scores: EvalScore[]): string {
    if (scores.length === 0) return '(no scores)';
    const rows = scores.map(s => ({
        id: s.id,
        pass: s.passed ? 'pass' : 'FAIL',
        overall: s.overall.toFixed(2),
        tmpl: s.templateMatch ? 'y' : 'n',
        tickers: s.tickerCoverage.toFixed(2),
        metrics: s.metricCoverage.toFixed(2),
        sections: s.sectionCoverage.toFixed(2),
        grounding: s.groundingRate.toFixed(2),
    }));
    const header = 'id                               pass  overall tmpl tickers metrics sections grounding';
    const bar = '─'.repeat(header.length);
    const body = rows.map(r =>
        `${r.id.padEnd(32)} ${r.pass.padEnd(5)} ${r.overall.padEnd(7)} ${r.tmpl.padEnd(4)} ${r.tickers.padEnd(7)} ${r.metrics.padEnd(7)} ${r.sections.padEnd(8)} ${r.grounding.padEnd(9)}`
    ).join('\n');
    return [header, bar, body].join('\n');
}

function loadFixtures(dir: string): Fixture[] {
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('.'));
    const fixtures: Fixture[] = [];
    for (const f of files) {
        const path = join(dir, f);
        try {
            const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
            if (
                !raw || typeof raw !== 'object'
                || !('goldenId' in raw) || !('report' in raw)
            ) {
                console.warn(`[warn] ${f}: missing goldenId or report; skipping`);
                continue;
            }
            const fix = raw as Fixture;
            if (typeof fix.goldenId !== 'string' || !fix.report) {
                console.warn(`[warn] ${f}: malformed fixture; skipping`);
                continue;
            }
            fixtures.push(fix);
        } catch (e: any) {
            console.warn(`[warn] ${f}: ${e?.message || e}; skipping`);
        }
    }
    return fixtures;
}

function runFixtureMode(fixturesDir: string): number {
    const fixtures = loadFixtures(fixturesDir);
    const goldenById = new Map<string, GoldenEntry>(SEED_GOLDEN.map(g => [g.id, g]));

    if (fixtures.length === 0) {
        console.log('[eval] No fixtures found.');
        console.log(`[eval] Drop ResearchReport JSON files into ${fixturesDir}`);
        console.log('[eval] Fixture schema: { "goldenId": "<SEED_GOLDEN id>", "report": { ResearchReport } }');
        console.log('[eval] → PASS (no fixtures yet; harness contract still enforced by phase-2 tests)');
        return 0;
    }

    const scores: EvalScore[] = [];
    let unknownIds = 0;
    for (const f of fixtures) {
        const golden = goldenById.get(f.goldenId);
        if (!golden) {
            console.warn(`[warn] fixture references unknown goldenId: ${f.goldenId}`);
            unknownIds += 1;
            continue;
        }
        scores.push(scoreReport(f.report, golden));
    }

    if (scores.length === 0) {
        console.error('[eval] All fixtures referenced unknown goldenIds — nothing scored.');
        return 1;
    }

    const summary = summarize(scores);
    const passRate = summary.total > 0 ? summary.passed / summary.total : 0;

    console.log('\n' + formatTable(scores));
    console.log('');
    console.log(`Total:            ${summary.total}`);
    console.log(`Passed:           ${summary.passed}`);
    console.log(`Failed:           ${summary.failed}`);
    console.log(`Pass rate:        ${(passRate * 100).toFixed(0)}%`);
    console.log(`Avg overall:      ${summary.avgOverall.toFixed(3)}`);
    console.log(`Avg grounding:    ${summary.avgGrounding.toFixed(3)}`);
    console.log(`Template match:   ${(summary.templateMatchRate * 100).toFixed(0)}%`);
    if (unknownIds > 0) console.log(`Unknown goldenIds skipped: ${unknownIds}`);

    const passFloor = envFloor('EVAL_PASS_RATE_FLOOR', 0.80);
    const overallFloor = envFloor('EVAL_AVG_OVERALL_FLOOR', 0.70);
    const groundingFloor = envFloor('EVAL_AVG_GROUNDING_FLOOR', 0.70);

    const failures: string[] = [];
    if (passRate < passFloor)
        failures.push(`pass rate ${(passRate * 100).toFixed(0)}% < ${(passFloor * 100).toFixed(0)}% floor`);
    if (summary.avgOverall < overallFloor)
        failures.push(`avg overall ${summary.avgOverall.toFixed(3)} < ${overallFloor.toFixed(2)} floor`);
    if (summary.avgGrounding < groundingFloor)
        failures.push(`avg grounding ${summary.avgGrounding.toFixed(3)} < ${groundingFloor.toFixed(2)} floor`);

    if (failures.length > 0) {
        console.error('\n[eval] FAIL — thresholds not met:');
        for (const f of failures) console.error('  • ' + f);
        return 1;
    }
    console.log('\n[eval] PASS — all thresholds met');
    return 0;
}

function runSyntheticMode(): number {
    // Build a minimal report that satisfies SEED_GOLDEN[0] by construction —
    // validates that the harness wiring (import path, types, scoring logic)
    // is intact. Does NOT validate real model output quality.
    const golden = SEED_GOLDEN[0];
    const markdown = [
        `# ${golden.query}`,
        '',
        ...golden.expectedTickers.map(t => `${t} is the subject.`),
        ...golden.expectedMetrics.map(m => `The ${m} figure is flat.`),
        ...golden.expectedSections.map(h => `## ${h}\n\nContent [1].`),
    ].join('\n');

    const synthetic: ResearchReport = {
        query: golden.query,
        title: golden.query,
        summary: '',
        markdown,
        citations: [{ id: 1, title: 'Source', url: 'https://example.com', source: 'Web' }],
        metadata: {
            sourcesAnalyzed: 1,
            generatedAt: new Date().toISOString(),
            estimatedReadTime: 1,
            modelUsed: 'synthetic',
            template: golden.expectedTemplate,
            verification: {
                totalClaims: 5, groundedClaims: 5, multiSourceClaims: 3,
                singleSourceClaims: [], unsupportedClaims: [],
            },
        },
    };

    const score = scoreReport(synthetic, golden);
    console.log('\n' + formatTable([score]));
    if (!score.passed) {
        console.error('\n[eval] FAIL — synthetic probe did not pass (harness wiring broken?)');
        return 1;
    }
    console.log('\n[eval] PASS — harness wiring intact (synthetic probe)');
    return 0;
}

// ─── Entry point ──────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Bundled output sits in a temp dir; fixtures live alongside the source tree.
// Resolve fixtures dir relative to the repo's apps/market-ui/ when the bundle
// is run from the default location, else fall back to CWD + eval/fixtures.
const candidates = [
    resolve(__dirname, '../../eval/fixtures'),   // when bundled under src/
    resolve(process.cwd(), 'eval/fixtures'),     // when run from market-ui/
    resolve(process.cwd(), 'apps/market-ui/eval/fixtures'), // repo root
];
const fixturesDir = candidates.find(p => existsSync(p)) ?? candidates[1];

const mode = (process.argv[2] || 'fixtures').toLowerCase();
let exitCode = 0;
if (mode === 'synthetic') {
    exitCode = runSyntheticMode();
} else if (mode === 'fixtures') {
    exitCode = runFixtureMode(fixturesDir);
} else {
    console.error(`[eval] Unknown mode: ${mode}`);
    console.error('[eval] Usage: eval [fixtures|synthetic]');
    exitCode = 2;
}
process.exit(exitCode);
