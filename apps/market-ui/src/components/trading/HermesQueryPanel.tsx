import React, { useState, useRef, useEffect } from 'react';
import { X, Loader, Send, MessageSquare, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
}

interface HermesQueryPanelProps {
  asset: string;
  context?: {
    exchanges?: any[];
    assetInfo?: any;
  };
  onClose: () => void;
}

export const HermesQueryPanel: React.FC<HermesQueryPanelProps> = ({
  asset,
  context,
  onClose,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streaming]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);
    setStreaming('');

    try {
      const response = await fetch('/api/trading/markets/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset,
          question: userMessage,
          context,
        }),
      });

      if (!response.ok) throw new Error('Failed to query Hermes');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += new TextDecoder().decode(value);
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              if (json.token) {
                setStreaming(prev => prev + json.token);
              }
              if (json.citations) {
                // Handle citations update if needed
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }

      if (streaming) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: streaming,
            citations: [],
          },
        ]);
        setStreaming('');
      }
    } catch (error) {
      console.error('Hermes query error:', error);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Error: Could not query Hermes. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 400 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 400 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-y-0 right-0 w-96 max-w-full flex flex-col bg-gradient-to-b from-[color:var(--surface)] to-[color:color-mix(in_oklch,var(--accent)_2%,var(--surface))] border-l border-[color:var(--line)] shadow-xl z-40"
    >
      {/* Header */}
      <div className="px-4 py-4 border-b border-[color:var(--line)] bg-gradient-to-r from-[color:color-mix(in_oklch,var(--accent)_8%,var(--surface))] to-transparent">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-[color:var(--accent)] bg-opacity-20">
              <Sparkles className="w-4 h-4 text-[color:var(--accent)]" />
            </div>
            <h3 className="text-body font-semibold text-[color:var(--text)]">
              Hermes Analysis
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[color:var(--surface-2)] rounded transition-colors"
          >
            <X className="w-4 h-4 text-[color:var(--text-3)]" />
          </button>
        </div>
        <p className="text-label text-[color:var(--text-3)]">
          Ask about {asset} markets, trends, and risks
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="p-4 rounded-lg bg-[color:var(--surface-2)] mb-3">
              <MessageSquare className="w-8 h-8 text-[color:var(--text-3)]" />
            </div>
            <p className="text-label text-[color:var(--text-3)]">
              Ask a question about {asset}
            </p>
            <p className="text-label text-[color:var(--text-4)] mt-1 max-w-xs">
              "Why is Binance 38%?" or "Best depth for trading?"
            </p>
          </div>
        )}

        <AnimatePresence>
          {messages.map((msg, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs px-4 py-2.5 rounded-lg ${
                  msg.role === 'user'
                    ? 'bg-[color:var(--accent)] text-[color:var(--accent-ink)]'
                    : 'bg-[color:var(--surface-2)] text-[color:var(--text)]'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-[color:var(--line)] text-label text-[color:var(--text-3)]">
                    <p className="font-semibold mb-1">Sources:</p>
                    <ul className="space-y-1">
                      {msg.citations.map((cite, i) => (
                        <li key={i} className="text-xs">
                          [{i + 1}] {cite}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {streaming && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="max-w-xs px-4 py-2.5 rounded-lg bg-[color:var(--surface-2)] text-[color:var(--text)]">
              <p className="text-sm whitespace-pre-wrap">{streaming}</p>
              <span className="inline-block w-2 h-4 bg-[color:var(--accent)] ml-1 animate-pulse" />
            </div>
          </motion.div>
        )}

        {loading && !streaming && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="px-4 py-2.5 rounded-lg bg-[color:var(--surface-2)] flex items-center gap-2">
              <Loader className="w-4 h-4 text-[color:var(--accent)] animate-spin" />
              <span className="text-sm text-[color:var(--text-3)]">Thinking...</span>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[color:var(--line)] p-4 bg-gradient-to-t from-[color:var(--surface)] to-transparent">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Hermes..."
            disabled={loading}
            className="flex-1 px-3 py-2 rounded-lg bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text)] placeholder:text-[color:var(--text-3)] focus:outline-none focus:border-[color:var(--accent)] disabled:opacity-50 transition-colors"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="p-2 rounded-lg bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </motion.div>
  );
};
