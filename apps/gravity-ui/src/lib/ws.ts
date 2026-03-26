import type {
  SearchRequest,
  SearchEvent,
  SourcePassage,
  Citation,
  SearchMetadata,
  AgentTraceStep,
} from "./types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface SearchCallbacks {
  onStatus: (message: string) => void;
  onSources: (sources: SourcePassage[]) => void;
  onToken: (text: string) => void;
  onAnswer: (answer: string, citations: Citation[]) => void;
  onMetadata: (meta: SearchMetadata) => void;
  onAgentTrace: (step: AgentTraceStep) => void;
  onError: (error: string) => void;
  onComplete: () => void;
}

export function createSearchSession(
  request: SearchRequest,
  callbacks: SearchCallbacks
): () => void {
  const ws = new WebSocket(`${WS_URL}/v1/search/stream`);

  ws.onopen = () => {
    ws.send(JSON.stringify(request));
  };

  ws.onmessage = (event) => {
    try {
      const ev: SearchEvent = JSON.parse(event.data as string);
      switch (ev.type) {
        case "status":
          callbacks.onStatus((ev.data as { message: string }).message);
          break;
        case "sources":
          callbacks.onSources((ev.data as { passages: SourcePassage[] }).passages);
          break;
        case "token":
          callbacks.onToken((ev.data as { text: string }).text);
          break;
        case "answer": {
          const d = ev.data as { answer: string; citations: Citation[] };
          callbacks.onAnswer(d.answer, d.citations);
          break;
        }
        case "metadata":
          callbacks.onMetadata(ev.data as unknown as SearchMetadata);
          break;
        case "agent_trace":
          callbacks.onAgentTrace(ev.data as unknown as AgentTraceStep);
          break;
        case "error":
          callbacks.onError((ev.data as { message: string }).message);
          break;
      }
    } catch {
      // ignore malformed frames
    }
  };

  ws.onerror = () => {
    callbacks.onError("WebSocket connection failed");
  };

  ws.onclose = () => {
    callbacks.onComplete();
  };

  return () => ws.close();
}

// REST fallback for environments where WS is unavailable
export async function searchRest(request: SearchRequest): Promise<void> {
  const res = await fetch(`${API_URL}/v1/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, options: { ...request.options, stream: false } }),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
}
