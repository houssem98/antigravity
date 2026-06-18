/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Chart } from '../components/trading/Chart';
import type { ChartRef, ChartColors } from '../components/trading/Chart';
import { Assistant } from '../components/trading/Assistant';
import { Sidebar } from '../components/trading/Sidebar';
import { Topbar } from '../components/trading/Topbar';
import { AssetInfoPanel } from '../components/trading/AssetInfoPanel';
import { CommunityPanel } from '../components/trading/CommunityPanel';
import { OrderBlockModal } from '../components/trading/OrderBlockModal';
import { SymbolSearchModal } from '../components/trading/SymbolSearchModal';
import { PortfolioPanel } from '../components/trading/PortfolioPanel';
import { Markets } from '../components/trading/Markets';
import { NewsTab } from '../components/trading/tabs/NewsTab';
import { HoldersTab } from '../components/trading/tabs/HoldersTab';
import { YieldTab } from '../components/trading/tabs/YieldTab';
import { AboutTab } from '../components/trading/tabs/AboutTab';
import { MarketsTab } from '../components/trading/tabs/MarketsTab';

import { X, MessageSquare, Search, Settings, PieChart, Star, ArrowLeft, Zap, BarChart3, History, Building2, Database, TrendingUp, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const NAV = [
  { to: '/search', icon: Zap, label: 'Search' },
  { to: '/trading', icon: TrendingUp, label: 'Trading' },
  { to: '/history', icon: History, label: 'History' },
  { to: '/companies', icon: Building2, label: 'Companies' },
  { to: '/dashboard', icon: BarChart3, label: 'Dashboard' },
  { to: '/documents', icon: Database, label: 'Documents' },
];

const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export default function TradingAssistantPage() {
  const location = useLocation();
  const [currentView, setCurrentView] = useState<'markets' | 'chart'>('markets');
  const [currentAsset, setCurrentAsset] = useState<string>('BTC');
  const [currentTimeframe, setCurrentTimeframe] = useState<string>('1D');
  const [activeTab, setActiveTab] = useState<string>('Chart');
  const [chartColors, setChartColors] = useState<ChartColors>({
    upColor: '#00E676',
    downColor: '#FF1744',
    borderVisible: false,
    wickVisible: true,
  });
  const chartRef = useRef<ChartRef>(null);

  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [activeIndicators, setActiveIndicators] = useState<string[]>(['SMA 20', 'SMA 50']);
  const [drawingPoints, setDrawingPoints] = useState<{time: number, price: number}[]>([]);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isOrderBookOpen, setIsOrderBookOpen] = useState(false);
  const [isOrderBlockModalOpen, setIsOrderBlockModalOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  
  const [drawingConfig] = useState({
    color: '#2962FF',
    lineWidth: 2,
    lineStyle: 0,
    text: '',
  });

  const handleIndicatorToggle = (indicator: string) => {
    setActiveIndicators(prev => 
      prev.includes(indicator) 
        ? prev.filter(i => i !== indicator)
        : [...prev, indicator]
    );
  };

  const handleDraw = useCallback((type: string, data: any) => {
    if (!chartRef.current) return;

    const levels = data.levels || [];
    const points = data.points || [];

    if (type === 'support_resistance') {
      levels.forEach((level: number) => {
        chartRef.current?.addPriceLine({
          price: level,
          color: '#2962FF',
          lineWidth: 2,
          lineStyle: 0,
          axisLabelVisible: true,
          title: 'S/R',
        });
      });
    } else if (type === 'order_block') {
      if (levels.length >= 2) {
        chartRef.current?.addPriceLine({
          price: levels[0],
          color: '#FF5252',
          lineWidth: 1,
          lineStyle: 1,
          axisLabelVisible: true,
          title: 'OB Top',
        });
        chartRef.current?.addPriceLine({
          price: levels[1],
          color: '#FF5252',
          lineWidth: 1,
          lineStyle: 1,
          axisLabelVisible: true,
          title: 'OB Bot',
        });
        chartRef.current?.addBox(levels[0], levels[1], 'rgba(255, 82, 82, 0.2)');
      }
    } else if (type === 'fibonacci') {
      if (levels.length >= 2) {
        const high = Math.max(levels[0], levels[1]);
        const low = Math.min(levels[0], levels[1]);
        const diff = high - low;
        
        const fibLevels = [
          { ratio: 0, color: '#787B86' },
          { ratio: 0.236, color: '#F44336' },
          { ratio: 0.382, color: '#81C784' },
          { ratio: 0.5, color: '#4CAF50' },
          { ratio: 0.618, color: '#009688' },
          { ratio: 0.786, color: '#64B5F6' },
          { ratio: 1, color: '#787B86' },
        ];

        fibLevels.forEach(({ ratio, color }) => {
          const price = high - diff * ratio;
          chartRef.current?.addPriceLine({
            price,
            color,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `Fib ${ratio}`,
          });
        });
      }
    } else if (type === 'pattern') {
      if (points.length > 0) {
        const markers = points.map((p: any) => {
          // If time is a string like '2023-10-01', convert to timestamp in seconds
          const time = typeof p.time === 'string' ? new Date(p.time).getTime() / 1000 : p.time;
          return {
            time: time,
            position: 'aboveBar',
            color: '#FF9800',
            shape: 'arrowDown',
            text: p.label || 'Point',
          };
        });
        chartRef.current?.setMarkers(markers);

        // Draw trendlines between points to visualize the pattern
        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          const t1 = typeof p1.time === 'string' ? new Date(p1.time).getTime() / 1000 : p1.time;
          const t2 = typeof p2.time === 'string' ? new Date(p2.time).getTime() / 1000 : p2.time;
          chartRef.current?.addTrendLine(
            { time: t1, price: p1.price },
            { time: t2, price: p2.price },
            '#FF9800',
            2,
            0
          );
        }
      }
    }
  }, []);

  const handleAssetChange = (asset: string) => {
    setCurrentAsset(asset);
    if (chartRef.current) {
      chartRef.current.clearLines();
    }
  };

  const handleTimeframeChange = (tf: string) => {
    setCurrentTimeframe(tf);
    if (chartRef.current) {
      chartRef.current.clearLines();
    }
  };

  const handleToolClick = (toolLabel: string) => {
    if (toolLabel === 'Remove All Drawings') {
      chartRef.current?.clearLines();
      setActiveTool(null);
      setDrawingPoints([]);
    } else if (toolLabel === 'Manual Order Block') {
      setIsOrderBlockModalOpen(true);
    } else if (['Crosshair', 'Cursor'].includes(toolLabel)) {
      setActiveTool(null);
      setDrawingPoints([]);
    } else if (toolLabel === 'Zoom In') {
      chartRef.current?.zoomIn();
    } else if (toolLabel === 'Zoom Out') {
      chartRef.current?.zoomOut();
    } else if (toolLabel === 'Pan Left') {
      chartRef.current?.pan('left');
    } else if (toolLabel === 'Pan Right') {
      chartRef.current?.pan('right');
    } else if (['Order Block', 'Rectangle', 'Measure', 'Trend Line', 'Fibonacci Retracement', 'Horizontal Line', 'Vertical Line', 'Ray', 'Extended Line', 'Trend-Based Fib Extension', 'Ellipse', 'Triangle', 'Path', 'Text', 'Callout', 'Head and Shoulders', 'Double Top', 'Double Bottom', 'Flag'].includes(toolLabel)) {
      setActiveTool(toolLabel);
      setDrawingPoints([]);
    } else {
      setToastMessage(`${toolLabel} is not fully implemented yet.`);
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  const handleChartClick = useCallback((time: number, price: number) => {
    if (!activeTool) return;

    const newPoints = [...drawingPoints, { time, price }];
    setDrawingPoints(newPoints);

    let requiredPoints = 2;
    if (['Horizontal Line', 'Vertical Line', 'Text', 'Callout'].includes(activeTool)) {
      requiredPoints = 1;
    } else if (activeTool === 'Head and Shoulders') {
      requiredPoints = 7;
    } else if (activeTool === 'Double Top' || activeTool === 'Double Bottom') {
      requiredPoints = 5;
    } else if (activeTool === 'Flag') {
      requiredPoints = 4;
    } else if (activeTool === 'Triangle') {
      requiredPoints = 3;
    }

    // Draw intermediate lines for multi-point patterns
    if (newPoints.length > 1 && ['Head and Shoulders', 'Double Top', 'Double Bottom', 'Flag', 'Triangle'].includes(activeTool)) {
      const prev = newPoints[newPoints.length - 2];
      const curr = newPoints[newPoints.length - 1];
      chartRef.current?.addTrendLine(prev, curr, drawingConfig.color, drawingConfig.lineWidth, drawingConfig.lineStyle);
    }

    if (newPoints.length === requiredPoints) {
      if (activeTool === 'Horizontal Line') {
        chartRef.current?.addPriceLine({
          price: price,
          color: drawingConfig.color,
          lineWidth: drawingConfig.lineWidth as any,
          lineStyle: drawingConfig.lineStyle,
          axisLabelVisible: true,
          title: drawingConfig.text || '',
        });
      } else if (activeTool === 'Vertical Line') {
        chartRef.current?.addVerticalLine(time, drawingConfig.color, drawingConfig.lineWidth, drawingConfig.lineStyle);
      } else if (activeTool === 'Text' || activeTool === 'Callout') {
        chartRef.current?.addText(time, price, drawingConfig.text || 'Text', drawingConfig.color);
      } else if (activeTool === 'Head and Shoulders') {
        const [_p1, _p2, p3, _p4, p5, _p6, _p7] = newPoints;
        chartRef.current?.addTrendLine(p3, p5, drawingConfig.color, drawingConfig.lineWidth, 2); // Neckline
      } else if (activeTool === 'Double Top' || activeTool === 'Double Bottom') {
        const [p1, _p2, p3, _p4, p5] = newPoints;
        chartRef.current?.addTrendLine({time: p1.time, price: p3.price}, {time: p5.time, price: p3.price}, drawingConfig.color, drawingConfig.lineWidth, 2); // Neckline
      } else if (activeTool === 'Flag') {
        const [_p1f, p2f, _p3f, p4f] = newPoints;
        chartRef.current?.addTrendLine(p4f, p2f, drawingConfig.color, drawingConfig.lineWidth, drawingConfig.lineStyle);
      } else if (activeTool === 'Triangle') {
        const [p1, _p2t, p3] = newPoints;
        chartRef.current?.addTrendLine(p3, p1, drawingConfig.color, drawingConfig.lineWidth, drawingConfig.lineStyle);
      } else {
        const [p1, p2] = newPoints;
        const top = Math.max(p1.price, p2.price);
        const bottom = Math.min(p1.price, p2.price);
        const startTime = Math.min(p1.time, p2.time);
        const endTime = Math.max(p1.time, p2.time);

        if (activeTool === 'Order Block' || activeTool === 'Rectangle' || activeTool === 'Manual Order Block') {
          const hexToRgba = (hex: string, alpha: number) => {
            if (hex.startsWith('#')) {
              const r = parseInt(hex.slice(1, 3), 16);
              const g = parseInt(hex.slice(3, 5), 16);
              const b = parseInt(hex.slice(5, 7), 16);
              return `rgba(${r}, ${g}, ${b}, ${alpha})`;
            }
            return hex;
          };
          const fillColor = hexToRgba(drawingConfig.color, 0.3);
          chartRef.current?.addBox(top, bottom, fillColor, startTime, endTime, drawingConfig.text);
        } else if (activeTool === 'Measure') {
          const diff = top - bottom;
          const pct = ((diff / bottom) * 100).toFixed(2);
          const isUp = p2.price >= p1.price;
          const color = isUp ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)';
          const text = `${isUp ? '+' : '-'}${pct}% (${Math.abs(p2.price - p1.price).toFixed(2)})`;
          chartRef.current?.addBox(top, bottom, color, startTime, endTime, text);
        } else if (activeTool === 'Trend Line' || activeTool === 'Ray' || activeTool === 'Extended Line') {
          chartRef.current?.addTrendLine(p1, p2, drawingConfig.color, drawingConfig.lineWidth, drawingConfig.lineStyle, drawingConfig.text);
        } else if (activeTool === 'Fibonacci Retracement' || activeTool === 'Trend-Based Fib Extension') {
          chartRef.current?.addFibonacci(p1, p2, drawingConfig.color, drawingConfig.lineWidth, drawingConfig.lineStyle);
        }
      }

      setActiveTool(null);
      setDrawingPoints([]);
    }
  }, [activeTool, drawingPoints, drawingConfig]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        setIsAssistantOpen(true);
      }
      if (e.key === '/' && !e.ctrlKey && !e.altKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        setIsSearchModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-full font-sans overflow-hidden bg-[color:var(--bg)] text-[color:var(--text-2)]">
      {/* Persistent Left Nav Sidebar */}
      <aside className="w-[56px] flex flex-col items-center py-3 shrink-0 z-50 bg-[color:var(--surface)] border-r border-[color:var(--line)]">
        <Link to="/search" className="w-8 h-8 rounded-sm flex items-center justify-center mb-4 bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)] glint chrome">
          <Sparkles className="w-4 h-4 text-[color:var(--accent)]" />
        </Link>
        <nav className="flex flex-col gap-1 flex-1 stagger">
          {NAV.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                title={label}
                className={`w-8 h-8 rounded-sm flex items-center justify-center transition-colors ${
                  active
                    ? 'text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)]'
                    : 'text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)]'
                }`}
              >
                <Icon className="w-4 h-4" />
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Trading Area */}
      <div className="flex flex-col flex-1 overflow-hidden">
      {/* Global Header */}
      <header className="h-12 shrink-0 flex items-center px-3 justify-between z-50 bg-[color:var(--surface)] border-b border-[color:var(--line)]">
        <div className="flex items-center gap-4">
          {currentView === 'chart' && (
            <button
              onClick={() => setCurrentView('markets')}
              className="w-7 h-7 rounded-sm flex items-center justify-center transition-colors text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)]"
              title="Back to markets"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => setCurrentView('markets')}
          >
            <div className="w-6 h-6 rounded-sm flex items-center justify-center bg-[color:var(--accent)] glint chrome">
              <span className="text-[color:var(--accent-ink)] font-bold text-[13px] leading-none">M</span>
            </div>
            <span className="font-display font-semibold text-h4 text-[color:var(--text)] tracking-tight">Markets</span>
          </div>
          <nav className="hidden lg:flex items-center gap-4 ml-2">
            {['Cryptocurrencies', 'Exchanges', 'Community', 'Products', 'Learn'].map((label, i) => {
              const isActive = i === 0 && currentView === 'markets';
              return (
                <button
                  key={label}
                  onClick={i === 0 ? () => setCurrentView('markets') : undefined}
                  className={`text-body font-medium transition-colors ${
                    isActive
                      ? 'text-[color:var(--text)]'
                      : 'text-[color:var(--text-3)] hover:text-[color:var(--text-2)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden xl:flex items-center gap-3">
            <button className="flex items-center gap-1.5 text-body font-medium text-[color:var(--text-3)] hover:text-[color:var(--text)] transition-colors">
              <Star className="w-3.5 h-3.5" /> Watchlist
            </button>
            <button className="flex items-center gap-1.5 text-body font-medium text-[color:var(--text-3)] hover:text-[color:var(--text)] transition-colors">
              <PieChart className="w-3.5 h-3.5" /> Portfolio
            </button>
          </div>
          <div
            className="relative hidden md:flex items-center cursor-pointer"
            onClick={() => setIsSearchModalOpen(true)}
          >
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-[color:var(--text-3)]" />
            <input
              type="text"
              placeholder="Search"
              readOnly
              className="text-body rounded-sm pl-8 pr-9 py-1.5 w-56 focus:outline-none cursor-pointer bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text)] placeholder:text-[color:var(--text-3)] hover:border-[color:var(--line-strong)] transition-colors"
            />
            <div className="absolute right-2 text-label font-mono px-1.5 py-0.5 rounded-sm text-[color:var(--text-3)] bg-[color:var(--surface-2)] border border-[color:var(--line)]">/</div>
          </div>
          <button className="p-1.5 rounded-sm transition-colors text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)]">
            <Settings className="w-4 h-4" />
          </button>
          <button className="text-label font-semibold px-3 py-1.5 rounded-sm bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-110 transition-colors press shiny chrome cta-glow" style={{ letterSpacing: '0.04em' }}>
            LOG IN
          </button>
          <button className="text-label font-semibold px-3 py-1.5 rounded-sm bg-[color:var(--bg)] border border-[color:var(--line)] text-[color:var(--text-2)] hover:border-[color:var(--line-strong)] hover:text-[color:var(--text)] transition-colors" style={{ letterSpacing: '0.04em' }}>
            SIGN UP
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className="absolute top-16 left-1/2 z-[9999] px-3 py-1.5 rounded-sm flex items-center gap-2 bg-[color:var(--surface-2)] border border-[color:var(--line-strong)] text-[color:var(--text)] text-body"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent)]" />
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {currentView === 'markets' ? (
        <Markets onAssetSelect={(asset) => {
          setCurrentAsset(asset);
          setCurrentView('chart');
        }} />
      ) : (
        <>
          {/* 3-column layout: left info | chart | right community */}
          <div className="flex flex-row flex-1 overflow-hidden bg-[color:var(--bg)]">

            {/* Left: Coin info */}
            <AssetInfoPanel asset={currentAsset} onAskAI={() => setIsAssistantOpen(true)} />

            {/* Center: Chart */}
            <div className="flex-1 flex flex-col min-w-0">

              {/* Unified control bar (tabs + timeframes + buy/sell) */}
              <Topbar
                currentAsset={currentAsset}
                onAssetChange={handleAssetChange}
                currentTimeframe={currentTimeframe}
                onTimeframeChange={handleTimeframeChange}
                chartColors={chartColors}
                onChartColorsChange={setChartColors}
                onToolClick={handleToolClick}
                isOrderBookOpen={isOrderBookOpen}
                onToggleOrderBook={() => setIsOrderBookOpen(!isOrderBookOpen)}
                activeTab={activeTab}
                onTabChange={(tab) => { console.log('setActiveTab:', tab); setActiveTab(tab); }}
              />

              {/* Tab content */}
              {activeTab === 'Chart' ? (
                <div className="flex flex-row flex-1 overflow-hidden relative">
                  <div className="shrink-0">
                    <Sidebar onToolClick={handleToolClick} activeTool={activeTool} activeIndicators={activeIndicators} onIndicatorToggle={handleIndicatorToggle} />
                  </div>
                  <div className="flex-1 relative min-w-0">
                    <Chart ref={chartRef} asset={currentAsset} timeframe={currentTimeframe} colors={chartColors} activeIndicators={activeIndicators} activeTool={activeTool} drawingPoints={drawingPoints} drawingConfig={drawingConfig} onChartClick={handleChartClick} />
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[480px] max-w-[90%] z-20">
                      <div className="rounded-sm p-1.5 flex items-center gap-2 cursor-text transition-colors bg-[color:var(--surface)] border border-[color:var(--line-strong)] hover:border-[color:var(--accent)]" onClick={() => setIsAssistantOpen(true)}>
                        <div className="w-7 h-7 rounded-sm flex items-center justify-center shrink-0 bg-[color:var(--accent)] glint chrome">
                          <Sparkles className="w-3.5 h-3.5 text-[color:var(--accent-ink)]" />
                        </div>
                        <input type="text" placeholder="Ask AI about this chart..." className="flex-1 bg-transparent text-body focus:outline-none cursor-text text-[color:var(--text)] placeholder:text-[color:var(--text-3)]" onFocus={() => setIsAssistantOpen(true)} readOnly />
                        <div className="text-label px-1.5 py-0.5 rounded-sm font-mono shrink-0 bg-[color:var(--surface-2)] text-[color:var(--text-3)] border border-[color:var(--line)]">Shift+/</div>
                      </div>
                    </div>
                    {activeTool && (
                      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
                        <div className="px-3 py-1.5 rounded-sm flex items-center gap-3 text-body bg-[color:var(--surface-2)] border border-[color:var(--line-strong)] text-[color:var(--text)]">
                          <span>{drawingPoints.length === 0 ? `Click to set first point for ${activeTool}` : `Click to set point ${drawingPoints.length + 1} for ${activeTool}`}</span>
                          <div className="w-px h-4 bg-[color:var(--line)]" />
                          <button onClick={() => { setActiveTool(null); setDrawingPoints([]); }} className="text-[color:var(--text-3)] hover:text-[color:var(--text)]">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : activeTab === 'Markets' ? (
                <div className="flex-1 flex items-center justify-center bg-[color:var(--bg)]">
                  <div className="text-h2 font-bold text-[color:var(--accent)]">MARKETS TAB WORKS!</div>
                </div>
              ) : activeTab === 'News' ? (
                <NewsTab asset={currentAsset} />
              ) : activeTab === 'Yield' ? (
                <YieldTab asset={currentAsset} />
              ) : activeTab === 'Holders' ? (
                <HoldersTab asset={currentAsset} />
              ) : activeTab === 'About' ? (
                <AboutTab asset={currentAsset} />
              ) : (
                <div className="flex-1 text-center text-[color:var(--text-3)] p-8">Unknown tab</div>
              )}
              </div>
            </div>

            {/* Right: Community / Twitter tracker */}
            <CommunityPanel currentAsset={currentAsset} />

          </div>

        {/* Floating Assistant Widget */}
        {isAssistantOpen && (
          <div className="absolute bottom-20 right-4 w-[380px] h-[600px] max-h-[80vh] z-50 flex flex-col overflow-hidden rounded-[6px] bg-[color:var(--surface)] border border-[color:var(--line-strong)]">
            <Assistant onDraw={handleDraw} currentAsset={currentAsset} onClose={() => setIsAssistantOpen(false)} />
          </div>
        )}

        {/* Floating Toggle Button */}
        <button
          onClick={() => setIsAssistantOpen(!isAssistantOpen)}
          className="absolute bottom-4 right-4 w-10 h-10 rounded-sm transition-colors z-40 flex items-center justify-center bg-[color:var(--accent)] text-[color:var(--accent-ink)] hover:brightness-110 press"
        >
          {isAssistantOpen ? (
            <X className="w-5 h-5" />
          ) : (
            <MessageSquare className="w-5 h-5" />
          )}
        </button>

        <PortfolioPanel />
        
        <OrderBlockModal 
          isOpen={isOrderBlockModalOpen}
          onClose={() => setIsOrderBlockModalOpen(false)}
          onAdd={(top, bottom, color) => {
            const fillColor = hexToRgba(color, 0.3);
            chartRef.current?.addBox(top, bottom, fillColor);
          }}
        />
        
        <SymbolSearchModal 
          isOpen={isSearchModalOpen} 
          onClose={() => setIsSearchModalOpen(false)} 
          onSelect={(asset) => {
            setCurrentAsset(asset);
            setIsSearchModalOpen(false);
          }} 
        />
      </>
      )}
      </div>
    </div>
  );
}
