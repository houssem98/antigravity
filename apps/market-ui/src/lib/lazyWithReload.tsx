// Resilient lazy-loading + a route-scoped error boundary.
//
// Why: the app code-splits every route. Two failure modes used to white-screen
// the WHOLE app (you couldn't navigate anywhere, "can't return to the tab"):
//   1. A stale chunk after a new deploy — a cached index.html references hashed
//      chunks that now 404, so the dynamic import rejects.
//   2. Any runtime error thrown while rendering a page.
// With no error boundary, either one unmounted the entire React tree.
//
// lazyWithReload recovers from (1) by forcing ONE reload to fetch fresh chunk
// refs. RouteErrorBoundary contains (2) so a crash on one page shows a
// recoverable card instead of killing the app — and because it is keyed by the
// route path, navigating elsewhere clears the error automatically.

import { Component, lazy, type ComponentType, type ReactNode } from 'react';

const RELOAD_TS_KEY = 'spa_chunk_reload_at';

function isChunkLoadError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return (
        /Failed to fetch dynamically imported module/i.test(msg) ||
        /error loading dynamically imported module/i.test(msg) ||
        /Importing a module script failed/i.test(msg) ||
        /ChunkLoadError/i.test(msg)
    );
}

// Wrap React.lazy so a failed chunk fetch (typically a stale deploy) triggers a
// single hard reload to pull fresh chunk references, instead of throwing.
export function lazyWithReload<T extends ComponentType<unknown>>(
    factory: () => Promise<{ default: T }>,
) {
    return lazy(async () => {
        try {
            return await factory();
        } catch (err) {
            const last = Number(sessionStorage.getItem(RELOAD_TS_KEY) || 0);
            // Reload at most once per 10s so a genuine bug can't loop forever.
            if (isChunkLoadError(err) && Date.now() - last > 10_000) {
                sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now()));
                window.location.reload();
                return new Promise<{ default: T }>(() => {}); // hang until reload
            }
            throw err;
        }
    });
}

interface BoundaryProps {
    children: ReactNode;
    fallback: (reset: () => void) => ReactNode;
}

export class RouteErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
    state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error) {
        // Stale chunk that slipped past lazyWithReload — recover with one reload.
        if (isChunkLoadError(error)) {
            const last = Number(sessionStorage.getItem(RELOAD_TS_KEY) || 0);
            if (Date.now() - last > 10_000) {
                sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now()));
                window.location.reload();
            }
        }
    }

    reset = () => this.setState({ error: null });

    render() {
        if (this.state.error) return this.props.fallback(this.reset);
        return this.props.children;
    }
}
