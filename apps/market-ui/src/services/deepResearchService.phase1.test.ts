// Phase-1 smoke test — in-codebase only.
// Validates: template selection, numeric verifier, budget tracker, tier routing.
//
// Run: npx tsx apps/market-ui/src/services/deepResearchService.phase1.test.ts

import {
    REPORT_TEMPLATES,
    selectTemplate,
    BudgetTracker,
    DEFAULT_BUDGET,
    defaultModelFor,
    extractClaims,
    verifyNumericConsistency,
} from './deepResearchService';

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

console.log('\n=== Phase-1 Smoke Test ===\n');

// ─── 1. Templates exist and have required structure ──────────────────────────
console.log('[1] REPORT_TEMPLATES registry');
const expectedKeys = ['investment_memo', 'earnings_preview', 'earnings_recap', 'thematic', 'company_primer', 'comparative'] as const;
for (const k of expectedKeys) {
    const t = REPORT_TEMPLATES[k];
    check(`template "${k}" exists`, !!t);
    check(`template "${k}" has sections`, !!t && t.sections.length >= 5, `got ${t?.sections.length}`);
    check(`template "${k}" has requiredTables`, !!t && t.requiredTables.length >= 1);
    check(`template "${k}" key matches`, t?.key === k);
}

// ─── 2. selectTemplate() heuristic ───────────────────────────────────────────
console.log('\n[2] selectTemplate() intent + query routing');
check('"earnings preview for NVDA Q4" -> earnings_preview',
    selectTemplate('company_analysis', 'earnings preview for NVDA Q4') === 'earnings_preview');
check('"Q4 results for AAPL" -> earnings_recap',
    selectTemplate('company_analysis', 'Q4 results for AAPL') === 'earnings_recap');
check('"overview of Stripe" -> company_primer',
    selectTemplate('company_analysis', 'overview of Stripe') === 'company_primer');
check('intent=comparative -> comparative',
    selectTemplate('comparative', 'which is better, AAPL or MSFT') === 'comparative');
check('intent=thematic -> thematic',
    selectTemplate('thematic', 'AI capex cycle 2026') === 'thematic');
check('intent=sector_analysis -> thematic',
    selectTemplate('sector_analysis', 'semiconductor sector outlook') === 'thematic');
check('intent=macro_analysis -> thematic',
    selectTemplate('macro_analysis', 'Fed rate path 2026') === 'thematic');
check('default -> investment_memo',
    selectTemplate('company_analysis', 'thoughts on NVDA') === 'investment_memo');

// ─── 3. extractClaims() finds numeric figures ────────────────────────────────
console.log('\n[3] extractClaims() numeric extraction');
const markdownA = `
NVIDIA reported revenue of $35.1B, up 94% YoY. Operating margin was 62.5%.
Guidance of $37.5B for Q1 implies 73x P/E. Margin compression of 150 bps.
The stock closed at $142.50 yesterday.
`;
const claimsA = extractClaims(markdownA);
check('extracts $35.1B', claimsA.some(c => /35\.1\s?B/i.test(c)));
check('extracts 94%', claimsA.some(c => /94\s?%/.test(c)));
check('extracts 62.5%', claimsA.some(c => /62\.5\s?%/.test(c)));
check('extracts 73x', claimsA.some(c => /73\s?x/i.test(c)));
check('extracts 150 bps', claimsA.some(c => /150\s?bps/i.test(c)));
check('extracts $142.50', claimsA.some(c => /142\.50/.test(c)));
check('does not extract "in Q1" as a claim', !claimsA.some(c => c === 'Q1'));

// ─── 4. verifyNumericConsistency() grounding logic ──────────────────────────
console.log('\n[4] verifyNumericConsistency() evidence matching');
const vInputs = {
    webSources: [
        { title: 'NVDA Q4 release', content: 'Revenue of $35.1B beat consensus.', url: 'x', source: 'x' },
    ] as any,
    ragResult: { available: true, sources: [{ text: 'Operating margin 62.5% in Q4' }] } as any,
    companyData: [{ marketCap: '3.5T', peRatio: '73x', fiftyTwoWeekHigh: '$150', fiftyTwoWeekLow: '$90' }] as any,
    knowledgeBase: 'Guidance 37.5B next quarter. Stock at $142.50.',
    sourceAnalysis: 'Growth of 94% YoY. Margin compression 150 bps.',
};
const vResultGrounded = verifyNumericConsistency(markdownA, vInputs);
check('totalClaims > 0', vResultGrounded.totalClaims > 0, `got ${vResultGrounded.totalClaims}`);
check('most claims grounded',
    vResultGrounded.groundedClaims >= vResultGrounded.totalClaims * 0.7,
    `${vResultGrounded.groundedClaims}/${vResultGrounded.totalClaims}`);

const markdownUngrounded = 'NVIDIA revenue hit $999.9B with a 200x multiple.';
const vResultUngrounded = verifyNumericConsistency(markdownUngrounded, {
    ...vInputs,
    knowledgeBase: '',
    sourceAnalysis: '',
});
check('hallucinated $999.9B flagged unsupported',
    vResultUngrounded.unsupportedClaims.some(c => /999\.9/.test(c)),
    JSON.stringify(vResultUngrounded.unsupportedClaims));
check('hallucinated 200x flagged unsupported',
    vResultUngrounded.unsupportedClaims.some(c => /200\s?x/i.test(c)));

// ─── 5. BudgetTracker enforcement ────────────────────────────────────────────
console.log('\n[5] BudgetTracker hard caps');
const tinyBudget = { maxLLMCalls: 3, maxEstimatedTokens: 1000, maxSearchRounds: 2 };
const t = new BudgetTracker(tinyBudget);
check('initial llmCalls=0', t.llmCalls === 0);
check('initial estimatedTokens=0', t.estimatedTokens === 0);
t.checkBeforeCall();
t.recordCall(100, 100);
t.recordCall(100, 100);
t.recordCall(100, 100);
check('after 3 calls llmCalls=3', t.llmCalls === 3);
let threw = false;
try { t.checkBeforeCall(); } catch (e: any) { threw = /Budget exhausted.*LLM calls/.test(e.message); }
check('4th checkBeforeCall throws', threw);

const tokenBudget = { maxLLMCalls: 100, maxEstimatedTokens: 50, maxSearchRounds: 2 };
const t2 = new BudgetTracker(tokenBudget);
t2.recordCall(200, 200);  // ~100 tokens (400/4)
let threw2 = false;
try { t2.checkBeforeCall(); } catch (e: any) { threw2 = /tokens/.test(e.message); }
check('token cap throws', threw2, `tokens=${t2.estimatedTokens}, cap=${tokenBudget.maxEstimatedTokens}`);

check('DEFAULT_BUDGET has all fields',
    DEFAULT_BUDGET.maxLLMCalls > 0 && DEFAULT_BUDGET.maxEstimatedTokens > 0 && DEFAULT_BUDGET.maxSearchRounds > 0);

// ─── 6. defaultModelFor() tier routing ───────────────────────────────────────
console.log('\n[6] defaultModelFor() tier routing');
check('anthropic/premium -> opus-4-6', defaultModelFor('anthropic', 'premium') === 'claude-opus-4-6');
check('anthropic/standard -> sonnet-4-6', defaultModelFor('anthropic', 'standard') === 'claude-sonnet-4-6');
check('anthropic/lite -> haiku-4-5', defaultModelFor('anthropic', 'lite') === 'claude-haiku-4-5-20251001');
check('gemini/premium -> 2.5-pro', defaultModelFor('gemini', 'premium') === 'gemini-2.5-pro');
check('gemini/standard -> 2.5-flash', defaultModelFor('gemini', 'standard') === 'gemini-2.5-flash');
check('gemini/lite -> 2.0-flash-lite', defaultModelFor('gemini', 'lite') === 'gemini-2.0-flash-lite');
check('deepseek/premium -> reasoner', defaultModelFor('deepseek', 'premium') === 'deepseek-reasoner');
check('deepseek/lite -> chat', defaultModelFor('deepseek', 'lite') === 'deepseek-chat');
check('groq/lite -> llama-3.1-8b', defaultModelFor('groq', 'lite') === 'llama-3.1-8b-instant');

// ─── Report ──────────────────────────────────────────────────────────────────
console.log('\n=== Result ===');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
} else {
    console.log('  Phase-1 all green ✓');
}
