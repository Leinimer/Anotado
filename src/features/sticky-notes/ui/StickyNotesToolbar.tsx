'use client';

import React from 'react';
import { Check, Loader2, List, Plus, Trash2, AlertCircle } from 'lucide-react';
import { useTheme } from '@/src/features/theme/theme-context';
import { STICKY_COLORS, StickyNoteColorKey } from '../types';

export type StickySaveState = 'idle' | 'saving' | 'saved' | 'error';

interface StickyNotesToolbarProps {
  activeColor: StickyNoteColorKey;
  selectedNoteColor?: string | null;
  hasSelectedNote: boolean;
  notesCount: number;
  saveState: StickySaveState;
  errorMessage?: string | null;
  onCreateNote: () => void;
  onSelectColor: (color: StickyNoteColorKey) => void;
  onToggleBullet?: () => void;
  onDeleteSelected?: () => void;
}

export function StickyNotesToolbar({
  activeColor,
  selectedNoteColor,
  hasSelectedNote,
  notesCount,
  saveState,
  errorMessage,
  onCreateNote,
  onSelectColor,
  onToggleBullet,
  onDeleteSelected,
}: StickyNotesToolbarProps) {
  const { theme, isMounted } = useTheme();
  const isDark = isMounted && theme === 'dark';
  const highlightedColor = (hasSelectedNote && selectedNoteColor ? selectedNoteColor : activeColor).toLowerCase();

  return (
    <div
      id="sticky-notes-toolbar"
      className="w-full shrink-0 bg-[#fbf9f4]/95 dark:bg-[#0a0a0a]/95 backdrop-blur-xs border-b border-[#eae8e3] dark:border-[#1c1c1c] px-3 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-2 select-none z-20"
    >
      {/* Ações principais */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <button
          id="sticky-create-note-btn"
          type="button"
          onClick={onCreateNote}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#68594d] hover:bg-[#53463c] dark:bg-[#2e2620] dark:border dark:border-[#4a3b2c] dark:hover:bg-[#3d3229] text-white text-xs font-sans-ui font-medium transition-colors cursor-pointer shadow-2xs"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.4]" />
          <span>Nova nota</span>
        </button>

        <div className="h-5 w-[1px] bg-[#e4e2dd] dark:bg-[#262626]" />

        {/* Seletor de cores pastel */}
        <div
          className="flex items-center gap-1.5"
          role="group"
          aria-label={
            hasSelectedNote
              ? 'Cor da nota selecionada e das próximas notas'
              : 'Cor das próximas notas adesivas'
          }
        >
          {STICKY_COLORS.map((c) => {
            const isActive = highlightedColor === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onSelectColor(c.key)}
                style={{
                  backgroundColor: isDark ? c.swatchDark : c.swatchLight,
                }}
                className={`w-5 h-5 sm:w-5.5 sm:h-5.5 rounded-full border transition-transform cursor-pointer hover:scale-110 ${
                  isActive
                    ? 'ring-2 ring-[#68594d] dark:ring-[#f4dfcb] ring-offset-2 ring-offset-[#fbf9f4] dark:ring-offset-[#0a0a0a] border-transparent scale-105'
                    : 'border-black/15 dark:border-white/20'
                }`}
                title={
                  hasSelectedNote
                    ? `Aplicar ${c.label.toLowerCase()} na nota selecionada`
                    : `Usar ${c.label.toLowerCase()} na próxima nota`
                }
                aria-label={c.label}
                aria-pressed={isActive}
              />
            );
          })}
        </div>

        {/* Ações rápidas quando uma nota está selecionada */}
        {hasSelectedNote && (
          <>
            <div className="h-5 w-[1px] bg-[#e4e2dd] dark:bg-[#262626]" />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onToggleBullet}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-sans-ui text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] dark:text-[#d1c4bc] dark:hover:bg-[#1a1a1a] dark:hover:text-white transition-colors cursor-pointer"
                title="Adicionar ou remover marcador de lista"
              >
                <List className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Lista</span>
              </button>

              <button
                type="button"
                onClick={onDeleteSelected}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-sans-ui text-[#7f756e] hover:bg-red-50 hover:text-[#ba1a1a] dark:text-[#a1a1aa] dark:hover:bg-red-950/40 dark:hover:text-red-300 transition-colors cursor-pointer"
                title="Excluir nota selecionada"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Excluir</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Estado discreto de salvamento */}
      <div className="flex items-center gap-2.5 text-[11px] font-sans-ui text-[#7f756e] dark:text-[#a1a1aa] ml-auto">
        {saveState === 'saving' && (
          <span className="inline-flex items-center gap-1 text-[#68594d] dark:text-[#d7c3b0]">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Salvando...</span>
          </span>
        )}
        {saveState === 'saved' && (
          <span className="inline-flex items-center gap-1 text-[#5f6f52] dark:text-[#9cc78b]">
            <Check className="w-3 h-3" />
            <span>Salvo</span>
          </span>
        )}
        {saveState === 'error' && (
          <span
            className="inline-flex items-center gap-1 text-[#ba1a1a] dark:text-[#fca5a5] max-w-[260px] truncate"
            title={errorMessage || 'Erro ao salvar'}
          >
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span className="truncate">{errorMessage || 'Erro ao salvar'}</span>
          </span>
        )}
        <span className="hidden sm:inline opacity-75">
          {notesCount} {notesCount === 1 ? 'nota' : 'notas'}
        </span>
      </div>
    </div>
  );
}
