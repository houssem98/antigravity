// Supabase Client — frontend auth + §6.11 RBAC org/workspace/project helpers
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
};

export const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
};

export const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
};

export const getSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
};

export const getAccessToken = async (): Promise<string | null> => {
    const session = await getSession();
    return session?.access_token || null;
};

// ─── §6.11 RBAC types ────────────────────────────────────────────────────────

export type OrgRole = 'viewer' | 'auditor' | 'reviewer' | 'member' | 'admin';
export type OrgPlan = 'free' | 'pro' | 'enterprise';

export interface Organization {
    id:          string;
    name:        string;
    slug:        string;
    plan:        OrgPlan;
    max_members: number;
    settings:    Record<string, unknown>;
    created_at:  string;
    updated_at:  string;
}

export interface OrgMember {
    id:        string;
    org_id:    string;
    user_id:   string;
    role:      OrgRole;
    joined_at: string;
}

export interface OrgWithRole {
    role:          OrgRole;
    organizations: Organization;
}

export interface OrgWorkspace {
    id:          string;
    org_id:      string;
    name:        string;
    slug:        string;
    description: string | null;
    created_by:  string | null;
    created_at:  string;
    updated_at:  string;
}

export interface Project {
    id:               string;
    workspace_id:     string;
    name:             string;
    description:      string | null;
    retrieval_filter: Record<string, unknown>;
    created_by:       string | null;
    created_at:       string;
    archived_at:      string | null;
}

export interface AuditEntry {
    id:          number;
    ts:          string;
    actor_id:    string | null;
    org_id:      string | null;
    action:      string;
    target_type: string | null;
    target_id:   string | null;
    payload:     Record<string, unknown>;
}

// Role weight helper — mirrors server-side hierarchy
const ROLE_WEIGHT: Record<OrgRole, number> = { viewer: 1, auditor: 2, reviewer: 3, member: 4, admin: 5 };
export function roleAtLeast(actual: OrgRole | null | undefined, required: OrgRole): boolean {
    if (!actual) return false;
    return (ROLE_WEIGHT[actual] ?? 0) >= ROLE_WEIGHT[required];
}

// ─── API base (proxied through market-server) ─────────────────────────────────

const API = import.meta.env.VITE_API_URL || 'http://localhost:3002';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getAccessToken();
    const res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...((init?.headers ?? {}) as Record<string, string>),
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

// ─── Organizations ────────────────────────────────────────────────────────────

export const getMyOrgs = () =>
    apiFetch<OrgWithRole[]>('/api/orgs');

export const createOrg = (name: string, slug: string, plan: OrgPlan = 'free') =>
    apiFetch<Organization>('/api/orgs', {
        method: 'POST',
        body: JSON.stringify({ name, slug, plan }),
    });

export const getOrg = (orgId: string) =>
    apiFetch<Organization>(`/api/orgs/${orgId}`);

export const updateOrg = (orgId: string, patch: Partial<Pick<Organization, 'name' | 'settings' | 'plan'>>) =>
    apiFetch<Organization>(`/api/orgs/${orgId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
    });

// ─── Members ──────────────────────────────────────────────────────────────────

export const getOrgMembers = (orgId: string) =>
    apiFetch<OrgMember[]>(`/api/orgs/${orgId}/members`);

export const upsertOrgMember = (orgId: string, userId: string, role: OrgRole) =>
    apiFetch<OrgMember>(`/api/orgs/${orgId}/members/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
    });

export const removeOrgMember = (orgId: string, userId: string) =>
    apiFetch<void>(`/api/orgs/${orgId}/members/${userId}`, { method: 'DELETE' });

// ─── Workspaces ───────────────────────────────────────────────────────────────

export const getOrgWorkspaces = (orgId: string) =>
    apiFetch<OrgWorkspace[]>(`/api/orgs/${orgId}/workspaces`);

export const createWorkspace = (orgId: string, name: string, slug: string, description?: string) =>
    apiFetch<OrgWorkspace>(`/api/orgs/${orgId}/workspaces`, {
        method: 'POST',
        body: JSON.stringify({ name, slug, description }),
    });

export const getWorkspaceMembers = (orgId: string, workspaceId: string) =>
    apiFetch<OrgMember[]>(`/api/orgs/${orgId}/workspaces/${workspaceId}/members`);

export const upsertWorkspaceMember = (orgId: string, workspaceId: string, userId: string, role: OrgRole) =>
    apiFetch<OrgMember>(`/api/orgs/${orgId}/workspaces/${workspaceId}/members/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
    });

// ─── Projects ─────────────────────────────────────────────────────────────────

export const getProjects = (orgId: string, workspaceId: string) =>
    apiFetch<Project[]>(`/api/orgs/${orgId}/workspaces/${workspaceId}/projects`);

export const createProject = (
    orgId: string,
    workspaceId: string,
    name: string,
    opts?: { description?: string; retrieval_filter?: Record<string, unknown> },
) =>
    apiFetch<Project>(`/api/orgs/${orgId}/workspaces/${workspaceId}/projects`, {
        method: 'POST',
        body: JSON.stringify({ name, ...opts }),
    });

export const updateProject = (
    orgId: string,
    workspaceId: string,
    projectId: string,
    patch: Partial<Pick<Project, 'name' | 'description' | 'retrieval_filter'>> & { archived?: boolean },
) =>
    apiFetch<Project>(`/api/orgs/${orgId}/workspaces/${workspaceId}/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
    });

// ─── Audit log ────────────────────────────────────────────────────────────────

export const getAuditLog = (orgId: string, limit = 100, offset = 0) =>
    apiFetch<AuditEntry[]>(`/api/orgs/${orgId}/audit?limit=${limit}&offset=${offset}`);
