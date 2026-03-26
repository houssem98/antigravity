import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, BarChart2, X, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { GoogleGenAI, Type, Chat } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { isCryptoAsset } from '../../constants/tradingAssets';
import { motion, AnimatePresence } from 'motion/react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isDrawing?: boolean;
}

interface AssistantProps {
  onDraw: (type: string, data: any) => void;
  currentAsset: string;
  onClose?: () => void;
}

export const Assistant: React.FC<AssistantProps> = ({ onDraw, currentAsset, onClose }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I am your AI Trading Assistant. I can analyze charts, identify patterns, and draw technical indicators like order blocks and Fibonacci retracements. How can I help you today?',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<Chat | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let isMounted = true;
    setCurrentPrice(null);

    const isCrypto = isCryptoAsset(currentAsset);

    if (isCrypto) {
      const connectWebSocket = (useUS: boolean = false) => {
        if (!isMounted) return;
        const baseUrl = useUS ? 'wss://stream.binance.us' : 'wss://stream.binance.com';
        ws = new WebSocket(`${baseUrl}/ws/${currentAsset.toLowerCase()}usdt@ticker`);
        
        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.c !== undefined) {
              setCurrentPrice(parseFloat(data.c));
            } else if (data.code || data.msg) {
              if (!useUS) {
                if (ws) ws.close();
                connectWebSocket(true);
              }
            }
          } catch (e) {
            console.error('WS parse error:', e);
          }
        };

        ws.onerror = () => {
          if (!useUS && isMounted) {
            if (ws) ws.close();
            connectWebSocket(true);
          }
        };
      };

      connectWebSocket(false);
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'subscribe', symbol: currentAsset, interval: '1m' }));
      };
      ws.onmessage = (event) => {
        if (!isMounted) return;
        const data = JSON.parse(event.data);
        if (data.type === 'trade' && data.symbol === currentAsset) {
          setCurrentPrice(data.close);
        }
      };
    }

    return () => {
      isMounted = false;
      if (ws) ws.close();
    };
  }, [currentAsset]);

  const initChat = () => {
    let apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    const allKeysStr = import.meta.env.VITE_GEMINI_API_KEYS;
    
    if (allKeysStr) {
      const keys = allKeysStr.split(',').map((k: string) => k.trim()).filter(Boolean);
      if (keys.length > 0) {
        // Randomly pick an API key to avoid rate limits
        apiKey = keys[Math.floor(Math.random() * keys.length)];
        console.log(`Using API key ending in ...${apiKey!.slice(-4)}`);
      }
    }

    if (!apiKey) {
      console.error('No Gemini API key found (tried GEMINI_API_KEYS and GEMINI_API_KEY)');
      return null;
    }

    const ai = new GoogleGenAI({ apiKey });

    const drawTechnicalAnalysisFunction: FunctionDeclaration = {
      name: 'drawTechnicalAnalysis',
      description: 'Draw technical analysis indicators on the chart.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            description: 'The type of drawing: "support_resistance", "order_block", "fibonacci", or "pattern".',
          },
          levels: {
            type: Type.ARRAY,
            items: { type: Type.NUMBER },
            description: 'The price levels to draw. For support/resistance, provide an array of prices. For order blocks, provide [top, bottom]. For fibonacci, provide [high, low].',
          },
          points: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                time: { type: Type.STRING, description: 'Date string (YYYY-MM-DD)' },
                price: { type: Type.NUMBER, description: 'Price level' },
                label: { type: Type.STRING, description: 'Label for the point (e.g., "Left Shoulder", "Head", "Top 1")' }
              }
            },
            description: 'Points to draw for patterns like head and shoulders, double top, etc.',
          },
          reasoning: {
            type: Type.STRING,
            description: 'Brief explanation of why these levels or patterns were chosen.',
          }
        },
        required: ['type', 'reasoning'],
      },
    };

    const getChartDataFunction: FunctionDeclaration = {
      name: 'getChartData',
      description: 'Get the recent OHLCV data for the current asset to analyze patterns and trends.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          days: {
            type: Type.NUMBER,
            description: 'Number of recent days of data to retrieve (max 365).',
          }
        },
        required: ['days'],
      },
    };

    const getFundamentalDataFunction: FunctionDeclaration = {
      name: 'getFundamentalData',
      description: 'Get fundamental data for the current asset (market cap, P/E ratio, revenue, etc.).',
      parameters: {
        type: Type.OBJECT,
        properties: {},
        required: [],
      },
    };

    const getFinancialStatementsFunction: FunctionDeclaration = {
      name: 'getFinancialStatements',
      description: 'Get detailed financial statements (income statement, balance sheet, cash flow) for the current asset.',
      parameters: {
        type: Type.OBJECT,
        properties: {},
        required: [],
      },
    };

    return ai.chats.create({
      model: 'gemini-3.1-pro-preview',
      config: {
        systemInstruction: `You are Dexter, an autonomous AI financial analyst and trading assistant. You take complex financial questions and turn them into clear, step-by-step research plans. You execute those tasks using live market data, check your own work, and refine the results until you have a confident, data-backed answer.
        
        Key Capabilities:
        - Intelligent Task Planning: Automatically decompose complex queries into structured research steps.
        - Autonomous Execution: Select and execute the right tools to gather financial data.
        - Self-Validation: Check your own work and iterate until tasks are complete.
        
        The user's chart currently displays:
        - Asset: ${currentAsset}
        - Current Real-time Price: ${currentPrice !== null ? '$' + currentPrice : 'Unknown'}
        - Candlestick price action
        - Volume histogram at the bottom
        - 20-period Simple Moving Average (SMA 20) in blue
        - 50-period Simple Moving Average (SMA 50) in orange
        
        You have access to the following tools:
        1. getChartData: Retrieves recent OHLCV data for the currently viewed asset (${currentAsset}). Use this to analyze price action, volume, and moving averages before making recommendations or drawing.
        2. drawTechnicalAnalysis: Draws indicators on the chart. Use this when the user asks you to find support/resistance, order blocks, fibonacci levels, or identify patterns like head and shoulders, double tops/bottoms, etc.
        3. getFundamentalData: Retrieves fundamental data (P/E ratio, Market Cap, Revenue, etc.) for the current asset. Use this when the user asks for fundamental analysis.
        4. getFinancialStatements: Retrieves detailed financial statements (income statement, balance sheet, cash flow) for the current asset. Use this for deep fundamental research.
        
        When analyzing, always provide clear insights and predictions based on technical indicators and historical data. Be professional, concise, and thoroughly explain your reasoning. If you draw something, explain what you drew and why. For patterns, use the "points" array to specify the time and price of each key point (e.g., left shoulder, head, right shoulder) and provide a label for each.`,
        tools: [{ functionDeclarations: [drawTechnicalAnalysisFunction, getChartDataFunction, getFundamentalDataFunction, getFinancialStatementsFunction] }],
      },
    });
  };

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      if (!chatRef.current) {
        chatRef.current = initChat();
      }

      if (!chatRef.current) {
        throw new Error('Failed to initialize chat');
      }

      const contextMessage = `[System Context: Current Asset is ${currentAsset}. Real-time Price is ${currentPrice !== null ? '$' + currentPrice : 'Unknown'}.]\n\n${text}`;
      let response = await chatRef.current.sendMessage({ message: contextMessage });
      
      let finalContent = response.text || '';
      let isDrawing = false;
      let loopCount = 0;
      const MAX_LOOPS = 5;

      while (response.functionCalls && response.functionCalls.length > 0 && loopCount < MAX_LOOPS) {
        loopCount++;
        let functionResponsesText = '';

        for (const call of response.functionCalls) {
          if (call.name === 'getChartData') {
            const days = (call.args as any).days || 30;
            const limit = Math.min(days, 365);
            
            let data;
            const isCrypto = isCryptoAsset(currentAsset);
            
            if (isCrypto) {
              // Fetch real data from Binance
              const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${currentAsset}USDT&interval=1d&limit=${limit}`);
              const rawData = await res.json();
              data = rawData.map((d: any) => ({
                date: new Date(d[0]).toISOString().split('T')[0],
                open: parseFloat(d[1]),
                high: parseFloat(d[2]),
                low: parseFloat(d[3]),
                close: parseFloat(d[4]),
                volume: parseFloat(d[5]),
              }));
            } else {
              // Fetch from backend proxy for Yahoo Finance
              let range = '3mo';
              if (limit > 252) range = '2y';
              else if (limit > 100) range = '1y';
              
              const res = await fetch(`/api/history?symbol=${currentAsset}&interval=1d&range=${range}`);
              const json = await res.json();
              data = [];
              if (json.chart && json.chart.result && json.chart.result[0]) {
                const result = json.chart.result[0];
                const timestamps = result.timestamp;
                const quote = result.indicators.quote[0];
                
                const startIndex = Math.max(0, timestamps.length - limit);
                for (let i = startIndex; i < timestamps.length; i++) {
                  if (quote.close[i] !== null) {
                    data.push({
                      date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
                      open: quote.open[i],
                      high: quote.high[i],
                      low: quote.low[i],
                      close: quote.close[i],
                      volume: quote.volume[i] || 0,
                    });
                  }
                }
              }
            }
            functionResponsesText += `\n\n[getChartData Result for ${currentAsset}]:\n${JSON.stringify(data)}`;
          } else if (call.name === 'drawTechnicalAnalysis') {
            const args = call.args as any;
            onDraw(args.type, args);
            isDrawing = true;
            finalContent += `\n\n*Drew ${args.type.replace('_', ' ')}*\n> ${args.reasoning}`;
            functionResponsesText += `\n\n[drawTechnicalAnalysis Result]: Successfully drew ${args.type} on the chart.`;
          } else if (call.name === 'getFundamentalData') {
            let data: any = {};
            const isCrypto = isCryptoAsset(currentAsset);
            let symbol = currentAsset;
            if (isCrypto) {
              symbol = `${currentAsset}-USD`;
            }
            try {
              const quoteRes = await fetch(`/api/quote?symbols=${symbol}`);
              if (quoteRes.ok) {
                const quoteJson = await quoteRes.json();
                const quoteData = quoteJson.quoteResponse?.result?.[0];
                if (quoteData) {
                  data = { ...quoteData };
                }
              }

              const res = await fetch(`/api/fundamentals?symbol=${symbol}`);
              if (res.ok) {
                const json = await res.json();
                const fundData = json.quoteSummary?.result?.[0];
                if (fundData) {
                  data = { ...data, ...fundData };
                }
              }
              
              if (Object.keys(data).length === 0) {
                data = { error: "Fundamental data not available for this asset." };
              }
            } catch (e) {
              if (Object.keys(data).length === 0) {
                data = { error: "Fundamental data not available for this asset." };
              }
            }
            functionResponsesText += `\n\n[getFundamentalData Result for ${currentAsset}]:\n${JSON.stringify(data)}`;
          } else if (call.name === 'getFinancialStatements') {
            let data: any = {};
            const isCrypto = isCryptoAsset(currentAsset);
            let symbol = currentAsset;
            if (isCrypto) {
              data = { error: "Financial statements are not applicable for cryptocurrencies." };
            } else {
              try {
                const res = await fetch(`/api/financials?symbol=${symbol}`);
                if (res.ok) {
                  const json = await res.json();
                  const finData = json.quoteSummary?.result?.[0];
                  if (finData) {
                    data = { ...finData };
                  } else {
                    data = { error: "Financial statements not available for this asset." };
                  }
                } else {
                  data = { error: "Failed to fetch financial statements." };
                }
              } catch (e) {
                data = { error: "Error fetching financial statements." };
              }
            }
            functionResponsesText += `\n\n[getFinancialStatements Result for ${currentAsset}]:\n${JSON.stringify(data)}`;
          }
        }

        if (functionResponsesText) {
          response = await chatRef.current.sendMessage({
            message: `Here are the results of your tool calls. Please analyze them and decide if you need to call more tools or provide the final answer to the user:\n${functionResponsesText}`
          });
          if (response.text) {
            finalContent += '\n\n' + response.text;
          }
        } else {
          break;
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: finalContent,
          isDrawing,
        },
      ]);
    } catch (error: any) {
      console.error('Error calling Gemini:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Sorry, I encountered an error: ${error.message}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => sendMessage(input);

  const handleAnalyze = () => {
    sendMessage(`Please analyze the current chart for ${currentAsset}, provide insights, predictions based on technical indicators, and explain your reasoning.`);
  };

  // Reset chat when asset changes
  useEffect(() => {
    chatRef.current = initChat();
  }, [currentAsset]);

  return (
    <div className="flex flex-col h-full bg-[#0B0E14] border-l border-[#1F2937] shadow-xl">
      {/* Header */}
      <div className="p-4 border-b border-[#1F2937] bg-gradient-to-r from-[#0B0E14] to-[#1F2937]/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-white font-bold flex items-center gap-2 text-lg">
              Dexter AI
              <Sparkles className="w-4 h-4 text-yellow-500" />
            </h2>
            {currentPrice !== null && (
              <div className="text-xs text-gray-400 font-mono flex items-center gap-1">
                {currentAsset}: <span className="text-white">${currentPrice < 1 ? currentPrice.toFixed(4) : currentPrice.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAnalyze}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-[#2962FF] hover:bg-[#2962FF]/80 text-white text-sm font-medium rounded-lg transition-all shadow-lg shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BarChart2 className="w-4 h-4" />
            <span className="hidden sm:inline">Analyze</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-[#1F2937] rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0B0E14] custom-scrollbar">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={`flex gap-4 ${
                msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md ${
                  msg.role === 'user' 
                    ? 'bg-gradient-to-br from-blue-500 to-blue-600' 
                    : 'bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700'
                }`}
              >
                {msg.role === 'user' ? (
                  <User className="w-5 h-5 text-white" />
                ) : (
                  <Bot className="w-5 h-5 text-blue-400" />
                )}
              </div>
              <div
                className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-[#2962FF] text-white rounded-tr-none'
                    : 'bg-[#1F2937] text-gray-200 rounded-tl-none border border-gray-700/50'
                }`}
              >
                <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-[#0B0E14] prose-pre:border prose-pre:border-gray-800">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
                {msg.isDrawing && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-3 flex items-center gap-2 text-xs text-blue-400 font-medium bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/20 w-fit"
                  >
                    <BarChart2 className="w-4 h-4" />
                    Chart updated with analysis
                  </motion.div>
                )}
              </div>
            </motion.div>
          ))}
          {isLoading && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex gap-4"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 flex items-center justify-center shrink-0 shadow-md">
                <Bot className="w-5 h-5 text-blue-400" />
              </div>
              <div className="bg-[#1F2937] rounded-2xl rounded-tl-none p-4 flex items-center gap-3 border border-gray-700/50 shadow-sm">
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                <span className="text-sm text-gray-400 animate-pulse">Dexter is analyzing...</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} className="h-4" />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-[#1F2937] bg-[#0B0E14]">
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl opacity-0 group-hover:opacity-20 transition duration-500 blur"></div>
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask Dexter to analyze patterns, draw support/resistance..."
              className="w-full bg-[#1F2937] text-white rounded-xl pl-5 pr-14 py-4 border border-gray-700 focus:outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF] transition-all shadow-inner placeholder-gray-500"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-[#2962FF] hover:bg-[#2962FF]/80 text-white rounded-lg disabled:opacity-50 disabled:bg-gray-700 transition-all shadow-md"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="mt-3 flex justify-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> Powered by Gemini 3.1 Pro</span>
        </div>
      </div>
    </div>
  );
};
