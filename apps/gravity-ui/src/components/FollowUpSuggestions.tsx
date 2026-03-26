"use client";

import { ArrowRight } from "lucide-react";

interface Props {
  queries: string[];
  onSelect: (q: string) => void;
}

export function FollowUpSuggestions({ queries, onSelect }: Props) {
  if (queries.length === 0) return null;

  return (
    <div className="animate-slide-up">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2.5">
        Follow-up Questions
      </p>
      <div className="flex flex-wrap gap-2">
        {queries.map((q, i) => (
          <button
            key={i}
            onClick={() => onSelect(q)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm text-slate-300 border border-slate-700/60 bg-slate-900/40 hover:border-gravity-500/50 hover:text-white hover:bg-gravity-500/5 transition-all duration-150 text-left"
          >
            <span className="truncate max-w-[280px]">{q}</span>
            <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 text-slate-500" />
          </button>
        ))}
      </div>
    </div>
  );
}
