// Auth client — three back-end modes:
//   1. "gravity_api"   — self-hosted FastAPI auth (P-A1). Default when
//                        VITE_GRAVITY_API_URL is set and VITE_DEV_AUTH_BYPASS != "true".
//   2. "supabase"      — legacy Supabase Auth (paused project).
//   3. "dev_bypass"    — VITE_DEV_AUTH_BYPASS=true (fake localStorage session).
//
// RBAC + workspace endpoints continue routing through market-server (`API`).
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

const DEV_AUTH_BYPASS = import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';
const GRAVITY_API_URL = import.meta.env.VITE_GRAVITY_API_URL || 'http://localhost:8000';
const USE_GRAVITY_API_AUTH =
    !DEV_AUTH_BYPASS && (import.meta.env.VITE_AUTH_BACKEND ?? 'gravity_api') === 'gravity_api';

const DEV_SESSION_KEY = 'gravity_dev_session_v1';
const GRAVITY_SESSION_KEY = 'gravity_api_session_v1';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Dev-mode helpers ─────────────────────────────────────────────────────────

interface DevSession {
    access_token: string;
    refresh_token: string;
    user: { id: string; email: string };
    expires_at: number;
}

function getDevSession(): DevSession | null {
    if (!DEV_AUTH_BYPASS) return null;
    try {
        const raw = localStorage.getItem(DEV_SESSION_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw) as DevSession;
        if (Date.now() / 1000 > s.expires_at) {
            localStorage.removeItem(DEV_SESSION_KEY);
            return null;
        }
        return s;
    } catch {
        return null;
    }
}

function setDevSession(email: string): DevSession {
    const s: DevSession = {
        access_token: `dev-token-${btoa(email)}-${Date.now()}`,
        refresh_token: `dev-refresh-${Date.now()}`,
        user: { id: `dev-${btoa(email)}`, email },
        expires_at: Math.floor(Date.now() / 1000) + 12 * 3600, // 12h
    };
    localStorage.setItem(DEV_SESSION_KEY, JSON.stringify(s));
    return s;
}

// ─── Gravity-API auth helpers ─────────────────────────────────────────────────

interface GravitySession {
    access_token: string;
    refresh_token: string;
    user: { id: string; email: string; org_id?: string };
    expires_at: number;        // unix seconds
}

function getGravitySession(): GravitySession | null {
    try {
        const raw = localStorage.getItem(GRAVITY_SESSION_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw) as GravitySession;
        if (Date.now() / 1000 > s.expires_at) {
            localStorage.removeItem(GRAVITY_SESSION_KEY);
            return null;
        }
        return s;
    } catch {
        return null;
    }
}

function saveGravitySession(payload: {
    access_token: string;
    refresh_token: string;
    user: { user_id: string; email: string; org_id?: string };
}): GravitySession {
    const s: GravitySession = {
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        user: { id: payload.user.user_id, email: payload.user.email, org_id: payload.user.org_id },
        expires_at: Math.floor(Date.now() / 1000) + 12 * 3600,  // matches backend JWT TTL
    };
    localStorage.setItem(GRAVITY_SESSION_KEY, JSON.stringify(s));
    return s;
}

async function gravityFetch(path: string, init?: RequestInit) {
    const res = await fetch(`${GRAVITY_API_URL}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...((init?.headers ?? {}) as Record<string, string>),
        },
    });
    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            if (typeof body?.detail === 'string') detail = body.detail;
        } catch { /* ignore */ }
        throw new Error(detail);
    }
    return res.status === 204 ? null : res.json();
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export const signUp = async (email: string, password: string, orgId: string = '') => {
    if (DEV_AUTH_BYPASS) {
        const s = setDevSession(email);
        return { user: s.user, session: s };
    }
    if (USE_GRAVITY_API_AUTH) {
        const data = await gravityFetch('/v1/auth/signup', {
            method: 'POST',
            body: JSON.stringify({ email, password, org_id: orgId }),
        });
        const s = saveGravitySession(data);
        return { user: s.user, session: s };
    }
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
};

export const signIn = async (email: string, password: string, mfaCode?: string) => {
    if (DEV_AUTH_BYPASS) {
        if (!email || !password) throw new Error('email + password required');
        const s = setDevSession(email);
        return { user: s.user, session: s };
    }
    if (USE_GRAVITY_API_AUTH) {
        const data = await gravityFetch('/v1/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password, mfa_code: mfaCode || null }),
        });
        const s = saveGravitySession(data);
        return { user: s.user, session: s };
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
};

export const signOut = async () => {
    if (DEV_AUTH_BYPASS) {
        localStorage.removeItem(DEV_SESSION_KEY);
        return;
    }
    if (USE_GRAVITY_API_AUTH) {
        const tok = getGravitySession()?.access_token;
        if (tok) {
            try {
                await fetch(`${GRAVITY_API_URL}/v1/auth/logout`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${tok}` },
                });
            } catch { /* best effort */ }
        }
        localStorage.removeItem(GRAVITY_SESSION_KEY);
        return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
};

export const getSession = async () => {
    if (DEV_AUTH_BYPASS) {
        return getDevSession();
    }
    if (USE_GRAVITY_API_AUTH) {
        return getGravitySession();
    }
    const { data: { session } } = await supabase.auth.getSession();
    return session;
};

// ─── Phase 1 auth flows: verify email, forgot password ────────────────────────

export const requestEmailVerification = async (email: string): Promise<void> => {
    if (!USE_GRAVITY_API_AUTH) {
        // Supabase has a different flow; for now no-op when not on gravity-api.
        return;
    }
    await gravityFetch('/v1/auth/verify/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
    });
};

export const confirmEmailVerification = async (token: string): Promise<void> => {
    if (!USE_GRAVITY_API_AUTH) return;
    await gravityFetch('/v1/auth/verify/confirm', {
        method: 'POST',
        body: JSON.stringify({ token }),
    });
};

export const requestPasswordReset = async (email: string): Promise<void> => {
    if (DEV_AUTH_BYPASS) return;
    if (USE_GRAVITY_API_AUTH) {
        await gravityFetch('/v1/auth/password/reset/request', {
            method: 'POST',
            body: JSON.stringify({ email }),
        });
        return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
};

export const confirmPasswordReset = async (token: string, newPassword: string): Promise<void> => {
    if (!USE_GRAVITY_API_AUTH) {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        return;
    }
    await gravityFetch('/v1/auth/password/reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, new_password: newPassword }),
    });
};

// ─── Phase 2: MFA (TOTP + recovery codes) ────────────────────────────────────

export interface MfaEnrollResponse {
    secret: string;
    provisioning_uri: string;
}

export interface MfaVerifyResponse {
    mfa_enabled: boolean;
    recovery_codes: string[];
}

async function gravityAuthFetch(path: string, init?: RequestInit) {
    const token = await getGravityToken();
    if (!token) throw new Error('not authenticated');
    return gravityFetch(path, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            ...((init?.headers ?? {}) as Record<string, string>),
        },
    });
}

async function getGravityToken(): Promise<string | null> {
    if (DEV_AUTH_BYPASS) return getDevSession()?.access_token ?? null;
    if (USE_GRAVITY_API_AUTH) return getGravitySession()?.access_token ?? null;
    return (await getSession())?.access_token ?? null;
}

export const mfaEnroll = (): Promise<MfaEnrollResponse> =>
    gravityAuthFetch('/v1/auth/mfa/enroll', { method: 'POST' });

export const mfaVerify = async (secret: string, code: string): Promise<MfaVerifyResponse> =>
    gravityAuthFetch('/v1/auth/mfa/verify', {
        method: 'POST',
        headers: { 'X-MFA-Secret': secret },
        body: JSON.stringify({ code }),
    });

export const mfaDisable = (password: string): Promise<void> =>
    gravityAuthFetch('/v1/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({ password }),
    });

export const mfaRecoveryRegenerate = (password: string): Promise<{ recovery_codes: string[] }> =>
    gravityAuthFetch('/v1/auth/mfa/recovery/regenerate', {
        method: 'POST',
        body: JSON.stringify({ password }),
    });

export const mfaQrUrl = (secret: string, email: string): string => {
    const params = new URLSearchParams({ secret, email });
    return `${GRAVITY_API_URL}/v1/auth/mfa/qr?${params.toString()}`;
};

export const getAccessToken = async (): Promise<string | null> => {
    if (DEV_AUTH_BYPASS) {
        return getDevSession()?.access_token || null;
    }
    if (USE_GRAVITY_API_AUTH) {
        return getGravitySession()?.access_token || null;
    }
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
