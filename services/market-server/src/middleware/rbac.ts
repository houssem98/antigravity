// §6.11 RBAC middleware — three-tier org/workspace/project access control.
//
// Usage:
//   router.get('/org/:orgId/data', authMiddleware, requireOrgRole('viewer'), handler)
//   router.post('/ws/:workspaceId/projects', authMiddleware, requireWorkspaceRole('member'), handler)
//
// The middleware reads org_id / workspace_id from req.params and verifies that
// the authenticated user (req.user.id set by authMiddleware) holds at least
// the specified role. Role hierarchy: viewer < auditor < reviewer < member < admin.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth';

// ─── Role hierarchy ──────────────────────────────────────────────────────────

export type OrgRole = 'viewer' | 'auditor' | 'reviewer' | 'member' | 'admin';

const ROLE_WEIGHT: Record<OrgRole, number> = {
    viewer:   1,
    auditor:  2,
    reviewer: 3,
    member:   4,
    admin:    5,
};

export function roleAtLeast(actual: OrgRole | null, required: OrgRole): boolean {
    if (!actual) return false;
    return (ROLE_WEIGHT[actual] ?? 0) >= ROLE_WEIGHT[required];
}

// ─── Extend AuthRequest with RBAC context ────────────────────────────────────

export interface RbacRequest extends AuthRequest {
    orgRole?:       OrgRole;
    workspaceRole?: OrgRole;
    orgId?:         string;
    workspaceId?:   string;
}

// ─── Supabase service-role client (reads org_members / workspace_members) ───

function getServiceClient(): SupabaseClient {
    return createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchOrgRole(userId: string, orgId: string): Promise<OrgRole | null> {
    const { data, error } = await getServiceClient()
        .from('org_members')
        .select('role')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .single();
    if (error || !data) return null;
    return data.role as OrgRole;
}

// Effective workspace role = workspace_members override (if present) else org role.
async function fetchWorkspaceRole(userId: string, workspaceId: string): Promise<OrgRole | null> {
    const sb = getServiceClient();

    // 1. Direct workspace membership override
    const { data: wm } = await sb
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .single();
    if (wm?.role) return wm.role as OrgRole;

    // 2. Fall back to org-level role
    const { data: ws } = await sb
        .from('org_workspaces')
        .select('org_id')
        .eq('id', workspaceId)
        .single();
    if (!ws) return null;

    return fetchOrgRole(userId, ws.org_id);
}

// ─── Middleware factories ─────────────────────────────────────────────────────

/**
 * Require the authenticated user to have at least `minRole` in the org
 * identified by `req.params.orgId`.
 */
export function requireOrgRole(minRole: OrgRole = 'viewer') {
    return async (req: RbacRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const orgId = req.params.orgId;
        if (!orgId) {
            res.status(400).json({ error: 'Missing orgId param' });
            return;
        }

        const role = await fetchOrgRole(req.user.id, orgId).catch(() => null);

        if (!roleAtLeast(role, minRole)) {
            res.status(403).json({
                error: `Insufficient permissions — requires ${minRole} in this organization`,
            });
            return;
        }

        req.orgId   = orgId;
        req.orgRole = role ?? undefined;
        next();
    };
}

/**
 * Require the authenticated user to have at least `minRole` in the workspace
 * identified by `req.params.workspaceId`.
 */
export function requireWorkspaceRole(minRole: OrgRole = 'viewer') {
    return async (req: RbacRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }

        const workspaceId = req.params.workspaceId;
        if (!workspaceId) {
            res.status(400).json({ error: 'Missing workspaceId param' });
            return;
        }

        const role = await fetchWorkspaceRole(req.user.id, workspaceId).catch(() => null);

        if (!roleAtLeast(role, minRole)) {
            res.status(403).json({
                error: `Insufficient permissions — requires ${minRole} in this workspace`,
            });
            return;
        }

        req.workspaceId   = workspaceId;
        req.workspaceRole = role ?? undefined;
        next();
    };
}

// ─── Audit logging helper ────────────────────────────────────────────────────
// Call from route handlers to write to rbac_audit_log.

export async function auditLog(params: {
    actorId:    string;
    orgId:      string;
    action:     string;
    targetType?: string;
    targetId?:  string;
    payload?:   Record<string, unknown>;
}): Promise<void> {
    try {
        await getServiceClient().from('rbac_audit_log').insert({
            actor_id:    params.actorId,
            org_id:      params.orgId,
            action:      params.action,
            target_type: params.targetType ?? null,
            target_id:   params.targetId   ?? null,
            payload:     params.payload    ?? {},
        });
    } catch {
        // Audit failures must never crash the request path.
    }
}
