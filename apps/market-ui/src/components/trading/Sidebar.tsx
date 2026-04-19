import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  MousePointer2, Crosshair, Minus, TrendingUp, Square, Circle, Type, Ruler,
  ZoomIn, ZoomOut, ArrowLeft, ArrowRight, Magnet, Lock, EyeOff, Trash2,
  ChevronRight, MoveRight, MoveUpRight, MoveDownRight, Spline, Triangle,
  PenTool, MessageSquareQuote, Activity, Check,
} from 'lucide-react';

interface SidebarProps {
  onToolClick?: (toolLabel: string) => void;
  activeTool?: string | null;
  activeIndicators?: string[];
  onIndicatorToggle?: (indicator: string) => void;
}

const TOOL_GROUPS = [
  { id: 'cursors', tools: [
    { icon: Crosshair, label: 'Crosshair' },
    { icon: MousePointer2, label: 'Cursor' },
  ]},
  { id: 'lines', tools: [
    { icon: Minus, label: 'Trend Line' },
    { icon: MoveRight, label: 'Horizontal Line' },
    { icon: Minus, label: 'Vertical Line', style: { transform: 'rotate(90deg)' } },
    { icon: MoveUpRight, label: 'Ray' },
    { icon: MoveDownRight, label: 'Extended Line' },
  ]},
  { id: 'fib', tools: [
    { icon: TrendingUp, label: 'Fibonacci Retracement' },
    { icon: Spline, label: 'Trend-Based Fib Extension' },
  ]},
  { id: 'shapes', tools: [
    { icon: Square, label: 'Order Block' },
    { icon: Square, label: 'Rectangle' },
    { icon: Square, label: 'Manual Order Block' },
    { icon: Circle, label: 'Ellipse' },
    { icon: Triangle, label: 'Triangle' },
    { icon: PenTool, label: 'Path' },
  ]},
  { id: 'patterns', tools: [
    { icon: Activity, label: 'Head and Shoulders' },
    { icon: Activity, label: 'Double Top' },
    { icon: Activity, label: 'Double Bottom' },
    { icon: Activity, label: 'Flag' },
  ]},
  { id: 'text', tools: [
    { icon: Type, label: 'Text' },
    { icon: MessageSquareQuote, label: 'Callout' },
  ]},
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

/** Compact left rail: drawing tools, indicators, actions.
 *  40px wide, 2px radii, no shadows, tokens only. */
export const Sidebar: React.FC<SidebarProps> = ({
  onToolClick, activeTool, activeIndicators, onIndicatorToggle,
}) => {
  const [activeGroupTools, setActiveGroupTools] = useState<Record<string, string>>({
    cursors: 'Crosshair',
    lines: 'Trend Line',
    fib: 'Fibonacci Retracement',
    shapes: 'Order Block',
    text: 'Text',
  });

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    const handleClickOutside = (e: MouseEvent) => {
      if (sidebar && !sidebar.contains(e.target as Node)) {
        if (!(e.target as Element).closest('.portal-menu')) setOpenMenuId(null);
      }
    };
    const handleScroll = () => setOpenMenuId(null);
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

  const btn = "relative shrink-0 w-7 h-7 flex items-center justify-center rounded-sm transition-colors";
  const btnIdle = "text-[color:var(--text-3)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface-2)]";
  const btnActive = "text-[color:var(--accent)] bg-[color:color-mix(in_oklch,var(--accent)_12%,transparent)]";
  const divider = "w-5 h-px my-1.5 shrink-0 bg-[color:var(--line)]";

  return (
    <div
      ref={sidebarRef}
      className="w-10 flex flex-col items-center py-2 gap-px h-full overflow-y-auto overflow-x-hidden relative z-50 bg-[color:var(--surface)] border-r border-[color:var(--line)]"
      style={{ scrollbarWidth: 'none' }}
    >
      {TOOL_GROUPS.map((group) => {
        const activeToolLabel = activeGroupTools[group.id];
        const activeToolObj = group.tools.find(t => t.label === activeToolLabel) || group.tools[0];
        const isGroupActive = group.tools.some(t => t.label === activeTool);
        const isMenuOpen = openMenuId === group.id;

        return (
          <div key={group.id} className="relative w-full flex justify-center">
            <button
              onClick={() => onToolClick?.(activeToolObj.label)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (isMenuOpen) setOpenMenuId(null);
                else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setMenuPosition({ top: rect.top, left: rect.right });
                  setOpenMenuId(group.id);
                }
              }}
              className={`${btn} ${isGroupActive ? btnActive : btnIdle}`}
              title={activeToolObj.label}
            >
              <activeToolObj.icon className="w-3.5 h-3.5 relative z-10" style={(activeToolObj as any).style} />
              <span
                className="absolute right-0 bottom-0 w-2 h-2 flex items-end justify-end text-[color:var(--text-4)] hover:text-[color:var(--text-2)] cursor-pointer z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isMenuOpen) setOpenMenuId(null);
                  else {
                    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                    setMenuPosition({ top: rect.top, left: rect.right });
                    setOpenMenuId(group.id);
                  }
                }}
              >
                <ChevronRight className="w-2.5 h-2.5" />
              </span>
            </button>

            {isMenuOpen && menuPosition && createPortal(
              <div
                className="portal-menu fixed z-[9999] pl-2"
                style={{ top: menuPosition.top, left: menuPosition.left }}
              >
                <div className="rounded-[4px] shadow-xl py-1 min-w-[200px] bg-[color:var(--surface-2)] border border-[color:var(--line-strong)]">
                  {group.tools.map((tool) => {
                    const isActive = activeTool === tool.label || activeToolLabel === tool.label;
                    return (
                      <button
                        key={tool.label}
                        onClick={() => handleToolSelect(group.id, tool.label)}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-data transition-colors ${
                          isActive
                            ? 'text-[color:var(--accent)]'
                            : 'text-[color:var(--text-2)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface)]'
                        }`}
                      >
                        <tool.icon className="w-3.5 h-3.5" style={(tool as any).style} />
                        <span className="flex-1 text-left">{tool.label}</span>
                        {isActive && <Check className="w-3 h-3" />}
                      </button>
                    );
                  })}
                </div>
              </div>,
              document.body
            )}
          </div>
        );
      })}

      <div className={divider} />

      {STANDALONE_TOOLS.map((tool, i) => {
        const isToolActive = activeTool === tool.label;
        return (
          <button
            key={i}
            onClick={() => onToolClick?.(tool.label)}
            className={`${btn} group ${isToolActive ? btnActive : btnIdle}`}
            title={tool.label}
          >
            <tool.icon className="w-3.5 h-3.5 relative z-10" />
            <span className="absolute left-full ml-2 px-2 py-0.5 text-label rounded-sm opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 bg-[color:var(--surface-2)] text-[color:var(--text)] border border-[color:var(--line)]">
              {tool.label}
            </span>
          </button>
        );
      })}

      <div className={divider} />

      <div className="relative w-full flex justify-center">
        <button
          onClick={() => setOpenMenuId(openMenuId === 'indicators' ? null : 'indicators')}
          className={`${btn} ${openMenuId === 'indicators' ? btnActive : btnIdle}`}
          title="Indicators"
        >
          <Activity className="w-3.5 h-3.5" />
          <span className="absolute right-0 bottom-0 w-2 h-2 flex items-end justify-end text-[color:var(--text-4)]">
            <ChevronRight className="w-2.5 h-2.5" />
          </span>
        </button>

        {openMenuId === 'indicators' && (
          <div className="absolute left-[44px] top-0 rounded-[4px] shadow-xl py-1 min-w-[180px] z-50 bg-[color:var(--surface-2)] border border-[color:var(--line-strong)]">
            {['SMA 20', 'SMA 50', 'SMA 200', 'EMA 20', 'EMA 50', 'RSI', 'MACD'].map((indicator) => {
              const isActive = activeIndicators?.includes(indicator);
              return (
                <button
                  key={indicator}
                  onClick={() => onIndicatorToggle?.(indicator)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-data transition-colors ${
                    isActive
                      ? 'text-[color:var(--accent)]'
                      : 'text-[color:var(--text-2)] hover:text-[color:var(--text)] hover:bg-[color:var(--surface)]'
                  }`}
                >
                  <span className="font-mono">{indicator}</span>
                  {isActive && <Check className="w-3 h-3" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className={divider} />

      {ACTIONS.map((action, i) => (
        <button
          key={i}
          onClick={() => onToolClick?.(action.label)}
          className={`${btn} group ${btnIdle}`}
          title={action.label}
        >
          <action.icon className="w-3.5 h-3.5" />
          <span className="absolute left-full ml-2 px-2 py-0.5 text-label rounded-sm opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 bg-[color:var(--surface-2)] text-[color:var(--text)] border border-[color:var(--line)]">
            {action.label}
          </span>
        </button>
      ))}
    </div>
  );
};
