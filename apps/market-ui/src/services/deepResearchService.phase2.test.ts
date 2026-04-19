// Phase-2 smoke test — in-codebase only.
// Validates: cancellation, evaluation harness, grid data model.
//
// Run: bundled via esbuild --define:import.meta.env={} and exec'd with node.

import {
    throwIfAborted,
    ResearchCancelledError,
    extractClaims,
    verifyNumericConsistency,
    extractClaimSentences,
    buildClaimJudgePrompt,
    parseClaimVerdicts,
    auditClaimsWithLLM,
    verifyCitationDensity,
} from './deepResearchService';
import {
    classifyAuthority,
    authorityWeight,
    weightedAuthorityScore,
    type TavilySearchResult,
} from './tavilyService';
import {
    scoreReport,
    summarize,
    runGolden,
    SEED_GOLDEN,
    type GoldenEntry,
} from './evaluation';
import {
    initializeGrid,
    updateCell,
    cellKey,
    allCellIds,
    gridProgress,
    resolvePrompt,
    runGridCell,
    runGrid,
    toCSV,
    SEED_GRID_PROMPTS,
    type GridDef,
    type CellRunnerDeps,
} from './gridResearch';
import { buildGridSheetData, buildSourceRows } from './gridExcelData';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
    if (cond) {
        pass += 1;
        console.log(`  ok   ${name}`);
    } else {
        fail += 1;
        failures.push(`${name}${detail ? ' — ' + detail : ''}`);
        console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
    }
}

console.log('\n=== Phase-2 Smoke Test ===\n');

// ─── 1. Cancellation primitives ──────────────────────────────────────────────
console.log('[1] Cancellation');

const ac = new AbortController();
let threw = false;
try { throwIfAborted(ac.signal); } catch { threw = true; }
check('throwIfAborted is a no-op when not aborted', !threw);

ac.abort();
threw = false;
let err: any;
try { throwIfAborted(ac.signal); } catch (e) { threw = true; err = e; }
check('throwIfAborted throws after abort()', threw);
check('thrown error is ResearchCancelledError', err instanceof ResearchCancelledError);
check('error name is ResearchCancelledError', err?.name === 'ResearchCancelledError');
check('error message is user-facing', /cancelled/i.test(err?.message ?? ''));

// ─── 2. Evaluation harness — scoreReport() ───────────────────────────────────
console.log('\n[2] Evaluation harness');

function mockReport(over: { markdown?: string; metadata?: any } = {}): any {
    return {
        query: 'x', title: 'x', summary: '', citations: [],
        markdown: over.markdown ?? '# Title\n\n## Executive Summary\n...\n## Bull Case\n\n## Bear Case\n\n## Risk Matrix',
        metadata: {
            sourcesAnalyzed: 10,
            generatedAt: '2026-04-18',
            estimatedReadTime: 5,
            template: 'investment_memo',
            verification: { totalClaims: 10, groundedClaims: 9, unsupportedClaims: [] },
            ...(over.metadata ?? {}),
        },
    };
}

const goldenPerfect: GoldenEntry = {
    id: 'g1',
    query: 'test',
    expectedTemplate: 'investment_memo',
    expectedTickers: [],
    expectedMetrics: [],
    expectedSections: ['Executive Summary', 'Bull Case', 'Bear Case'],
};

const s1 = scoreReport(mockReport(), goldenPerfect);
check('perfect report: templateMatch=true', s1.templateMatch);
check('perfect report: sectionCoverage=1.0', s1.sectionCoverage === 1);
check('perfect report: groundingRate=0.9', Math.abs(s1.groundingRate - 0.9) < 0.001);
check('perfect report: overall >= 0.8', s1.overall >= 0.8, `overall=${s1.overall.toFixed(3)}`);
check('perfect report: passed=true', s1.passed);

const s2 = scoreReport(
    mockReport({ metadata: { template: 'earnings_recap' } }),  // wrong template
    goldenPerfect,
);
check('wrong template: templateMatch=false', !s2.templateMatch);
check('wrong template: overall < perfect', s2.overall < s1.overall);
check('wrong template notes mention expected', s2.notes.some(n => /expected/i.test(n)));

const s3 = scoreReport(
    mockReport({ metadata: { verification: { totalClaims: 10, groundedClaims: 3, unsupportedClaims: [] } } }),
    goldenPerfect,
);
check('low grounding: groundingRate=0.3', Math.abs(s3.groundingRate - 0.3) < 0.001);
check('low grounding: passed=false (below floor)', !s3.passed);

const goldenWithTickers: GoldenEntry = {
    id: 'g2',
    query: 'test',
    expectedTemplate: 'investment_memo',
    expectedTickers: ['NVDA', 'AAPL'],
    expectedMetrics: ['revenue', 'margin'],
    expectedSections: ['Bull Case'],
};
const s4 = scoreReport(
    mockReport({ markdown: '# T\n\n## Bull Case\nNVDA had strong revenue and margin growth.' }),
    goldenWithTickers,
);
check('half tickers found (NVDA yes, AAPL no): coverage=0.5', s4.tickerCoverage === 0.5);
check('all metrics found: metricCoverage=1', s4.metricCoverage === 1);

// ─── 3. Evaluation harness — summarize() ─────────────────────────────────────
console.log('\n[3] Summarize');
const summary = summarize([s1, s2, s3, s4]);
check('summary.total=4', summary.total === 4);
check('summary.passed matches', summary.passed === [s1, s2, s3, s4].filter(s => s.passed).length);
check('summary.templateMatchRate', summary.templateMatchRate === 0.75);
check('summary.avgGrounding sane', summary.avgGrounding > 0 && summary.avgGrounding <= 1);

// ─── 4. Evaluation harness — runGolden() with mock generator ────────────────
console.log('\n[4] runGolden()');

const mockGen = async (_query: string) => mockReport();
const progressHits: number[] = [];
const runSummary = await runGolden(SEED_GOLDEN.slice(0, 3), mockGen, (done) => {
    progressHits.push(done);
});
check('runGolden scored 3 entries', runSummary.total === 3);
check('progress callback fired 3 times', progressHits.length === 3);
check('first progress=0', progressHits[0] === 0);

const failingGen = async () => { throw new Error('boom'); };
const failSummary = await runGolden(SEED_GOLDEN.slice(0, 2), failingGen);
check('failing generator: 0 passed', failSummary.passed === 0);
check('failing generator: notes contain error', failSummary.scores[0].notes.some(n => /boom/.test(n)));

check('SEED_GOLDEN has >=10 entries', SEED_GOLDEN.length >= 10);
check('SEED_GOLDEN entries have required fields',
    SEED_GOLDEN.every(g => g.id && g.query && g.expectedTemplate && Array.isArray(g.expectedMetrics)));

// ─── 5. Grid data model — initialize, update, selectors ─────────────────────
console.log('\n[5] Grid state');

const def: GridDef = {
    id: 'grid1',
    name: 'MAG-7 triage',
    tickers: ['NVDA', 'AAPL', 'MSFT'],
    prompts: [
        { id: 'thesis', label: 'Thesis', prompt: 'Thesis for {ticker}' },
        { id: 'risks', label: 'Risks', prompt: 'Risks for {ticker}' },
    ],
};

const state0 = initializeGrid(def);
check('initializeGrid creates 3×2=6 cells', Object.keys(state0.cells).length === 6);
check('all cells start pending',
    Object.values(state0.cells).every(c => c.status === 'pending'));
check('cellKey format', cellKey('NVDA', 'thesis') === 'NVDA::thesis');
check('allCellIds returns 6 pairs', allCellIds(def).length === 6);

const state1 = updateCell(state0, 'NVDA', 'thesis', { status: 'running' });
check('updateCell is immutable (state0 unchanged)',
    state0.cells[cellKey('NVDA', 'thesis')].status === 'pending');
check('updateCell applies patch (state1 running)',
    state1.cells[cellKey('NVDA', 'thesis')].status === 'running');
check('updateCell leaves other cells untouched',
    state1.cells[cellKey('AAPL', 'thesis')].status === 'pending');

const state2 = updateCell(state1, 'NVDA', 'thesis', {
    status: 'done',
    answer: 'test answer',
    durationMs: 1234,
});
check('done cell has answer', state2.cells[cellKey('NVDA', 'thesis')].answer === 'test answer');

const prog1 = gridProgress(state0);
check('progress: 0 done, 6 total', prog1.done === 0 && prog1.total === 6);
const prog2 = gridProgress(state2);
check('progress: 1 done after update', prog2.done === 1);

// ─── 6. Grid — resolvePrompt + runGridCell + runGrid ────────────────────────
console.log('\n[6] Grid runner');

check('resolvePrompt substitutes {ticker}',
    resolvePrompt({ id: 'x', label: 'X', prompt: 'Analyze {ticker} now {ticker}' }, 'NVDA') === 'Analyze NVDA now NVDA');

let llmCalls = 0;
const capturedPrompts: string[] = [];
const fakeDeps: CellRunnerDeps = {
    callLLM: async (prompt: string) => {
        llmCalls += 1;
        capturedPrompts.push(prompt);
        return { text: `Answer to: ${prompt.slice(-50)}`, model: 'gemini-2.5-flash' as any };
    },
};

const cell = await runGridCell(def, 'NVDA', 'thesis', fakeDeps);
check('runGridCell calls LLM once', llmCalls === 1);
check('runGridCell status=done', cell.status === 'done');
check('runGridCell has answer', !!cell.answer && cell.answer.length > 0);
check('runGridCell records model', cell.modelUsed === 'gemini-2.5-flash');
check('runGridCell records duration', typeof cell.durationMs === 'number' && cell.durationMs! >= 0);
check('runGridCell prompt includes resolved ticker', capturedPrompts[0].includes('NVDA'));

const errCell = await runGridCell(def, 'ZZZ', 'unknown-id', fakeDeps);
check('runGridCell unknown promptId -> error status', errCell.status === 'error');
check('runGridCell unknown promptId has error message', !!errCell.error);

const failingDeps: CellRunnerDeps = {
    callLLM: async () => { throw new Error('LLM offline'); },
};
const failed = await runGridCell(def, 'NVDA', 'thesis', failingDeps);
check('runGridCell LLM failure -> error', failed.status === 'error');
check('runGridCell error propagates message', /LLM offline/.test(failed.error ?? ''));

// Cancellation
const ac2 = new AbortController();
const blockingDeps: CellRunnerDeps = {
    callLLM: async (_p: string, signal?: AbortSignal) => {
        return await new Promise((_res, rej) => {
            signal?.addEventListener('abort', () => {
                const e = new Error('aborted');
                e.name = 'AbortError';
                rej(e);
            });
        });
    },
};
const cancelPromise = runGridCell(def, 'NVDA', 'thesis', blockingDeps, ac2.signal);
setTimeout(() => ac2.abort(), 10);
const cancelled = await cancelPromise;
check('runGridCell on abort -> cancelled status', cancelled.status === 'cancelled');

// runGrid concurrency + full run
llmCalls = 0;
const updates: string[] = [];
const finalState = await runGrid(state0, fakeDeps, {
    concurrency: 2,
    onCellUpdate: (_s, c) => { updates.push(`${c.ticker}/${c.promptId}=${c.status}`); },
});
check('runGrid calls LLM for all 6 cells', llmCalls === 6);
check('runGrid onCellUpdate fires per completion', updates.length === 6);
check('runGrid all cells done', Object.values(finalState.cells).every(c => c.status === 'done'));
check('runGrid sets completedAt', !!finalState.completedAt);
check('runGrid sets startedAt', !!finalState.startedAt);

// Seed prompts sanity
check('SEED_GRID_PROMPTS has 6 entries', SEED_GRID_PROMPTS.length === 6);
check('SEED_GRID_PROMPTS all use {ticker}',
    SEED_GRID_PROMPTS.every(p => p.prompt.includes('{ticker}')));

// toCSV
const csv = toCSV(finalState);
const csvLines = csv.split('\r\n');
check('toCSV has header + N rows', csvLines.length === 1 + state0.def.tickers.length);
check('toCSV header first col is ticker', csvLines[0].startsWith('ticker,'));
check('toCSV header includes all prompt labels',
    state0.def.prompts.every(p => csvLines[0].includes(p.label)));
check('toCSV ticker col matches def',
    state0.def.tickers.every((t, i) => csvLines[i + 1].startsWith(t + ',')));

// toCSV escaping — answers with commas/quotes/newlines must be quoted
const escState: any = {
    def: {
        id: 'esc', name: 'esc', tickers: ['X'],
        prompts: [{ id: 'p1', label: 'P1', prompt: '' }],
    },
    cells: {
        'X::p1': { ticker: 'X', promptId: 'p1', status: 'done', answer: 'a,b "c"\nd' },
    },
};
const escCsv = toCSV(escState);
check('toCSV escapes comma/quote/newline',
    escCsv.includes('"a,b ""c""\nd"'));

// toCSV emits empty string for pending, marker for error/cancelled
const mixedState: any = {
    def: {
        id: 'm', name: 'm', tickers: ['A', 'B', 'C'],
        prompts: [{ id: 'p1', label: 'P1', prompt: '' }],
    },
    cells: {
        'A::p1': { ticker: 'A', promptId: 'p1', status: 'pending' },
        'B::p1': { ticker: 'B', promptId: 'p1', status: 'error', error: 'boom' },
        'C::p1': { ticker: 'C', promptId: 'p1', status: 'cancelled' },
    },
};
const mixedCsv = toCSV(mixedState).split('\r\n');
check('toCSV pending -> empty field', mixedCsv[1] === 'A,');
check('toCSV error -> (error: …) marker', mixedCsv[2].includes('(error: boom)'));
check('toCSV cancelled -> (cancelled) marker', mixedCsv[3].includes('(cancelled)'));

// ─── 6b. Excel data shaping (buildGridSheetData + buildSourceRows) ──────────
console.log('\n[6b] Excel data shaping');

const xlsxState: any = {
    def: {
        id: 'x', name: 'x',
        tickers: ['AAPL', 'NVDA'],
        prompts: [
            { id: 'thesis', label: 'Thesis', prompt: '' },
            { id: 'risks',  label: 'Risks',  prompt: '' },
        ],
    },
    cells: {
        'AAPL::thesis': {
            ticker: 'AAPL', promptId: 'thesis', status: 'done',
            answer: 'Strong services margin',
            citations: [
                { id: 1, title: '10-K FY2025', url: 'https://sec.gov/aapl' },
                { id: 2, title: 'Q4 earnings call', url: 'https://ir.apple.com' },
            ],
        },
        'AAPL::risks': { ticker: 'AAPL', promptId: 'risks', status: 'error', error: 'rate limited' },
        'NVDA::thesis': {
            ticker: 'NVDA', promptId: 'thesis', status: 'done',
            answer: 'Data-center moat',
            citations: [{ id: 1, title: '10-Q FY2026', url: 'https://sec.gov/nvda' }],
        },
        'NVDA::risks': { ticker: 'NVDA', promptId: 'risks', status: 'pending' },
    },
};

const sheet = buildGridSheetData(xlsxState);
check('buildGridSheetData headers start with Ticker',
    sheet.headers[0] === 'Ticker');
check('buildGridSheetData headers include all prompt labels',
    sheet.headers.slice(1).join('|') === 'Thesis|Risks');
check('buildGridSheetData row count = tickers',
    sheet.rows.length === 2);
check('buildGridSheetData done cell carries answer',
    sheet.rows[0][1] === 'Strong services margin');
check('buildGridSheetData error cell has marker',
    sheet.rows[0][2].startsWith('(error:') && sheet.rows[0][2].includes('rate limited'));
check('buildGridSheetData pending cell is empty',
    sheet.rows[1][2] === '');

const srcRows = buildSourceRows(xlsxState);
check('buildSourceRows flattens citations across cells',
    srcRows.length === 3);
check('buildSourceRows carries ticker + prompt label',
    srcRows[0].ticker === 'AAPL' && srcRows[0].promptLabel === 'Thesis');
check('buildSourceRows preserves citation id + url',
    srcRows[0].citationId === 1 && srcRows[0].url === 'https://sec.gov/aapl');
check('buildSourceRows skips cells without citations',
    !srcRows.some(r => r.promptLabel === 'Risks'));

// ─── 7. Phase-1 regression (sanity check that earlier helpers still work) ───
console.log('\n[7] Phase-1 regression');
const claims = extractClaims('Revenue $35.1B up 94%.');
check('extractClaims still works', claims.length >= 2);
const v = verifyNumericConsistency('Revenue $35.1B.', {
    webSources: [{ title: 't', content: '35.1B', url: '', source: '' } as any],
    ragResult: undefined,
    companyData: [],
    knowledgeBase: '',
    sourceAnalysis: '',
});
check('verifyNumericConsistency still works', v.totalClaims > 0 && v.groundedClaims > 0);

// ─── 8. LLM-judge claim verifier ────────────────────────────────────────────
console.log('\n[8] LLM-judge claim verifier');

const sampleReport = `
# Apple Q4 FY2025

## Financials
Apple reported revenue of $94.9B, beating consensus of $94.5B.
Services revenue grew 12% YoY to $24.9B, a record high.
Management raised FY2026 guidance to mid-single-digit growth.

## Narrative
The print was solid.

## Risks
Greater China revenue fell 4% YoY amid soft iPhone demand.
Regulatory overhang in the EU remains a concern.
`;

const claimSents = extractClaimSentences(sampleReport);
check('extractClaimSentences finds revenue claim',
    claimSents.some(s => s.includes('$94.9B')));
check('extractClaimSentences finds services growth claim',
    claimSents.some(s => s.includes('Services revenue grew 12%')));
check('extractClaimSentences finds guidance claim',
    claimSents.some(s => /raised.*guidance/i.test(s)));
check('extractClaimSentences skips narrative fillers',
    !claimSents.some(s => s === 'The print was solid.'));
check('extractClaimSentences strips markdown headers',
    !claimSents.some(s => s.startsWith('# ')));

// buildClaimJudgePrompt
const prompt = buildClaimJudgePrompt(
    ['Revenue was $94.9B.', 'Services grew 12%.'],
    'Q4 revenue: $94.9B. Services +12% YoY.',
);
check('buildClaimJudgePrompt numbers claims',
    prompt.includes('[1] Revenue was $94.9B.') && prompt.includes('[2] Services grew 12%.'));
check('buildClaimJudgePrompt embeds evidence',
    prompt.includes('Q4 revenue: $94.9B'));
check('buildClaimJudgePrompt asks for JSON',
    /Return ONLY valid JSON/i.test(prompt));

// parseClaimVerdicts — happy path
const parsed = parseClaimVerdicts(
    '{"verdicts":[{"i":1,"status":"supported","reason":"exact match"},{"i":2,"status":"partial","reason":"no pct"}]}',
    ['Revenue $94.9B.', 'Services grew 12%.'],
);
check('parseClaimVerdicts returns N verdicts', parsed.length === 2);
check('parseClaimVerdicts maps i→claim text', parsed[0].claim === 'Revenue $94.9B.');
check('parseClaimVerdicts preserves status', parsed[0].status === 'supported' && parsed[1].status === 'partial');
check('parseClaimVerdicts preserves reason', parsed[0].reason === 'exact match');

// parseClaimVerdicts — malformed inputs
check('parseClaimVerdicts tolerates non-JSON',
    parseClaimVerdicts('sorry, I can\'t', ['x']).length === 0);
check('parseClaimVerdicts drops out-of-range indices',
    parseClaimVerdicts('{"verdicts":[{"i":99,"status":"supported"}]}', ['x']).length === 0);
check('parseClaimVerdicts defaults bad status to unsupported',
    parseClaimVerdicts('{"verdicts":[{"i":1,"status":"maybe"}]}', ['x'])[0].status === 'unsupported');
check('parseClaimVerdicts accepts JSON wrapped in prose',
    parseClaimVerdicts('Here is my verdict: {"verdicts":[{"i":1,"status":"supported"}]} done.', ['x']).length === 1);

// auditClaimsWithLLM — inject a fake LLM and check it does the right thing
const fakeAudit = await auditClaimsWithLLM(
    sampleReport,
    {
        webSources: [{ title: 'Apple 10-Q', content: 'Revenue $94.9B Services $24.9B +12% YoY.', url: '', source: '' } as any],
        ragResult: undefined,
        companyData: [],
        knowledgeBase: '',
        sourceAnalysis: '',
    },
    {
        maxClaims: 10,
        callLLM: async (_p) =>
            '{"verdicts":[{"i":1,"status":"supported","reason":"match"},{"i":2,"status":"supported","reason":"match"},{"i":3,"status":"partial","reason":"guidance not quoted"}]}',
    },
);
check('auditClaimsWithLLM returns verdicts', fakeAudit.length >= 2);
check('auditClaimsWithLLM first verdict carries claim text',
    !!fakeAudit[0].claim && fakeAudit[0].claim.length > 5);

// auditClaimsWithLLM swallows LLM errors (best-effort)
const errorAudit = await auditClaimsWithLLM(
    sampleReport,
    { webSources: [], ragResult: undefined, companyData: [], knowledgeBase: '', sourceAnalysis: '' },
    { callLLM: async () => { throw new Error('rate limited'); } },
);
check('auditClaimsWithLLM returns [] when LLM throws', errorAudit.length === 0);

// ─── 9. Source-authority classification ─────────────────────────────────────
console.log('\n[9] Source-authority classification');

check('sec.gov classifies as primary',
    classifyAuthority('https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany') === 'primary');
check('ir.apple.com classifies as primary',
    classifyAuthority('https://ir.apple.com/investor-updates/default.aspx') === 'primary');
check('investor.microsoft.com classifies as primary',
    classifyAuthority('https://investor.microsoft.com/investor-relations/earnings') === 'primary');
check('federalreserve.gov classifies as primary',
    classifyAuthority('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm') === 'primary');
check('reuters.com classifies as premium_news',
    classifyAuthority('https://www.reuters.com/business/finance/') === 'premium_news');
check('bloomberg.com classifies as premium_news',
    classifyAuthority('https://www.bloomberg.com/news/articles/xyz') === 'premium_news');
check('cnbc.com classifies as mainstream',
    classifyAuthority('https://www.cnbc.com/2026/04/18/markets') === 'mainstream');
check('seekingalpha.com classifies as aggregator',
    classifyAuthority('https://seekingalpha.com/article/123') === 'aggregator');
check('some-random-blog.xyz classifies as other',
    classifyAuthority('https://some-random-blog.xyz/post/whatever') === 'other');
check('malformed URL falls back to other',
    classifyAuthority('not a url at all') === 'other');

// Authority weights are strictly decreasing across tiers.
check('authorityWeight(primary) > premium_news',
    authorityWeight('primary') > authorityWeight('premium_news'));
check('authorityWeight(premium_news) > mainstream',
    authorityWeight('premium_news') > authorityWeight('mainstream'));
check('authorityWeight(mainstream) > aggregator',
    authorityWeight('mainstream') > authorityWeight('aggregator'));
check('authorityWeight(aggregator) > other',
    authorityWeight('aggregator') > authorityWeight('other'));

// weightedAuthorityScore: SEC with a low tavily score beats a blog with a high score.
const secLow: TavilySearchResult = {
    title: 'Apple 10-Q', url: 'https://www.sec.gov/Archives/edgar/x/0001.htm',
    content: '...', score: 0.2,
};
const blogHigh: TavilySearchResult = {
    title: 'Hot take on AAPL', url: 'https://random-blog.com/aapl-is-doomed',
    content: '...', score: 0.99,
};
check('weightedAuthorityScore: SEC with low tavily score > blog with high tavily score',
    weightedAuthorityScore(secLow) > weightedAuthorityScore(blogHigh));

// ─── 10. Citation-density verifier ──────────────────────────────────────────
console.log('\n[10] Citation-density verifier');

const fullyCitedMd = `
# AAPL Earnings Recap

Apple reported revenue of $94.9 billion [1].
Services grew 12% year-over-year to $24.9 billion [RAG-2].
Management raised FY guidance to $400B [3].
We now turn to the bear case.
`;
const noCiteMd = `
# AAPL Earnings Recap

Apple reported revenue of $94.9 billion.
Services grew 12% year-over-year to $24.9 billion.
Management raised FY guidance to $400B.
`;
const partialMd = `
# AAPL Earnings Recap

Apple reported revenue of $94.9 billion [1].
Services grew 12% year-over-year to $24.9 billion.
Management raised FY guidance to $400B.
`;

const full = verifyCitationDensity(fullyCitedMd);
check('citation density: fully-cited report has density 1.0',
    full.density === 1 && full.totalFactSentences === 3,
    `density=${full.density} total=${full.totalFactSentences}`);
check('citation density: non-factual transition not counted',
    full.totalFactSentences === 3);

const none = verifyCitationDensity(noCiteMd);
check('citation density: no-cite report has density 0.0',
    none.density === 0 && none.citedSentences === 0,
    `density=${none.density} cited=${none.citedSentences}`);
check('citation density: no-cite report reports 3 fact sentences',
    none.totalFactSentences === 3);
check('citation density: no-cite report carries uncited samples',
    none.uncitedSamples.length === 3);

const part = verifyCitationDensity(partialMd);
check('citation density: partial-cite report density ~ 0.33',
    Math.abs(part.density - 1/3) < 0.01,
    `density=${part.density}`);
check('citation density: partial-cite report flags 2 uncited',
    part.uncitedSamples.length === 2);

// Empty / header-only markdown should not throw or divide by zero.
const empty = verifyCitationDensity('# Title\n\n## Section\n\nWe now turn to analysis.');
check('citation density: empty markdown yields density 1.0 (no fact sentences)',
    empty.totalFactSentences === 0 && empty.density === 1);

// Table-row content is stripped (tables carry their own citations in captions/footers).
const tableMd = `
## Scorecard
| Metric | Value |
|---|---|
| Revenue | $94.9B |
| Growth  | 12%    |

The headline miss on services guidance [2] is the key takeaway.
`;
const tbl = verifyCitationDensity(tableMd);
check('citation density: table rows not counted as fact sentences',
    tbl.totalFactSentences === 1 && tbl.citedSentences === 1);

// ─── Report ──────────────────────────────────────────────────────────────────
console.log('\n=== Result ===');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
} else {
    console.log('  Phase-2 all green ✓');
}
