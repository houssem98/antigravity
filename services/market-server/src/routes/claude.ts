import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { performClaudeResearch } from '../services/claudeResearchService.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const claudeRouter = Router();

claudeRouter.use(authMiddleware);

// Start new research via Claude Managed Agent
claudeRouter.post('/research', async (req: AuthRequest, res) => {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Query is required' });
        return;
    }

    try {
        const progressUpdates: any[] = [];

        const report = await performClaudeResearch(query, (progress) => {
            progressUpdates.push(progress);
        });

        // Save report to database
        const { data, error } = await supabase
            .from('research_reports')
            .insert({
                user_id: req.user!.id,
                query: report.query,
                title: report.title,
                summary: report.summary,
                markdown: report.markdown,
                citations: report.citations,
                sources_analyzed: report.metadata.sourcesAnalyzed,
                read_time: report.metadata.estimatedReadTime,
            })
            .select('id')
            .single();

        if (error) {
            console.error('DB save error:', error);
        }

        res.json({
            id: data?.id || null,
            ...report,
        });
    } catch (error: any) {
        console.error('Claude Research error:', error);
        res.status(500).json({ error: error.message || 'Claude Research failed' });
    }
});
