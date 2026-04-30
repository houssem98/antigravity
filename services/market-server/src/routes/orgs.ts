// §6.11 Org/Workspace/Project CRUD endpoints.
// All routes require authMiddleware first, then the appropriate RBAC middleware.

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { authMiddleware } from '../middleware/auth';
import {
    requireOrgRole,
    requireWorkspaceRole,
    auditLog,
    roleAtLeast,
} from '../middleware/rbac';
import type { RbacRequest } from '../middleware/rbac';
import type { Response } from 'express';

export const orgsRouter = Router();

function sb() {
    return createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
}

// ─── Organizations ────────────────────────────────────────────────────────────

// List orgs the authenticated user belongs to
orgsRouter.get('/', authMiddleware, async (req: RbacRequest, res: Response) => {
    const { data, error } = await sb()
        .from('org_members')
        .select('role, organizations(*)')
        .eq('user_id', req.user!.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
});

// Create a new org (any authenticated user can create; they become admin)
orgsRouter.post('/', authMiddleware, async (req: RbacRequest, res: Response) => {
    const { name, slug, plan } = req.body;
    if (!name || !slug) { res.status(400).json({ error: 'Required: name, slug' }); return; }

    const { data: org, error: orgErr } = await sb()
        .from('organizations')
        .insert({ name, slug, plan: plan ?? 'free' })
        .select()
        .single();
    if (orgErr) { res.status(400).json({ error: orgErr.message }); return; }

    // Creator becomes admin
    await sb().from('org_members').insert({
        org_id:  org.id,
        user_id: req.user!.id,
        role:    'admin',
    });

    await auditLog({ actorId: req.user!.id, orgId: org.id, action: 'create_org', payload: { name, slug } });
    res.status(201).json(org);
});

// Get one org (viewer+)
orgsRouter.get('/:orgId', authMiddleware, requireOrgRole('viewer'), async (req: RbacRequest, res: Response) => {
    const { data, error } = await sb()
        .from('organizations')
        .select('*')
        .eq('id', req.params.orgId)
        .single();
    if (error) { res.status(404).json({ error: 'Org not found' }); return; }
    res.json(data);
});

// Update org settings (admin only)
orgsRouter.patch('/:orgId', authMiddleware, requireOrgRole('admin'), async (req: RbacRequest, res: Response) => {
    const { name, settings, plan } = req.body;
    const patch: Record<string, unknown> = {};
    if (name)     patch.name     = name;
    if (settings) patch.settings = settings;
    if (plan)     patch.plan     = plan;

    const { data, error } = await sb()
        .from('organizations')
        .update(patch)
        .eq('id', req.params.orgId)
        .select()
        .single();
    if (error) { res.status(400).json({ error: error.message }); return; }
    await auditLog({ actorId: req.user!.id, orgId: req.params.orgId, action: 'update_org', payload: patch });
    res.json(data);
});

// ─── Members ──────────────────────────────────────────────────────────────────

orgsRouter.get('/:orgId/members', authMiddleware, requireOrgRole('viewer'), async (req: RbacRequest, res: Response) => {
    const { data, error } = await sb()
        .from('org_members')
        .select('id, role, joined_at, user_id')
        .eq('org_id', req.params.orgId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
});

// Invite / upsert a member (admin only)
orgsRouter.put('/:orgId/members/:userId', authMiddleware, requireOrgRole('admin'), async (req: RbacRequest, res: Response) => {
    const { role } = req.body;
    if (!role) { res.status(400).json({ error: 'Required: role' }); return; }

    // Admin cannot escalate another user to admin unless they are themselves admin — already enforced by requireOrgRole('admin').
    const { data, error } = await sb()
        .from('org_members')
        .upsert({ org_id: req.params.orgId, user_id: req.params.userId, role, invited_by: req.user!.id },
                 { onConflict: 'org_id,user_id' })
        .select()
        .single();
    if (error) { res.status(400).json({ error: error.message }); return; }
    await auditLog({ actorId: req.user!.id, orgId: req.params.orgId, action: 'upsert_member',
                     targetType: 'user', targetId: req.params.userId, payload: { role } });
    res.json(data);
});

// Remove a member (admin only, cannot remove self if last admin)
orgsRouter.delete('/:orgId/members/:userId', authMiddleware, requireOrgRole('admin'), async (req: RbacRequest, res: Response) => {
    const { error } = await sb()
        .from('org_members')
        .delete()
        .eq('org_id', req.params.orgId)
        .eq('user_id', req.params.userId);
    if (error) { res.status(400).json({ error: error.message }); return; }
    await auditLog({ actorId: req.user!.id, orgId: req.params.orgId, action: 'remove_member',
                     targetType: 'user', targetId: req.params.userId });
    res.sendStatus(204);
});

// ─── Workspaces ───────────────────────────────────────────────────────────────

orgsRouter.get('/:orgId/workspaces', authMiddleware, requireOrgRole('viewer'), async (req: RbacRequest, res: Response) => {
    const { data, error } = await sb()
        .from('org_workspaces')
        .select('*')
        .eq('org_id', req.params.orgId)
        .order('created_at');
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
});

orgsRouter.post('/:orgId/workspaces', authMiddleware, requireOrgRole('member'), async (req: RbacRequest, res: Response) => {
    const { name, slug, description } = req.body;
    if (!name || !slug) { res.status(400).json({ error: 'Required: name, slug' }); return; }

    const { data, error } = await sb()
        .from('org_workspaces')
        .insert({ org_id: req.params.orgId, name, slug, description, created_by: req.user!.id })
        .select()
        .single();
    if (error) { res.status(400).json({ error: error.message }); return; }

    // Creator gets admin role in new workspace
    await sb().from('workspace_members').insert({
        workspace_id: data.id, user_id: req.user!.id, role: 'admin',
    });

    await auditLog({ actorId: req.user!.id, orgId: req.params.orgId, action: 'create_workspace',
                     targetType: 'workspace', targetId: data.id, payload: { name } });
    res.status(201).json(data);
});

// ─── Workspace members ───────────────────────────────────────────────────────

orgsRouter.get('/:orgId/workspaces/:workspaceId/members',
    authMiddleware, requireOrgRole('viewer'),
    async (req: RbacRequest, res: Response) => {
        const { data, error } = await sb()
            .from('workspace_members')
            .select('id, role, added_at, user_id')
            .eq('workspace_id', req.params.workspaceId);
        if (error) { res.status(500).json({ error: error.message }); return; }
        res.json(data ?? []);
    });

orgsRouter.put('/:orgId/workspaces/:workspaceId/members/:userId',
    authMiddleware, requireWorkspaceRole('admin'),
    async (req: RbacRequest, res: Response) => {
        const { role } = req.body;
        if (!role) { res.status(400).json({ error: 'Required: role' }); return; }

        // Workspace role must not exceed the user's org-level role.
        const { data: orgMember } = await sb()
            .from('org_members')
            .select('role')
            .eq('org_id', req.params.orgId)
            .eq('user_id', req.params.userId)
            .single();
        if (!orgMember) {
            res.status(400).json({ error: 'User is not a member of this organization' });
            return;
        }
        if (!roleAtLeast(orgMember.role, role)) {
            res.status(400).json({ error: `Workspace role cannot exceed org role (${orgMember.role})` });
            return;
        }

        const { data, error } = await sb()
            .from('workspace_members')
            .upsert({ workspace_id: req.params.workspaceId, user_id: req.params.userId, role },
                     { onConflict: 'workspace_id,user_id' })
            .select()
            .single();
        if (error) { res.status(400).json({ error: error.message }); return; }
        res.json(data);
    });

// ─── Projects ─────────────────────────────────────────────────────────────────

orgsRouter.get('/:orgId/workspaces/:workspaceId/projects',
    authMiddleware, requireWorkspaceRole('viewer'),
    async (req: RbacRequest, res: Response) => {
        const { data, error } = await sb()
            .from('projects')
            .select('*')
            .eq('workspace_id', req.params.workspaceId)
            .is('archived_at', null)
            .order('created_at');
        if (error) { res.status(500).json({ error: error.message }); return; }
        res.json(data ?? []);
    });

orgsRouter.post('/:orgId/workspaces/:workspaceId/projects',
    authMiddleware, requireWorkspaceRole('member'),
    async (req: RbacRequest, res: Response) => {
        const { name, description, retrieval_filter } = req.body;
        if (!name) { res.status(400).json({ error: 'Required: name' }); return; }

        const { data, error } = await sb()
            .from('projects')
            .insert({
                workspace_id:     req.params.workspaceId,
                name,
                description:      description ?? null,
                retrieval_filter: retrieval_filter ?? {},
                created_by:       req.user!.id,
            })
            .select()
            .single();
        if (error) { res.status(400).json({ error: error.message }); return; }

        await auditLog({ actorId: req.user!.id, orgId: req.params.orgId, action: 'create_project',
                         targetType: 'project', targetId: data.id, payload: { name } });
        res.status(201).json(data);
    });

orgsRouter.patch('/:orgId/workspaces/:workspaceId/projects/:projectId',
    authMiddleware, requireWorkspaceRole('member'),
    async (req: RbacRequest, res: Response) => {
        const { name, description, retrieval_filter, archived } = req.body;
        const patch: Record<string, unknown> = {};
        if (name)             patch.name             = name;
        if (description)      patch.description      = description;
        if (retrieval_filter) patch.retrieval_filter = retrieval_filter;
        if (archived === true) patch.archived_at = new Date().toISOString();
        if (archived === false) patch.archived_at = null;

        const { data, error } = await sb()
            .from('projects')
            .update(patch)
            .eq('id', req.params.projectId)
            .eq('workspace_id', req.params.workspaceId)
            .select()
            .single();
        if (error) { res.status(400).json({ error: error.message }); return; }
        res.json(data);
    });

// ─── Audit log ────────────────────────────────────────────────────────────────

orgsRouter.get('/:orgId/audit', authMiddleware, requireOrgRole('auditor'), async (req: RbacRequest, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10), 500);
    const offset = parseInt(String(req.query.offset ?? '0'), 10);

    const { data, error } = await sb()
        .from('rbac_audit_log')
        .select('*')
        .eq('org_id', req.params.orgId)
        .order('ts', { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
});
