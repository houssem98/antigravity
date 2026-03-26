"use client";

import { useRef } from "react";
import { SearchBar } from "@/components/SearchBar";
import { AnswerPanel } from "@/components/AnswerPanel";
import { SourcePanel } from "@/components/SourcePanel";
import { FollowUpSuggestions } from "@/components/FollowUpSuggestions";
import { StreamingIndicator } from "@/components/StreamingIndicator";
import { useSearch } from "@/hooks/useSearch";
import { TrendingUp, Shield, Zap, Database } from "lucide-react";

const FEATURES = [
  { icon: Database, label: "SEC Filings", desc: "10-K · 10-Q · 8-K" },
  { icon: TrendingUp, label: "Earnings Calls", desc: "Live transcripts" },
  { icon: Shield, label: "Cited Answers", desc: "Zero hallucination" },
  { icon: Zap, label: "< 200ms", desc: "Fast queries" },
];

export default function HomePage() {
  const {
    search,
    cancel,
    isSearching,
    statusMessage,
    streamingTokens,
    answer,
    citations,
    sources,
    confidence,
    followUpQueries,
    error,
    query,
  } = useSearch();

  const sourceRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const hasResults = answer || streamingTokens || sources.length > 0 || isSearching;

  const handleCitationClick = (id: number) => {
    const citation = citations[id - 1];
    if (!citation) return;
    // Find the matching source and scroll to it
    const el = sourceRefs.current.get(id.toString());
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="min-h-screen bg-[#090b14] bg-radial-gravity">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800/60">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gravity-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-white">Gravity Search</span>
          <span className="text-xs text-slate-500 ml-1">by Antigravity</span>
        </div>
        <nav className="flex items-center gap-4 text-sm text-slate-500">
          <a href="#" className="hover:text-slate-300 transition-colors">Docs</a>
          <a href="#" className="hover:text-slate-300 transition-colors">API</a>
          <button className="px-3 py-1.5 rounded-lg bg-gravity-600 text-white text-xs font-medium hover:bg-gravity-500 transition-colors">
            Sign In
          </button>
        </nav>
      </header>

      <main className="max-w-4xl mx-auto px-4 pb-16">
        {/* Hero — shown when no results */}
        {!hasResults && (
          <div className="pt-24 pb-12 text-center animate-fade-in">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-gravity-500/10 text-gravity-400 border border-gravity-500/20 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-gravity-400 animate-pulse" />
              Now searching 15M+ financial documents
            </div>
            <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">
              Financial research,{" "}
              <span className="text-gradient-gravity">answered</span>
            </h1>
            <p className="text-lg text-slate-400 max-w-xl mx-auto">
              Ask any question about SEC filings, earnings calls, or market data.
              Get cited answers in seconds.
            </p>
          </div>
        )}

        {/* Search bar — pinned to top when results */}
        <div className={hasResults ? "pt-6 pb-6" : "pb-6"}>
          <SearchBar
            onSearch={search}
            onCancel={cancel}
            isSearching={isSearching}
          />
        </div>

        {/* Results layout */}
        {hasResults && (
          <div className="space-y-6">
            {/* Status while searching (before tokens start) */}
            {isSearching && !streamingTokens && (
              <StreamingIndicator message={statusMessage} />
            )}

            {/* Answer panel */}
            <AnswerPanel
              isSearching={isSearching}
              statusMessage={statusMessage}
              streamingTokens={streamingTokens}
              answer={answer}
              citations={citations}
              confidence={confidence}
              onCitationClick={handleCitationClick}
            />

            {/* Two-column: sources + follow-ups */}
            {(sources.length > 0 || followUpQueries.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <SourcePanel
                    sources={sources}
                    onSourceRef={(el, id) => {
                      if (el) sourceRefs.current.set(id, el);
                      else sourceRefs.current.delete(id);
                    }}
                  />
                </div>
                {followUpQueries.length > 0 && (
                  <div>
                    <FollowUpSuggestions
                      queries={followUpQueries}
                      onSelect={search}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Feature grid — landing only */}
        {!hasResults && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-8 animate-fade-in">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div
                key={label}
                className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-4 text-center"
              >
                <Icon className="w-5 h-5 text-gravity-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-200">{label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
