import { getAccessToken, supabase } from './supabase';

const GRAVITY_API_URL = import.meta.env.VITE_GRAVITY_API_URL || 'http://localhost:8000';

// Tries gravity-api session first, falls back to Supabase JWT.
// Needed when VITE_AUTH_BACKEND=gravity_api but user authenticated via Supabase.
async function getBillingToken(): Promise<string | null> {
    const gravityToken = await getAccessToken();
    if (gravityToken) return gravityToken;
    // Supabase fallback
    try {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.access_token ?? null;
    } catch {
        return null;
    }
}

export type BillingPlan = string;
export type SubStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'none' | (string & {});
export type PaymentProvider = string;
export type CryptoCurrency = string;

export interface SubscriptionStatus {
    plan: BillingPlan;
    status: SubStatus;
    provider: string;
    current_period_end: number | null;
    cancel_at_period_end: boolean;
    customer_id: string | null;
}

export interface CheckoutResponse {
    provider: string;
    url: string | null;
    invoice_id: string | null;
    wallet: string | null;
    amount_usd: number | null;
    currency: string | null;
    qr_data: string | null;
    manual_info: PayoneerInfo | null;
}

export interface PayoneerInfo {
    method: string;
    send_to_email: string;
    amount_usd: number;
    plan: string;
    note: string;
    instructions: string[];
    configured: boolean;
}

export interface PlanConfig {
    name: string;
    price_usd: number;
    period: string;
    description: string;
    highlight: boolean;
    features: string[];
    limits: { searches_per_day: number; seats: number };
    active: boolean;
}

export interface ProviderConfig {
    id: string;
    enabled: boolean;
    label: string;
    sublabel: string;
    icon: string;
    description: string;
    email?: string;
    currencies?: string[];
}

export interface BillingConfig {
    plans: Record<string, PlanConfig>;
    providers: ProviderConfig[];
    app_name: string;
    support_email: string;
}

// Fallback static data used if the API is unreachable
const FALLBACK_CONFIG: BillingConfig = {
    app_name: 'Antigravity',
    support_email: '',
    plans: {
        free: {
            name: 'Free', price_usd: 0, period: '', description: 'Explore the platform',
            highlight: false, features: ['10 searches / day', 'Basic SEC filings', 'Community support'],
            limits: { searches_per_day: 10, seats: 1 }, active: true,
        },
        pro: {
            name: 'Pro', price_usd: 49, period: '/ mo', description: 'For individual analysts',
            highlight: true,
            features: ['Unlimited searches', 'Deep Research mode', 'Earnings call transcripts', 'KPI graph extraction', 'Priority support'],
            limits: { searches_per_day: -1, seats: 1 }, active: true,
        },
        team: {
            name: 'Team', price_usd: 499, period: '/ mo', description: '5 seats — for funds & teams',
            highlight: false,
            features: ['Everything in Pro', '5 user seats', 'Shared workspaces', 'Audit log', 'SSO (SAML)', 'Dedicated support'],
            limits: { searches_per_day: -1, seats: 5 }, active: true,
        },
    },
    providers: [
        { id: 'paddle',   enabled: true, label: 'Card',     sublabel: 'Visa / Mastercard / Amex', icon: '💳', description: 'Pay by card — Paddle processes securely.' },
        { id: 'paypal',   enabled: true, label: 'PayPal',   sublabel: 'PayPal balance or card',    icon: '🅿', description: 'Pay via PayPal account or linked card.' },
        { id: 'payoneer', enabled: true, label: 'Payoneer', sublabel: 'Manual transfer',            icon: '🟠', description: 'Send via Payoneer — we activate after confirming.' },
        { id: 'crypto',   enabled: true, label: 'Crypto',   sublabel: 'BTC / ETH / USDT',          icon: '₿', description: 'Pay with crypto. Instant activation.', currencies: ['USDT_TRC20', 'USDT_ERC20', 'ETH', 'BTC'] },
    ],
};

async function billingFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getBillingToken();
    const res = await fetch(`${GRAVITY_API_URL}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...((init?.headers ?? {}) as Record<string, string>),
        },
    });
    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            if (typeof body?.detail === 'string') detail = body.detail;
        } catch { /* ignore */ }
        throw new Error(detail);
    }
    return res.json();
}

export const getBillingConfig = async (): Promise<BillingConfig> => {
    try {
        return await billingFetch<BillingConfig>('/v1/billing/config');
    } catch {
        return FALLBACK_CONFIG;
    }
};

export const getMySubscription = () =>
    billingFetch<SubscriptionStatus>('/v1/billing/me');

export const createCheckout = (
    plan: BillingPlan,
    provider: PaymentProvider,
    crypto_currency?: CryptoCurrency,
) =>
    billingFetch<CheckoutResponse>('/v1/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
            plan,
            provider,
            crypto_currency: crypto_currency ?? null,
            success_path: '/billing/success',
            cancel_path: '/billing/cancel',
        }),
    });

export const createPortalSession = () =>
    billingFetch<{ url: string }>('/v1/billing/portal', { method: 'POST' });

export const getPayoneerInfo = (plan: BillingPlan) =>
    billingFetch<PayoneerInfo>(`/v1/billing/payoneer/info?plan=${plan}`);

export const confirmCryptoTx = (invoice_id: string, tx_hash: string) =>
    billingFetch<{ status: string; message: string }>('/v1/billing/crypto/confirm', {
        method: 'POST',
        body: JSON.stringify({ invoice_id, tx_hash }),
    });

// Admin API
export const adminGetConfig = () =>
    billingFetch<Record<string, unknown>>('/v1/billing/admin/config');

export const adminUpdatePlans = (plans: Record<string, unknown>) =>
    billingFetch<Record<string, unknown>>('/v1/billing/admin/plans', {
        method: 'PUT',
        body: JSON.stringify(plans),
    });

export const adminUpdateProviders = (providers: Record<string, unknown>) =>
    billingFetch<Record<string, unknown>>('/v1/billing/admin/providers', {
        method: 'PUT',
        body: JSON.stringify(providers),
    });

export const adminUpdateWallets = (wallets: Record<string, string>) =>
    billingFetch<{ wallets: Record<string, string> }>('/v1/billing/admin/wallets', {
        method: 'PUT',
        body: JSON.stringify(wallets),
    });

export const adminListSubscriptions = (limit = 50, offset = 0) =>
    billingFetch<{ total: number; items: Record<string, unknown>[] }>(
        `/v1/billing/admin/subscriptions?limit=${limit}&offset=${offset}`
    );

export const adminListInvoices = (status = 'pending_confirmation') =>
    billingFetch<{ items: Record<string, unknown>[] }>(
        `/v1/billing/admin/invoices?status=${encodeURIComponent(status)}`
    );

export const adminConfirmInvoice = (invoice_id: string) =>
    billingFetch<{ confirmed: boolean; user_id: string; plan: string }>(
        `/v1/billing/admin/invoices/${encodeURIComponent(invoice_id)}/confirm`,
        { method: 'PUT' }
    );

export const adminSetSubscription = (user_id: string, plan: string, status: string, provider = 'manual') =>
    billingFetch<Record<string, unknown>>(
        `/v1/billing/admin/subscriptions/${encodeURIComponent(user_id)}`,
        { method: 'PUT', body: JSON.stringify({ plan, status, provider }) }
    );
