// BlueprintReview — Human-in-the-loop plan approval (plan §6.1 P0).
// Gemini-DR's editable-blueprint pattern: after the Chief Analyst drafts the
// research plan (intent, queries, SEC targets, key metrics, angles) but BEFORE
// any retrieval fires, let the analyst edit or veto. Matches how real research
// teams scope work: a junior drafts, a senior scopes, then the work begins.
//
// Returns via the onSubmit callback:
//   - undefined → accept blueprint as-is (auto path)
//   - edited blueprint → run with these changes
//   - null       → cancel the whole research run

import { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Edit3, Sparkles } from 'lucide-react';
import type { ResearchBlueprint } from '../../services/deepResearchService';

interface Props {
    blueprint: ResearchBlueprint;
    onSubmit: (result: ResearchBlueprint | null | undefined) => void;
}

// Multi-line textarea ↔ string[] helpers. We keep the raw text in state so the
// analyst can type a blank line mid-edit without it vanishing on every keystroke.
function linesToArray(s: string): string[] {
    return s.split('\n').map(l => l.trim()).filter(Boolean);
}
function arrayToLines(a: string[]): string {
    return a.join('\n');
}

export default function BlueprintReview({ blueprint, onSubmit }: Props) {
    const [queriesText, setQueriesText] = useState(arrayToLines(blueprint.searchQueries));
    const [secText, setSecText] = useState(arrayToLines(blueprint.secTargets));
    const [metricsText, setMetricsText] = useState(arrayToLines(blueprint.keyMetrics));
    const [anglesText, setAnglesText] = useState(arrayToLines(blueprint.researchAngles));
    const [submitted, setSubmitted] = useState(false);

    const edited = useMemo<ResearchBlueprint>(() => ({
        ...blueprint,
        searchQueries: linesToArray(queriesText),
        secTargets: linesToArray(secText),
        keyMetrics: linesToArray(metricsText),
        researchAngles: linesToArray(anglesText),
    }), [blueprint, queriesText, secText, metricsText, anglesText]);

    const isModified = useMemo(
        () => JSON.stringify(edited) !== JSON.stringify(blueprint),
        [edited, blueprint],
    );

    const handleApprove = () => {
        if (submitted) return;
        setSubmitted(true);
        onSubmit(isModified ? edited : undefined);
    };
    const handleCancel = () => {
        if (submitted) return;
        setSubmitted(true);
        onSubmit(null);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-xl border border-white/10 bg-[#0B0F14] shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-white/10">
                    <div className="flex items-start gap-3">
                        <div className="mt-0.5 p-1.5 rounded-lg bg-pink-500/15 border border-pink-500/30">
                            <Sparkles className="w-4 h-4 text-pink-300" />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold text-white">Review research plan</h2>
                            <p className="text-xs text-gray-400 mt-0.5">
                                Edit queries, SEC targets, metrics, or angles before retrieval fires. Empty lines are ignored.
                            </p>
                        </div>
                    </div>
                    <div className="text-[11px] text-gray-500 whitespace-nowrap">
                        Intent: <span className="text-gray-300">{blueprint.intent.replace(/_/g, ' ')}</span>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                    <Field
                        label="Search queries"
                        hint={`${linesToArray(queriesText).length} queries · one per line`}
                        value={queriesText}
                        onChange={setQueriesText}
                        rows={6}
                    />
                    <Field
                        label="SEC targets"
                        hint={`${linesToArray(secText).length} companies · one ticker or name per line`}
                        value={secText}
                        onChange={setSecText}
                        rows={3}
                    />
                    <Field
                        label="Key metrics"
                        hint={`${linesToArray(metricsText).length} metrics`}
                        value={metricsText}
                        onChange={setMetricsText}
                        rows={3}
                    />
                    <Field
                        label="Research angles"
                        hint={`${linesToArray(anglesText).length} angles · framed as sub-questions`}
                        value={anglesText}
                        onChange={setAnglesText}
                        rows={4}
                    />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-white/10 bg-[#0E1218]">
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                        {isModified ? (
                            <>
                                <Edit3 className="w-3 h-3 text-amber-400" />
                                <span className="text-amber-300">Edited — will run with your changes</span>
                            </>
                        ) : (
                            <span>No edits — will run the auto-generated plan</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleCancel}
                            disabled={submitted}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-white/10 text-gray-300 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed">
                            <XCircle className="w-3.5 h-3.5" />
                            Cancel run
                        </button>
                        <button
                            type="button"
                            onClick={handleApprove}
                            disabled={submitted}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-pink-500/20 border border-pink-500/40 text-pink-100 hover:bg-pink-500/30 disabled:opacity-40 disabled:cursor-not-allowed">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {isModified ? 'Run with edits' : 'Approve & run'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Field({
    label, hint, value, onChange, rows,
}: {
    label: string;
    hint: string;
    value: string;
    onChange: (s: string) => void;
    rows: number;
}) {
    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">{label}</label>
                <span className="text-[10px] text-gray-500">{hint}</span>
            </div>
            <textarea
                value={value}
                onChange={e => onChange(e.target.value)}
                rows={rows}
                spellCheck={false}
                className="w-full px-3 py-2 text-xs font-mono bg-[#060A10] border border-white/10 rounded-md text-gray-200 focus:outline-none focus:border-pink-500/40 focus:ring-1 focus:ring-pink-500/20 resize-y"
            />
        </div>
    );
}
