/**
 * Parallel deep research engine using Claude's Managed Agents API.
 * This is an alternative to the Gemini-based deepResearchService.ts.
 * It delegates the research to Anthropic's headless agents (e.g. market-researcher).
 */

import type { ResearchReport } from './deepResearchService.js';

export async function performClaudeResearch(
    query: string,
    onProgress?: (msg: any) => void
): Promise<ResearchReport> {
    if (onProgress) {
        onProgress({ stage: 'Connecting to Claude Managed Agent API...', progress: 10 });
    }

    const GRAVITY_API_URL = process.env.GRAVITY_API_URL || 'http://localhost:8000';

    try {
        const response = await fetch(`${GRAVITY_API_URL}/v1/claude/research`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agent_slug: 'market-researcher',
                query: query,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Claude Agent failed: ${response.status} ${errorText}`);
        }

        const data = await response.json();

        if (onProgress) {
            onProgress({ stage: 'Report compiled successfully.', progress: 100 });
        }

        return {
            query: query,
            title: `Claude Research: ${query.substring(0, 50)}...`,
            summary: data.report.substring(0, 300) + '...',
            markdown: data.report,
            citations: [],
            metadata: {
                sourcesAnalyzed: 0,
                estimatedReadTime: Math.ceil(data.report.split(' ').length / 200),
            },
        };
    } catch (e: any) {
        console.error('Claude research failed:', e);
        throw e;
    }
}
