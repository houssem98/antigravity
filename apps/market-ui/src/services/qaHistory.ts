// qaHistory — Quick-Answer conversation persistence.
//
// Backed by gravity-api's own Postgres (POST/GET /v1/library/qa/*), keyed by the
// gravity user id. This replaces the previous Supabase-direct access, which was
// dead in gravity-api auth mode (the qa_* tables are bound to Supabase
// auth.users via a uuid FK that gravity users don't satisfy).
//
// Every call degrades gracefully: with no auth session the helpers no-op or
// return empty, so dev/anon usage still works (history just isn't saved).

import { gravityApi } from './supabase';
import type {
    GravityCitation, GravitySource, GravityMetric, ChartSpec,
} from '../hooks/useGravitySearch';

export interface QaConversationMeta {
    id: string;
    title: string;
    created_at: string;
}

export interface QaTurnRecord {
    role: 'user' | 'assistant';
    content: string;
    citations?: GravityCitation[];
    sources?: GravitySource[];
    structuredData?: GravityMetric[];
    chartSpecs?: ChartSpec[];
    followUpQueries?: string[];
}

export function conversationTitle(query: string): string {
    const t = query.trim().replace(/\s+/g, ' ');
    return t.length > 60 ? `${t.slice(0, 60)}…` : t || 'Untitled';
}

export async function listQaConversations(): Promise<QaConversationMeta[]> {
    try {
        return (await gravityApi('/v1/library/qa/conversations')) ?? [];
    } catch {
        return [];
    }
}

export async function createQaConversation(title: string): Promise<string | null> {
    try {
        const res = await gravityApi('/v1/library/qa/conversations', {
            method: 'POST',
            body: JSON.stringify({ title }),
        });
        return res?.id ?? null;
    } catch {
        return null;
    }
}

export async function loadQaTurns(conversationId: string): Promise<QaTurnRecord[]> {
    try {
        const rows = await gravityApi(
            `/v1/library/qa/conversations/${encodeURIComponent(conversationId)}/turns`,
        );
        return (rows ?? []).map((r: QaTurnRecord) => ({
            role: r.role,
            content: r.content,
            citations: r.citations ?? [],
            sources: r.sources ?? [],
            structuredData: r.structuredData ?? [],
            chartSpecs: r.chartSpecs ?? [],
            followUpQueries: r.followUpQueries ?? [],
        }));
    } catch {
        return [];
    }
}

export async function saveQaTurn(conversationId: string, turn: QaTurnRecord): Promise<void> {
    try {
        await gravityApi(
            `/v1/library/qa/conversations/${encodeURIComponent(conversationId)}/turns`,
            { method: 'POST', body: JSON.stringify(turn) },
        );
    } catch {
        /* not authenticated / offline — history just isn't saved */
    }
}

export async function deleteQaConversation(id: string): Promise<void> {
    try {
        await gravityApi(`/v1/library/qa/conversations/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
    } catch {
        /* ignore */
    }
}
