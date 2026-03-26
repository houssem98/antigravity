"use client";

import { useState, useRef, useEffect } from "react";
import { Search, X, Zap, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What was Apple's revenue in Q4 2025?",
  "Compare TSMC vs Samsung CapEx guidance",
  "NVIDIA gross margin trend last 4 quarters",
  "What risks did Microsoft highlight in their 10-K?",
  "Goldman Sachs outlook on semiconductor sector",
  "Tesla free cash flow 2024 vs 2023",
];

interface Props {
  onSearch: (query: string) => void;
  isSearching?: boolean;
  onCancel?: () => void;
  className?: string;
}

export function SearchBar({ onSearch, isSearching, onCancel, className }: Props) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = SUGGESTIONS.filter((s) =>
    value.length > 0 ? s.toLowerCase().includes(value.toLowerCase()) : true
  ).slice(0, 5);

  const submit = (q?: string) => {
    const query = (q ?? value).trim();
    if (!query || isSearching) return;
    setShowSuggestions(false);
    onSearch(query);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target as Element).tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <div className={cn("relative w-full", className)}>
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all duration-200",
          "bg-slate-900/80 backdrop-blur-sm",
          focused
            ? "border-gravity-500/60 shadow-lg shadow-gravity-500/10"
            : "border-slate-700/60 hover:border-slate-600"
        )}
      >
        <Search
          className={cn(
            "w-5 h-5 flex-shrink-0 transition-colors",
            focused ? "text-gravity-400" : "text-slate-500"
          )}
        />

        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setShowSuggestions(e.target.value.length === 0 || e.target.value.length > 1);
          }}
          onFocus={() => {
            setFocused(true);
            setShowSuggestions(true);
          }}
          onBlur={() => {
            setFocused(false);
            setTimeout(() => setShowSuggestions(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") {
              setValue("");
              setShowSuggestions(false);
              inputRef.current?.blur();
            }
          }}
          placeholder="Search SEC filings, earnings, market intelligence…"
          className="flex-1 bg-transparent text-white placeholder-slate-500 text-base outline-none"
          disabled={isSearching}
        />

        <div className="flex items-center gap-2">
          {value && !isSearching && (
            <button
              onClick={() => setValue("")}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {isSearching ? (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          ) : (
            <button
              onClick={() => submit()}
              disabled={!value.trim()}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                value.trim()
                  ? "bg-gravity-600 text-white hover:bg-gravity-500 shadow-md shadow-gravity-600/30"
                  : "bg-slate-800 text-slate-600 cursor-not-allowed"
              )}
            >
              <Zap className="w-3 h-3" />
              Search
            </button>
          )}
        </div>
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && filtered.length > 0 && !isSearching && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-xl border border-slate-700/60 bg-slate-900/95 backdrop-blur-sm shadow-2xl overflow-hidden animate-fade-in">
          <div className="px-3 pt-2 pb-1">
            <p className="text-xs text-slate-500 font-medium">
              {value ? "Suggestions" : "Try asking"}
            </p>
          </div>
          {filtered.map((s, i) => (
            <button
              key={i}
              onMouseDown={() => {
                setValue(s);
                submit(s);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800/60 hover:text-white transition-colors text-left"
            >
              <Brain className="w-3.5 h-3.5 text-gravity-500 flex-shrink-0" />
              <span className="truncate">{s}</span>
            </button>
          ))}
        </div>
      )}

      {/* Keyboard hint */}
      {!focused && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-xs text-slate-600 bg-slate-800 border border-slate-700 rounded">
            /
          </kbd>
        </div>
      )}
    </div>
  );
}
