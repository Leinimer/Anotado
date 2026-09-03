'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Calendar,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  User,
  Settings,
  LogOut,
  Trash2,
  CheckSquare,
  Plus,
} from 'lucide-react';
import { Folder, Note } from '@/src/features/notes/types';
import { WorkspaceSwitch } from '@/src/features/core_layout/ui/WorkspaceSwitch';
import { SettingsModal } from '@/src/features/notes/ui/SettingsModal';
import { createClient } from '@/src/features/auth/api/supabase-client';
import { getLocalDateString } from '@/src/features/notes/utils/diary-date';

interface DiarySidebarNavigationProps {
  folders: Folder[];
  notes: Note[];
  activeNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  onCreateYear: () => void;
  onCreateEntry: () => void;
  onOpenToday: () => void;
  onDeleteNote: (noteId: string) => void;
  onRenameNote?: (noteId: string, newTitle: string) => void;
  onMoveItem?: (
    itemType: 'note',
    itemId: string,
    targetFolderId: string,
    targetPosition: number
  ) => void;
  onToggleWorkspace: () => void;
  onCloseMobile?: () => void;
}

export function DiarySidebarNavigation({
  folders,
  notes,
  activeNoteId,
  onSelectNote,
  onCreateYear,
  onCreateEntry,
  onOpenToday,
  onDeleteNote,
  onRenameNote,
  onMoveItem,
  onToggleWorkspace,
  onCloseMobile,
}: DiarySidebarNavigationProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  // Drag and drop state exclusivo para entradas diárias (anos e meses são estruturais fixos)
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dragOverMonthId, setDragOverMonthId] = useState<string | null>(null);

  // Carrega email do usuário
  useEffect(() => {
    let isCancelled = false;
    const supabase = createClient();
    const loadUser = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (isCancelled) return;
        if (data?.user?.email) setUserEmail(data.user.email);
      } catch {
        // Modo offline
      }
    };
    loadUser();
    return () => {
      isCancelled = true;
    };
  }, []);

  // Ano atual para atalhos
  const currentYear = new Date().getFullYear();

  // Estado de recolhimento de anos e meses (por padrão iniciam expandidos)
  const [collapsedYears, setCollapsedYears] = useState<Set<string>>(new Set());
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  // Alternadores de acordeão
  const toggleYear = (yearId: string) => {
    setCollapsedYears((prev) => {
      const next = new Set(prev);
      if (next.has(yearId)) next.delete(yearId);
      else next.add(yearId);
      return next;
    });
  };

  const toggleMonth = (monthId: string) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthId)) next.delete(monthId);
      else next.add(monthId);
      return next;
    });
  };

  // Agrupamento da árvore hierárquica do Diário:
  // ANO -> MÊS -> DIAS
  const diaryTree = useMemo(() => {
    // 1. Pastas de Anos (parent_id === null)
    const yearFolders = folders
      .filter((f) => f.parent_id === null && f.workspace_type === 'diary')
      .sort((a, b) => {
        const yearA = parseInt(a.name, 10) || a.position || 0;
        const yearB = parseInt(b.name, 10) || b.position || 0;
        return yearB - yearA; // Anos mais recentes primeiro (2026, 2025...)
      });

    return yearFolders.map((yearFolder) => {
      // 2. Meses deste ano (parent_id === yearFolder.id)
      const monthFolders = folders
        .filter((f) => f.parent_id === yearFolder.id)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)); // 1 a 12 (Janeiro a Dezembro)

      const monthsWithNotes = monthFolders.map((monthFolder) => {
        // 3. Entradas deste mês (folder_id === monthFolder.id)
        let monthNotes = notes.filter((n) => n.folder_id === monthFolder.id);

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          monthNotes = monthNotes.filter(
            (n) =>
              n.title.toLowerCase().includes(q) ||
              (n.entry_date && n.entry_date.includes(q))
          );
        }

        // Ordena dias em ordem cronológica (Dia 01, Dia 02...)
        monthNotes.sort((a, b) => {
          const dayA = a.diary_day ?? a.position ?? 0;
          const dayB = b.diary_day ?? b.position ?? 0;
          return dayA - dayB;
        });

        return {
          monthFolder,
          notes: monthNotes,
        };
      });

      // Total de entradas do ano
      const totalNotesInYear = monthsWithNotes.reduce((acc, m) => acc + m.notes.length, 0);

      return {
        yearFolder,
        months: monthsWithNotes,
        totalNotes: totalNotesInYear,
      };
    });
  }, [folders, notes, searchQuery]);

  // Manipulação de seleção múltipla
  const handleToggleSelectNote = (noteId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  };

  const handleBatchDelete = () => {
    selectedNoteIds.forEach((id) => onDeleteNote(id));
    setSelectedNoteIds(new Set());
    setShowBatchDeleteConfirm(false);
  };

  // Drag and Drop para Entradas Diárias
  const handleNoteDragStart = (e: React.DragEvent, noteId: string) => {
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', noteId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedNoteId(noteId);
  };

  const handleMonthDragOver = (e: React.DragEvent, monthId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverMonthId !== monthId) {
      setDragOverMonthId(monthId);
    }
  };

  const handleMonthDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverMonthId(null);
  };

  const handleMonthDrop = (e: React.DragEvent, targetMonthId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverMonthId(null);
    const noteId = e.dataTransfer.getData('text/plain') || draggedNoteId;
    if (noteId && onMoveItem) {
      const noteToMove = notes.find((n) => n.id === noteId);
      if (noteToMove && noteToMove.folder_id !== targetMonthId) {
        onMoveItem('note', noteId, targetMonthId, noteToMove.position ?? 0);
      }
    }
    setDraggedNoteId(null);
  };

  return (
    <aside
      id="diary-sidebar-container"
      className="w-full md:w-64 lg:w-72 h-full bg-[#fbf9f4] border-r border-[#eae8e3] flex flex-col justify-between p-3 sm:p-4 select-none shrink-0"
    >
      {/* Top Header: Logo + Switch Discreta + Busca */}
      <div className="space-y-3 shrink-0">
        <div className="flex items-center justify-between py-1 px-1">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#68594d] text-white flex items-center justify-center font-serif-note font-bold text-sm shadow-xs">
              A
            </div>
            <span className="font-serif-note font-bold text-lg text-[#1b1c19] tracking-tight">
              anotado!
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Chavezinha / Switch Discreta e Elegante */}
            <WorkspaceSwitch currentWorkspace="diary" onToggle={onToggleWorkspace} />

            {onCloseMobile && (
              <button
                id="diary-sidebar-close-mobile-btn"
                type="button"
                onClick={onCloseMobile}
                className="p-1 text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-lg md:hidden cursor-pointer"
                aria-label="Fechar Menu"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Busca por Entradas e Datas */}
        <div className="relative">
          <input
            id="diary-search-input"
            type="text"
            placeholder="Buscar no Diário..."
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

        {/* Botão de Atalho para HOJE */}
        <button
          id="diary-today-quick-btn"
          type="button"
          onClick={onOpenToday}
          className="w-full flex items-center justify-between px-3 py-2 bg-[#f4dfcb]/70 hover:bg-[#f4dfcb] border border-[#e8d2bd] rounded-xl text-xs text-[#5e4b3e] font-sans-ui font-medium transition-all shadow-2xs cursor-pointer group"
          title="Abrir ou criar entrada do dia de hoje"
        >
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-[#68594d]" />
            <span className="font-semibold text-[#1b1c19]">Hoje</span>
            <span className="text-[11px] text-[#7f756e]">({getLocalDateString()})</span>
          </div>
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-white/80 rounded-md text-[#68594d] group-hover:bg-white transition-colors">
            Abrir
          </span>
        </button>

        {/* Barra de Ações para Multi-Seleção */}
        {selectedNoteIds.size > 0 && (
          <div className="px-2.5 py-1.5 bg-[#eae5de] border border-[#d8d1c7] rounded-xl flex items-center justify-between shadow-2xs font-sans-ui text-xs text-[#1b1c19]">
            <div className="flex items-center gap-1.5 font-medium truncate">
              <CheckSquare className="w-3.5 h-3.5 text-[#68594d] shrink-0" />
              <span>{selectedNoteIds.size} selecionada{selectedNoteIds.size > 1 ? 's' : ''}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowBatchDeleteConfirm(true)}
                className="p-1 hover:bg-[#ded7ce] text-red-600 rounded cursor-pointer"
                title="Excluir selecionadas"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setSelectedNoteIds(new Set())}
                className="p-1 hover:bg-[#ded7ce] text-[#7f756e] rounded cursor-pointer"
                title="Limpar seleção"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Hierarchical Tree Area: ANO -> MÊS -> DIAS */}
      <div className="flex-1 overflow-y-auto min-h-0 my-3 pr-1 space-y-2 scrollbar-thin">
        {diaryTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center px-4">
            <Calendar className="w-8 h-8 text-[#a1968e] stroke-[1.5] mb-2" />
            <p className="text-xs text-[#7f756e] font-sans-ui">Nenhum ano no Diário</p>
            <button
              type="button"
              onClick={onCreateYear}
              className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-sans-ui font-medium bg-[#68594d] text-white rounded-lg shadow-2xs hover:bg-[#53463c] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Criar Ano {currentYear}</span>
            </button>
          </div>
        ) : (
          diaryTree.map(({ yearFolder, months, totalNotes }) => {
            const isYearOpen = !collapsedYears.has(yearFolder.id);

            return (
              <div key={yearFolder.id} className="rounded-xl overflow-hidden bg-white/40 border border-[#eae8e3]/80">
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
                    {months.map(({ monthFolder, notes: monthNotes }) => {
                      const isMonthOpen = !collapsedMonths.has(monthFolder.id);
                      const isDragOver = dragOverMonthId === monthFolder.id;

                      return (
                        <div
                          key={monthFolder.id}
                          onDragOver={(e) => handleMonthDragOver(e, monthFolder.id)}
                          onDragLeave={handleMonthDragLeave}
                          onDrop={(e) => handleMonthDrop(e, monthFolder.id)}
                          className={`rounded-lg transition-colors ${
                            isDragOver ? 'bg-[#f4dfcb]/80 ring-2 ring-[#68594d]' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleMonth(monthFolder.id)}
                            className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-[#eae8e3]/60 rounded-lg transition-colors text-left cursor-pointer group"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[#a1968e] group-hover:text-[#1b1c19]">
                                {isMonthOpen ? (
                                  <ChevronDown className="w-3 h-3 stroke-[2]" />
                                ) : (
                                  <ChevronRight className="w-3 h-3 stroke-[2]" />
                                )}
                              </span>
                              <span
                                className={`font-sans-ui text-xs truncate ${
                                  monthNotes.length > 0
                                    ? 'font-medium text-[#2d2824]'
                                    : 'text-[#7f756e]'
                                }`}
                              >
                                {monthFolder.name}
                              </span>
                            </div>
                            {monthNotes.length > 0 && (
                              <span className="text-[10px] font-sans-ui text-[#7f756e] px-1 rounded bg-[#f0eee9]">
                                {monthNotes.length}
                              </span>
                            )}
                          </button>

                          {/* 3. Nível: DIAS */}
                          {isMonthOpen && (
                            <div className="pl-4 pr-1 py-0.5 space-y-0.5 border-l border-[#e4e0d7] ml-3 mt-0.5">
                              {monthNotes.length === 0 ? (
                                <p className="text-[11px] text-[#a1968e] py-1 px-2 italic font-sans-ui">
                                  Nenhuma entrada
                                </p>
                              ) : (
                                monthNotes.map((note) => {
                                  const isActive = note.id === activeNoteId;
                                  const isSelected = selectedNoteIds.has(note.id);

                                  return (
                                    <div
                                      key={note.id}
                                      draggable
                                      onDragStart={(e) => handleNoteDragStart(e, note.id)}
                                      onClick={(e) => {
                                        if (e.ctrlKey || e.metaKey || isMultiSelectMode) {
                                          handleToggleSelectNote(note.id, e);
                                        } else {
                                          onSelectNote(note.id);
                                        }
                                      }}
                                      className={`group/entry relative flex items-center justify-between px-2 py-1 rounded-lg text-xs font-sans-ui transition-all cursor-pointer ${
                                        isActive
                                          ? 'bg-[#f4dfcb] text-[#5e4b3e] font-semibold border border-[#e8d2bd] shadow-2xs'
                                          : isSelected
                                          ? 'bg-[#eae5de] text-[#1b1c19]'
                                          : 'text-[#4e453f] hover:bg-[#eae8e3]/70 hover:text-[#1b1c19]'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                        <Calendar
                                          className={`w-3.5 h-3.5 shrink-0 ${
                                            isActive
                                              ? 'text-[#68594d] stroke-[2]'
                                              : 'text-[#8c6b4f] stroke-[1.5]'
                                          }`}
                                        />
                                        <span className="truncate">{note.title}</span>
                                      </div>

                                      {/* Ações na entrada (hover) */}
                                      <div className="flex items-center opacity-0 group-hover/entry:opacity-100 transition-opacity">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteNote(note.id);
                                          }}
                                          className="p-1 text-[#7f756e] hover:text-red-600 rounded cursor-pointer"
                                          title="Excluir entrada"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
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

      {/* Bottom Actions: + Ano, + Entrada, Usuário */}
      <div className="pt-2 border-t border-[#eae8e3] space-y-2 shrink-0">
        <div className="grid grid-cols-2 gap-2">
          {/* Botão Novo Ano */}
          <button
            id="diary-create-year-btn"
            type="button"
            onClick={onCreateYear}
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-[#eae8e3] hover:bg-[#e0ded8] text-[#4e453f] hover:text-[#1b1c19] text-xs font-sans-ui font-medium rounded-xl transition-colors cursor-pointer"
            title="Criar novo ano no Diário"
          >
            <CalendarPlus className="w-4 h-4 text-[#68594d]" />
            <span>+ Ano</span>
          </button>

          {/* Botão Nova Entrada */}
          <button
            id="diary-create-entry-btn"
            type="button"
            onClick={onCreateEntry}
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-[#68594d] hover:bg-[#53463c] text-white text-xs font-sans-ui font-medium rounded-xl transition-colors cursor-pointer shadow-2xs"
            title="Criar nova entrada por data"
          >
            <Calendar className="w-4 h-4" />
            <span>+ Entrada</span>
          </button>
        </div>

        {/* Rodapé do Usuário e Configurações */}
        <div className="flex items-center justify-between px-1 pt-1 text-xs text-[#7f756e]">
          <div className="flex items-center gap-1.5 truncate max-w-[150px]" title={userEmail || ''}>
            <User className="w-3.5 h-3.5 shrink-0 text-[#68594d]" />
            <span className="truncate font-sans-ui">{userEmail || 'Conta'}</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              id="diary-settings-btn"
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="p-1 hover:bg-[#eae8e3] rounded-lg transition-colors text-[#7f756e] hover:text-[#1b1c19] cursor-pointer"
              title="Configurações"
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              id="diary-logout-btn"
              type="button"
              onClick={async () => {
                const supabase = createClient();
                await supabase.auth.signOut();
                window.location.href = '/login';
              }}
              className="p-1 hover:bg-[#eae8e3] rounded-lg transition-colors text-[#7f756e] hover:text-[#1b1c19] cursor-pointer"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal de Confirmação de Exclusão em Lote */}
      {showBatchDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-xl border border-[#eae8e3] space-y-4">
            <h3 className="font-serif-note font-bold text-base text-[#1b1c19]">
              Excluir entradas selecionadas?
            </h3>
            <p className="text-xs text-[#7f756e] font-sans-ui leading-relaxed">
              Deseja realmente excluir as {selectedNoteIds.size} entradas selecionadas? Esta ação não pode ser desfeita.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowBatchDeleteConfirm(false)}
                className="px-3 py-1.5 text-xs font-sans-ui font-medium text-[#7f756e] hover:bg-[#f0eee9] rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleBatchDelete}
                className="px-3 py-1.5 text-xs font-sans-ui font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-2xs cursor-pointer"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Configurações */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        userEmail={userEmail || undefined}
      />
    </aside>
  );
}
