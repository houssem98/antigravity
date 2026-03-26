-- ============================================================
-- Gravity Search — Initial Schema
-- Paste this into Supabase SQL Editor and click Run
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── companies ────────────────────────────────────────────────
create table if not exists companies (
  id          varchar(36) primary key default gen_random_uuid()::text,
  name        varchar(255) not null,
  ticker      varchar(10)  unique not null,
  isin        varchar(12)  unique,
  sector      varchar(100),
  industry    varchar(100),
  country     varchar(50),
  market_cap  float,
  exchange    varchar(20),
  created_at  timestamptz  default now(),
  updated_at  timestamptz  default now()
);
create index if not exists idx_companies_name   on companies(name);
create index if not exists idx_companies_ticker on companies(ticker);

-- ── documents ────────────────────────────────────────────────
create table if not exists documents (
  id              varchar(36) primary key default gen_random_uuid()::text,
  company_id      varchar(36) references companies(id),
  title           varchar(500) not null,
  ticker          varchar(10),
  filing_type     varchar(20),   -- 10-K, 10-Q, 8-K, earnings_transcript, news
  filing_date     date,
  fiscal_year     integer,
  fiscal_quarter  varchar(5),    -- Q1, Q2, Q3, Q4, FY
  source_url      text,
  raw_text        text,
  metadata        jsonb default '{}',
  status          varchar(20) default 'pending',  -- pending, processing, indexed, failed
  chunk_count     integer default 0,
  created_at      timestamptz default now()
);
create index if not exists idx_doc_ticker_date  on documents(ticker, filing_date);
create index if not exists idx_doc_type_date    on documents(filing_type, filing_date);
create index if not exists idx_doc_company      on documents(company_id);

-- ── chunks ───────────────────────────────────────────────────
create table if not exists chunks (
  id                  varchar(36) primary key default gen_random_uuid()::text,
  document_id         varchar(36) not null references documents(id) on delete cascade,
  text                text not null,
  text_with_metadata  text,
  chunk_level         integer not null,  -- 1=section, 2=paragraph, 3=sentence
  section_name        varchar(200),
  page_number         integer,
  token_count         integer,
  position            integer,
  metadata            jsonb default '{}',
  created_at          timestamptz default now()
);
create index if not exists idx_chunk_doc_level on chunks(document_id, chunk_level);

-- ── financial_statements ─────────────────────────────────────
create table if not exists financial_statements (
  id                  varchar(36) primary key default gen_random_uuid()::text,
  company_id          varchar(36) references companies(id),
  ticker              varchar(10) not null,
  metric_name         varchar(100) not null,
  value               float not null,
  currency            varchar(3) default 'USD',
  fiscal_year         integer not null,
  fiscal_quarter      varchar(5),
  filing_date         date not null,
  source_document_id  varchar(36),
  created_at          timestamptz default now()
);
create index if not exists idx_fin_ticker_metric on financial_statements(ticker, metric_name);
create index if not exists idx_fin_ticker_date   on financial_statements(ticker, filing_date);

-- ── consensus_estimates ──────────────────────────────────────
create table if not exists consensus_estimates (
  id              varchar(36) primary key default gen_random_uuid()::text,
  company_id      varchar(36) references companies(id),
  ticker          varchar(10) not null,
  metric_name     varchar(100) not null,
  estimate_value  float,
  actual_value    float,
  period          varchar(10),
  analyst_count   integer,
  estimate_date   date,
  source          varchar(100),
  created_at      timestamptz default now()
);
create index if not exists idx_est_ticker on consensus_estimates(ticker);

-- ── price_data ───────────────────────────────────────────────
create table if not exists price_data (
  id          varchar(36) primary key default gen_random_uuid()::text,
  ticker      varchar(10) not null,
  date        date not null,
  open        float,
  high        float,
  low         float,
  close       float,
  volume      float,
  market_cap  float,
  unique (ticker, date)
);
create index if not exists idx_price_ticker on price_data(ticker);
create index if not exists idx_price_date   on price_data(date);

-- ── workspaces ───────────────────────────────────────────────
create table if not exists workspaces (
  id          varchar(36) primary key default gen_random_uuid()::text,
  name        varchar(200) not null,
  user_id     varchar(36),
  query       text not null,
  answer      text not null,
  search_id   varchar(36),
  snapshot    jsonb default '{}',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_workspace_user_date on workspaces(user_id, created_at);

-- ── search_logs ──────────────────────────────────────────────
create table if not exists search_logs (
  id                  varchar(36) primary key default gen_random_uuid()::text,
  trace_id            varchar(36) unique,
  query               text not null,
  user_id             varchar(36),
  intent              varchar(50),
  complexity          varchar(20),
  model_used          varchar(50),
  latency_ms          float,
  cost_usd            float,
  passages_retrieved  integer,
  cache_hit           boolean default false,
  answer_confidence   varchar(10),
  user_feedback       varchar(10),
  filters             jsonb,
  created_at          timestamptz default now()
);
create index if not exists idx_log_user_date  on search_logs(user_id, created_at);
create index if not exists idx_log_trace      on search_logs(trace_id);

-- ── Row Level Security (auth) ─────────────────────────────────
-- search_logs: users see only their own logs
alter table search_logs enable row level security;
create policy "Users see own logs" on search_logs
  for all using (auth.uid()::text = user_id);

-- workspaces: users see only their own workspaces
alter table workspaces enable row level security;
create policy "Users see own workspaces" on workspaces
  for all using (auth.uid()::text = user_id);

-- public read on companies, documents, financial data
alter table companies             enable row level security;
alter table documents             enable row level security;
alter table chunks                enable row level security;
alter table financial_statements  enable row level security;
alter table consensus_estimates   enable row level security;
alter table price_data            enable row level security;

create policy "Public read companies"            on companies            for select using (true);
create policy "Public read documents"            on documents            for select using (true);
create policy "Public read chunks"               on chunks               for select using (true);
create policy "Public read financial_statements" on financial_statements for select using (true);
create policy "Public read consensus_estimates"  on consensus_estimates  for select using (true);
create policy "Public read price_data"           on price_data           for select using (true);
