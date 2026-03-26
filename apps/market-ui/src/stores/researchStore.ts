// Global research store — persists state across route changes
// so deep research continues even when the user switches tabs.
import { create } from 'zustand';
import type { GeminiModelId, ResearchReport, ResearchProgress } from '../services/deepResearchService';

export interface HistoryItem {
    id: string;
    query: string;
    title: string;
    created_at: string;
}

interface ResearchState {
    // In-flight / result state
    isResearching: boolean;
    progress: ResearchProgress | null;
    report: ResearchReport | null;
    researchError: string | null;
    activeId: string | null;
    selectedModel: GeminiModelId;

    // Sidebar
    history: HistoryItem[];
    sidebarSearch: string;

    // Actions
    setIsResearching: (v: boolean) => void;
    setProgress: (p: ResearchProgress | null) => void;
    setReport: (r: ResearchReport | null) => void;
    setResearchError: (e: string | null) => void;
    setActiveId: (id: string | null) => void;
    setSelectedModel: (m: GeminiModelId) => void;
    setHistory: (h: HistoryItem[]) => void;
    prependHistory: (item: HistoryItem) => void;
    removeFromHistory: (id: string) => void;
    setSidebarSearch: (s: string) => void;
    resetResearch: () => void;
}

export const useResearchStore = create<ResearchState>((set) => ({
    isResearching: false,
    progress: null,
    report: null,
    researchError: null,
    activeId: null,
    selectedModel: 'gemini-2.5-flash',
    history: [],
    sidebarSearch: '',

    setIsResearching: (v) => set({ isResearching: v }),
    setProgress: (p) => set({ progress: p }),
    setReport: (r) => set({ report: r }),
    setResearchError: (e) => set({ researchError: e }),
    setActiveId: (id) => set({ activeId: id }),
    setSelectedModel: (m) => set({ selectedModel: m }),
    setHistory: (h) => set({ history: h }),
    prependHistory: (item) => set((s) => ({ history: [item, ...s.history] })),
    removeFromHistory: (id) => set((s) => ({ history: s.history.filter((h) => h.id !== id) })),
    setSidebarSearch: (s) => set({ sidebarSearch: s }),
    resetResearch: () => set({ report: null, progress: null, researchError: null, activeId: null }),
}));
