// reports — Deep-Research report persistence.
//
// Backed by gravity-api's own Postgres (/v1/library/reports), keyed by the
// gravity user id. Replaces the previous Supabase-direct access to
// research_reports, which was dead in gravity-api auth mode (uuid FK to
// auth.users). Degrades gracefully: with no auth session, reads return empty
// and saves return null.

import { gravityApi } from './supabase';

export interface ReportMeta {
    id: string;
    query: string;
    title: string;
    summary?: string;
    sources_analyzed?: number;
    read_time?: number;
    created_at: string;
}

export interface ReportFull extends ReportMeta {
    markdown: string;
    citations: unknown[];
}

export interface SaveReportInput {
    query: string;
    title: string;
    summary?: string;
    markdown: string;
    citations?: unknown[];
    sources_analyzed?: number;
    read_time?: number;
}

export async function listReports(): Promise<ReportMeta[]> {
    try {
        return (await gravityApi('/v1/library/reports')) ?? [];
    } catch {
        return [];
    }
}

export async function getReport(id: string): Promise<ReportFull | null> {
    try {
        return (await gravityApi(`/v1/library/reports/${encodeURIComponent(id)}`)) ?? null;
    } catch {
        return null;
    }
}

export async function saveReport(input: SaveReportInput): Promise<string | null> {
    try {
        const res = await gravityApi('/v1/library/reports', {
            method: 'POST',
            body: JSON.stringify(input),
        });
        return res?.id ?? null;
    } catch {
        return null;
    }
}

export async function deleteReport(id: string): Promise<void> {
    try {
        await gravityApi(`/v1/library/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
        /* ignore */
    }
}
