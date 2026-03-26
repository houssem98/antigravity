import React, { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { ALL_ASSETS } from '../../constants/tradingAssets';

interface SymbolSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (symbol: string) => void;
}

export const SymbolSearchModal: React.FC<SymbolSearchModalProps> = ({ isOpen, onClose, onSelect }) => {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('All');

  // Reset search and tab when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setActiveTab('All');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredAssets = ALL_ASSETS.filter(asset => {
    const matchesTab = activeTab === 'All' || asset.type === activeTab;
    const matchesSearch = asset.symbol.toLowerCase().includes(search.toLowerCase()) || 
                          asset.name.toLowerCase().includes(search.toLowerCase());
    return matchesTab && matchesSearch;
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-[#111827] rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-[#1F2937] flex flex-col h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-[#1F2937] flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              autoFocus
              type="text"
              placeholder="Search symbol or name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#1F2937] text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow text-lg"
            />
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white hover:bg-[#1F2937] rounded-lg transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-4 border-b border-[#1F2937]">
          {['All', 'Crypto', 'Stock', 'Forex'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 font-medium text-sm transition-colors relative ${
                activeTab === tab ? 'text-blue-500' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab}
              {activeTab === tab && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-500" />
              )}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {filteredAssets.length > 0 ? (
            <div className="space-y-1">
              {filteredAssets.map(asset => (
                <button
                  key={asset.symbol}
                  onClick={() => {
                    onSelect(asset.symbol);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between p-3 hover:bg-[#1F2937] rounded-lg transition-colors group text-left"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#1F2937] flex items-center justify-center text-gray-300 font-bold text-xs group-hover:bg-[#111827] transition-colors">
                      {asset.symbol.substring(0, 2)}
                    </div>
                    <div>
                      <div className="text-white font-bold">{asset.symbol}</div>
                      <div className="text-gray-400 text-sm">{asset.name}</div>
                    </div>
                  </div>
                  <div className="text-xs font-medium px-2 py-1 rounded bg-[#1F2937] text-gray-400 group-hover:bg-[#111827] transition-colors">
                    {asset.type}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-500">
              <Search className="w-12 h-12 mb-4 opacity-20" />
              <p>No symbols found matching "{search}"</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
