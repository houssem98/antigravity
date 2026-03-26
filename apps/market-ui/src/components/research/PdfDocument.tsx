// Premium Finance Research Report — PDF Document
// Unified with web app palette: #070A12 dark · #3D7FF6 blue · blue→purple gradient

import React from 'react';
import {
    Document, Page, View, Text, Link, Font,
    StyleSheet,
} from '@react-pdf/renderer';
import type { ResearchReport } from '../../services/deepResearchService';

Font.registerHyphenationCallback(word => [word]);

function stripMd(s: string): string {
    return s.replace(/\*\*\*/g, '').replace(/\*\*/g, '').replace(/\*/g, '')
        .replace(/`([^`]+)`/g, '$1').replace(/\[(\d+)\]/g, '').trim();
}

/* ── Unified Color Palette (mirrors web app) ── */
const C = {
    /* Cover page dark — matches web #070A12 */
    dark:          '#070A12',
    /* Section headers — refined navy (not pitch-black, no eye strain) */
    navyHeader:    '#112244',
    navyHeaderMid: '#0F1D38',
    darkLift:      '#0A0D18',
    darkCard:      '#0E1120',

    /* Accent blue — matches web #3D7FF6 */
    blue:       '#3D7FF6',
    blueMid:    '#2563EB',
    purple:     '#7C3AED',
    pink:       '#EC4899',

    /* Page body — slight warm-blue tint (not pure white, easier on eyes) */
    white:      '#FFFFFF',
    offWhite:   '#F7F9FF',   /* body page background */
    pageBody:   '#FAFBFF',   /* content area background */
    gray50:     '#EFF4FF',
    gray100:    '#DDE6F7',
    gray200:    '#C0CEEE',
    gray300:    '#9AACD8',
    gray400:    '#6E82B8',
    gray500:    '#4C5E8A',
    gray600:    '#354571',
    gray700:    '#2A3248',
    text:       '#2A3248',
    textDark:   '#1A2040',
};

/* Section accent palette — same progression as web app accents */
const ACCENTS = [
    '#3D7FF6', '#7C3AED', '#059669', '#DC2626',
    '#D97706', '#0891B2', '#4F46E5', '#BE185D',
];

/* ── StyleSheet ── */
const s = StyleSheet.create({
    /* Body page — subtle blue-tinted background, easy on eyes */
    page: {
        fontFamily: 'Helvetica',
        fontSize: 10,
        color: C.text,
        backgroundColor: C.offWhite,
        paddingTop: 40,
        paddingBottom: 52,
        paddingHorizontal: 46,
    },

    /* ── Cover page ── */
    coverPage: {
        fontFamily: 'Helvetica',
        backgroundColor: C.dark,
        padding: 0,
    },
    coverContent: {
        flex: 1,
        padding: 46,
        justifyContent: 'space-between',
    },

    /* Cover — gradient accent bar at top */
    coverAccentBar: {
        height: 3,
        backgroundColor: C.blue,          /* react-pdf can't do CSS gradients inline */
        marginBottom: 0,
    },

    /* Cover — brand row */
    coverBrand: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    coverLogo: {
        width: 40,
        height: 40,
        backgroundColor: C.blue,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    coverLogoText: {
        color: C.white,
        fontSize: 13,
        fontWeight: 700,
    },
    coverBrandName: {
        fontSize: 16,
        fontWeight: 700,
        color: C.white,
    },
    coverBrandSub: {
        fontSize: 7,
        color: 'rgba(255,255,255,0.35)',
        textTransform: 'uppercase',
        letterSpacing: 3,
        marginTop: 2,
    },

    /* Cover — main content */
    coverBadge: {
        fontSize: 7,
        fontWeight: 600,
        color: C.blue,
        textTransform: 'uppercase',
        letterSpacing: 3,
        borderWidth: 1,
        borderColor: 'rgba(61,127,246,0.35)',
        borderRadius: 14,
        paddingVertical: 5,
        paddingHorizontal: 14,
        alignSelf: 'flex-start',
        marginBottom: 20,
    },
    coverTitle: {
        fontSize: 28,
        fontWeight: 700,
        color: C.white,
        lineHeight: 1.18,
        marginBottom: 14,
    },
    coverQuery: {
        fontSize: 11,
        color: 'rgba(255,255,255,0.4)',
        lineHeight: 1.65,
        maxWidth: '78%',
    },
    coverDivider: {
        width: 52,
        height: 3,
        backgroundColor: C.blue,
        marginVertical: 22,
        borderRadius: 2,
    },

    /* Cover — stats strip */
    coverStats: {
        flexDirection: 'row',
        backgroundColor: 'rgba(61,127,246,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(61,127,246,0.2)',
        borderRadius: 12,
        alignSelf: 'flex-start',
    },
    coverStat: {
        paddingVertical: 16,
        paddingHorizontal: 26,
        alignItems: 'center',
    },
    coverStatDivider: {
        width: 1,
        backgroundColor: 'rgba(61,127,246,0.15)',
    },
    coverStatValue: {
        fontSize: 26,
        fontWeight: 700,
        color: C.white,
    },
    coverStatLabel: {
        fontSize: 6,
        textTransform: 'uppercase',
        letterSpacing: 2,
        color: 'rgba(255,255,255,0.3)',
        marginTop: 4,
    },

    /* Cover — bottom row */
    coverBottom: {
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.07)',
        paddingTop: 18,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
    },
    coverBottomText: {
        fontSize: 8,
        color: 'rgba(255,255,255,0.3)',
        lineHeight: 1.6,
    },
    coverConfidential: {
        fontSize: 7,
        color: 'rgba(255,255,255,0.1)',
        textTransform: 'uppercase',
        letterSpacing: 3,
    },

    /* ── Page header (fixed, appears on every body page) ── */
    pageHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: 10,
        borderBottomWidth: 1,
        borderBottomColor: C.gray100,
        marginBottom: 18,
    },
    pageHeaderBrand: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    pageHeaderLogo: {
        width: 17,
        height: 17,
        backgroundColor: C.blue,
        borderRadius: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    pageHeaderLogoText: {
        color: C.white,
        fontSize: 5,
        fontWeight: 700,
    },
    pageHeaderName: {
        fontSize: 8,
        fontWeight: 600,
        color: C.gray400,
    },
    pageHeaderRight: {
        fontSize: 7,
        color: C.gray400,
    },

    /* ── Section label row (TOC / References pages) ── */
    sectionLabel: {
        fontSize: 7,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 3,
        color: C.blue,
        marginBottom: 5,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 700,
        color: C.darkLift,
        marginBottom: 5,
    },
    sectionDivider: {
        width: 40,
        height: 3,
        backgroundColor: C.blue,
        borderRadius: 2,
        marginBottom: 18,
    },

    /* ── TOC grid cards ── */
    tocRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    tocCard: {
        width: '48%',
        backgroundColor: C.pageBody,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: C.gray100,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 4,
    },
    tocBadge: {
        width: 26,
        height: 26,
        borderRadius: 6,
        justifyContent: 'center',
        alignItems: 'center',
    },
    tocBadgeText: {
        color: C.white,
        fontSize: 10,
        fontWeight: 700,
    },
    tocCardText: {
        fontSize: 9,
        fontWeight: 600,
        color: C.darkLift,
        flex: 1,
    },

    /* ── Section slide card ── */
    slideCard: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: C.gray100,
        marginBottom: 12,
        overflow: 'hidden',
    },
    slideHeader: {
        backgroundColor: C.navyHeader,
        paddingVertical: 14,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    slideBadge: {
        width: 30,
        height: 30,
        borderRadius: 7,
        justifyContent: 'center',
        alignItems: 'center',
    },
    slideBadgeText: {
        color: C.white,
        fontSize: 12,
        fontWeight: 700,
    },
    slideTitle: {
        fontSize: 13,
        fontWeight: 700,
        color: C.white,
        flex: 1,
    },
    slideAccent: {
        height: 3,
    },
    slideBody: {
        padding: 20,
        backgroundColor: C.pageBody,
    },

    /* ── Inline text styles ── */
    heading2: {
        fontSize: 13,
        fontWeight: 700,
        color: C.darkLift,
        marginTop: 16,
        marginBottom: 6,
        paddingBottom: 5,
        borderBottomWidth: 1,
        borderBottomColor: C.gray100,
    },
    heading3: {
        fontSize: 11,
        fontWeight: 700,
        color: C.darkLift,
        marginTop: 12,
        marginBottom: 5,
        paddingLeft: 8,
        borderLeftWidth: 3,
        borderLeftColor: C.blue,
    },
    heading4: {
        fontSize: 9,
        fontWeight: 700,
        color: C.gray500,
        marginTop: 10,
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    paragraph: {
        fontSize: 9,
        lineHeight: 1.75,
        color: C.text,
        marginBottom: 6,
    },
    bold: {
        fontWeight: 700,
        color: C.textDark,
    },
    italic: {
        color: C.gray500,
    },
    listItem: {
        flexDirection: 'row',
        marginBottom: 3,
        paddingLeft: 4,
    },
    listBullet: {
        fontSize: 9,
        color: C.blue,
        marginRight: 6,
        width: 10,
    },
    listText: {
        fontSize: 9,
        lineHeight: 1.65,
        color: C.text,
        flex: 1,
    },

    /* Key Finding blockquote — mirrors web app blue card */
    blockquote: {
        backgroundColor: '#EEF3FF',
        borderLeftWidth: 3,
        borderLeftColor: C.blue,
        borderRadius: 6,
        paddingVertical: 10,
        paddingHorizontal: 14,
        marginVertical: 8,
    },
    blockquoteLabel: {
        fontSize: 7,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 2,
        color: C.blue,
        marginBottom: 4,
    },
    blockquoteText: {
        fontSize: 9,
        fontWeight: 500,
        color: C.darkLift,
        lineHeight: 1.65,
    },

    /* Inline code */
    codeInline: {
        fontSize: 8,
        backgroundColor: C.gray50,
        paddingHorizontal: 3,
        paddingVertical: 1,
        borderRadius: 3,
        color: '#6366F1',
    },

    /* Table */
    table: {
        marginVertical: 8,
        borderWidth: 1,
        borderColor: C.gray100,
        borderRadius: 8,
        overflow: 'hidden',
    },
    tableHeaderRow: {
        flexDirection: 'row',
        backgroundColor: C.navyHeader,
    },
    tableHeaderCell: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 10,
        fontSize: 7,
        fontWeight: 700,
        color: C.white,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: C.gray50,
    },
    tableRowEven: {
        backgroundColor: C.gray50,
    },
    tableCell: {
        flex: 1,
        paddingVertical: 6,
        paddingHorizontal: 10,
        fontSize: 8,
        color: C.text,
        lineHeight: 1.5,
    },

    /* Reference cards */
    refCard: {
        width: '48%',
        backgroundColor: C.pageBody,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: C.gray100,
        padding: 10,
        marginBottom: 8,
        flexDirection: 'row',
        gap: 8,
    },
    refBadge: {
        width: 20,
        height: 20,
        borderRadius: 5,
        backgroundColor: C.blue,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
    },
    refBadgeText: {
        color: C.white,
        fontSize: 7,
        fontWeight: 700,
    },
    refTitle: {
        fontSize: 8,
        fontWeight: 600,
        color: C.textDark,
        marginBottom: 2,
        lineHeight: 1.4,
    },
    refSource: {
        fontSize: 7,
        color: C.gray400,
        marginBottom: 1,
    },
    refUrl: {
        fontSize: 6,
        color: C.blue,
    },
    refSECBadge: {
        fontSize: 6,
        color: '#60A5FA',
        backgroundColor: '#0F2744',
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: 3,
        alignSelf: 'flex-start',
        marginTop: 2,
    },

    /* Page footer */
    footer: {
        position: 'absolute',
        bottom: 20,
        left: 46,
        right: 46,
        borderTopWidth: 2,
        borderTopColor: C.blue,
        paddingTop: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    footerText: {
        fontSize: 6,
        color: C.gray300,
    },

    /* Disclaimer block */
    disclaimer: {
        backgroundColor: C.pageBody,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: C.gray100,
        padding: 14,
        marginTop: 20,
    },
    disclaimerText: {
        fontSize: 7,
        color: C.gray400,
        lineHeight: 1.55,
    },
    disclaimerBold: {
        fontWeight: 700,
        color: C.gray500,
    },

    /* Executive summary special card */
    execSummaryCard: {
        backgroundColor: '#EEF3FF',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(61,127,246,0.2)',
        padding: 18,
        marginBottom: 14,
    },
    execSummaryLabel: {
        fontSize: 7,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 3,
        color: C.blue,
        marginBottom: 8,
    },
    execSummaryText: {
        fontSize: 10,
        lineHeight: 1.8,
        color: C.darkLift,
        fontWeight: 400,
    },
    execStatsRow: {
        flexDirection: 'row',
        gap: 0,
        marginTop: 14,
        borderTopWidth: 1,
        borderTopColor: 'rgba(61,127,246,0.12)',
        paddingTop: 12,
    },
    execStat: {
        flex: 1,
        alignItems: 'center',
    },
    execStatValue: {
        fontSize: 18,
        fontWeight: 700,
        color: C.blue,
    },
    execStatLabel: {
        fontSize: 6,
        textTransform: 'uppercase',
        letterSpacing: 2,
        color: C.gray400,
        marginTop: 2,
    },
});

/* ── Markdown parser ── */
interface ParsedBlock {
    type: 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'blockquote' | 'hr' | 'table';
    content: string;
    cells?: string[][];
}

function parseMarkdown(md: string): ParsedBlock[] {
    const lines = md.split('\n');
    const blocks: ParsedBlock[] = [];
    let tableRows: string[][] = [];
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            if (inTable && tableRows.length > 0) {
                blocks.push({ type: 'table', content: '', cells: tableRows });
                tableRows = []; inTable = false;
            }
            continue;
        }
        if (line.startsWith('|') && line.endsWith('|')) {
            const cells = line.split('|').filter(Boolean).map(c => c.trim());
            if (cells.every(c => /^[-:]+$/.test(c))) { inTable = true; continue; }
            tableRows.push(cells); inTable = true; continue;
        } else if (inTable && tableRows.length > 0) {
            blocks.push({ type: 'table', content: '', cells: tableRows });
            tableRows = []; inTable = false;
        }
        if (line.startsWith('#### ')) blocks.push({ type: 'h4', content: line.slice(5) });
        else if (line.startsWith('### ')) blocks.push({ type: 'h3', content: line.slice(4) });
        else if (line.startsWith('## ')) blocks.push({ type: 'h2', content: line.slice(3) });
        else if (line.startsWith('> ')) blocks.push({ type: 'blockquote', content: line.slice(2) });
        else if (line === '---') blocks.push({ type: 'hr', content: '' });
        else if (line.startsWith('- ')) blocks.push({ type: 'li', content: line.slice(2) });
        else if (/^\d+\.\s/.test(line)) blocks.push({ type: 'li', content: line.replace(/^\d+\.\s/, '') });
        else blocks.push({ type: 'p', content: line });
    }
    if (tableRows.length > 0) blocks.push({ type: 'table', content: '', cells: tableRows });
    return blocks;
}

/* ── Inline rich text ── */
function renderInlineText(text: string): React.ReactNode[] {
    const cleaned = text.replace(/\[(\d+)\]/g, '');
    const parts: React.ReactNode[] = [];
    let key = 0;
    const regex = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIndex = 0;
    let m;
    while ((m = regex.exec(cleaned)) !== null) {
        if (m.index > lastIndex) parts.push(<Text key={key++}>{cleaned.slice(lastIndex, m.index)}</Text>);
        if (m[1]) parts.push(<Text key={key++} style={s.bold}>{m[1]}</Text>);
        else if (m[2]) parts.push(<Text key={key++} style={s.codeInline}>{m[2]}</Text>);
        else if (m[3] && m[4]) parts.push(
            <Link key={key++} src={m[4]} style={{ color: C.blue, fontSize: 9 }}>{m[3]}</Link>
        );
        lastIndex = m.index + m[0].length;
    }
    if (lastIndex < cleaned.length) parts.push(<Text key={key++}>{cleaned.slice(lastIndex)}</Text>);
    if (parts.length === 0) parts.push(<Text key={0}>{cleaned}</Text>);
    return parts;
}

/* ── Section splitter ── */
interface Section { title: string; blocks: ParsedBlock[] }
function parseSections(markdown: string): Section[] {
    const sections: Section[] = [];
    const parts = markdown.split(/^(?=## )/m);
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const m = trimmed.match(/^## (.+)$/m);
        if (!m) continue;
        const title = m[1].replace(/\*\*/g, '').replace(/\[(\d+)\]/g, '').trim();
        const bodyMd = trimmed.substring(trimmed.indexOf('\n') + 1).trim();
        sections.push({ title, blocks: parseMarkdown(bodyMd) });
    }
    return sections;
}

/* ── Sub-components ── */

function PageHeader({ rightText }: { rightText: string }) {
    return (
        <View style={s.pageHeader} fixed>
            <View style={s.pageHeaderBrand}>
                <View style={s.pageHeaderLogo}>
                    <Text style={s.pageHeaderLogoText}>MI</Text>
                </View>
                <Text style={s.pageHeaderName}>Market Intelligence</Text>
            </View>
            <Text style={s.pageHeaderRight}>{rightText}</Text>
        </View>
    );
}

function PageFooter({ year }: { year: number }) {
    return (
        <View style={s.footer} fixed>
            <Text style={s.footerText}>© {year} Market Intelligence AI — Deep Research Engine</Text>
            <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
    );
}

function RenderBlocks({ blocks }: { blocks: ParsedBlock[] }) {
    return (
        <>
            {blocks.map((block, i) => {
                switch (block.type) {
                    case 'h2': return <Text key={i} style={s.heading2}>{renderInlineText(block.content)}</Text>;
                    case 'h3': return <Text key={i} style={s.heading3}>{renderInlineText(block.content)}</Text>;
                    case 'h4': return <Text key={i} style={s.heading4}>{renderInlineText(block.content)}</Text>;
                    case 'p':  return <Text key={i} style={s.paragraph}>{renderInlineText(block.content)}</Text>;
                    case 'li': return (
                        <View key={i} style={s.listItem}>
                            <Text style={s.listBullet}>•</Text>
                            <Text style={s.listText}>{renderInlineText(block.content)}</Text>
                        </View>
                    );
                    case 'blockquote': return (
                        <View key={i} style={s.blockquote}>
                            <Text style={s.blockquoteLabel}>Key Finding</Text>
                            <Text style={s.blockquoteText}>{renderInlineText(block.content)}</Text>
                        </View>
                    );
                    case 'hr': return (
                        <View key={i} style={{ height: 1, backgroundColor: C.gray100, marginVertical: 12 }} />
                    );
                    case 'table': return block.cells && block.cells.length > 0 ? (
                        <View key={i} style={s.table}>
                            <View style={s.tableHeaderRow}>
                                {block.cells[0].map((cell, ci) => (
                                    <Text key={ci} style={s.tableHeaderCell}>{cell}</Text>
                                ))}
                            </View>
                            {block.cells.slice(1).map((row, ri) => (
                                <View key={ri} style={[s.tableRow, ri % 2 === 1 ? s.tableRowEven : {}]}>
                                    {row.map((cell, ci) => (
                                        <Text key={ci} style={s.tableCell}>{cell}</Text>
                                    ))}
                                </View>
                            ))}
                        </View>
                    ) : null;
                    default: return null;
                }
            })}
        </>
    );
}

/* ── Main PDF Document ── */
interface Props { report: ResearchReport }

export default function PdfDocument({ report }: Props) {
    const generatedDate = new Date(report.metadata.generatedAt).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
    });
    const generatedTime = new Date(report.metadata.generatedAt).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit',
    });
    const year = new Date().getFullYear();
    const sections = parseSections(report.markdown);

    const tocItems: string[] = [];
    const headingRegex = /^## (.+)$/gm;
    let match;
    while ((match = headingRegex.exec(report.markdown)) !== null) {
        tocItems.push(match[1].replace(/\*\*/g, '').replace(/\[(\d+)\]/g, '').trim());
    }

    return (
        <Document
            title={stripMd(report.title)}
            author="Market Intelligence AI"
            subject="Deep Research Report"
            creator="Market Intelligence — AI Research Engine"
        >
            {/* ══════════════════════════════════
                COVER PAGE  — dark, matches web
            ══════════════════════════════════ */}
            <Page size="A4" style={[s.page, s.coverPage]}>
                {/* Top gradient accent bar (3 segments to simulate gradient) */}
                <View style={{ flexDirection: 'row', height: 4 }}>
                    <View style={{ flex: 1, backgroundColor: C.blue }} />
                    <View style={{ flex: 1, backgroundColor: C.purple }} />
                    <View style={{ flex: 1, backgroundColor: C.pink }} />
                </View>

                <View style={s.coverContent}>
                    {/* Brand */}
                    <View style={s.coverBrand}>
                        <View style={s.coverLogo}>
                            <Text style={s.coverLogoText}>MI</Text>
                        </View>
                        <View>
                            <Text style={s.coverBrandName}>Market Intelligence</Text>
                            <Text style={s.coverBrandSub}>AI Research Engine</Text>
                        </View>
                    </View>

                    {/* Main title area */}
                    <View>
                        <Text style={s.coverBadge}>Deep Research Report</Text>
                        <Text style={s.coverTitle}>{stripMd(report.title)}</Text>
                        <Text style={s.coverQuery}>{stripMd(report.query)}</Text>
                        <View style={s.coverDivider} />

                        {/* Stats strip */}
                        <View style={s.coverStats}>
                            <View style={s.coverStat}>
                                <Text style={s.coverStatValue}>{report.metadata.sourcesAnalyzed}</Text>
                                <Text style={s.coverStatLabel}>Sources</Text>
                            </View>
                            <View style={s.coverStatDivider} />
                            <View style={s.coverStat}>
                                <Text style={s.coverStatValue}>{report.metadata.estimatedReadTime}</Text>
                                <Text style={s.coverStatLabel}>Min Read</Text>
                            </View>
                            <View style={s.coverStatDivider} />
                            <View style={s.coverStat}>
                                <Text style={s.coverStatValue}>{report.citations.length}</Text>
                                <Text style={s.coverStatLabel}>Citations</Text>
                            </View>
                        </View>
                    </View>

                    {/* Footer row */}
                    <View style={s.coverBottom}>
                        <View>
                            <Text style={s.coverBottomText}>{generatedDate} · {generatedTime}</Text>
                            <Text style={s.coverBottomText}>AI Research Engine — Powered by Gemini</Text>
                        </View>
                        <Text style={s.coverConfidential}>Confidential</Text>
                    </View>
                </View>
            </Page>

            {/* ══════════════════════════════════
                TABLE OF CONTENTS
            ══════════════════════════════════ */}
            <Page size="A4" style={s.page}>
                <PageHeader rightText={generatedDate} />
                <Text style={s.sectionLabel}>Navigation</Text>
                <Text style={s.sectionTitle}>Table of Contents</Text>
                <View style={s.sectionDivider} />
                <View style={s.tocRow}>
                    {tocItems.map((item, i) => (
                        <View key={i} style={s.tocCard}>
                            <View style={[s.tocBadge, { backgroundColor: ACCENTS[i % ACCENTS.length] }]}>
                                <Text style={s.tocBadgeText}>{i + 1}</Text>
                            </View>
                            <Text style={s.tocCardText}>{item}</Text>
                        </View>
                    ))}
                </View>
                <PageFooter year={year} />
            </Page>

            {/* ══════════════════════════════════
                EXECUTIVE SUMMARY
            ══════════════════════════════════ */}
            {report.summary ? (
                <Page size="A4" style={s.page}>
                    <PageHeader rightText={generatedDate} />

                    {/* Blue accent card */}
                    <View style={s.execSummaryCard}>
                        <Text style={s.execSummaryLabel}>Executive Summary</Text>
                        <Text style={s.execSummaryText}>{stripMd(report.summary)}</Text>

                        {/* Mini stats strip inside card */}
                        <View style={s.execStatsRow}>
                            <View style={s.execStat}>
                                <Text style={s.execStatValue}>{report.metadata.sourcesAnalyzed}</Text>
                                <Text style={s.execStatLabel}>Sources Analyzed</Text>
                            </View>
                            <View style={s.execStat}>
                                <Text style={s.execStatValue}>{report.metadata.estimatedReadTime}m</Text>
                                <Text style={s.execStatLabel}>Read Time</Text>
                            </View>
                            <View style={s.execStat}>
                                <Text style={s.execStatValue}>{report.citations.length}</Text>
                                <Text style={s.execStatLabel}>Citations</Text>
                            </View>
                        </View>
                    </View>

                    <PageFooter year={year} />
                </Page>
            ) : null}

            {/* ══════════════════════════════════
                SECTION SLIDES
            ══════════════════════════════════ */}
            {sections.map((section, idx) => {
                const accent = ACCENTS[idx % ACCENTS.length];
                const sectionNum = String(idx + 1).padStart(2, '0');
                return (
                    <Page key={idx} size="A4" style={s.page} wrap>
                        <PageHeader rightText={generatedDate} />

                        {/* Section header bar — refined navy, accent badge */}
                        <View
                            fixed
                            style={{
                                backgroundColor: C.navyHeader,
                                paddingVertical: 12,
                                paddingHorizontal: 18,
                                flexDirection: 'row' as const,
                                alignItems: 'center' as const,
                                gap: 10,
                                borderTopLeftRadius: 10,
                                borderTopRightRadius: 10,
                            }}
                        >
                            <View style={[s.slideBadge, { backgroundColor: accent }]}>
                                <Text style={s.slideBadgeText}>{sectionNum}</Text>
                            </View>
                            <Text style={s.slideTitle}>{section.title}</Text>
                        </View>

                        {/* Accent stripe */}
                        <View style={[s.slideAccent, { backgroundColor: accent }]} fixed />

                        {/* Content body */}
                        <View style={{
                            padding: 18,
                            borderWidth: 1,
                            borderColor: C.gray100,
                            borderTopWidth: 0,
                            borderBottomLeftRadius: 10,
                            borderBottomRightRadius: 10,
                            backgroundColor: C.pageBody,
                        }}>
                            <RenderBlocks blocks={section.blocks} />
                        </View>

                        <PageFooter year={year} />
                    </Page>
                );
            })}

            {/* ══════════════════════════════════
                REFERENCES
            ══════════════════════════════════ */}
            {report.citations.length > 0 ? (
                <Page size="A4" style={s.page}>
                    <PageHeader rightText="References" />
                    <Text style={s.sectionLabel}>Sources</Text>
                    <Text style={s.sectionTitle}>References & Citations</Text>
                    <View style={s.sectionDivider} />

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {report.citations.map((c, i) => (
                            <View key={i} style={s.refCard}>
                                <View style={[s.refBadge, { backgroundColor: c.source === 'SEC EDGAR' ? '#1E3A8A' : C.blue }]}>
                                    <Text style={s.refBadgeText}>{i + 1}</Text>
                                </View>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text style={s.refTitle}>{c.title}</Text>
                                    <Text style={s.refSource}>{c.source}{c.publishedDate ? ` · ${c.publishedDate}` : ''}</Text>
                                    {c.source === 'SEC EDGAR' && (
                                        <Text style={s.refSECBadge}>SEC EDGAR</Text>
                                    )}
                                    <Link src={c.url} style={{ textDecoration: 'none' }}>
                                        <Text style={s.refUrl}>{c.url}</Text>
                                    </Link>
                                </View>
                            </View>
                        ))}
                    </View>

                    {/* Disclaimer */}
                    <View style={s.disclaimer}>
                        <Text style={s.disclaimerText}>
                            <Text style={s.disclaimerBold}>Disclaimer: </Text>
                            This report was generated using AI-powered analysis of publicly available information.
                            While every effort is made to ensure accuracy, content should be independently verified
                            before making investment or business decisions. Market Intelligence AI does not provide
                            financial advice.
                        </Text>
                    </View>

                    <PageFooter year={year} />
                </Page>
            ) : null}
        </Document>
    );
}
