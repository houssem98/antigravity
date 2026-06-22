// gridStore — Research Grid run persistence.
//
// Backed by gravity-api's own Postgres (/v1/library/grids), keyed by the gravity
// user id. Replaces the previous Supabase-direct access to grid_runs, which was
// dead in gravity-api auth mode (uuid FK to auth.users). Degrades gracefully:
// with no auth session, reads return empty/null and saves return null.

import { gravityApi } from './supabase';
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
    try {
        const res = await gravityApi('/v1/library/grids', {
            method: 'POST',
            body: JSON.stringify({
                name: state.def.name,
                def: state.def,
                cells: state.cells,
                started_at: state.startedAt ?? null,
                completed_at: state.completedAt ?? null,
            }),
        });
        return res?.id ?? null;
    } catch {
        return null;
    }
}

export async function loadLatestGridRun(): Promise<GridState | null> {
    try {
        const row = await gravityApi('/v1/library/grids/latest');
        return row ? rowToState(row as SavedGridRow) : null;
    } catch {
        return null;
    }
}

export async function loadGridRun(id: string): Promise<GridState | null> {
    try {
        const row = await gravityApi(`/v1/library/grids/${encodeURIComponent(id)}`);
        return row ? rowToState(row as SavedGridRow) : null;
    } catch {
        return null;
    }
}

export async function listGridRuns(limit = 20): Promise<SavedGridRow[]> {
    try {
        return (await gravityApi(`/v1/library/grids?limit=${limit}`)) ?? [];
    } catch {
        return [];
    }
}

export async function deleteGridRun(id: string): Promise<boolean> {
    try {
        await gravityApi(`/v1/library/grids/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return true;
    } catch {
        return false;
    }
}

function rowToState(row: SavedGridRow): GridState {
    return {
        def: row.def,
        cells: row.cells,
        startedAt: row.started_at ?? undefined,
        completedAt: row.completed_at ?? undefined,
    };
}
