// qaHistory — Supabase persistence for Quick-Answer conversations.
//
// Mirrors the research_reports pattern but for the QA (WebSocket RAG) flow.
// Every call degrades gracefully: with no auth session the functions no-op or
// return empty, so dev/anon usage still works (history just isn't saved).

import { supabase } from './supabase';
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

async function userId(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
}

export function conversationTitle(query: string): string {
    const t = query.trim().replace(/\s+/g, ' ');
    return t.length > 60 ? `${t.slice(0, 60)}…` : t || 'Untitled';
}

export async function listQaConversations(): Promise<QaConversationMeta[]> {
    const uid = await userId();
    if (!uid) return [];
    const { data, error } = await supabase
        .from('qa_conversations')
        .select('id, title, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) return [];
    return data ?? [];
}

export async function createQaConversation(title: string): Promise<string | null> {
    const uid = await userId();
    if (!uid) return null;
    const { data, error } = await supabase
        .from('qa_conversations')
        .insert({ user_id: uid, title })
        .select('id')
        .single();
    if (error) return null;
    return data?.id ?? null;
}

export async function loadQaTurns(conversationId: string): Promise<QaTurnRecord[]> {
    const { data, error } = await supabase
        .from('qa_turns')
        .select('role, content, citations, sources, structured_data, chart_specs, follow_up')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
    if (error || !data) return [];
    return data.map(r => ({
        role: r.role,
        content: r.content,
        citations: r.citations ?? [],
        sources: r.sources ?? [],
        structuredData: r.structured_data ?? [],
        chartSpecs: r.chart_specs ?? [],
        followUpQueries: r.follow_up ?? [],
    }));
}

export async function saveQaTurn(conversationId: string, turn: QaTurnRecord): Promise<void> {
    const uid = await userId();
    if (!uid) return;
    await supabase.from('qa_turns').insert({
        conversation_id: conversationId,
        user_id: uid,
        role: turn.role,
        content: turn.content,
        citations: turn.citations ?? [],
        sources: turn.sources ?? [],
        structured_data: turn.structuredData ?? [],
        chart_specs: turn.chartSpecs ?? [],
        follow_up: turn.followUpQueries ?? [],
    });
    // Bump the parent so the sidebar can sort by recency.
    await supabase
        .from('qa_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);
}

export async function deleteQaConversation(id: string): Promise<void> {
    await supabase.from('qa_conversations').delete().eq('id', id);
}
