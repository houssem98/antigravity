import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { 
  MousePointer2, 
  Crosshair, 
  Minus, 
  TrendingUp, 
  Square, 
  Circle, 
  Type, 
  Ruler, 
  ZoomIn, 
  ZoomOut,
  ArrowLeft,
  ArrowRight,
  Magnet, 
  Lock, 
  EyeOff, 
  Trash2,
  ChevronRight,
  MoveRight,
  MoveUpRight,
  MoveDownRight,
  Spline,
  Triangle,
  PenTool,
  MessageSquareQuote,
  Activity,
  Check
} from 'lucide-react';

interface SidebarProps {
  onToolClick?: (toolLabel: string) => void;
  activeTool?: string | null;
  activeIndicators?: string[];
  onIndicatorToggle?: (indicator: string) => void;
}

const TOOL_GROUPS = [
  {
    id: 'cursors',
    tools: [
      { icon: Crosshair, label: 'Crosshair' },
      { icon: MousePointer2, label: 'Cursor' },
    ]
  },
  {
    id: 'lines',
    tools: [
      { icon: Minus, label: 'Trend Line' },
      { icon: MoveRight, label: 'Horizontal Line' },
      { icon: Minus, label: 'Vertical Line', style: { transform: 'rotate(90deg)' } },
      { icon: MoveUpRight, label: 'Ray' },
      { icon: MoveDownRight, label: 'Extended Line' },
    ]
  },
  {
    id: 'fib',
    tools: [
      { icon: TrendingUp, label: 'Fibonacci Retracement' },
      { icon: Spline, label: 'Trend-Based Fib Extension' },
    ]
  },
  {
    id: 'shapes',
    tools: [
      { icon: Square, label: 'Order Block' },
      { icon: Square, label: 'Rectangle' },
      { icon: Square, label: 'Manual Order Block' },
      { icon: Circle, label: 'Ellipse' },
      { icon: Triangle, label: 'Triangle' },
      { icon: PenTool, label: 'Path' },
    ]
  },
  {
    id: 'patterns',
    tools: [
      { icon: Activity, label: 'Head and Shoulders' },
      { icon: Activity, label: 'Double Top' },
      { icon: Activity, label: 'Double Bottom' },
      { icon: Activity, label: 'Flag' },
    ]
  },
  {
    id: 'text',
    tools: [
      { icon: Type, label: 'Text' },
      { icon: MessageSquareQuote, label: 'Callout' },
    ]
  }
];

const STANDALONE_TOOLS = [
  { icon: Ruler, label: 'Measure' },
  { icon: ZoomIn, label: 'Zoom In' },
  { icon: ZoomOut, label: 'Zoom Out' },
  { icon: ArrowLeft, label: 'Pan Left' },
  { icon: ArrowRight, label: 'Pan Right' },
];

const ACTIONS = [
  { icon: Magnet, label: 'Magnet Mode' },
  { icon: Lock, label: 'Lock All Drawings' },
  { icon: EyeOff, label: 'Hide All Drawings' },
  { icon: Trash2, label: 'Remove All Drawings' },
];

export const Sidebar: React.FC<SidebarProps> = ({ onToolClick, activeTool, activeIndicators, onIndicatorToggle }) => {
  const [activeGroupTools, setActiveGroupTools] = useState<Record<string, string>>({
    cursors: 'Crosshair',
    lines: 'Trend Line',
    fib: 'Fibonacci Retracement',
    shapes: 'Order Block',
    text: 'Text',
  });

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number, left: number } | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    const handleClickOutside = (e: MouseEvent) => {
      if (sidebar && !sidebar.contains(e.target as Node)) {
        // Only close if we didn't click inside a portal menu
        if (!(e.target as Element).closest('.portal-menu')) {
          setOpenMenuId(null);
        }
      }
    };
    
    const handleScroll = () => {
      setOpenMenuId(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    sidebar?.addEventListener('scroll', handleScroll);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      sidebar?.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const handleToolSelect = (groupId: string, toolLabel: string) => {
    setActiveGroupTools(prev => ({ ...prev, [groupId]: toolLabel }));
    setOpenMenuId(null);
    onToolClick?.(toolLabel);
  };

  return (
    <div ref={sidebarRef} className="w-10 bg-[#0B0E14] flex flex-col items-center py-3 gap-0.5 h-full overflow-y-auto overflow-x-hidden relative z-50" style={{ scrollbarWidth: 'none', borderRight: '1px solid #1B2236' }}>
      {TOOL_GROUPS.map((group) => {
        const activeToolLabel = activeGroupTools[group.id];
        const activeToolObj = group.tools.find(t => t.label === activeToolLabel) || group.tools[0];
        const isGroupActive = group.tools.some(t => t.label === activeTool);
        const isMenuOpen = openMenuId === group.id;

        return (
          <div key={group.id} className="relative group/item w-full flex justify-center">
            <button
              onClick={() => onToolClick?.(activeToolObj.label)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (isMenuOpen) {
                  setOpenMenuId(null);
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setMenuPosition({ top: rect.top, left: rect.right });
                  setOpenMenuId(group.id);
                }
              }}
              className={`p-1.5 rounded-lg transition-all relative shrink-0 ${
                isGroupActive ? 'text-blue-500 bg-blue-500/10' : 'text-gray-400 hover:text-white hover:bg-[#1B2236]'
              }`}
              title={activeToolObj.label}
            >
              {isGroupActive && (
                <motion.div
                  layoutId="activeToolBackground"
                  className="absolute inset-0 bg-blue-500/10 rounded-xl z-0 border border-blue-500/20"
                  initial={false}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <activeToolObj.icon className="w-4 h-4 relative z-10" style={(activeToolObj as any).style} />
              
              {/* Small arrow indicator */}
              <div 
                className="absolute right-0 bottom-0 w-4 h-4 flex items-end justify-end opacity-50 hover:opacity-100 cursor-pointer z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isMenuOpen) {
                    setOpenMenuId(null);
                  } else {
                    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                    setMenuPosition({ top: rect.top, left: rect.right });
                    setOpenMenuId(group.id);
                  }
                }}
              >
                <ChevronRight className="w-3 h-3 text-gray-400" />
              </div>
            </button>

            {/* Flyout Menu */}
            {isMenuOpen && menuPosition && createPortal(
              <div 
                className="portal-menu fixed z-[9999] pl-2"
                style={{ top: menuPosition.top, left: menuPosition.left }}
              >
                <div className="rounded-xl shadow-2xl py-2 min-w-[200px]" style={{ background: '#0E1320', border: '1px solid #1B2236' }}>
                  {group.tools.map((tool) => (
                    <button
                      key={tool.label}
                      onClick={() => handleToolSelect(group.id, tool.label)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                        activeTool === tool.label || activeToolLabel === tool.label
                          ? 'text-blue-500 bg-blue-500/10 font-medium'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      <tool.icon className="w-4 h-4" style={(tool as any).style} />
                      {tool.label}
                    </button>
                  ))}
                </div>
              </div>,
              document.body
            )}
          </div>
        );
      })}

      <div className="w-6 h-px my-1.5 shrink-0" style={{ background: '#1B2236' }} />

      {STANDALONE_TOOLS.map((tool, i) => {
        const isToolActive = activeTool === tool.label;
        return (
          <button
            key={i}
            onClick={() => onToolClick?.(tool.label)}
            className={`p-2 rounded-xl transition-all group relative shrink-0 ${
              isToolActive ? 'text-blue-500 bg-blue-500/10' : 'text-gray-400 hover:text-white hover:bg-[#1B2236]'
            }`}
            title={tool.label}
          >
            {isToolActive && (
              <motion.div
                layoutId="activeToolBackground"
                className="absolute inset-0 bg-blue-500/10 rounded-xl z-0 border border-blue-500/20"
                initial={false}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            )}
            <tool.icon className="w-4 h-4 relative z-10" />
            <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-xs text-white rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
              {tool.label}
            </div>
          </button>
        );
      })}

      <div className="w-6 h-px my-1.5 shrink-0" style={{ background: '#1B2236' }} />

      <div className="relative group/item w-full flex justify-center">
        <button
          onClick={() => setOpenMenuId(openMenuId === 'indicators' ? null : 'indicators')}
          className={`p-1.5 rounded-lg transition-all relative shrink-0 ${
            openMenuId === 'indicators' ? 'text-blue-500 bg-blue-500/10' : 'text-gray-400 hover:text-white hover:bg-[#1B2236]'
          }`}
          title="Indicators"
        >
          <Activity className="w-4 h-4" />
          <div className="absolute right-0 bottom-0 w-4 h-4 flex items-end justify-end opacity-50 hover:opacity-100 cursor-pointer">
            <ChevronRight className="w-3 h-3 text-gray-400" />
          </div>
        </button>

        {openMenuId === 'indicators' && (
          <div className="absolute left-[44px] top-0 rounded-xl shadow-2xl py-2 min-w-[200px] z-50" style={{ background: '#0E1320', border: '1px solid #1B2236' }}>
            {['SMA 20', 'SMA 50', 'SMA 200', 'EMA 20', 'EMA 50', 'RSI', 'MACD'].map((indicator) => {
              const isActive = activeIndicators?.includes(indicator);
              return (
                <button
                  key={indicator}
                  onClick={() => onIndicatorToggle?.(indicator)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                    isActive ? 'text-blue-500 bg-blue-500/10 font-medium' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <span>{indicator}</span>
                  {isActive && <Check className="w-4 h-4 text-blue-500" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="w-6 h-px my-1.5 shrink-0" style={{ background: '#1B2236' }} />
      
      {ACTIONS.map((action, i) => (
        <button
          key={i}
          onClick={() => onToolClick?.(action.label)}
          className="p-1.5 text-gray-400 hover:text-white hover:bg-[#1B2236] rounded-lg transition-all group relative shrink-0"
          title={action.label}
        >
          <action.icon className="w-4 h-4" />
          <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-xs text-white rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
            {action.label}
          </div>
        </button>
      ))}
    </div>
  );
};
