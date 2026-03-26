import React, { useState } from 'react';
import { X } from 'lucide-react';

interface OrderBlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (top: number, bottom: number, color: string) => void;
}

export const OrderBlockModal: React.FC<OrderBlockModalProps> = ({ isOpen, onClose, onAdd }) => {
  const [topPrice, setTopPrice] = useState('');
  const [bottomPrice, setBottomPrice] = useState('');
  const [color, setColor] = useState('#FF5252');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const top = parseFloat(topPrice);
    const bottom = parseFloat(bottomPrice);
    if (!isNaN(top) && !isNaN(bottom)) {
      onAdd(Math.max(top, bottom), Math.min(top, bottom), color);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-[#111827] rounded-xl shadow-2xl w-full max-w-sm overflow-hidden border border-[#1F2937] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-[#1F2937] flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Add Order Block</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white hover:bg-[#1F2937] rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm text-gray-400">Top Price</label>
            <input
              type="number"
              step="any"
              required
              value={topPrice}
              onChange={e => setTopPrice(e.target.value)}
              className="bg-[#1F2937] text-white px-3 py-2 rounded-lg border border-[#374151] focus:outline-none focus:border-blue-500"
              placeholder="e.g. 65000"
            />
          </div>
          
          <div className="flex flex-col gap-1">
            <label className="text-sm text-gray-400">Bottom Price</label>
            <input
              type="number"
              step="any"
              required
              value={bottomPrice}
              onChange={e => setBottomPrice(e.target.value)}
              className="bg-[#1F2937] text-white px-3 py-2 rounded-lg border border-[#374151] focus:outline-none focus:border-blue-500"
              placeholder="e.g. 64000"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm text-gray-400">Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer bg-transparent border-none p-0"
              />
              <span className="text-sm text-gray-300 uppercase">{color}</span>
            </div>
          </div>

          <button
            type="submit"
            className="mt-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg transition-colors"
          >
            Add Order Block
          </button>
        </form>
      </div>
    </div>
  );
};
