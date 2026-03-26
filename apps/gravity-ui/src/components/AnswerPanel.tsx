"use client";

import { useRef, useEffect } from "react";
import { Sparkles, Copy, CheckCheck } from "lucide-react";
import { useState } from "react";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { StreamingIndicator } from "./StreamingIndicator";
import { parseAnswerWithCitations } from "./CitationLink";
import type { Citation } from "@/lib/types";

interface Props {
  isSearching: boolean;
  statusMessage: string;
  streamingTokens: string;
  answer: string;
  citations: Citation[];
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  onCitationClick?: (id: number) => void;
}

export function AnswerPanel({
  isSearching,
  statusMessage,
  streamingTokens,
  answer,
  citations,
  confidence,
  onCitationClick,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const displayText = answer || streamingTokens;
  const isStreaming = isSearching && streamingTokens.length > 0;

  // Auto-scroll while streaming
  useEffect(() => {
    if (isStreaming) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingTokens, isStreaming]);

  const copyAnswer = async () => {
    await navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isSearching && !displayText) return null;

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/50 overflow-hidden animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/40">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gravity-400" />
          <span className="text-sm font-medium text-slate-200">AI Answer</span>
          {confidence && <ConfidenceBadge confidence={confidence} />}
        </div>
        {answer && (
          <button
            onClick={copyAnswer}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            {copied ? (
              <>
                <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy
              </>
            )}
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-5 py-4 max-h-[480px] overflow-y-auto">
        {isSearching && !displayText && (
          <StreamingIndicator message={statusMessage} />
        )}

        {displayText && (
          <div className="prose prose-invert prose-sm max-w-none">
            <p className="text-slate-200 leading-relaxed whitespace-pre-wrap text-[15px]">
              {parseAnswerWithCitations(displayText, onCitationClick)}
              {isStreaming && (
                <span className="inline-block w-0.5 h-4 bg-gravity-400 ml-0.5 animate-pulse" />
              )}
            </p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Citations list */}
      {citations.length > 0 && (
        <div className="px-5 py-3 border-t border-slate-700/40 space-y-1.5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
            Sources
          </p>
          {citations.map((c) => (
            <button
              key={c.id}
              onClick={() => onCitationClick?.(c.id)}
              className="flex items-start gap-2.5 w-full text-left group"
            >
              <span className="flex-shrink-0 w-5 h-5 rounded text-[10px] font-bold bg-gravity-600/30 text-gravity-300 border border-gravity-500/40 flex items-center justify-center mt-0.5">
                {c.id}
              </span>
              <div>
                <p className="text-xs text-slate-300 group-hover:text-white transition-colors">
                  {c.source}
                  {c.section && (
                    <span className="text-slate-500"> · {c.section}</span>
                  )}
                </p>
                <p className="text-[11px] text-slate-600 line-clamp-1 mt-0.5">
                  {c.text}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
