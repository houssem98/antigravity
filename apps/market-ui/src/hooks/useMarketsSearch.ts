import { useState, useCallback, useMemo } from 'react';

interface ExchangeMarket {
  name: string;
  pair: string;
  [key: string]: any;
}

export function useMarketsSearch(data: ExchangeMarket[] = []) {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return data;

    const query = searchQuery.toLowerCase();
    return data.filter(ex =>
      ex.name.toLowerCase().includes(query) ||
      ex.pair.toLowerCase().includes(query)
    );
  }, [data, searchQuery]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  return { filtered, searchQuery, setSearchQuery, clearSearch };
}
