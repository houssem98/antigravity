-- ============================================================
-- §6.11 Three-Tier RBAC: Organization → Workspace → Project
-- ============================================================
-- Tier 1: organization   — a firm, institution, or individual account
-- Tier 2: org_workspace  — a team or department within an organization
-- Tier 3: project        — a research project within a workspace
--
-- Roles (least → most privileged): viewer < auditor < reviewer < member < admin
-- org_members.role governs the default across all workspaces in an org.
-- workspace_members.role optionally overrides per-workspace (never escalates above org role).
-- Source-level entitlements: retrieval_filter column on projects gates which
-- data sources can be queried — prevents exfiltration of unlicensed content.
-- ============================================================

-- ── Role type ────────────────────────────────────────────────────────────────
create type if not exists org_role as enum ('viewer','auditor','reviewer','member','admin');

-- Helper: numeric weight for role comparison (used in RLS and app logic).
-- Stored as a SQL function so policy expressions can call it without joins.
create or replace function role_weight(r org_role) returns int language sql immutable as $$
    select case r
        when 'viewer'   then 1
        when 'auditor'  then 2
        when 'reviewer' then 3
        when 'member'   then 4
        when 'admin'    then 5
        else 0
    end;
$$;

-- ── organizations ─────────────────────────────────────────────────────────────
create table if not exists organizations (
    id          uuid        primary key default gen_random_uuid(),
    name        text        not null,
    slug        text        not null unique,
    plan        text        not null default 'free'   check (plan in ('free','pro','enterprise')),
    max_members int         not null default 5,
    settings    jsonb       not null default '{}',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists idx_orgs_slug on organizations(slug);

-- ── org_members ───────────────────────────────────────────────────────────────
create table if not exists org_members (
    id          uuid        primary key default gen_random_uuid(),
    org_id      uuid        not null references organizations(id) on delete cascade,
    user_id     uuid        not null references auth.users(id)   on delete cascade,
    role        org_role    not null default 'viewer',
    invited_by  uuid        references auth.users(id),
    joined_at   timestamptz not null default now(),
    unique (org_id, user_id)
);
create index if not exists idx_org_members_user on org_members(user_id);
create index if not exists idx_org_members_org  on org_members(org_id);

-- ── org_workspaces ────────────────────────────────────────────────────────────
create table if not exists org_workspaces (
    id          uuid        primary key default gen_random_uuid(),
    org_id      uuid        not null references organizations(id) on delete cascade,
    name        text        not null,
    slug        text        not null,
    description text,
    created_by  uuid        references auth.users(id),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (org_id, slug)
);
create index if not exists idx_ws_org on org_workspaces(org_id);

-- ── workspace_members ─────────────────────────────────────────────────────────
-- Optional per-workspace role. Must be ≤ the user's org-level role (enforced
-- in the server-side upsert helper — see rbac.ts — not in a DB trigger, to
-- keep the migration portable across Supabase plans).
create table if not exists workspace_members (
    id           uuid        primary key default gen_random_uuid(),
    workspace_id uuid        not null references org_workspaces(id) on delete cascade,
    user_id      uuid        not null references auth.users(id)     on delete cascade,
    role         org_role    not null default 'viewer',
    added_at     timestamptz not null default now(),
    unique (workspace_id, user_id)
);
create index if not exists idx_wm_workspace on workspace_members(workspace_id);
create index if not exists idx_wm_user      on workspace_members(user_id);

-- ── projects ──────────────────────────────────────────────────────────────────
create table if not exists projects (
    id                  uuid        primary key default gen_random_uuid(),
    workspace_id        uuid        not null references org_workspaces(id) on delete cascade,
    name                text        not null,
    description         text,
    retrieval_filter    jsonb       not null default '{}',
    -- e.g. {"allowed_sources": ["SEC","transcripts"], "denied_sources": ["broker_research"]}
    created_by          uuid        references auth.users(id),
    created_at          timestamptz not null default now(),
    archived_at         timestamptz
);
create index if not exists idx_proj_workspace on projects(workspace_id);
create index if not exists idx_proj_active    on projects(workspace_id) where archived_at is null;

-- ── audit_log ─────────────────────────────────────────────────────────────────
-- Append-only; INSERT-only policy; no UPDATE/DELETE allowed.
create table if not exists rbac_audit_log (
    id          bigserial   primary key,
    ts          timestamptz not null default now(),
    actor_id    uuid        references auth.users(id),
    org_id      uuid        references organizations(id),
    action      text        not null,   -- 'invite_member','change_role','create_workspace',…
    target_type text,
    target_id   uuid,
    payload     jsonb       not null default '{}'
);
create index if not exists idx_audit_org  on rbac_audit_log(org_id, ts);
create index if not exists idx_audit_user on rbac_audit_log(actor_id, ts);

-- ── Row Level Security ────────────────────────────────────────────────────────

alter table organizations      enable row level security;
alter table org_members        enable row level security;
alter table org_workspaces     enable row level security;
alter table workspace_members  enable row level security;
alter table projects           enable row level security;
alter table rbac_audit_log     enable row level security;

-- Helper function: get the authenticated user's role in an org.
create or replace function my_org_role(p_org_id uuid) returns org_role
    language sql security definer stable as $$
    select role from org_members
    where org_id = p_org_id and user_id = auth.uid()
    limit 1;
$$;

-- Helper: get the authenticated user's effective role in a workspace
-- (workspace override if present, else fall back to org role).
create or replace function my_workspace_role(p_workspace_id uuid) returns org_role
    language sql security definer stable as $$
    select coalesce(
        (select wm.role from workspace_members wm
         where wm.workspace_id = p_workspace_id and wm.user_id = auth.uid()
         limit 1),
        (select om.role from org_members om
         join org_workspaces ow on ow.org_id = om.org_id
         where ow.id = p_workspace_id and om.user_id = auth.uid()
         limit 1)
    );
$$;

-- organizations: only members can see their orgs
create policy "org members can select" on organizations
    for select using (
        exists (select 1 from org_members where org_id = id and user_id = auth.uid())
    );
create policy "org admins can update" on organizations
    for update using (role_weight(my_org_role(id)) >= role_weight('admin'));

-- org_members: members can list other members in their org
create policy "org members can list members" on org_members
    for select using (
        exists (select 1 from org_members m2 where m2.org_id = org_id and m2.user_id = auth.uid())
    );
create policy "org admins can manage members" on org_members
    for all using (role_weight(my_org_role(org_id)) >= role_weight('admin'));

-- org_workspaces: any org member can read; only admin/member can create/update
create policy "org members can list workspaces" on org_workspaces
    for select using (role_weight(my_org_role(org_id)) >= role_weight('viewer'));
create policy "org members can create workspaces" on org_workspaces
    for insert with check (role_weight(my_org_role(org_id)) >= role_weight('member'));
create policy "workspace admins can update" on org_workspaces
    for update using (role_weight(my_workspace_role(id)) >= role_weight('admin'));

-- workspace_members: readable by org members, writable by workspace admins
create policy "org members can read workspace_members" on workspace_members
    for select using (
        exists (
            select 1 from org_workspaces ow
            join org_members om on om.org_id = ow.org_id
            where ow.id = workspace_id and om.user_id = auth.uid()
        )
    );
create policy "workspace admins manage workspace_members" on workspace_members
    for all using (role_weight(my_workspace_role(workspace_id)) >= role_weight('admin'));

-- projects: visible to all workspace members; create/update requires member+
create policy "workspace members can list projects" on projects
    for select using (role_weight(my_workspace_role(workspace_id)) >= role_weight('viewer'));
create policy "workspace members can create projects" on projects
    for insert with check (role_weight(my_workspace_role(workspace_id)) >= role_weight('member'));
create policy "workspace members can update projects" on projects
    for update using (role_weight(my_workspace_role(workspace_id)) >= role_weight('member'));

-- audit_log: any org member can read their org's log; INSERT is unrestricted
-- (application writes via service-role key; no UPDATE/DELETE ever allowed)
create policy "org members can read audit log" on rbac_audit_log
    for select using (
        exists (select 1 from org_members where org_id = rbac_audit_log.org_id and user_id = auth.uid())
    );
create policy "service role can insert audit" on rbac_audit_log
    for insert with check (true);

-- ── Triggers ──────────────────────────────────────────────────────────────────
-- Auto-update updated_at on organizations and org_workspaces.

create or replace function trigger_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger set_org_updated_at
    before update on organizations
    for each row execute function trigger_set_updated_at();

create trigger set_workspace_updated_at
    before update on org_workspaces
    for each row execute function trigger_set_updated_at();
