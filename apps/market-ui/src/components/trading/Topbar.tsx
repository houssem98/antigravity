import React, { useState } from 'react';
import { Settings, BarChart2, Activity, ChevronDown, TrendingUp, SlidersHorizontal } from 'lucide-react';
import type { ChartColors } from './Chart';

const COIN_TABS = ['Chart', 'Markets', 'News', 'Yield', 'Holders', 'About'] as const;
const TIMEFRAMES = ['1h', '24h', '1W', '1M', '1Y', 'ALL'];

interface TopbarProps {
  currentAsset?: string;
  onAssetChange?: (asset: string) => void;
  currentTimeframe: string;
  onTimeframeChange: (tf: string) => void;
  chartColors: ChartColors;
  onChartColorsChange: (colors: ChartColors) => void;
  onToolClick?: (toolLabel: string) => void;
  isOrderBookOpen?: boolean;
  onToggleOrderBook?: () => void;
  onSellClick?: () => void;
  onBuyClick?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  currentAsset = 'BTC',
  currentTimeframe,
  onTimeframeChange,
  chartColors,
  onChartColorsChange,
  onBuyClick,
}) => {
  const [activeTab, setActiveTab] = useState<string>('Chart');
  const [chartType, setChartType] = useState<'candles' | 'line'>('candles');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [dexMode, setDexMode] = useState(false);
  const [showAllTf, setShowAllTf] = useState(false);

  // Visible timeframes: first 3 always shown, rest in dropdown
  const visibleTf = TIMEFRAMES.slice(0, 3);

  return (
    <div className="shrink-0" style={{ background: '#0B0E14', borderBottom: '1px solid #1B2236' }}>

      {/* ── Row 1: Page tabs + actions ── */}
      <div className="flex items-stretch h-11 px-0" style={{ borderBottom: '1px solid #1B2236' }}>
        <div className="flex items-stretch" style={{ scrollbarWidth: 'none' }}>
          {COIN_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="relative flex items-center px-4 text-[13px] font-semibold whitespace-nowrap transition-colors"
              style={{ color: activeTab === tab ? '#FFFFFF' : '#5A6478' }}
            >
              {tab}
              {tab === 'Yield' && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-[#00C853] inline-block" />
              )}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2962FF] rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 px-3 shrink-0">
          <button
            onClick={onBuyClick}
            className="px-4 py-1.5 rounded-lg text-[12px] font-bold text-white transition-all"
            style={{ background: '#2962FF' }}
          >
            Buy {currentAsset}
          </button>

          {/* DEX Mode toggle */}
          <button
            onClick={() => setDexMode(!dexMode)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all"
            style={{ background: '#0E1320', border: '1px solid #1B2236', color: '#C4CDD8' }}
          >
            DEX Mode
            <span
              className="w-8 h-4 rounded-full relative transition-all shrink-0"
              style={{ background: dexMode ? '#2962FF' : '#1B2236' }}
            >
              <span
                className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                style={{ left: dexMode ? '17px' : '2px' }}
              />
            </span>
          </button>
        </div>
      </div>

      {/* ── Row 2: Chart controls ── */}
      <div className="flex items-center h-10 px-3">

        {/* LEFT group */}
        <div className="flex items-center gap-1 shrink-0">

          {/* Price / Mkt Cap toggle */}
          <div className="flex items-center rounded-lg p-0.5" style={{ background: '#0E1320' }}>
            <button className="px-2.5 py-1 text-[12px] font-bold rounded-md text-white" style={{ background: '#2962FF' }}>
              Price
            </button>
            <button className="px-2.5 py-1 text-[12px] font-semibold" style={{ color: '#5A6478' }}>
              Mkt Cap
            </button>
          </div>

          {/* Divider */}
          <div className="w-px h-5 mx-1.5" style={{ background: '#1B2236' }} />

          {/* Chart type icon */}
          <button
            onClick={() => setChartType(chartType === 'candles' ? 'line' : 'candles')}
            className="flex items-center px-2 py-1 rounded-lg transition-colors"
            style={{
              color: '#5A6478',
              background: chartType === 'line' ? '#0E1320' : 'transparent',
            }}
            title="Chart type"
          >
            <BarChart2 className="w-4 h-4" />
          </button>

          {/* TradingView */}
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-bold transition-colors"
            style={{ color: '#C4CDD8', background: '#0E1320', border: '1px solid #1B2236' }}
          >
            <TrendingUp className="w-3.5 h-3.5" style={{ color: '#2962FF' }} />
            TradingView
          </button>
        </div>

        {/* RIGHT group — ml-auto */}
        <div className="ml-auto flex items-center gap-1 shrink-0">

          {/* Indicators */}
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
            style={{ color: '#C4CDD8', background: '#0E1320', border: '1px solid #1B2236' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#2962FF')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#1B2236')}
          >
            <Activity className="w-3.5 h-3.5" style={{ color: '#7364FF' }} />
            Indicators
          </button>

          {/* Divider */}
          <div className="w-px h-5 mx-1.5" style={{ background: '#1B2236' }} />

          {/* Timeframes */}
          <div className="flex items-center">
            {(showAllTf ? TIMEFRAMES : visibleTf).map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange(tf)}
                className="px-2.5 py-1 text-[12px] font-bold rounded-lg transition-all"
                style={{
                  color: currentTimeframe === tf ? '#2962FF' : '#5A6478',
                  background: currentTimeframe === tf ? 'rgba(41,98,255,0.1)' : 'transparent',
                }}
              >
                {tf}
              </button>
            ))}
            <button
              onClick={() => setShowAllTf(!showAllTf)}
              className="flex items-center p-1 rounded-lg transition-colors"
              style={{ color: '#5A6478' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#0E1320')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <ChevronDown className="w-3.5 h-3.5" style={{ transform: showAllTf ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>
          </div>

          {/* Divider */}
          <div className="w-px h-5 mx-1.5" style={{ background: '#1B2236' }} />

          {/* Chart Settings */}
          <div className="relative">
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="p-1.5 rounded-lg transition-colors"
              style={{
                color: isSettingsOpen ? '#2962FF' : '#5A6478',
                background: isSettingsOpen ? 'rgba(41,98,255,0.1)' : 'transparent',
              }}
              title="Chart settings"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>

            {isSettingsOpen && (
              <div className="absolute top-10 right-0 rounded-2xl p-5 shadow-2xl z-50 w-64"
                style={{ background: '#0E1320', border: '1px solid #1B2236' }}>
                <h3 className="font-bold mb-4 text-[13px] flex items-center gap-2 text-white">
                  <Settings className="w-4 h-4 text-[#2962FF]" /> Chart Settings
                </h3>
                <div className="space-y-4">
                  {([['Up Color', 'upColor'], ['Down Color', 'downColor']] as const).map(([label, key]) => (
                    <div key={key} className="flex items-center justify-between">
                      <label className="text-[12px] font-medium" style={{ color: '#8A92A6' }}>{label}</label>
                      <div
                        className="w-7 h-7 rounded-lg cursor-pointer border transition-transform hover:scale-110"
                        style={{ backgroundColor: chartColors[key], borderColor: '#1B2236' }}
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'color';
                          input.value = chartColors[key];
                          input.onchange = (e) => onChartColorsChange({ ...chartColors, [key]: (e.target as HTMLInputElement).value });
                          input.click();
                        }}
                      />
                    </div>
                  ))}
                  {([['Show Borders', 'borderVisible'], ['Show Wicks', 'wickVisible']] as const).map(([label, key]) => (
                    <div key={key} className="flex items-center justify-between">
                      <label className="text-[12px] font-medium" style={{ color: '#8A92A6' }}>{label}</label>
                      <input
                        type="checkbox"
                        checked={chartColors[key] as boolean}
                        onChange={e => onChartColorsChange({ ...chartColors, [key]: e.target.checked })}
                        className="w-4 h-4 rounded cursor-pointer accent-[#2962FF]"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
