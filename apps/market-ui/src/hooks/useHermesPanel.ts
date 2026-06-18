import { useState } from 'react';

export const useHermesPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedContext, setSelectedContext] = useState<any>(null);

  const openPanel = (context?: any) => {
    setSelectedContext(context);
    setIsOpen(true);
  };

  const closePanel = () => {
    setIsOpen(false);
    setSelectedContext(null);
  };

  return {
    isOpen,
    openPanel,
    closePanel,
    selectedContext,
  };
};
