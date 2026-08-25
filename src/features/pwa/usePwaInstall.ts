'use client';

import { useState, useEffect, useCallback } from 'react';

export interface PwaState {
  isStandalone: boolean;
  canInstall: boolean;
  isIos: boolean;
  updateAvailable: boolean;
  promptInstall: () => Promise<boolean>;
  applyUpdate: () => void;
}

let globalDeferredPrompt: any = null;

export function usePwaInstall(): PwaState {
  const [isStandalone, setIsStandalone] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes('android-app://')
    );
  });
  const [canInstall, setCanInstall] = useState<boolean>(() => Boolean(globalDeferredPrompt));
  const [isIos] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent.toLowerCase();
    return /iphone|ipad|ipod/.test(ua) && !(window as any).MSStream;
  });
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Monitora mudanças de display-mode (ex: alternar para standalone)
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches);
    };
    try {
      mediaQuery.addEventListener('change', handleMediaChange);
    } catch {
      mediaQuery.addListener(handleMediaChange);
    }

    // 2. Captura o evento nativo de instalação 'beforeinstallprompt'
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      globalDeferredPrompt = e;
      setCanInstall(true);
    };

    const handleAppInstalled = () => {
      globalDeferredPrompt = null;
      setCanInstall(false);
      setIsStandalone(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // 3. Registro seguro do Service Worker e monitoramento de atualizações
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // Escuta quando uma nova versão for detectada
          reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (
                  installingWorker.state === 'installed' &&
                  navigator.serviceWorker.controller
                ) {
                  setUpdateAvailable(true);
                }
              };
            }
          };
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker não pôde ser registrado:', err);
        });

      // Recarrega de forma suave quando o novo Service Worker assumir o controle
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      try {
        mediaQuery.removeEventListener('change', handleMediaChange);
      } catch {
        mediaQuery.removeListener(handleMediaChange);
      }
    };
  }, []);

  // Executa o diálogo nativo de instalação
  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!globalDeferredPrompt) {
      return false;
    }
    try {
      await globalDeferredPrompt.prompt();
      const choiceResult = await globalDeferredPrompt.userChoice;
      if (choiceResult && choiceResult.outcome === 'accepted') {
        setCanInstall(false);
        globalDeferredPrompt = null;
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[PWA] Erro ao disparar prompt de instalação:', err);
      return false;
    }
  }, []);

  // Aplica atualização pendente do Service Worker
  const applyUpdate = useCallback(() => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
    }
  }, []);

  return {
    isStandalone,
    canInstall,
    isIos,
    updateAvailable,
    promptInstall,
    applyUpdate,
  };
}
