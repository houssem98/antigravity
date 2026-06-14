-- Exact financial facts (XBRL/table-extracted) for the structured retrieval
-- channel — runs on Supabase Postgres instead of Elasticsearch.
-- The backend reads/writes via PostgREST with the service-role key (which
-- bypasses RLS), so no public policy is needed.

create table if not exists public.financials (
    id              text primary key,         -- {ticker}_{metric}_{period}_{document_id}
    ticker          text not null,
    company         text,
    filing_type     text,
    filing_date     text,
    document_id     text,
    metric_name     text not null,
    period          text,
    value_raw       text,
    value_float     double precision,
    unit            text,
    source_section  text,
    caption         text,
    created_at      timestamptz not null default now()
);

create index if not exists idx_financials_ticker        on public.financials(ticker);
create index if not exists idx_financials_ticker_metric on public.financials(ticker, metric_name);
create index if not exists idx_financials_period        on public.financials(period);

-- Lock down anon/public; only the service-role key (backend) touches it.
alter table public.financials enable row level security;
