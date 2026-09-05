'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  BookOpen,
  ArrowLeft,
  Eye,
  CalendarDays,
} from 'lucide-react';
import { Folder, Note } from '@/src/features/notes/types';
import {
  MONTH_NAMES_PT,
  formatDateReadable,
  formatDateDisplayWithWeekday,
  getLocalDateString,
} from '@/src/features/notes/utils/diary-date';
import { SyncStatusIndicator } from '@/src/features/notes/ui/SyncStatusIndicator';

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
  const todayDay = today.getDate();
  const todayDateStr = getLocalDateString(today);
  const currentMonthKey = `${todayYear}-${todayMonth}`;

  // Estado de expansão: SOMENTE o ano atual e SOMENTE o mês atual iniciam abertos
  const [openYears, setOpenYears] = useState<Set<number>>(() => new Set([todayYear]));
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set([currentMonthKey]));

  const toggleYear = (yearNum: number) => {
    setOpenYears((prev) => {
      const next = new Set(prev);
      if (next.has(yearNum)) {
        next.delete(yearNum);
      } else {
        next.add(yearNum);
      }
      return next;
    });
  };

  const toggleMonth = (monthKey: string) => {
    setOpenMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  };

  // Monta a árvore hierárquica do Diário do proprietário com deduplicação estrita
  const diaryTree = useMemo(() => {
    // 1. Agrupa por ano numérico para garantir que cada ano apareça exatamente 1 vez
    const yearsMap = new Map<number, { yearFolder: Folder; folderIds: Set<string> }>();

    for (const f of folders) {
      if (!f.parent_id && (f.diary_year !== undefined || /^\d{4}$/.test(f.name.trim()))) {
        const yNum = f.diary_year || parseInt(f.name.trim(), 10);
        if (yNum) {
          if (!yearsMap.has(yNum)) {
            yearsMap.set(yNum, { yearFolder: f, folderIds: new Set([f.id]) });
          } else {
            yearsMap.get(yNum)!.folderIds.add(f.id);
          }
        }
      }
    }

    const sortedYearNums = Array.from(yearsMap.keys()).sort((a, b) => b - a);

    return sortedYearNums.map((yearNum) => {
      const { yearFolder, folderIds: yearFolderIds } = yearsMap.get(yearNum)!;

      // 2. Agrupa por mês numérico (1..12) para que nenhum mês seja duplicado
      const monthsMap = new Map<number, { monthFolder: Folder; folderIds: Set<string> }>();

      for (const f of folders) {
        if (f.parent_id && yearFolderIds.has(f.parent_id)) {
          let mNum: number | null = null;
          if (typeof f.diary_month === 'number' && f.diary_month >= 1 && f.diary_month <= 12) {
            mNum = f.diary_month;
          } else {
            const ptIdx = MONTH_NAMES_PT.findIndex(
              (m) => m.toLowerCase() === f.name.trim().toLowerCase()
            );
            if (ptIdx !== -1) {
              mNum = ptIdx + 1;
            } else {
              const parsed = parseInt(f.name.trim(), 10);
              if (!isNaN(parsed) && parsed >= 1 && parsed <= 12) {
                mNum = parsed;
              } else if (typeof f.position === 'number' && f.position >= 1 && f.position <= 12) {
                mNum = f.position;
              }
            }
          }

          if (mNum !== null) {
            if (!monthsMap.has(mNum)) {
              monthsMap.set(mNum, { monthFolder: f, folderIds: new Set([f.id]) });
            } else {
              monthsMap.get(mNum)!.folderIds.add(f.id);
            }
          }
        }
      }

      // 3. Garante exatamente os 12 meses (Janeiro a Dezembro) para cada ano
      const all12Months = Array.from({ length: 12 }, (_, i) => i + 1);
      let totalYearNotes = 0;

      const months = all12Months.map((monthNum) => {
        const monthData = monthsMap.get(monthNum);
        const monthFolder = monthData?.monthFolder;
        const monthFolderIds = monthData?.folderIds || new Set<string>();

        // Notas pertencentes a esse mês
        const monthNotesList = notes.filter(
          (n) =>
            !n.is_archived &&
            ((n.folder_id && monthFolderIds.has(n.folder_id)) ||
              (n.diary_year === yearNum && n.diary_month === monthNum))
        );

        // Deduplica notas por DIA (1 nota por dia)
        // Se houver mais de uma nota para o mesmo dia, prioriza a que tem conteúdo ou a ativa
        const notesByDay = new Map<number, Note>();
        for (const n of monthNotesList) {
          let day = n.diary_day;
          if (!day && n.entry_date) {
            const parts = n.entry_date.split('-');
            if (parts.length === 3) day = parseInt(parts[2], 10);
          }
          if (!day && typeof n.position === 'number' && n.position >= 1 && n.position <= 31) {
            day = n.position;
          }
          if (!day && n.title) {
            const m = n.title.match(/(?:Dia\s+|#\s*)0*([1-9]|[12]\d|3[01])\b/i);
            if (m) day = parseInt(m[1], 10);
          }

          if (day && day >= 1 && day <= 31) {
            const existing = notesByDay.get(day);
            if (!existing) {
              notesByDay.set(day, n);
            } else {
              const currentContent = (n.content || '').trim();
              const existingContent = (existing.content || '').trim();
              if (n.id === activeNoteId || (!existingContent && currentContent)) {
                notesByDay.set(day, n);
              }
            }
          }
        }

        const sortedNotes = Array.from(notesByDay.values()).sort((a, b) => {
          if (a.entry_date && b.entry_date) {
            return a.entry_date.localeCompare(b.entry_date);
          }
          return (a.position ?? 0) - (b.position ?? 0);
        });

        totalYearNotes += sortedNotes.length;

        return {
          monthFolder,
          yearNum,
          monthNum,
          monthNotes: sortedNotes,
        };
      });

      return {
        yearFolder,
        yearNum,
        months,
        totalNotes: totalYearNotes,
      };
    });
  }, [folders, notes, activeNoteId]);

  // Handler rápido para abrir "Hoje"
  const handleOpenToday = () => {
    setOpenYears((prev) => new Set([...Array.from(prev), todayYear]));
    setOpenMonths((prev) => new Set([...Array.from(prev), currentMonthKey]));

    // Localiza a nota correspondente a hoje se existir
    const todayNote = notes.find((n) => {
      if (n.entry_date === todayDateStr) return true;
      if (n.diary_year === todayYear && n.diary_month === todayMonth && n.diary_day === todayDay) {
        return true;
      }
      const dayFormatted = String(todayDay).padStart(2, '0');
      return Boolean(n.title && n.title.toLowerCase().startsWith(`dia ${dayFormatted}`));
    });

    if (todayNote) {
      onSelectNote(todayNote.id);
    }
  };

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
            className="inline-flex items-center gap-1.5 text-xs font-sans-ui font-medium text-[#68594d] hover:text-[#1b1c19] px-2 py-1 rounded-xl hover:bg-[#eae8e3] transition-colors cursor-pointer"
            title="Voltar ao Meu Diário e Notas"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Voltar</span>
          </Link>

          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-sans-ui font-semibold bg-[#eae8e3] text-[#5e4b3e] border border-[#d1c4bc]">
            <Eye className="w-3 h-3 text-[#68594d]" />
            Modo Leitura
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

        {/* Botão Rápido de Acesso ao Dia Atual */}
        <button
          type="button"
          onClick={handleOpenToday}
          className="w-full flex items-center justify-between px-3 py-1.5 bg-[#f0eee9] hover:bg-[#eae8e3] text-[#1b1c19] rounded-xl text-xs font-sans-ui transition-colors cursor-pointer border border-[#eae8e3]/60 shadow-2xs"
          title="Abrir ano e mês de hoje"
        >
          <div className="flex items-center gap-2">
            <CalendarDays className="w-3.5 h-3.5 text-[#68594d]" />
            <span className="font-medium">Hoje</span>
          </div>
          <span className="text-[10px] text-[#7f756e]">
            {formatDateReadable(todayDateStr)}
          </span>
        </button>

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
                        ? 'bg-[#f4dfcb] text-[#5e4b3e] font-semibold border border-[#e8d2bd] shadow-2xs'
                        : 'hover:bg-[#eae8e3]/70 text-[#1b1c19]'
                    }`}
                  >
                    <Calendar className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? 'text-[#68594d] stroke-[2]' : 'text-[#8a8178]'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-serif-note font-semibold text-xs truncate">
                        {note.title || 'Sem título'}
                      </p>
                      {note.entry_date && (
                        <p className={`text-[10px] font-sans-ui ${isSelected ? 'text-[#5e4b3e]/80' : 'text-[#7f756e]'}`}>
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
          diaryTree.map(({ yearFolder, yearNum, months, totalNotes }) => {
            const isYearOpen = openYears.has(yearNum);

            return (
              <div
                key={yearNum}
                className="rounded-xl overflow-hidden bg-white/40 border border-[#eae8e3]/80 shadow-2xs"
              >
                {/* 1. Nível: ANO */}
                <button
                  type="button"
                  onClick={() => toggleYear(yearNum)}
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
                      {yearNum}
                    </span>
                  </div>
                  <span className="text-[10px] font-sans-ui font-medium text-[#7f756e] px-1.5 py-0.5 rounded-full bg-[#f0eee9]">
                    {totalNotes} {totalNotes === 1 ? 'entrada' : 'entradas'}
                  </span>
                </button>

                {/* 2. Nível: MESES */}
                {isYearOpen && (
                  <div className="pl-3 pr-1 py-1 space-y-1 bg-[#faf8f4]/40 border-t border-[#eae8e3]/60">
                    {months.map(({ monthFolder, monthNum, monthNotes }) => {
                      const monthKey = `${yearNum}-${monthNum}`;
                      const isMonthOpen = openMonths.has(monthKey);
                      const monthName = MONTH_NAMES_PT[monthNum - 1] || `Mês ${monthNum}`;

                      return (
                        <div key={monthKey} className="rounded-lg overflow-hidden">
                          {/* Botão do Mês */}
                          <button
                            type="button"
                            onClick={() => toggleMonth(monthKey)}
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
                                  const isToday = note.entry_date === todayDateStr;
                                  const hasContent = Boolean((note.content || '').trim().length > 0);
                                  const dayLabel = note.title || (note.entry_date ? formatDateDisplayWithWeekday(note.entry_date) : 'Entrada');

                                  return (
                                    <button
                                      key={note.id}
                                      type="button"
                                      onClick={() => onSelectNote(note.id)}
                                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer text-xs font-sans-ui ${
                                        isSelected
                                          ? 'bg-[#f4dfcb] text-[#5e4b3e] font-semibold border border-[#e8d2bd] shadow-2xs'
                                          : 'text-[#4e453f] hover:bg-[#eae8e3]/70 hover:text-[#1b1c19]'
                                      }`}
                                    >
                                      <Calendar
                                        className={`w-3.5 h-3.5 shrink-0 ${
                                          isSelected ? 'text-[#68594d] stroke-[2]' : 'text-[#8a8178]'
                                        }`}
                                      />
                                      <span className="truncate flex-1 font-medium">
                                        {dayLabel}
                                      </span>

                                      {/* Indicador de conteúdo */}
                                      {hasContent && (
                                        <span
                                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                            isSelected ? 'bg-[#5e4b3e]' : 'bg-[#68594d]/40'
                                          }`}
                                          title="Possui anotações"
                                        />
                                      )}

                                      {/* Badge "Hoje" */}
                                      {isToday && (
                                        <span className="text-[9px] font-semibold uppercase px-1.5 py-0.2 rounded-md bg-[#68594d] text-white shrink-0">
                                          Hoje
                                        </span>
                                      )}
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

      {/* Rodapé com Status em Tempo Real e Indicador de Modo Somente Leitura */}
      <div className="p-3 border-t border-[#eae8e3] bg-white/70 backdrop-blur-xs flex items-center justify-between">
        <SyncStatusIndicator readOnly={true} />
        <span className="text-[10px] font-sans-ui text-[#7f756e]">
          Espelho em tempo real
        </span>
      </div>
    </aside>
  );
}
