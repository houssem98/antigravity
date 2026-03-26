// Supabase Auth Middleware — verifies JWT from Authorization header
import { createClient } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
    };
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing authorization token' });
        return;
    }

    const token = authHeader.split(' ')[1];

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }

        req.user = {
            id: user.id,
            email: user.email || '',
        };

        next();
    } catch {
        res.status(401).json({ error: 'Authentication failed' });
    }
};
