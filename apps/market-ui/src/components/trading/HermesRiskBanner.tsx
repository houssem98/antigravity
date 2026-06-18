import React from 'react';
import { AlertTriangle, AlertCircle, TrendingDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface RiskAlert {
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  type: 'concentration' | 'liquidity' | 'volatility';
}

interface HermesRiskBannerProps {
  alerts: RiskAlert[];
  isLoading: boolean;
  onDismiss: (index: number) => void;
}

export const HermesRiskBanner: React.FC<HermesRiskBannerProps> = ({
  alerts,
  isLoading,
  onDismiss,
}) => {
  const severityStyles = {
    high: {
      bg: 'from-[color:var(--down)]/20 to-[color:var(--down)]/10',
      border: 'border-[color:var(--down)]/50',
      icon: 'bg-[color:var(--down)]/20 text-[color:var(--down)]',
      badge: 'bg-[color:var(--down)] text-white',
    },
    medium: {
      bg: 'from-[color:var(--accent)]/20 to-[color:var(--accent)]/10',
      border: 'border-[color:var(--accent)]/50',
      icon: 'bg-[color:var(--accent)]/20 text-[color:var(--accent)]',
      badge: 'bg-[color:var(--accent)] text-[color:var(--accent-ink)]',
    },
    low: {
      bg: 'from-[color:var(--up)]/20 to-[color:var(--up)]/10',
      border: 'border-[color:var(--up)]/50',
      icon: 'bg-[color:var(--up)]/20 text-[color:var(--up)]',
      badge: 'bg-[color:var(--up)] text-white',
    },
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'concentration':
        return <AlertTriangle className="w-4 h-4" />;
      case 'liquidity':
        return <AlertCircle className="w-4 h-4" />;
      case 'volatility':
        return <TrendingDown className="w-4 h-4" />;
      default:
        return <AlertCircle className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {alerts.map((alert, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`bg-gradient-to-r ${severityStyles[alert.severity].bg} border ${severityStyles[alert.severity].border} rounded-lg p-3 flex gap-3 items-start`}
          >
            <div className={`p-2 rounded-lg ${severityStyles[alert.severity].icon} flex-shrink-0 mt-0.5`}>
              {getIcon(alert.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-label font-semibold text-[color:var(--text)]">
                  {alert.title}
                </h4>
                <span className={`text-label font-bold px-2 py-0.5 rounded-sm ${severityStyles[alert.severity].badge}`}>
                  {alert.severity.toUpperCase()}
                </span>
              </div>
              <p className="text-label text-[color:var(--text-2)] line-clamp-2">
                {alert.description}
              </p>
            </div>
            <button
              onClick={() => onDismiss(idx)}
              className="flex-shrink-0 text-[color:var(--text-3)] hover:text-[color:var(--text)] transition-colors mt-0.5"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      {isLoading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-[color:var(--surface-2)] rounded-lg p-3 flex gap-2 items-center"
        >
          <div className="w-4 h-4 border-2 border-[color:var(--accent)] border-t-transparent rounded-full animate-spin" />
          <span className="text-label text-[color:var(--text-3)]">Analyzing asset safety...</span>
        </motion.div>
      )}
    </div>
  );
};
