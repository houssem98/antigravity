-- Quick-Answer (QA) conversation history.
-- Persists the WebSocket RAG threads so users get a sidebar of past Q&A,
-- the same way research_reports backs Deep Research.

create table if not exists public.qa_conversations (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    title       text not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists public.qa_turns (
    id               uuid primary key default gen_random_uuid(),
    conversation_id  uuid not null references public.qa_conversations(id) on delete cascade,
    user_id          uuid not null references auth.users(id) on delete cascade,
    role             text not null check (role in ('user', 'assistant')),
    content          text not null,
    citations        jsonb not null default '[]',
    sources          jsonb not null default '[]',
    structured_data  jsonb not null default '[]',
    chart_specs      jsonb not null default '[]',
    follow_up        jsonb not null default '[]',
    created_at       timestamptz not null default now()
);

create index if not exists idx_qa_conversations_user
    on public.qa_conversations(user_id, updated_at desc);
create index if not exists idx_qa_turns_conversation
    on public.qa_turns(conversation_id, created_at);

-- Row-level security: a user sees only their own rows.
alter table public.qa_conversations enable row level security;
alter table public.qa_turns        enable row level security;

drop policy if exists "own qa conversations" on public.qa_conversations;
create policy "own qa conversations" on public.qa_conversations
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own qa turns" on public.qa_turns;
create policy "own qa turns" on public.qa_turns
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
