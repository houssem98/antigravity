// Influencer Tracker Service — queries Supabase directly for signals + influencer data

import { supabase } from './supabase';

export interface Influencer {
    id: string;
    handle: string;
    twitter_user_id: string | null;
    follower_count: number;
    reputation_score: number;
    win_loss_ratio: number;
    tracked_coins: string[];
    created_at: string;
    updated_at: string;
}

export interface Signal {
    id: string;
    influencer_id: string;
    tweet_id: string;
    tweet_url: string;
    token_ticker: string;
    contract_address: string | null;
    entry_price_cmc: number | null;
    entry_price_cg: number | null;
    entry_price_consensus: number;
    price_target: number | null;
    timeframe: string | null;
    conviction_level: number | null;
    market_outcome: 'Success' | 'Fail' | 'Pending';
    sentiment: string | null;
    ai_summary: string | null;
    created_at: string;
    resolved_at: string | null;
    influencer?: Pick<Influencer, 'handle' | 'reputation_score'>;
}

export const influencerService = {
    async listInfluencers(): Promise<Influencer[]> {
        const { data, error } = await supabase
            .from('influencers')
            .select('*')
            .order('reputation_score', { ascending: false });
        if (error) throw error;
        return data ?? [];
    },

    async getSignalsFeed(limit = 50, influencer_id?: string): Promise<Signal[]> {
        let query = supabase
            .from('signals_feed')
            .select(`
                *,
                influencer:influencers(handle, reputation_score)
            `)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (influencer_id) {
            query = query.eq('influencer_id', influencer_id);
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []) as Signal[];
    },

    async getInfluencer(id: string): Promise<Influencer | null> {
        const { data, error } = await supabase
            .from('influencers')
            .select('*')
            .eq('id', id)
            .single();
        if (error) return null;
        return data;
    },

    async trackInfluencer(handle: string): Promise<Influencer> {
        const { data, error } = await supabase
            .from('influencers')
            .upsert({ handle: handle.replace('@', '').toLowerCase() }, { onConflict: 'handle' })
            .select()
            .single();
        if (error) throw error;
        return data;
    },

    async untrackInfluencer(id: string): Promise<void> {
        const { error } = await supabase
            .from('influencers')
            .delete()
            .eq('id', id);
        if (error) throw error;
    },
};
