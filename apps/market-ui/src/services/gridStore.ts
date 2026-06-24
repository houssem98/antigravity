// gridStore — Supabase persistence for Research Grid runs.
// See migration 20260418000001_grid_runs.sql for schema.

import { supabase } from './supabase';
import type { GridDef, GridState, GridCell } from './gridResearch';

export interface SavedGridRow {
    id: string;
    name: string;
    def: GridDef;
    cells: Record<string, GridCell>;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
}

export async function saveGridRun(state: GridState): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const { data, error } = await supabase.from('grid_runs').insert({
        user_id: session.user.id,
        name: state.def.name,
        def: state.def,
        cells: state.cells,
        started_at: state.startedAt ?? null,
        completed_at: state.completedAt ?? null,
    }).select('id').single();

    if (error) return null;
    return data?.id ?? null;
}

export async function loadLatestGridRun(): Promise<GridState | null> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const { data } = await supabase
        .from('grid_runs')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!data) return null;
    return rowToState(data as SavedGridRow);
}

export async function loadGridRun(id: string): Promise<GridState | null> {
    const { data } = await supabase
        .from('grid_runs')
        .select('*')
        .eq('id', id)
        .maybeSingle();
    if (!data) return null;
    return rowToState(data as SavedGridRow);
}

export async function listGridRuns(limit = 20): Promise<SavedGridRow[]> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];

    const { data } = await supabase
        .from('grid_runs')
        .select('id, name, def, cells, started_at, completed_at, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

    return (data as SavedGridRow[] | null) ?? [];
}

export async function deleteGridRun(id: string): Promise<boolean> {
    const { error } = await supabase.from('grid_runs').delete().eq('id', id);
    return !error;
}

function rowToState(row: SavedGridRow): GridState {
    return {
        def: row.def,
        cells: row.cells,
        startedAt: row.started_at ?? undefined,
        completedAt: row.completed_at ?? undefined,
    };
}
