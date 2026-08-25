'use client';

import React, { createContext, useContext, useState } from 'react';
import { usePwaInstall, PwaState } from './usePwaInstall';
import { PwaInstallModal } from './PwaInstallModal';
import { PwaUpdateToast } from './PwaUpdateToast';

interface PwaContextType extends PwaState {
  openInstallModal: () => void;
  closeInstallModal: () => void;
  isInstallModalOpen: boolean;
}

const PwaContext = createContext<PwaContextType | null>(null);

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const pwaState = usePwaInstall();
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);

  const openInstallModal = () => setIsInstallModalOpen(true);
  const closeInstallModal = () => setIsInstallModalOpen(false);

  return (
    <PwaContext.Provider
      value={{
        ...pwaState,
        openInstallModal,
        closeInstallModal,
        isInstallModalOpen,
      }}
    >
      {children}
      <PwaInstallModal isOpen={isInstallModalOpen} onClose={closeInstallModal} />
      <PwaUpdateToast />
    </PwaContext.Provider>
  );
}

export function usePwa() {
  const context = useContext(PwaContext);
  if (!context) {
    // Fallback gracioso se usado fora do provider
    return {
      isStandalone: false,
      canInstall: false,
      isIos: false,
      updateAvailable: false,
      promptInstall: async () => false,
      applyUpdate: () => {},
      openInstallModal: () => {},
      closeInstallModal: () => {},
      isInstallModalOpen: false,
    };
  }
  return context;
}
