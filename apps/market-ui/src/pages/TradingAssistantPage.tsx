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
    <div className="flex h-screen w-full font-sans overflow-hidden" style={{ background: '#0A0E17', color: '#C4CDD8' }}>
      {/* Persistent Left Nav Sidebar */}
      <aside className="w-[56px] flex flex-col items-center py-4 shrink-0 z-50" style={{ background: '#0B0E14', borderRight: '1px solid #1B2236' }}>
        <Link to="/search" className="w-9 h-9 rounded-xl flex items-center justify-center mb-5" style={{ background: 'rgba(41,98,255,0.15)' }}>
          <Sparkles className="w-5 h-5" style={{ color: '#2962FF' }} />
        </Link>
        <nav className="flex flex-col gap-2 flex-1">
          {NAV.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                title={label}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
                style={{ background: active ? 'rgba(41,98,255,0.15)' : 'transparent' }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#0E1320'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <Icon className="w-4.5 h-4.5" style={{ color: active ? '#2962FF' : '#5A6478' }} />
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Trading Area */}
      <div className="flex flex-col flex-1 overflow-hidden">
      {/* Global Header */}
      <header className="h-14 shrink-0 flex items-center px-4 justify-between z-50" style={{ background: '#0B0E14', borderBottom: '1px solid #1B2236' }}>
        <div className="flex items-center gap-4">
          {currentView === 'chart' && (
            <button
              onClick={() => setCurrentView('markets')}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
              style={{ color: '#5A6478' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#0E1320')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              title="Back to markets"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div
            className="font-bold text-[18px] tracking-tighter flex items-center gap-2 cursor-pointer text-white"
            onClick={() => setCurrentView('markets')}
          >
            <div className="w-8 h-8 rounded-full flex items-center justify-center shadow-sm" style={{ background: '#2962FF' }}>
              <span className="text-white font-extrabold text-base leading-none">M</span>
            </div>
            Markets
          </div>
          <nav className="hidden lg:flex items-center gap-5">
            {['Cryptocurrencies', 'Exchanges', 'Community', 'Products', 'Learn'].map((label, i) => (
              <button
                key={label}
                onClick={i === 0 ? () => setCurrentView('markets') : undefined}
                className="text-[13px] font-semibold transition-colors"
                style={{ color: (i === 0 && currentView === 'markets') ? '#2962FF' : '#5A6478' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#FFFFFF')}
                onMouseLeave={e => (e.currentTarget.style.color = (i === 0 && currentView === 'markets') ? '#2962FF' : '#5A6478')}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden xl:flex items-center gap-4">
            <button className="flex items-center gap-1.5 text-[13px] font-semibold transition-colors" style={{ color: '#5A6478' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#FFFFFF')}
              onMouseLeave={e => (e.currentTarget.style.color = '#5A6478')}>
              <Star className="w-4 h-4" /> Watchlist
            </button>
            <button className="flex items-center gap-1.5 text-[13px] font-semibold transition-colors" style={{ color: '#5A6478' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#FFFFFF')}
              onMouseLeave={e => (e.currentTarget.style.color = '#5A6478')}>
              <PieChart className="w-4 h-4" /> Portfolio
            </button>
          </div>
          <div
            className="relative hidden md:flex items-center cursor-pointer"
            onClick={() => setIsSearchModalOpen(true)}
          >
            <Search className="w-4 h-4 absolute left-3" style={{ color: '#5A6478' }} />
            <input
              type="text"
              placeholder="Search"
              readOnly
              className="text-[13px] rounded-xl pl-9 pr-10 py-2 w-56 focus:outline-none cursor-pointer transition-all"
              style={{ background: '#0E1320', border: '1px solid #1B2236', color: '#C4CDD8' }}
            />
            <div className="absolute right-2.5 text-[11px] px-1.5 py-0.5 rounded font-mono" style={{ color: '#5A6478', background: '#1B2236' }}>/</div>
          </div>
          <button className="p-2 rounded-lg transition-colors" style={{ color: '#5A6478' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#0E1320')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <Settings className="w-4 h-4" />
          </button>
          <button className="text-[13px] font-bold px-4 py-2 rounded-xl transition-all" style={{ background: '#2962FF', color: '#FFFFFF' }}>
            Log In
          </button>
          <button className="text-[13px] font-bold px-4 py-2 rounded-xl transition-colors" style={{ background: '#0E1320', color: '#C4CDD8', border: '1px solid #1B2236' }}>
            Sign Up
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
            className="absolute top-20 left-1/2 z-[9999] bg-gray-800 border border-gray-700 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2"
          >
            <div className="w-2 h-2 rounded-full bg-blue-500" />
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
          <div className="flex flex-row flex-1 overflow-hidden" style={{ background: '#0B0E14' }}>

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
              />

              {/* Chart area */}
              <div className="flex flex-row flex-1 overflow-hidden relative">
                {/* Drawing tools sidebar */}
                <div className="shrink-0" style={{ borderRight: '1px solid #1B2236' }}>
                  <Sidebar
                    onToolClick={handleToolClick}
                    activeTool={activeTool}
                    activeIndicators={activeIndicators}
                    onIndicatorToggle={handleIndicatorToggle}
                  />
                </div>

                {/* Chart */}
                <div className="flex-1 relative min-w-0">
                  <Chart
                    ref={chartRef}
                    asset={currentAsset}
                    timeframe={currentTimeframe}
                    colors={chartColors}
                    activeIndicators={activeIndicators}
                    activeTool={activeTool}
                    drawingPoints={drawingPoints}
                    drawingConfig={drawingConfig}
                    onChartClick={handleChartClick}
                  />

                  {/* Ask AI bar */}
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[480px] max-w-[90%] z-20">
                    <div
                      className="rounded-full p-2 flex items-center gap-3 cursor-text transition-all"
                      style={{ background: '#0E1320', border: '1px solid #1B2236', boxShadow: '0 4px 24px rgba(41,98,255,0.15)' }}
                      onClick={() => setIsAssistantOpen(true)}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(41,98,255,0.5)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = '#1B2236')}
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ml-1" style={{ background: 'linear-gradient(135deg,#2962FF,#7C3AED)' }}>
                        <Sparkles className="w-4 h-4 text-white" />
                      </div>
                      <input
                        type="text"
                        placeholder="Ask AI about this chart..."
                        className="flex-1 bg-transparent text-[13px] focus:outline-none cursor-text placeholder:text-[#5A6478]"
                        style={{ color: '#C4CDD8' }}
                        onFocus={() => setIsAssistantOpen(true)}
                        readOnly
                      />
                      <div className="text-[11px] px-2.5 py-1 rounded-full font-mono shrink-0 mr-1" style={{ background: '#1B2236', color: '#5A6478' }}>Shift+/</div>
                    </div>
                  </div>

                  {/* Active tool toast */}
                  {activeTool && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
                      <div className="bg-blue-500 text-white px-5 py-2.5 rounded-full shadow-lg flex items-center gap-3 text-sm">
                        <span>
                          {drawingPoints.length === 0
                            ? `Click to set first point for ${activeTool}`
                            : `Click to set point ${drawingPoints.length + 1} for ${activeTool}`}
                        </span>
                        <div className="w-px h-4 bg-blue-300/50" />
                        <button onClick={() => { setActiveTool(null); setDrawingPoints([]); }}>
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Community / Twitter tracker */}
            <CommunityPanel currentAsset={currentAsset} />

          </div>

        {/* Floating Assistant Widget */}
        {isAssistantOpen && (
          <div className="absolute bottom-24 right-6 w-[380px] h-[600px] max-h-[80vh] bg-[#0B0E14] border border-[#1F2937] rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden">
            <Assistant onDraw={handleDraw} currentAsset={currentAsset} onClose={() => setIsAssistantOpen(false)} />
          </div>
        )}

        {/* Floating Toggle Button */}
        <button
          onClick={() => setIsAssistantOpen(!isAssistantOpen)}
          className={`absolute bottom-6 right-6 p-4 rounded-full shadow-xl transition-all duration-300 z-40 flex items-center justify-center ${
            isAssistantOpen
              ? 'bg-red-500 hover:bg-red-600 rotate-90'
              : 'bg-blue-600 hover:bg-blue-700 hover:scale-105'
          }`}
        >
          {isAssistantOpen ? (
            <X className="w-6 h-6 text-white" />
          ) : (
            <MessageSquare className="w-6 h-6 text-white" />
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
