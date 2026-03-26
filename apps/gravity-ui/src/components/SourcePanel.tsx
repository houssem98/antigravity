"use client";

import { useState } from "react";
import { FileText, ChevronDown, ChevronUp, Calendar, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourcePassage } from "@/lib/types";

interface Props {
  sources: SourcePassage[];
  highlightedId?: number | null;
  onSourceRef?: (el: HTMLDivElement | null, id: string) => void;
}

function SourceCard({
  source,
  highlighted,
  refCallback,
}: {
  source: SourcePassage;
  highlighted?: boolean;
  refCallback?: (el: HTMLDivElement | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const scorePercent = Math.round(source.relevance_score * 100);

  return (
    <div
      ref={refCallback}
      className={cn(
        "rounded-xl border p-4 transition-all duration-200",
        highlighted
          ? "border-gravity-500/60 bg-gravity-500/5 shadow-sm shadow-gravity-500/10"
          : "border-slate-700/50 bg-slate-900/40 hover:border-slate-600/60"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <FileText className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">
              {source.title}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              {source.ticker && (
                <span className="flex items-center gap-1 text-[11px] text-gravity-400">
                  <Tag className="w-3 h-3" />
                  {source.ticker}
                </span>
              )}
              {source.filing_type && (
                <span className="text-[11px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                  {source.filing_type}
                </span>
              )}
              <span className="flex items-center gap-1 text-[11px] text-slate-500">
                <Calendar className="w-3 h-3" />
                {source.date}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Relevance bar */}
          <div className="flex items-center gap-1.5">
            <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gravity-500 rounded-full"
                style={{ width: `${scorePercent}%` }}
              />
            </div>
            <span className="text-[11px] text-slate-500">{scorePercent}%</span>
          </div>
        </div>
      </div>

      {/* Section */}
      {source.section && (
        <p className="text-[11px] text-slate-500 mt-1.5 ml-6.5">
          {source.section}
        </p>
      )}

      {/* Passage */}
      <div className="mt-2.5 ml-0">
        <p
          className={cn(
            "text-sm text-slate-400 leading-relaxed",
            !expanded && "line-clamp-3"
          )}
        >
          {source.passage}
        </p>
        {source.passage.length > 200 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-gravity-400 hover:text-gravity-300 mt-1.5 transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" /> Show more
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export function SourcePanel({ sources, highlightedId, onSourceRef }: Props) {
  if (sources.length === 0) return null;

  return (
    <div className="space-y-2 animate-slide-up">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
          {sources.length} Source{sources.length !== 1 ? "s" : ""}
        </p>
      </div>
      {sources.map((s) => (
        <SourceCard
          key={s.id}
          source={s}
          highlighted={highlightedId !== null && highlightedId !== undefined}
          refCallback={(el) => onSourceRef?.(el, s.id)}
        />
      ))}
    </div>
  );
}
