'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  BookOpen,
  ArrowLeft,
  FileText,
  Eye,
} from 'lucide-react';
import { Folder, Note } from '@/src/features/notes/types';
import {
  MONTH_NAMES_PT,
  formatDateReadable,
  formatDateDisplayWithWeekday,
} from '@/src/features/notes/utils/diary-date';

interface SharedDiarySidebarNavigationProps {
  ownerName: string;
  ownerEmail: string;
  folders: Folder[];
  notes: Note[];
  activeNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  onCloseMobile?: () => void;
}

export function SharedDiarySidebarNavigation({
  ownerName,
  ownerEmail,
  folders,
  notes,
  activeNoteId,
  onSelectNote,
  onCloseMobile,
}: SharedDiarySidebarNavigationProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const today = useMemo(() => new Date(), []);
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;
  const currentMonthKey = `${todayYear}-${todayMonth}`;

  // Estado de expansão de meses: por padrão, apenas o mês atual fica aberto
  const [collapsedYears, setCollapsedYears] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(
    () => new Set([currentMonthKey])
  );

  const toggleYear = (yearId: string) => {
    setCollapsedYears((prev) => {
      const next = new Set(prev);
      if (next.has(yearId)) next.delete(yearId);
      else next.add(yearId);
      return next;
    });
  };

  const toggleMonth = (key: string, folderId?: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      const isOpen = next.has(key) || (folderId ? next.has(folderId) : false);
      if (isOpen) {
        next.delete(key);
        if (folderId) next.delete(folderId);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Monta a árvore hierárquica do Diário do proprietário
  const diaryTree = useMemo(() => {
    const yearFolders = folders
      .filter((f) => f.diary_year !== undefined && f.diary_year !== null && !f.parent_id)
      .sort((a, b) => (b.diary_year ?? 0) - (a.diary_year ?? 0));

    return yearFolders.map((yearFolder) => {
      const yearNum = yearFolder.diary_year!;
      const monthFolders = folders
        .filter((f) => f.parent_id === yearFolder.id && f.diary_month !== undefined)
        .sort((a, b) => (a.diary_month ?? 0) - (b.diary_month ?? 0));

      const monthsData = monthFolders.map((monthFolder) => {
        const monthNum = monthFolder.diary_month!;
        const monthNotes = notes
          .filter((n) => n.folder_id === monthFolder.id && !n.is_archived)
          .sort((a, b) => {
            if (a.entry_date && b.entry_date) {
              return a.entry_date.localeCompare(b.entry_date);
            }
            return (a.position ?? 0) - (b.position ?? 0);
          });

        const notesByDay: Record<number, Note> = {};
        monthNotes.forEach((n) => {
          if (n.entry_date) {
            const parts = n.entry_date.split('-');
            if (parts.length === 3) {
              const d = parseInt(parts[2], 10);
              if (!isNaN(d)) notesByDay[d] = n;
            }
          }
        });

        return {
          monthFolder,
          yearNum,
          monthNum,
          monthNotes,
          notesByDay,
        };
      });

      const totalYearNotes = monthsData.reduce((acc, m) => acc + m.monthNotes.length, 0);

      return {
        yearFolder,
        yearNum,
        months: monthsData,
        totalNotes: totalYearNotes,
      };
    });
  }, [folders, notes]);

  // Resultados de busca filtrados
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const query = searchQuery.toLowerCase().trim();
    return notes.filter((n) => {
      const titleMatch = n.title?.toLowerCase().includes(query);
      const dateMatch = n.entry_date?.includes(query);
      const contentMatch = n.content?.toLowerCase().includes(query);
      const tagsMatch = n.tags?.some((t) => t.toLowerCase().includes(query));
      return titleMatch || dateMatch || contentMatch || tagsMatch;
    });
  }, [notes, searchQuery]);

  return (
    <aside
      id="shared-diary-sidebar"
      className="w-[300px] h-full bg-[#fbf9f4] border-r border-[#eae8e3] flex flex-col select-none relative z-20"
    >
      {/* Cabeçalho do Diário Compartilhado */}
      <div className="px-4 pt-4 pb-3 border-b border-[#eae8e3]/80 bg-white/60 backdrop-blur-xs space-y-3">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-sans-ui font-medium text-[#68594d] hover:text-[#1b1c19] px-2.5 py-1.5 rounded-xl hover:bg-[#eae8e3] transition-colors cursor-pointer"
            title="Voltar ao Meu Diário e Notas"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Voltar</span>
          </Link>

          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-sans-ui font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <Eye className="w-3 h-3 text-emerald-600" />
            Somente Leitura
          </span>

          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="p-1 text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-lg md:hidden cursor-pointer"
              aria-label="Fechar Menu"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div>
          <h1 className="font-serif-note font-bold text-sm text-[#1b1c19] tracking-tight truncate uppercase">
            DIÁRIO DE {ownerName || ownerEmail}
          </h1>
          <p className="font-sans-ui text-[11px] text-[#7f756e] truncate">
            {ownerEmail}
          </p>
        </div>

        {/* Campo de Busca */}
        <div className="relative">
          <input
            id="shared-diary-search-input"
            type="text"
            placeholder="Buscar nas entradas..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 bg-[#f0eee9] focus:bg-white text-xs font-sans-ui text-[#1b1c19] placeholder-[#7f756e] rounded-xl border border-transparent focus:border-[#68594d]/30 focus:outline-none focus:ring-1 focus:ring-[#68594d]/20 transition-all shadow-2xs"
          />
          <Search className="w-3.5 h-3.5 text-[#7f756e] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7f756e] hover:text-[#1b1c19] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Árvore Hierárquica: ANO -> MÊS -> DIAS */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-2.5 scrollbar-thin">
        {searchResults !== null ? (
          // Resultados da busca
          <div className="space-y-1">
            <p className="text-[11px] font-sans-ui text-[#7f756e] px-1 pb-1">
              {searchResults.length} resultado{searchResults.length === 1 ? '' : 's'} encontrado{searchResults.length === 1 ? '' : 's'}
            </p>
            {searchResults.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#7f756e] font-sans-ui">
                Nenhuma entrada encontrada para &quot;{searchQuery}&quot;
              </div>
            ) : (
              searchResults.map((note) => {
                const isSelected = note.id === activeNoteId;
                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => onSelectNote(note.id)}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#68594d] text-white shadow-2xs'
                        : 'hover:bg-[#eae8e3]/70 text-[#1b1c19]'
                    }`}
                  >
                    <Calendar className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? 'text-white' : 'text-[#68594d]'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-serif-note font-semibold text-xs truncate">
                        {note.title || 'Sem título'}
                      </p>
                      {note.entry_date && (
                        <p className={`text-[10px] font-sans-ui ${isSelected ? 'text-white/80' : 'text-[#7f756e]'}`}>
                          {formatDateDisplayWithWeekday(note.entry_date)}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        ) : diaryTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center px-4">
            <BookOpen className="w-8 h-8 text-[#a1968e] stroke-[1.5] mb-2" />
            <p className="text-xs text-[#7f756e] font-sans-ui">
              Nenhuma entrada disponível neste Diário.
            </p>
          </div>
        ) : (
          diaryTree.map(({ yearFolder, months, totalNotes }) => {
            const isYearOpen = !collapsedYears.has(yearFolder.id);

            return (
              <div
                key={yearFolder.id}
                className="rounded-xl overflow-hidden bg-white/40 border border-[#eae8e3]/80 shadow-2xs"
              >
                {/* 1. Nível: ANO */}
                <button
                  type="button"
                  onClick={() => toggleYear(yearFolder.id)}
                  className="w-full flex items-center justify-between px-2.5 py-2 hover:bg-[#eae8e3]/60 transition-colors text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[#7f756e] group-hover:text-[#1b1c19] transition-transform">
                      {isYearOpen ? (
                        <ChevronDown className="w-3.5 h-3.5 stroke-[2]" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 stroke-[2]" />
                      )}
                    </span>
                    <Calendar className="w-4 h-4 text-[#68594d] shrink-0" />
                    <span className="font-serif-note font-bold text-sm text-[#1b1c19] tracking-wide">
                      {yearFolder.name}
                    </span>
                  </div>
                  <span className="text-[10px] font-sans-ui font-medium text-[#7f756e] px-1.5 py-0.5 rounded-full bg-[#f0eee9]">
                    {totalNotes} {totalNotes === 1 ? 'entrada' : 'entradas'}
                  </span>
                </button>

                {/* 2. Nível: MESES */}
                {isYearOpen && (
                  <div className="pl-3 pr-1 py-1 space-y-1 bg-[#faf8f4]/40 border-t border-[#eae8e3]/60">
                    {months.map(({ monthFolder, yearNum, monthNum, monthNotes }) => {
                      const monthKey = `${yearNum}-${monthNum}`;
                      const isMonthOpen =
                        expandedMonths.has(monthKey) || expandedMonths.has(monthFolder.id);
                      const monthName = MONTH_NAMES_PT[monthNum - 1] || `Mês ${monthNum}`;

                      return (
                        <div key={monthFolder.id} className="rounded-lg overflow-hidden">
                          {/* Botão do Mês */}
                          <button
                            type="button"
                            onClick={() => toggleMonth(monthKey, monthFolder.id)}
                            className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-[#eae8e3]/60 rounded-lg text-left transition-colors cursor-pointer group"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[#7f756e] group-hover:text-[#1b1c19]">
                                {isMonthOpen ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                              </span>
                              <span className="font-serif-note font-medium text-xs text-[#1b1c19] capitalize">
                                {monthName}
                              </span>
                            </div>
                            <span className="text-[10px] font-sans-ui text-[#7f756e] px-1.5 py-0.2 rounded-md bg-[#f0eee9]/60">
                              {monthNotes.length}
                            </span>
                          </button>

                          {/* 3. Nível: ENTRADAS / DIAS */}
                          {isMonthOpen && (
                            <div className="pl-4 pr-1 py-1 space-y-0.5 border-l-2 border-[#eae8e3] ml-2.5 my-0.5">
                              {monthNotes.length === 0 ? (
                                <p className="text-[11px] text-[#a1968e] italic py-1 px-2 font-sans-ui">
                                  Nenhuma entrada neste mês
                                </p>
                              ) : (
                                monthNotes.map((note) => {
                                  const isSelected = note.id === activeNoteId;
                                  const dayLabel = note.entry_date
                                    ? formatDateDisplayWithWeekday(note.entry_date)
                                    : note.title || 'Entrada';

                                  return (
                                    <button
                                      key={note.id}
                                      type="button"
                                      onClick={() => onSelectNote(note.id)}
                                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer text-xs font-sans-ui ${
                                        isSelected
                                          ? 'bg-[#68594d] text-white font-medium shadow-2xs'
                                          : 'hover:bg-[#eae8e3]/70 text-[#1b1c19]'
                                      }`}
                                    >
                                      <span
                                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                          isSelected ? 'bg-white' : 'bg-[#68594d]'
                                        }`}
                                      />
                                      <span className="truncate flex-1 font-medium">
                                        {dayLabel}
                                      </span>
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
