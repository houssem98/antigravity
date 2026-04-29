// PowerPoint Export — plan §6.6 ("PowerPoint export via python-pptx or
// integrate a FlashDocs-style deck generator for IC memos and pitchbooks").
//
// We use pptxgenjs (browser-friendly, no Python sidecar) to render a
// ResearchReport into a slide deck following an institutional layout:
//   1. Title slide       — title + summary line + date
//   2. Executive Summary — first paragraph of the report
//   3. Section slides    — one per H2 heading, body bulletized
//   4. Methodology       — confidence + grounding stats
//   5. Citations         — top sources by index
//
// The deck is intentionally minimalist (no images, no charts) — analysts
// usually want a structural starting point they can polish themselves
// rather than a finished design.

import PptxGenJS from 'pptxgenjs';
import type { ResearchReport } from './deepResearchService';

// ─── Slide-outline planner ─────────────────────────────────────────────────
// Pure data step — extracted so phase-2 tests can verify deck structure
// without invoking the pptxgenjs rendering layer.

export interface SlideTitle    { kind: 'title'; title: string; subtitle: string; }
export interface SlideSection  { kind: 'section'; heading: string; bullets: string[]; }
export interface SlideMethod   { kind: 'methodology'; lines: string[]; }
export interface SlideCitations { kind: 'citations'; rows: Array<{ id: number; title: string; source: string }>; }
export type Slide = SlideTitle | SlideSection | SlideMethod | SlideCitations;

const MAX_BULLETS_PER_SLIDE = 8;        // pptxgenjs auto-shrinks but readability suffers past 8
const MAX_BULLET_CHARS = 220;

function cleanLine(s: string): string {
    return s.replace(/\[(?:RAG-)?\d+\]/g, '')   // strip citation tags
        .replace(/\*\*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Extract H2 sections from markdown into bullet outlines. Each section's
// body is collapsed into discrete bullets:
//   • a markdown bullet (- / *)
//   • OR a sentence (split on .!?) when no bullets are present
// Bullets get clamped to MAX_BULLET_CHARS to keep slides readable.
export function planDeckOutline(report: Pick<ResearchReport, 'title' | 'summary' | 'markdown' | 'citations' | 'metadata'>): Slide[] {
    const slides: Slide[] = [];
    const cleanTitle = (report.title || 'Research Report').replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
    const cleanSummary = cleanLine(report.summary || '');

    const date = new Date(report.metadata?.generatedAt || Date.now()).toISOString().slice(0, 10);

    slides.push({
        kind: 'title',
        title: cleanTitle,
        subtitle: cleanSummary ? `${cleanSummary} · ${date}` : date,
    });

    const md = report.markdown || '';

    // Strip the appended methodology + limitations from the body — they
    // get their own slide groups. Anything from "## Methodology & Confidence"
    // onward is structural footer.
    const cutIdx = md.search(/^##\s+(Methodology|Limitations)\s*&/m);
    const body = cutIdx > 0 ? md.slice(0, cutIdx) : md;

    // Split on H2 headings via index scan — JS regex has no \z for true
    // end-of-string, so we collect heading offsets and slice between them.
    const headingIdx: Array<{ start: number; lineEnd: number; heading: string }> = [];
    const headingRe = /^##\s+([^\n]+)/gm;
    let mh: RegExpExecArray | null;
    while ((mh = headingRe.exec(body)) !== null) {
        const start = mh.index;
        const lineEnd = body.indexOf('\n', start);
        headingIdx.push({
            start,
            lineEnd: lineEnd >= 0 ? lineEnd : body.length,
            heading: cleanLine(mh[1]),
        });
    }
    for (let h = 0; h < headingIdx.length; h++) {
        const heading = headingIdx[h].heading;
        const bodyStart = headingIdx[h].lineEnd + 1;
        const bodyEnd = h + 1 < headingIdx.length ? headingIdx[h + 1].start : body.length;
        const sectionBody = body.slice(bodyStart, bodyEnd);
        const bullets = extractBullets(sectionBody);
        if (bullets.length === 0) continue;
        for (let i = 0; i < bullets.length; i += MAX_BULLETS_PER_SLIDE) {
            const chunk = bullets.slice(i, i + MAX_BULLETS_PER_SLIDE);
            slides.push({
                kind: 'section',
                heading: i === 0 ? heading : `${heading} (cont.)`,
                bullets: chunk,
            });
        }
    }

    // Methodology slide
    const meta = report.metadata;
    if (meta) {
        const lines: string[] = [];
        if (meta.confidence) lines.push(`Confidence: ${meta.confidence}`);
        if (meta.verification && meta.verification.totalClaims > 0) {
            const v = meta.verification;
            lines.push(`Numeric grounding: ${v.groundedClaims}/${v.totalClaims} claims (${Math.round(v.groundedClaims / v.totalClaims * 100)}%)`);
            if (v.multiSourceClaims > 0) {
                lines.push(`Cross-referenced: ${v.multiSourceClaims} claims by ≥2 sources`);
            }
        }
        if (meta.citationDensity && meta.citationDensity.totalFactSentences > 0) {
            lines.push(`Citation density: ${Math.round(meta.citationDensity.density * 100)}%`);
        }
        if (meta.workflow) {
            lines.push(`Workflow: ${meta.workflow.label} (template: ${meta.workflow.template})`);
        }
        if (meta.budget) {
            lines.push(`LLM calls: ${meta.budget.calls} · ~${Math.round(meta.budget.tokens / 1000)}k tokens · $${meta.budget.estimatedUsd.toFixed(3)}`);
        }
        lines.push(`Sources analyzed: ${meta.sourcesAnalyzed}`);
        if (lines.length > 0) slides.push({ kind: 'methodology', lines });
    }

    // Citations slide — top 12 by id
    if (report.citations && report.citations.length > 0) {
        const rows = report.citations.slice(0, 12).map(c => ({
            id: c.id,
            title: cleanLine(c.title || ''),
            source: c.source || 'Web',
        }));
        slides.push({ kind: 'citations', rows });
    }

    return slides;
}

// Pull bullets out of a markdown section body. Prefers existing bullet
// list lines; falls back to sentence-splitting prose so the slide isn't
// just a wall of text.
function extractBullets(sectionBody: string): string[] {
    const bullets: string[] = [];
    const seen = new Set<string>();

    // First pass: existing bullet items (- / * / numbered).
    for (const m of sectionBody.matchAll(/^\s*(?:[-*]|\d+\.)\s+(.+?)$/gm)) {
        const line = cleanLine(m[1]);
        if (!line) continue;
        const clamped = line.length > MAX_BULLET_CHARS ? line.slice(0, MAX_BULLET_CHARS - 1) + '…' : line;
        if (!seen.has(clamped)) {
            seen.add(clamped);
            bullets.push(clamped);
        }
    }

    if (bullets.length > 0) return bullets;

    // Fallback: sentence-split the prose body.
    const stripped = sectionBody
        .replace(/^\s*>\s?/gm, '')
        .replace(/\|[^\n]*\|/g, '')
        .replace(/`[^`]*`/g, '');
    const sentences = stripped.split(/(?<=[.!?])\s+(?=[A-Z(])|\n{2,}/).map(s => cleanLine(s)).filter(Boolean);
    for (const s of sentences) {
        const clamped = s.length > MAX_BULLET_CHARS ? s.slice(0, MAX_BULLET_CHARS - 1) + '…' : s;
        if (clamped.length >= 12 && !seen.has(clamped)) {
            seen.add(clamped);
            bullets.push(clamped);
        }
    }
    return bullets;
}

// ─── Render to .pptx via pptxgenjs ─────────────────────────────────────────

const COLOR = {
    text: '1F2937',
    accent: '3B82F6',
    muted: '6B7280',
    bg: 'FFFFFF',
};

export interface ExportOptions {
    company?: string;     // optional footer text
    author?: string;
}

export async function exportReportToPptx(
    report: Pick<ResearchReport, 'title' | 'summary' | 'markdown' | 'citations' | 'metadata'>,
    opts: ExportOptions = {},
): Promise<void> {
    const slides = planDeckOutline(report);
    const pres = new PptxGenJS();
    pres.author = opts.author || 'market-ui deep research';
    pres.company = opts.company || '';
    pres.title = report.title || 'Research Report';
    pres.layout = 'LAYOUT_16x9';

    for (const s of slides) {
        const slide = pres.addSlide();
        slide.background = { color: COLOR.bg };
        switch (s.kind) {
            case 'title':
                slide.addText(s.title, {
                    x: 0.6, y: 2.0, w: 12.5, h: 1.6,
                    fontSize: 36, bold: true, color: COLOR.text, fontFace: 'Calibri',
                });
                slide.addText(s.subtitle, {
                    x: 0.6, y: 3.7, w: 12.5, h: 0.6,
                    fontSize: 14, color: COLOR.muted, fontFace: 'Calibri',
                });
                break;
            case 'section':
                slide.addText(s.heading, {
                    x: 0.5, y: 0.4, w: 12.5, h: 0.7,
                    fontSize: 24, bold: true, color: COLOR.text, fontFace: 'Calibri',
                });
                slide.addText(
                    s.bullets.map(b => ({ text: b, options: { bullet: true } })),
                    {
                        x: 0.6, y: 1.3, w: 12.4, h: 5.6,
                        fontSize: 14, color: COLOR.text, fontFace: 'Calibri', valign: 'top',
                    },
                );
                break;
            case 'methodology':
                slide.addText('Methodology & Confidence', {
                    x: 0.5, y: 0.4, w: 12.5, h: 0.7,
                    fontSize: 24, bold: true, color: COLOR.text, fontFace: 'Calibri',
                });
                slide.addText(
                    s.lines.map(l => ({ text: l, options: { bullet: true } })),
                    {
                        x: 0.6, y: 1.3, w: 12.4, h: 5.6,
                        fontSize: 14, color: COLOR.text, fontFace: 'Calibri', valign: 'top',
                    },
                );
                break;
            case 'citations':
                slide.addText('Sources', {
                    x: 0.5, y: 0.4, w: 12.5, h: 0.7,
                    fontSize: 24, bold: true, color: COLOR.text, fontFace: 'Calibri',
                });
                slide.addText(
                    s.rows.map(r => ({
                        text: `[${r.id}] ${r.title}  —  ${r.source}`,
                        options: { bullet: true },
                    })),
                    {
                        x: 0.6, y: 1.3, w: 12.4, h: 5.6,
                        fontSize: 12, color: COLOR.text, fontFace: 'Calibri', valign: 'top',
                    },
                );
                break;
        }
    }

    const safeName = (report.title || 'research-report')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 60) || 'research-report';
    await pres.writeFile({ fileName: `${safeName}.pptx` });
}
