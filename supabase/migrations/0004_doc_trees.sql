-- GravityIndex doc-grounding engine: hierarchical filing trees for reasoning-based
-- (vectorless) navigation. Each row is one filing's TOC-like node tree; the LLM
-- navigates the outline to the exact section instead of cosine-matching chunks.
-- Backend writes via PostgREST + service-role key (bypasses RLS).

create table if not exists public.doc_trees (
    doc_id        text primary key,          -- stable per filing
    ticker        text,
    company       text,
    filing_type   text,
    filing_date   text,
    period        text,                       -- e.g. FY2023
    -- tree: [{node_id, title, level, section, summary, chunk_ids:[...], pages}]
    tree          jsonb not null,
    node_count    integer,
    created_at    timestamptz not null default now()
);

create index if not exists idx_doc_trees_ticker        on public.doc_trees(ticker);
create index if not exists idx_doc_trees_ticker_period on public.doc_trees(ticker, period);

alter table public.doc_trees enable row level security;
