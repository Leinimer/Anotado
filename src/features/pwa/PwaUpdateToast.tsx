'use client';

import React from 'react';
import { Sparkles, RefreshCw, X } from 'lucide-react';
import { usePwaInstall } from './usePwaInstall';

export function PwaUpdateToast() {
  const { updateAvailable, applyUpdate } = usePwaInstall();
  const [dismissed, setDismissed] = React.useState(false);

  if (!updateAvailable || dismissed) return null;

  return (
    <div
      id="pwa-update-toast"
      className="fixed bottom-4 right-4 z-50 max-w-sm w-full p-4 bg-[#fbf9f4] border border-[#68594d]/40 rounded-2xl shadow-xl animate-in slide-in-from-bottom-5 fade-in duration-300"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-[#f4dfcb] rounded-xl text-[#68594d] shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="space-y-1">
            <p className="font-serif-note font-bold text-sm text-[#1b1c19]">
              Nova versão disponível
            </p>
            <p className="font-sans-ui text-xs text-[#4e453f] leading-relaxed">
              Uma nova versão do ANOTADO! está pronta. Suas notas salvas no dispositivo estão 100% seguras.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1 text-[#7f756e] hover:text-[#1b1c19] rounded-lg transition-colors cursor-pointer"
          aria-label="Ignorar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex justify-end gap-2 mt-3 pt-2 border-t border-[#eae8e3]">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="px-3 py-1 text-xs font-sans-ui font-medium text-[#7f756e] hover:text-[#1b1c19] transition-colors cursor-pointer"
        >
          Mais tarde
        </button>
        <button
          type="button"
          onClick={applyUpdate}
          className="px-3 py-1 bg-[#68594d] hover:bg-[#53463c] text-white text-xs font-sans-ui font-medium rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Atualizar agora</span>
        </button>
      </div>
    </div>
  );
}
