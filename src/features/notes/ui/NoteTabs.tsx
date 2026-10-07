'use client';

import React, { useRef, useEffect, useState } from 'react';
import { X, Plus, FileText, Columns2, Minimize2, ArrowLeftRight } from 'lucide-react';
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
  isSplit?: boolean;
  splitLeftTabId?: string | null;
  splitRightTabId?: string | null;
  activeSplitPane?: 'left' | 'right';
  onSplitTab?: (tabId: string) => void;
  onUnsplitTab?: (tabId: string) => void;
  onSwapSplitPanes?: () => void;
}

export function NoteTabs({
  tabs,
  activeTabId,
  notes,
  onSelectTab,
  onCloseTab,
  onNewTab,
  isSplit = false,
  splitLeftTabId = null,
  splitRightTabId = null,
  activeSplitPane = 'left',
  onSplitTab,
  onUnsplitTab,
  onSwapSplitPanes,
}: NoteTabsProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const startupPendingRef = useRef(true);
  const initialTabsFromSessionRef = useRef(false);
  const startupCloseCountRef = useRef(0);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      initialTabsFromSessionRef.current = Boolean(
        sessionStorage.getItem('anotado_active_notes_id')
      );
    }
  }, []);

  // Ao iniciar o aplicativo, nenhuma nota deve permanecer aberta.
  // Isso também limpa uma aba restaurada anteriormente da sessionStorage.
  // A segunda passagem trata o caso em que o carregamento inicial recria
  // automaticamente a primeira nota depois de a aba persistida ser fechada.
  useEffect(() => {
    if (!startupPendingRef.current || !activeTabId || tabs.length === 0) return;

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('anotado_active_notes_id');
    }

    startupCloseCountRef.current += 1;
    onCloseTab(activeTabId);

    if (!initialTabsFromSessionRef.current || startupCloseCountRef.current >= 2) {
      startupPendingRef.current = false;
    }
  }, [tabs.length, activeTabId, onCloseTab]);

  const handleWheel = (e: React.WheelEvent) => {
    if (scrollContainerRef.current) {
      if (e.deltaY !== 0) {
        scrollContainerRef.current.scrollLeft += e.deltaY;
      }
    }
  };

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

  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };

    window.addEventListener('click', handleCloseMenu);
    window.addEventListener('scroll', handleCloseMenu, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('click', handleCloseMenu);
      window.removeEventListener('scroll', handleCloseMenu, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 190;
    const menuHeight = 130;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);

    setContextMenu({ x, y, tabId });
  };

  return (
    <div
      id="note-tabs-bar"
      className="w-full -mt-9 relative z-30 flex items-center bg-[#f4f1ea] dark:bg-[#0d0d0d] border-b border-[#eae8e3] dark:border-[#1e1e1e] px-2 sm:px-4 py-1 select-none shrink-0 overflow-hidden"
    >
      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth flex-1 min-w-0 py-0.5"
      >
        {tabs.map((tab) => {
          const note = notes.find((n) => n.id === tab.noteId);
          const isLeftSplitTab = isSplit && tab.id === splitLeftTabId;
          const isRightSplitTab = isSplit && tab.id === splitRightTabId;
          const isSplitTab = isLeftSplitTab || isRightSplitTab;

          const isCurrentlyActive = isSplit
            ? (isLeftSplitTab && activeSplitPane === 'left') ||
              (isRightSplitTab && activeSplitPane === 'right') ||
              (!isSplitTab && tab.id === activeTabId)
            : tab.id === activeTabId;

          const title = note?.title?.trim() || 'Sem título';

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              id={`note-tab-${tab.id}`}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }
              }}
              title={
                isSplit
                  ? `${title} ${isLeftSplitTab ? 'E' : isRightSplitTab ? 'D' : ''}`
                  : title
              }
              className={`group flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-lg text-xs font-sans-ui cursor-pointer transition-all duration-150 max-w-[190px] sm:max-w-[230px] shrink-0 border ${
                isCurrentlyActive
                  ? 'bg-[#ffffff] dark:bg-[#1a1a1a] text-[#1b1c19] dark:text-[#ffffff] font-semibold border-[#e0ddd5] dark:border-[#2d2d2d] shadow-xs ring-1 ring-black/[0.04] dark:ring-white/[0.05]'
                  : isSplitTab
                  ? 'bg-[#ffffff]/70 dark:bg-[#171717] text-[#2c2723] dark:text-[#eaeaea] font-medium border-[#e0ddd5]/60 dark:border-[#282828] hover:bg-[#ffffff] dark:hover:bg-[#1a1a1a]'
                  : 'bg-[#ebe7de]/60 hover:bg-[#ebe7de] dark:bg-[#141414] dark:hover:bg-[#1c1c1c] text-[#71655b] hover:text-[#1b1c19] dark:text-[#8e8e93] dark:hover:text-[#ffffff] font-medium border-transparent'
              }`}
            >
              <FileText
                className={`w-3.5 h-3.5 shrink-0 ${
                  isCurrentlyActive
                    ? 'text-[#68594d] dark:text-[#d7c3b0]'
                    : isSplitTab
                    ? 'text-[#827163] dark:text-[#9e9e9e]'
                    : 'text-[#9c9186] dark:text-[#636366]'
                }`}
              />

              <span className="truncate flex-1 min-w-0 text-[12px] leading-tight">
                {title}
              </span>

              {isLeftSplitTab && (
                <span className="text-[11px] font-semibold text-[#8a7e72] dark:text-[#a1a1aa] shrink-0 select-none ml-1 mr-0.5">
                  E
                </span>
              )}
              {isRightSplitTab && (
                <span className="text-[11px] font-semibold text-[#8a7e72] dark:text-[#a1a1aa] shrink-0 select-none ml-1 mr-0.5">
                  D
                </span>
              )}

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

      {contextMenu && (
        <div
          id="tab-context-menu"
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-[9999] min-w-[180px] bg-[#ffffff] dark:bg-[#1c1c1e] border border-[#e4e2dd] dark:border-[#2c2c2e] rounded-xl shadow-2xl p-1 font-sans-ui text-xs animate-in fade-in zoom-in-95 duration-100 select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {isSplit ? (
            <>
              <button
                id="context-menu-unsplit-btn"
                type="button"
                onClick={() => {
                  onUnsplitTab?.(contextMenu.tabId);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[#1b1c19] dark:text-[#f4f1ea] hover:bg-[#f0eee9] dark:hover:bg-[#2c2c2e] font-medium transition-colors cursor-pointer"
              >
                <Minimize2 className="w-3.5 h-3.5 text-[#68594d] dark:text-[#d7c3b0]" />
                <span>Desagrupar</span>
              </button>

              <button
                id="context-menu-swap-split-btn"
                type="button"
                onClick={() => {
                  onSwapSplitPanes?.();
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[#1b1c19] dark:text-[#f4f1ea] hover:bg-[#f0eee9] dark:hover:bg-[#2c2c2e] font-medium transition-colors cursor-pointer"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-[#68594d] dark:text-[#d7c3b0]" />
                <span>Trocar de lado</span>
              </button>
            </>
          ) : (
            <button
              id="context-menu-split-btn"
              type="button"
              disabled={tabs.length < 2}
              onClick={() => {
                if (tabs.length >= 2) {
                  onSplitTab?.(contextMenu.tabId);
                  setContextMenu(null);
                }
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left font-medium transition-colors ${
                tabs.length >= 2
                  ? 'text-[#1b1c19] dark:text-[#f4f1ea] hover:bg-[#f0eee9] dark:hover:bg-[#2c2c2e] cursor-pointer'
                  : 'text-[#9c9186] dark:text-[#636366] opacity-50 cursor-not-allowed'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5 text-[#68594d] dark:text-[#d7c3b0]" />
              <span>Dividir tela</span>
            </button>
          )}

          <div className="my-1 border-t border-[#eae8e3] dark:border-[#2c2c2e]" />

          <button
            id="context-menu-close-tab-btn"
            type="button"
            onClick={() => {
              onCloseTab(contextMenu.tabId);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[#ba1a1a] dark:text-[#ffb4ab] hover:bg-[#ba1a1a]/10 dark:hover:bg-[#ba1a1a]/20 font-medium transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5 stroke-[2]" />
            <span>Fechar aba</span>
          </button>
        </div>
      )}
    </div>
  );
}
