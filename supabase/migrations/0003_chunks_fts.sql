-- Keyword retrieval channel (document-copilot pattern): chunk text + Postgres
-- full-text search, replacing the dead Elasticsearch BM25 channel. One DB
-- (Supabase) instead of provisioning an ES cluster.
--
-- The backend reads/writes via PostgREST with the service-role key (bypasses
-- RLS). Ranked FTS lives in a SQL function (ts_rank ordering can't be a plain
-- PostgREST filter), called via /rest/v1/rpc/search_chunks_fts.

create table if not exists public.chunks (
    id            text primary key,         -- chunk_id (stable, matches Qdrant point id)
    document_id   text,
    ticker        text,
    company       text,
    document_title text,
    filing_type   text,
    filing_date   text,
    section       text,
    page          integer,
    chunk_level   integer,                  -- 2 = paragraph (the retrievable level)
    text          text not null,
    -- generated tsvector so inserts don't have to compute it
    tsv           tsvector generated always as (to_tsvector('english', coalesce(text, ''))) stored,
    created_at    timestamptz not null default now()
);

create index if not exists idx_chunks_tsv         on public.chunks using gin(tsv);
create index if not exists idx_chunks_ticker       on public.chunks(ticker);
create index if not exists idx_chunks_ticker_level on public.chunks(ticker, chunk_level);

alter table public.chunks enable row level security;

-- Ranked full-text search. websearch_to_tsquery handles quoted phrases / OR / -.
-- Optional ticker scoping (NULL/empty array = no scope). Paragraph level only.
create or replace function public.search_chunks_fts(
    q        text,
    tickers  text[] default null,
    k        integer default 50
)
returns table (
    id text, document_id text, ticker text, company text,
    document_title text, filing_type text, filing_date text,
    section text, page integer, text text, rank real
)
language sql stable as $$
    select c.id, c.document_id, c.ticker, c.company,
           c.document_title, c.filing_type, c.filing_date,
           c.section, c.page, c.text,
           ts_rank(c.tsv, websearch_to_tsquery('english', q)) as rank
    from public.chunks c
    where c.tsv @@ websearch_to_tsquery('english', q)
      and (c.chunk_level = 2 or c.chunk_level is null)
      and (tickers is null or array_length(tickers, 1) is null or c.ticker = any(tickers))
    order by rank desc
    limit k;
$$;
