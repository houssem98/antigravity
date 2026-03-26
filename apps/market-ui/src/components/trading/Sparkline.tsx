import React, { useEffect, useState } from 'react';

interface SparklineProps {
  id: string;
  color: string;
}

export const Sparkline: React.FC<SparklineProps> = ({ id, color }) => {
  const [data, setData] = useState<number[]>([]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      // Try backend proxy first
      try {
        const res = await fetch(`/api/crypto/sparkline/${id}`);
        if (res.ok) {
          const json = await res.json();
          if (isMounted && Array.isArray(json) && json.length > 0) { setData(json); return; }
        }
      } catch { /* fall through */ }
      // Direct Binance fallback
      try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${id.toUpperCase()}USDT&interval=2h&limit=84`);
        if (res.ok) {
          const json = await res.json();
          if (isMounted && Array.isArray(json)) setData(json.map((d: any[]) => parseFloat(d[4])));
        }
      } catch { /* silent */ }
    };
    load();
    return () => { isMounted = false; };
  }, [id]);

  if (!data.length) {
    return <div className="w-24 h-8 bg-[#1F2937] animate-pulse rounded"></div>;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  
  const width = 100;
  const height = 32;
  
  const points = data.map((val, i) => {
    const x = data.length > 1 ? (i / (data.length - 1)) * width : width / 2;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};
