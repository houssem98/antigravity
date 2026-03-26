import { create } from "zustand";
import type {
  SourcePassage,
  Citation,
  SearchMetadata,
  AgentTraceStep,
  SearchFilters,
} from "@/lib/types";

interface SearchState {
  // Input
  query: string;
  filters: SearchFilters;

  // Status
  isSearching: boolean;
  statusMessage: string;

  // Results
  streamingTokens: string;
  answer: string;
  citations: Citation[];
  sources: SourcePassage[];
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  followUpQueries: string[];
  metadata: SearchMetadata | null;
  agentTrace: AgentTraceStep[];

  // Error
  error: string | null;

  // Actions
  setQuery: (q: string) => void;
  setFilters: (f: SearchFilters) => void;
  startSearch: () => void;
  appendToken: (t: string) => void;
  setSources: (s: SourcePassage[]) => void;
  setAnswer: (answer: string, citations: Citation[]) => void;
  setMetadata: (m: SearchMetadata) => void;
  addAgentTrace: (step: AgentTraceStep) => void;
  setStatus: (msg: string) => void;
  setError: (err: string) => void;
  completeSearch: () => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  filters: {},
  isSearching: false,
  statusMessage: "",
  streamingTokens: "",
  answer: "",
  citations: [],
  sources: [],
  confidence: null,
  followUpQueries: [],
  metadata: null,
  agentTrace: [],
  error: null,

  setQuery: (q) => set({ query: q }),
  setFilters: (f) => set({ filters: f }),

  startSearch: () =>
    set({
      isSearching: true,
      statusMessage: "Analyzing query…",
      streamingTokens: "",
      answer: "",
      citations: [],
      sources: [],
      confidence: null,
      followUpQueries: [],
      metadata: null,
      agentTrace: [],
      error: null,
    }),

  appendToken: (t) => set((s) => ({ streamingTokens: s.streamingTokens + t })),

  setSources: (sources) => set({ sources }),

  setAnswer: (answer, citations) =>
    set({ answer, citations, streamingTokens: "" }),

  setMetadata: (metadata) =>
    set({
      metadata,
      confidence: (metadata as unknown as { confidence: "HIGH" | "MEDIUM" | "LOW" }).confidence ?? null,
    }),

  addAgentTrace: (step) =>
    set((s) => ({ agentTrace: [...s.agentTrace, step] })),

  setStatus: (statusMessage) => set({ statusMessage }),

  setError: (error) => set({ error, isSearching: false }),

  completeSearch: () => set({ isSearching: false }),

  reset: () =>
    set({
      query: "",
      filters: {},
      isSearching: false,
      statusMessage: "",
      streamingTokens: "",
      answer: "",
      citations: [],
      sources: [],
      confidence: null,
      followUpQueries: [],
      metadata: null,
      agentTrace: [],
      error: null,
    }),
}));
