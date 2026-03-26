-- Migration: Add Influencer Tracker UI & Agent Sub-system
-- Depends on: 20260316000001_initial_schema.sql (Gravity Search Core)

-- Ensure vector extension is enabled inside the main Gravity Search DB
CREATE EXTENSION IF NOT EXISTS vector;

-- Influencers Table
CREATE TABLE IF NOT EXISTS public.influencers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handle TEXT UNIQUE NOT NULL,
    twitter_user_id TEXT,
    follower_count BIGINT DEFAULT 0,
    reputation_score DECIMAL(5,2) DEFAULT 50.00,
    win_loss_ratio DECIMAL(5,2) DEFAULT 0.00,
    tracked_coins TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Signals Feed Table (Dual-Oracle Schema)
CREATE TABLE IF NOT EXISTS public.signals_feed (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID REFERENCES public.influencers(id) ON DELETE CASCADE,
    tweet_id TEXT UNIQUE NOT NULL,
    tweet_url TEXT NOT NULL,
    token_ticker TEXT NOT NULL,
    contract_address TEXT,
    entry_price_cmc DECIMAL(20,10),
    entry_price_cg DECIMAL(20,10),
    entry_price_consensus DECIMAL(20,10) NOT NULL,
    price_target DECIMAL(20,10),
    timeframe TEXT,
    conviction_level INTEGER CHECK (conviction_level >= 1 AND conviction_level <= 10),
    market_outcome TEXT DEFAULT 'Pending' CHECK (market_outcome IN ('Success', 'Fail', 'Pending')),
    sentiment TEXT,
    ai_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- Agent Memory Graph (Embeddings)
CREATE TABLE IF NOT EXISTS public.agent_memory_graph (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id UUID REFERENCES public.influencers(id) ON DELETE CASCADE,
    source_tweet_id TEXT REFERENCES public.signals_feed(tweet_id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    embedding vector(1536), -- Standard size for OpenAI/modern embedding models
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.influencers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals_feed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory_graph ENABLE ROW LEVEL SECURITY;

-- Allow public read access to influencers and signals (For the UI)
CREATE POLICY "Allow public read access for influencers" ON public.influencers FOR SELECT USING (true);
CREATE POLICY "Allow public read access for signals_feed" ON public.signals_feed FOR SELECT USING (true);

-- Allow authenticated users to interact if needed later (Requires tying to Gravity Search `auth.users`)
-- CREATE POLICY "Allow authenticated full access" ON public.influencers FOR ALL USING (auth.role() = 'authenticated');
