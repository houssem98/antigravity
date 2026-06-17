import React from 'react';
import { TrendingUp, Lock, Zap, Award } from 'lucide-react';
import { motion } from 'motion/react';

interface YieldTabProps {
  asset: string;
}

interface YieldOpportunity {
  protocol: string;
  type: string;
  apy: number;
  minDeposit: string;
  lockup: string;
  riskLevel: 'low' | 'medium' | 'high';
  tvl: string;
  icon: string;
}

const YIELD_OPPORTUNITIES: Record<string, YieldOpportunity[]> = {
  BTC: [
    { protocol: 'Staked', type: 'Staking', apy: 3.5, minDeposit: '0.01 BTC', lockup: '30 days', riskLevel: 'medium', tvl: '$450M', icon: '🪙' },
    { protocol: 'Lido', type: 'Liquid Staking', apy: 3.2, minDeposit: '0.001 BTC', lockup: 'Unstake anytime', riskLevel: 'medium', tvl: '$850M', icon: '💧' },
    { protocol: 'Nexus', type: 'Staking Pool', apy: 4.1, minDeposit: '0.1 BTC', lockup: '90 days', riskLevel: 'low', tvl: '$230M', icon: '⚡' },
  ],
  ETH: [
    { protocol: 'Lido', type: 'Liquid Staking', apy: 3.4, minDeposit: '0.01 ETH', lockup: 'Unstake anytime', riskLevel: 'low', tvl: '$32.5B', icon: '💧' },
    { protocol: 'Rocket Pool', type: 'Staking', apy: 3.8, minDeposit: '0.001 ETH', lockup: 'Unstake anytime', riskLevel: 'low', tvl: '$8.2B', icon: '🚀' },
    { protocol: 'Curve', type: 'Yield Farming', apy: 8.5, minDeposit: '1 ETH', lockup: 'None', riskLevel: 'high', tvl: '$4.5B', icon: '📈' },
    { protocol: 'Aave', type: 'Lending', apy: 2.3, minDeposit: '0.1 ETH', lockup: 'None', riskLevel: 'medium', tvl: '$15B', icon: '🏦' },
  ],
  SOL: [
    { protocol: 'Marinade', type: 'Liquid Staking', apy: 8.2, minDeposit: '0.01 SOL', lockup: 'Unstake anytime', riskLevel: 'low', tvl: '$2.8B', icon: '💧' },
    { protocol: 'Magic Eden', type: 'Staking', apy: 6.5, minDeposit: '1 SOL', lockup: '7 days', riskLevel: 'medium', tvl: '$450M', icon: '✨' },
    { protocol: 'Raydium', type: 'Yield Farming', apy: 12.3, minDeposit: '10 SOL', lockup: 'None', riskLevel: 'high', tvl: '$280M', icon: '🌤️' },
  ],
};

const getRiskColor = (level: 'low' | 'medium' | 'high') => {
  switch (level) {
    case 'low':
      return 'text-[color:var(--up)] bg-[color:var(--up)]/10';
    case 'medium':
      return 'text-[color:var(--text-2)] bg-[color:var(--line)]';
    case 'high':
      return 'text-[color:var(--accent)] bg-[color:var(--accent)]/10';
  }
};

export const YieldTab: React.FC<YieldTabProps> = ({ asset }) => {
  const opportunities = YIELD_OPPORTUNITIES[asset] || [];
  const avgApy = opportunities.length > 0 ? (opportunities.reduce((sum, o) => sum + o.apy, 0) / opportunities.length).toFixed(2) : '0';
  const topApy = opportunities.length > 0 ? Math.max(...opportunities.map(o => o.apy)).toFixed(1) : '0';

  return (
    <div className="flex flex-col h-full">
      {/* Summary cards */}
      <div className="p-4 border-b border-[color:var(--line)] bg-[color:var(--surface)]">
        <div className="grid grid-cols-2 gap-3">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-3 bg-[color:var(--bg)] border border-[color:var(--line)] rounded-sm">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-[color:var(--accent)]" />
              <span className="label text-[color:var(--text-3)]">Average APY</span>
            </div>
            <div className="text-h3 font-semibold text-[color:var(--text)]">{avgApy}%</div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="p-3 bg-[color:var(--bg)] border border-[color:var(--line)] rounded-sm">
            <div className="flex items-center gap-2 mb-2">
              <Award className="w-4 h-4 text-[color:var(--up)]" />
              <span className="label text-[color:var(--text-3)]">Best APY</span>
            </div>
            <div className="text-h3 font-semibold text-[color:var(--text)]">{topApy}%</div>
          </motion.div>
        </div>
      </div>

      {/* Opportunities list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {opportunities.length === 0 ? (
          <div className="py-12 text-center text-[color:var(--text-3)]">
            No yield opportunities available for {asset}
          </div>
        ) : (
          opportunities.map((opp, idx) => (
            <motion.div
              key={opp.protocol}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="p-4 bg-[color:var(--surface)] border border-[color:var(--line)] hover:border-[color:var(--line-strong)] rounded-sm transition-colors group cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-start gap-3 flex-1">
                  <span className="text-2xl">{opp.icon}</span>
                  <div className="flex-1">
                    <h3 className="text-body font-semibold text-[color:var(--text)]">{opp.protocol}</h3>
                    <p className="text-label text-[color:var(--text-3)]">{opp.type}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-h3 font-bold text-[color:var(--up)] group-hover:scale-105 transition-transform origin-top-right">
                    {opp.apy.toFixed(1)}%
                  </div>
                  <div className="text-label text-[color:var(--text-3)]">APY</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="text-label">
                  <span className="text-[color:var(--text-3)]">Min Deposit:</span>
                  <div className="font-mono text-[color:var(--text)] text-data">{opp.minDeposit}</div>
                </div>
                <div className="text-label">
                  <span className="text-[color:var(--text-3)]">TVL:</span>
                  <div className="font-mono text-[color:var(--text)] text-data">{opp.tvl}</div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Lock className="w-3 h-3 text-[color:var(--text-3)]" />
                  <span className="text-label text-[color:var(--text-3)]">{opp.lockup}</span>
                </div>
                <span className={`text-label font-semibold px-2 py-1 rounded-sm capitalize ${getRiskColor(opp.riskLevel)}`}>
                  {opp.riskLevel}
                </span>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};
