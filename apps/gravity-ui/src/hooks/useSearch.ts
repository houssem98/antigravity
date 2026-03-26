"use client";

import { useCallback, useRef } from "react";
import { createSearchSession } from "@/lib/ws";
import { useSearchStore } from "@/store/searchStore";

export function useSearch() {
  const store = useSearchStore();
  const cancelRef = useRef<(() => void) | null>(null);

  const search = useCallback(
    (query: string) => {
      if (cancelRef.current) {
        cancelRef.current();
        cancelRef.current = null;
      }

      store.setQuery(query);
      store.startSearch();

      cancelRef.current = createSearchSession(
        { query, filters: store.filters, options: { reasoning_depth: "auto" } },
        {
          onStatus: store.setStatus,
          onSources: store.setSources,
          onToken: store.appendToken,
          onAnswer: (answer, citations) => {
            store.setAnswer(answer, citations);
          },
          onMetadata: (meta) => {
            store.setMetadata(meta);
            // Extract follow-up queries from metadata if present
          },
          onAgentTrace: store.addAgentTrace,
          onError: store.setError,
          onComplete: store.completeSearch,
        }
      );
    },
    [store]
  );

  const cancel = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
      store.completeSearch();
    }
  }, [store]);

  return {
    search,
    cancel,
    isSearching: store.isSearching,
    statusMessage: store.statusMessage,
    streamingTokens: store.streamingTokens,
    answer: store.answer,
    citations: store.citations,
    sources: store.sources,
    confidence: store.confidence,
    followUpQueries: store.followUpQueries,
    metadata: store.metadata,
    agentTrace: store.agentTrace,
    error: store.error,
    query: store.query,
  };
}
