-- Migration: Research Grid persistence (grid_runs table)
-- Stores saved grid runs per user so Grid mode can restore last run on mount.

CREATE TABLE IF NOT EXISTS public.grid_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    def JSONB NOT NULL,
    cells JSONB NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS grid_runs_user_created_idx
    ON public.grid_runs (user_id, created_at DESC);

ALTER TABLE public.grid_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grid_runs: owner read"
    ON public.grid_runs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "grid_runs: owner insert"
    ON public.grid_runs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "grid_runs: owner update"
    ON public.grid_runs FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "grid_runs: owner delete"
    ON public.grid_runs FOR DELETE
    USING (auth.uid() = user_id);
