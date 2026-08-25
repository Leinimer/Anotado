'use client';

import React from 'react';
import { X, Download, Share, PlusSquare, CheckCircle2, Smartphone, Monitor } from 'lucide-react';
import { usePwaInstall } from './usePwaInstall';

interface PwaInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PwaInstallModal({ isOpen, onClose }: PwaInstallModalProps) {
  const { isStandalone, canInstall, isIos, promptInstall } = usePwaInstall();

  if (!isOpen) return null;

  const handleInstallClick = async () => {
    const success = await promptInstall();
    if (success) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl p-6 sm:p-7 max-w-md w-full shadow-xl space-y-5 animate-in fade-in zoom-in-95"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#68594d] text-white flex items-center justify-center font-serif-note font-bold text-lg shadow-xs">
              A!
            </div>
            <div>
              <h3 className="font-serif-note font-bold text-lg text-[#1b1c19]">
                Instalar ANOTADO!
              </h3>
              <p className="font-sans-ui text-xs text-[#7f756e]">
                Um espaço para escrever.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-lg transition-colors cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Conteúdo de acordo com o ambiente */}
        {isStandalone ? (
          <div className="p-4 bg-[#f4dfcb]/60 border border-[#68594d]/30 rounded-xl flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-[#68594d] shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs sm:text-sm text-[#3b332d] font-sans-ui leading-relaxed">
              <p className="font-semibold text-[#1b1c19]">
                Aplicativo já instalado!
              </p>
              <p>
                O ANOTADO! está rodando como Progressive Web App (PWA) autônomo com suporte Offline-First completo.
              </p>
            </div>
          </div>
        ) : isIos ? (
          <div className="space-y-3.5 text-xs sm:text-sm font-sans-ui text-[#4e453f]">
            <p className="font-medium text-[#1b1c19]">
              Para instalar no iPhone ou iPad:
            </p>
            <div className="space-y-2.5 p-3.5 bg-white/70 rounded-xl border border-[#eae8e3]">
              <div className="flex items-start gap-3">
                <div className="p-1.5 bg-[#f0eee9] rounded-lg text-[#68594d] shrink-0">
                  <Share className="w-4 h-4" />
                </div>
                <p className="leading-snug pt-0.5">
                  1. Toque no botão de <strong>Compartilhar</strong> na barra do Safari (ícone de quadrado com seta para cima).
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-1.5 bg-[#f0eee9] rounded-lg text-[#68594d] shrink-0">
                  <PlusSquare className="w-4 h-4" />
                </div>
                <p className="leading-snug pt-0.5">
                  2. Role para baixo e selecione <strong>&quot;Adicionar à Tela de Início&quot;</strong>.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-1.5 bg-[#f0eee9] rounded-lg text-[#68594d] shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <p className="leading-snug pt-0.5">
                  3. Toque em <strong>&quot;Adicionar&quot;</strong> no canto superior direito.
                </p>
              </div>
            </div>
            <p className="text-[11px] text-[#7f756e]">
              O ícone do ANOTADO! aparecerá na tela inicial e abrirá sem as barras do navegador.
            </p>
          </div>
        ) : canInstall ? (
          <div className="space-y-4">
            <p className="text-xs sm:text-sm font-sans-ui text-[#4e453f] leading-relaxed">
              Instale o ANOTADO! no seu dispositivo para ter acesso instantâneo direto da área de trabalho ou tela inicial, em tela cheia e com abertura ultrarrápida.
            </p>

            <div className="grid grid-cols-2 gap-2 text-xs font-sans-ui text-[#7f756e]">
              <div className="p-2.5 bg-white/70 rounded-xl border border-[#eae8e3] flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-[#68594d]" />
                <span>Mobile & Tablet</span>
              </div>
              <div className="p-2.5 bg-white/70 rounded-xl border border-[#eae8e3] flex items-center gap-2">
                <Monitor className="w-4 h-4 text-[#68594d]" />
                <span>Windows, Mac & Linux</span>
              </div>
            </div>

            <button
              type="button"
              id="pwa-native-install-btn"
              onClick={handleInstallClick}
              className="w-full py-2.5 px-4 bg-[#68594d] hover:bg-[#53463c] text-white text-sm font-sans-ui font-medium rounded-xl transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Instalar ANOTADO!</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3.5 text-xs sm:text-sm font-sans-ui text-[#4e453f]">
            <p className="leading-relaxed">
              Para instalar este aplicativo no seu navegador atual (Chrome, Edge ou Brave):
            </p>
            <div className="p-3.5 bg-white/70 rounded-xl border border-[#eae8e3] space-y-2">
              <p className="leading-snug">
                • Clique no ícone de instalação <Download className="w-3.5 h-3.5 inline text-[#68594d]" /> na <strong>barra de endereço</strong> do navegador.
              </p>
              <p className="leading-snug">
                • Ou acesse o menu <strong>(três pontos ⋮) → &quot;Instalar ANOTADO!&quot;</strong>.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-sans-ui font-medium text-[#4e453f] hover:bg-[#eae8e3] transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
