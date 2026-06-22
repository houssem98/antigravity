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

// Supabase client. When VITE_AUTH_BACKEND=supabase, this is the primary auth
// backend — sessions persist in localStorage and auto-refresh. URL token
// detection stays off because AppRouter already scrubs magic-link fragments
// and we don't use Supabase OAuth providers today.
const _useSupabaseAuth =
    !DEV_AUTH_BYPASS && (import.meta.env.VITE_AUTH_BACKEND ?? 'gravity_api') === 'supabase';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        // Detect Supabase recovery / OAuth hash fragments when Supabase is the
        // primary auth backend — needed for password reset email links which
        // arrive as `#access_token=...&type=recovery`.
        detectSessionInUrl: _useSupabaseAuth,
        persistSession: _useSupabaseAuth,
        autoRefreshToken: _useSupabaseAuth,
    },
});

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

// Decode the `exp` claim from a JWT so the client's notion of expiry matches
// the backend's actual token TTL (instead of a hardcoded guess that drifts).
function jwtExp(token: string): number | null {
    try {
        const part = token.split('.')[1];
        if (!part) return null;
        const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(json) as { exp?: number };
        return typeof payload.exp === 'number' ? payload.exp : null;
    } catch {
        return null;
    }
}

// Raw read — returns the stored session even if expired, so the refresh_token
// remains available to renew it. Never deletes.
function readGravitySession(): GravitySession | null {
    try {
        const raw = localStorage.getItem(GRAVITY_SESSION_KEY);
        return raw ? (JSON.parse(raw) as GravitySession) : null;
    } catch {
        return null;
    }
}

function clearGravitySession(): void {
    localStorage.removeItem(GRAVITY_SESSION_KEY);
    _notifyAuth();
}

// Treat the token as expired 60s early so a renewal lands before the backend
// would 401.
function gravitySessionExpired(s: { expires_at: number }, skewSec = 60): boolean {
    return Date.now() / 1000 > s.expires_at - skewSec;
}

// Backward-compatible sync reader: valid session or null. No longer deletes on
// expiry (the refresh path needs the stored refresh_token to survive).
function getGravitySession(): GravitySession | null {
    const s = readGravitySession();
    if (!s) return null;
    return gravitySessionExpired(s, 0) ? null : s;
}

// Exchange the stored refresh_token for a fresh access token via the backend
// `/v1/auth/refresh` endpoint. Concurrent callers share one in-flight request.
let _refreshInFlight: Promise<GravitySession | null> | null = null;
async function refreshGravitySession(): Promise<GravitySession | null> {
    const cur = readGravitySession();
    if (!cur?.refresh_token) return null;
    if (_refreshInFlight) return _refreshInFlight;
    _refreshInFlight = (async () => {
        try {
            const res = await fetch(`${GRAVITY_API_URL}/v1/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: cur.refresh_token }),
            });
            if (res.status === 401) {
                // Refresh token itself is dead — session is unrecoverable.
                clearGravitySession();
                return null;
            }
            if (!res.ok) return null; // transient server error — keep session, retry later
            return saveGravitySession(await res.json());
        } catch {
            return null; // network blip — keep session, retry later
        } finally {
            _refreshInFlight = null;
        }
    })();
    return _refreshInFlight;
}

// Async accessor: returns a valid session, refreshing transparently if the
// access token has expired. Returns null only when truly logged out.
async function ensureGravitySession(): Promise<GravitySession | null> {
    const cur = readGravitySession();
    if (!cur) return null;
    if (!gravitySessionExpired(cur)) return cur;
    return refreshGravitySession();
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
        // Prefer the JWT's real exp; fall back to 12h only if it can't be read.
        expires_at: jwtExp(payload.access_token) ?? Math.floor(Date.now() / 1000) + 12 * 3600,
    };
    localStorage.setItem(GRAVITY_SESSION_KEY, JSON.stringify(s));
    _notifyAuth();
    return s;
}

// ─── Session manager ──────────────────────────────────────────────────────────
// Single source of truth for the auth lifecycle: proactive refresh (token never
// expires mid-use), cross-tab synchronization, and a pub/sub observer so the
// whole app reacts to login/logout/refresh from one place.

export type AuthUser = { id: string; email?: string; org_id?: string };
export type AuthState = { user: AuthUser } | null;

const _authListeners = new Set<(s: AuthState) => void>();
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _managerStarted = false;

// Best-effort synchronous read of the current session across all backends.
function currentAuthState(): AuthState {
    if (DEV_AUTH_BYPASS) {
        const s = getDevSession();
        return s ? { user: { id: s.user.id, email: s.user.email } } : null;
    }
    if (USE_GRAVITY_API_AUTH) {
        const s = readGravitySession();
        return s ? { user: s.user } : null;
    }
    return null; // Supabase mode emits via its own onAuthStateChange below
}

function _notifyAuth(): void {
    const state = currentAuthState();
    for (const cb of _authListeners) {
        try { cb(state); } catch { /* a bad listener must not break the others */ }
    }
    scheduleProactiveRefresh();
}

// Subscribe to auth changes. Fires immediately with the current state, and on
// every login/logout/refresh (including changes made in other tabs). Returns an
// unsubscribe function.
export function subscribeAuth(cb: (s: AuthState) => void): () => void {
    _authListeners.add(cb);
    cb(currentAuthState());
    return () => { _authListeners.delete(cb); };
}

export function getCurrentUserId(): string | null {
    return currentAuthState()?.user.id ?? null;
}

// Schedule a refresh to fire ~60s before the access token expires, so an active
// session is renewed before it can ever 401. Re-armed on every token change.
function scheduleProactiveRefresh(): void {
    if (!USE_GRAVITY_API_AUTH || typeof window === 'undefined') return;
    if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
    const s = readGravitySession();
    if (!s) return;
    const msUntilRefresh = Math.max(0, (s.expires_at - 60) * 1000 - Date.now());
    // Cap at ~24d (setTimeout 32-bit limit); re-arms itself on each fire anyway.
    _refreshTimer = setTimeout(() => { void refreshGravitySession(); },
        Math.min(msUntilRefresh, 2_000_000_000));
}

// Start the session manager once at app boot. Idempotent.
export function startSessionManager(): void {
    if (_managerStarted || typeof window === 'undefined') return;
    _managerStarted = true;

    // Cross-tab sync: a login/logout/refresh in any tab writes localStorage,
    // which fires a `storage` event in every *other* tab. Re-notify so all tabs
    // converge on the same session without a reload.
    window.addEventListener('storage', (e) => {
        if (e.key === GRAVITY_SESSION_KEY || e.key === DEV_SESSION_KEY) _notifyAuth();
    });

    // Renew the moment a backgrounded tab returns, then keep the timer armed.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void ensureGravitySession();
    });

    scheduleProactiveRefresh();
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
        const err = new Error(detail) as Error & { status?: number };
        err.status = res.status; // reliable signal for the 401 refresh interceptor
        throw err;
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
        _notifyAuth();
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
        clearGravitySession(); // clears storage + notifies all tabs/subscribers
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
        return ensureGravitySession();
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
    if (!token) {
        onSessionLost();
        throw new Error('not authenticated');
    }
    try {
        return await gravityFetch(path, {
            ...init,
            headers: {
                Authorization: `Bearer ${token}`,
                ...((init?.headers ?? {}) as Record<string, string>),
            },
        });
    } catch (err) {
        // Token was rejected mid-flight (e.g. revoked, or clock skew). Force one
        // refresh and retry before giving up — this is what stops the app from
        // wedging into a "logged-in but every call 401s" zombie state.
        if (USE_GRAVITY_API_AUTH && (err as { status?: number })?.status === 401) {
            const fresh = await refreshGravitySession();
            if (fresh) {
                return gravityFetch(path, {
                    ...init,
                    headers: {
                        Authorization: `Bearer ${fresh.access_token}`,
                        ...((init?.headers ?? {}) as Record<string, string>),
                    },
                });
            }
            onSessionLost();
        }
        throw err;
    }
}

// Session is unrecoverable — drop it and bounce to the login screen so the user
// never gets stuck on a dead page with non-working navigation.
function onSessionLost(): void {
    if (typeof window === 'undefined') return;
    clearGravitySession();
    if (window.location.pathname !== '/auth') {
        window.location.assign('/auth');
    }
}

async function getGravityToken(): Promise<string | null> {
    if (DEV_AUTH_BYPASS) return getDevSession()?.access_token ?? null;
    if (USE_GRAVITY_API_AUTH) return (await ensureGravitySession())?.access_token ?? null;
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
