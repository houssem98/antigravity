// Single source of truth for the left-nav rail. Both the AppLayout rail (search
// and other protected pages) and the TradingAssistantPage rail import this, so
// the two can never drift out of sync again.
import {
    Zap, TrendingUp, History, Building2, BarChart3, Database,
    CreditCard, ShieldCheck, Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
    to: string;
    icon: LucideIcon;
    label: string;
}

export const NAV_ITEMS: NavItem[] = [
    { to: '/search', icon: Zap, label: 'Search' },
    { to: '/trading', icon: TrendingUp, label: 'AI Trading Assistant' },
    { to: '/history', icon: History, label: 'History' },
    { to: '/companies', icon: Building2, label: 'Companies' },
    { to: '/dashboard', icon: BarChart3, label: 'Dashboard' },
    { to: '/documents', icon: Database, label: 'Documents' },
    { to: '/billing', icon: CreditCard, label: 'Billing' },
    { to: '/admin/billing', icon: ShieldCheck, label: 'Admin — Billing' },
    { to: '/settings', icon: Settings, label: 'Settings' },
];
