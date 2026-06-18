import { useState, useEffect } from 'react';
import type { RiskAlert } from '../components/trading/HermesRiskBanner';

export const useAssetRiskCheck = (
  asset: string,
  holdersData?: any[],
  marketsData?: any[]
) => {
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!asset || !holdersData || !marketsData) return;

    const checkRisks = async () => {
      setIsLoading(true);
      try {
        const newAlerts: RiskAlert[] = [];

        // Check holder concentration (Phase 3T)
        if (holdersData.length > 0) {
          const top5Pct = holdersData
            .slice(0, 5)
            .reduce((sum, h) => sum + (h.percentage || 0), 0);

          if (top5Pct > 80) {
            newAlerts.push({
              severity: 'high',
              title: 'High Holder Concentration',
              description: `Top 5 holders control ${top5Pct.toFixed(1)}% — extreme concentration risk`,
              type: 'concentration',
            });
          } else if (top5Pct > 60) {
            newAlerts.push({
              severity: 'medium',
              title: 'Moderate Holder Concentration',
              description: `Top 5 holders control ${top5Pct.toFixed(1)}%`,
              type: 'concentration',
            });
          }
        }

        // Check liquidity depth (Phase 3T)
        if (marketsData.length > 0) {
          const topExchange = marketsData[0];
          if (topExchange.depth) {
            const depthStr = topExchange.depth.toString();
            // Extract first depth number (bid side)
            const depthMatch = depthStr.match(/\$?([\d,]+)/);
            if (depthMatch) {
              const depthValue = parseInt(depthMatch[1].replace(/,/g, ''));
              if (depthValue < 100000) {
                newAlerts.push({
                  severity: 'high',
                  title: 'Thin Order Book Depth',
                  description: `Top exchange shows only $${(depthValue / 1000).toFixed(0)}K depth — high slippage risk`,
                  type: 'liquidity',
                });
              } else if (depthValue < 500000) {
                newAlerts.push({
                  severity: 'medium',
                  title: 'Limited Liquidity',
                  description: `Moderate depth on largest exchange`,
                  type: 'liquidity',
                });
              }
            }
          }
        }

        // Check volume concentration (Phase 3T)
        if (marketsData.length > 0) {
          const topVolume = marketsData[0];
          if (topVolume.volumePercent) {
            const volumeNum = parseFloat(topVolume.volumePercent);
            if (volumeNum > 50) {
              newAlerts.push({
                severity: 'high',
                title: 'Extreme Volume Concentration',
                description: `${volumeNum.toFixed(1)}% of volume on single exchange — execution risk`,
                type: 'concentration',
              });
            } else if (volumeNum > 35) {
              newAlerts.push({
                severity: 'medium',
                title: 'High Volume Concentration',
                description: `${volumeNum.toFixed(1)}% on largest exchange`,
                type: 'concentration',
              });
            }
          }
        }

        // Filter out dismissed alerts
        const filteredAlerts = newAlerts.filter(
          (a) => !dismissed.has(`${a.type}-${a.title}`)
        );

        setAlerts(filteredAlerts);
      } catch (error) {
        console.error('Risk check failed:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkRisks();
  }, [asset, holdersData, marketsData, dismissed]);

  const dismissAlert = (index: number) => {
    if (alerts[index]) {
      const key = `${alerts[index].type}-${alerts[index].title}`;
      setDismissed((prev) => new Set([...prev, key]));
    }
  };

  return {
    alerts,
    isLoading,
    dismissAlert,
    hasAlerts: alerts.length > 0,
  };
};
