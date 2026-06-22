import { useState, useCallback, useMemo } from 'react';

type SortField = 'rank' | 'volume24h' | 'price' | 'liquidity' | 'spreadBps';
type SortOrder = 'asc' | 'desc';

interface ExchangeMarket {
  rank: number;
  volume24h: string;
  price: string;
  liquidity: number;
  spreadBps: number;
  [key: string]: any;
}

export function useMarketsSort(data: ExchangeMarket[] = []) {
  const [sortField, setSortField] = useState<SortField>('rank');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  }, [sortField, sortOrder]);

  const sorted = useMemo(() => {
    if (!data || data.length === 0) return [];

    const copy = [...data];
    copy.sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      if (typeof aVal === 'string') {
        aVal = parseFloat(aVal.replace(/[$,%]/g, '')) || 0;
        bVal = parseFloat(String(bVal).replace(/[$,%]/g, '')) || 0;
      }

      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return copy;
  }, [data, sortField, sortOrder]);

  return { sorted, sortField, sortOrder, toggleSort };
}
