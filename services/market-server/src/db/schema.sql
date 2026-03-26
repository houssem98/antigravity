-- Supabase SQL Schema — run this in your Supabase SQL Editor
-- Go to: Supabase Dashboard → SQL Editor → New Query → Paste & Run

-- Research Reports table
CREATE TABLE IF NOT EXISTS research_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  markdown TEXT NOT NULL,
  citations JSONB DEFAULT '[]',
  sources_analyzed INTEGER DEFAULT 0,
  read_time INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast user queries
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON research_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON research_reports(created_at DESC);

-- Row Level Security — users can only see their own reports
ALTER TABLE research_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own reports"
  ON research_reports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reports"
  ON research_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can do everything"
  ON research_reports FOR ALL
  USING (auth.role() = 'service_role');
