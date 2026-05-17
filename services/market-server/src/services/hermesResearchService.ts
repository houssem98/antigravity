/**
 * Parallel deep research engine using NousResearch's Hermes Agent API.
 * This delegates the research to the python backend's hermes_client.
 */

import type { ResearchReport } from './deepResearchService.js';

export async function performHermesResearch(
    query: string,
    onProgress?: (msg: any) => void
): Promise<ResearchReport> {
    if (onProgress) {
        onProgress({ stage: 'Connecting to Hermes Agent...', progress: 10 });
    }

    const GRAVITY_API_URL = process.env.GRAVITY_API_URL || 'http://localhost:8000';

    try {
        const response = await fetch(`${GRAVITY_API_URL}/v1/hermes/research`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: query,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Hermes Agent failed: ${response.status} ${errorText}`);
        }

        const data = await response.json();

        if (onProgress) {
            onProgress({ stage: 'Report compiled successfully.', progress: 100 });
        }

        return {
            query: query,
            title: `Hermes Research: ${query.substring(0, 50)}...`,
            summary: data.report.substring(0, 300) + '...',
            markdown: data.report,
            citations: [],
            metadata: {
                sourcesAnalyzed: 0,
                estimatedReadTime: Math.ceil(data.report.split(' ').length / 200),
            },
        };
    } catch (e: any) {
        console.error('Hermes research failed:', e);
        throw e;
    }
}
