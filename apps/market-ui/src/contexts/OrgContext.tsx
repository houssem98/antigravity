// §6.11 OrgContext — provides the active org/workspace/role throughout the app.
// Wrap the protected route tree with <OrgProvider>; consume with useOrg().

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
    getMyOrgs,
    getOrgWorkspaces,
    roleAtLeast,
    type Organization,
    type OrgWorkspace,
    type OrgRole,
    type OrgWithRole,
} from '../services/supabase';

interface OrgContextValue {
    orgs:           OrgWithRole[];
    activeOrg:      Organization | null;
    activeOrgRole:  OrgRole | null;
    workspaces:     OrgWorkspace[];
    activeWorkspace: OrgWorkspace | null;
    loading:        boolean;
    error:          string | null;
    setActiveOrg:        (org: Organization, role: OrgRole) => void;
    setActiveWorkspace:  (ws: OrgWorkspace | null) => void;
    refresh:             () => Promise<void>;
    // Role checks
    can: (minRole: OrgRole) => boolean;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
    const [orgs, setOrgs]                       = useState<OrgWithRole[]>([]);
    const [activeOrg, setActiveOrgState]        = useState<Organization | null>(null);
    const [activeOrgRole, setActiveOrgRole]     = useState<OrgRole | null>(null);
    const [workspaces, setWorkspaces]           = useState<OrgWorkspace[]>([]);
    const [activeWorkspace, setActiveWorkspace] = useState<OrgWorkspace | null>(null);
    const [loading, setLoading]                 = useState(true);
    const [error, setError]                     = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const fetched = await getMyOrgs();
            setOrgs(fetched);
            // Auto-select the first org if none selected
            if (!activeOrg && fetched.length > 0) {
                const first = fetched[0];
                setActiveOrgState(first.organizations);
                setActiveOrgRole(first.role);
            }
        } catch (e: any) {
            setError(e.message ?? 'Failed to load organizations');
        } finally {
            setLoading(false);
        }
    }, [activeOrg]);

    // Fetch workspaces whenever the active org changes
    useEffect(() => {
        if (!activeOrg) { setWorkspaces([]); return; }
        getOrgWorkspaces(activeOrg.id)
            .then(ws => {
                setWorkspaces(ws);
                // Auto-select first workspace
                if (!activeWorkspace && ws.length > 0) setActiveWorkspace(ws[0]);
            })
            .catch(() => setWorkspaces([]));
    }, [activeOrg?.id]);

    // Initial load
    useEffect(() => { refresh(); }, []);

    const setActiveOrg = useCallback((org: Organization, role: OrgRole) => {
        setActiveOrgState(org);
        setActiveOrgRole(role);
        setActiveWorkspace(null);  // reset workspace when org switches
    }, []);

    const can = useCallback((minRole: OrgRole) => roleAtLeast(activeOrgRole, minRole), [activeOrgRole]);

    return (
        <OrgContext.Provider value={{
            orgs,
            activeOrg,
            activeOrgRole,
            workspaces,
            activeWorkspace,
            loading,
            error,
            setActiveOrg,
            setActiveWorkspace,
            refresh,
            can,
        }}>
            {children}
        </OrgContext.Provider>
    );
}

export function useOrg(): OrgContextValue {
    const ctx = useContext(OrgContext);
    if (!ctx) throw new Error('useOrg must be used within <OrgProvider>');
    return ctx;
}
