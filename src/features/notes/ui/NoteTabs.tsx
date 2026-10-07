'use client';

import React, { useRef, useEffect } from 'react';
import { X, Plus, FileText } from 'lucide-react';
import { Note as NoteType } from '../types';

export interface NoteTabItem {
  id: string;
  noteId: string;
}

interface NoteTabsProps {
  tabs: NoteTabItem[];
  activeTabId: string | null;
  notes: NoteType[];
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}

export function NoteTabs({
  tabs,
  activeTabId,
  notes,
  onSelectTab,
  onCloseTab,
  onNewTab,
}: NoteTabsProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Rolagem horizontal suave ao girar a roda do mouse sobre as abas
  const handleWheel = (e: React.WheelEvent) => {
    if (scrollContainerRef.current) {
      if (e.deltaY !== 0) {
        scrollContainerRef.current.scrollLeft += e.deltaY;
      }
    }
  };

  // Garante que a aba ativa esteja sempre visível na barra com rolagem
  useEffect(() => {
    if (activeTabId && scrollContainerRef.current) {
      const activeEl = scrollContainerRef.current.querySelector(
        `[data-tab-id="${activeTabId}"]`
      ) as HTMLElement | null;
      if (activeEl) {
        activeEl.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    }
  }, [activeTabId]);

  return (
    <div
      id="note-tabs-bar"
      className="w-full flex items-center bg-[#f4f1ea] dark:bg-[#0d0d0d] border-b border-[#eae8e3] dark:border-[#1e1e1e] px-2 sm:px-4 py-1 select-none shrink-0 overflow-hidden"
    >
      {/* Contêiner de Abas com Rolagem Horizontal */}
      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth flex-1 min-w-0 py-0.5"
      >
        {tabs.map((tab) => {
          const note = notes.find((n) => n.id === tab.noteId);
          const isActive = tab.id === activeTabId;
          const title = note?.title?.trim() || 'Sem título';

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              id={`note-tab-${tab.id}`}
              onClick={() => onSelectTab(tab.id)}
              onAuxClick={(e) => {
                // Clique com botão do meio do mouse fecha a aba
                if (e.button === 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }
              }}
              title={title}
              className={`group flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-lg text-xs font-sans-ui cursor-pointer transition-all duration-150 max-w-[180px] sm:max-w-[220px] shrink-0 border ${
                isActive
                  ? 'bg-[#ffffff] dark:bg-[#1a1a1a] text-[#1b1c19] dark:text-[#ffffff] font-semibold border-[#e0ddd5] dark:border-[#2d2d2d] shadow-xs ring-1 ring-black/[0.04] dark:ring-white/[0.05]'
                  : 'bg-[#ebe7de]/60 hover:bg-[#ebe7de] dark:bg-[#141414] dark:hover:bg-[#1c1c1c] text-[#71655b] hover:text-[#1b1c19] dark:text-[#8e8e93] dark:hover:text-[#ffffff] font-medium border-transparent'
              }`}
            >
              <FileText
                className={`w-3.5 h-3.5 shrink-0 ${
                  isActive
                    ? 'text-[#68594d] dark:text-[#d7c3b0]'
                    : 'text-[#9c9186] dark:text-[#636366]'
                }`}
              />

              {/* Título com truncamento visual */}
              <span className="truncate flex-1 min-w-0 text-[12px] leading-tight">
                {title}
              </span>

              {/* Botão Fechar Aba × */}
              <button
                type="button"
                id={`close-tab-${tab.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className="p-0.5 rounded-md text-[#9c9186] hover:text-[#1b1c19] hover:bg-black/10 dark:text-[#8e8e93] dark:hover:text-[#ffffff] dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0 ml-0.5"
                title="Fechar aba"
                aria-label={`Fechar aba ${title}`}
              >
                <X className="w-3.5 h-3.5 stroke-[2]" />
              </button>
            </div>
          );
        })}

        {/* Botão + Adicionar Nova Aba */}
        <button
          id="new-note-tab-btn"
          type="button"
          onClick={onNewTab}
          className="flex items-center justify-center p-1.5 rounded-lg text-[#68594d] hover:text-[#1b1c19] hover:bg-[#ebe7de] dark:text-[#a1a1aa] dark:hover:text-white dark:hover:bg-[#1c1c1c] transition-colors cursor-pointer shrink-0 ml-0.5"
          title="Nova aba"
          aria-label="Criar nova aba"
        >
          <Plus className="w-4 h-4 stroke-[2]" />
        </button>
      </div>
    </div>
  );
}
