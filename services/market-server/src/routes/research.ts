// Research API Routes — handles research jobs server-side
import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { performDeepResearch } from '../services/deepResearchService.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const researchRouter = Router();

// All research routes require auth
researchRouter.use(authMiddleware);

// Start new research
researchRouter.post('/', async (req: AuthRequest, res) => {
    const { query, model } = req.body;

    if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Query is required' });
        return;
    }

    try {
        const progressUpdates: any[] = [];

        const report = await performDeepResearch(query, (progress) => {
            progressUpdates.push(progress);
        }, model);

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
            // Still return the report even if DB save fails
        }

        res.json({
            id: data?.id || null,
            ...report,
        });
    } catch (error: any) {
        console.error('Research error:', error);
        res.status(500).json({ error: error.message || 'Research failed' });
    }
});

// Get user's research history
researchRouter.get('/', async (req: AuthRequest, res) => {
    try {
        const { data, error } = await supabase
            .from('research_reports')
            .select('id, query, title, summary, sources_analyzed, read_time, created_at')
            .eq('user_id', req.user!.id)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;
        res.json(data || []);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get specific report
researchRouter.get('/:id', async (req: AuthRequest, res) => {
    try {
        const { data, error } = await supabase
            .from('research_reports')
            .select('*')
            .eq('id', req.params.id)
            .eq('user_id', req.user!.id)
            .single();

        if (error || !data) {
            res.status(404).json({ error: 'Report not found' });
            return;
        }

        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
