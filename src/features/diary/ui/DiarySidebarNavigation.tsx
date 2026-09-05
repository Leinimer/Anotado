'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
  Edit2,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import { Folder, Note } from '@/src/features/notes/types';
import { WorkspaceSwitch } from '@/src/features/core_layout/ui/WorkspaceSwitch';
import { SettingsModal } from '@/src/features/notes/ui/SettingsModal';
import { createClient } from '@/src/features/auth/api/supabase-client';
import { DiaryShare } from '../api/diary-sharing-api';
import {
  getLocalDateString,
  getDaysInMonth,
  parseDiaryDate,
  MONTH_NAMES,
} from '@/src/features/notes/utils/diary-date';
import {
  isDiaryYearFolder,
  extractDiaryYear,
  isDiaryMonthFolder,
  extractDiaryMonth,
  isDiaryNote,
} from '@/src/features/notes/utils/diary-hierarchy';

interface DiarySidebarNavigationProps {
  folders: Folder[];
  notes: Note[];
  activeNoteId: string | null;
  userId?: string;
  onSelectNote: (noteId: string) => void;
  onOpenOrCreateDay?: (year: number, month: number, day: number) => void;
  onCreateYear: () => void;
  onCreateEntry: () => void;
  onOpenToday: () => void;
  onDeleteNote: (noteId: string) => void;
  onRenameNote?: (noteId: string, newTitle: string) => void;
  onDeleteFolder?: (folderId: string, cascade: boolean) => void | Promise<void>;
  onRenameFolder?: (folderId: string, newName: string) => void | Promise<void>;
  onMoveItem?: (
    itemType: 'note',
    itemId: string,
    targetFolderId: string,
    targetPosition: number
  ) => void;
  onToggleWorkspace: () => void;
  onCloseMobile?: () => void;
  onOpenShareModal?: () => void;
  acceptedSharedDiaries?: DiaryShare[];
}

export function DiarySidebarNavigation({
  folders,
  notes,
  activeNoteId,
  userId = '',
  onSelectNote,
  onOpenOrCreateDay,
  onCreateYear,
  onCreateEntry,
  onOpenToday,
  onDeleteNote,
  onRenameNote,
  onDeleteFolder,
  onRenameFolder,
  onMoveItem,
  onToggleWorkspace,
  onCloseMobile,
  onOpenShareModal,
  acceptedSharedDiaries = [],
}: DiarySidebarNavigationProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShareMenuOpen, setIsShareMenuOpen] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const [monthFilter, setMonthFilter] = useState<Record<string, 'all' | 'created'>>({});

  // Menu de Contexto (botão direito)
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: 'year' | 'month' | 'note';
    id: string;
    name: string;
    notesCount?: number;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Modais de Confirmação e Edição
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    type: 'year' | 'month' | 'note';
    id: string;
    name: string;
    notesCount: number;
  }>({
    isOpen: false,
    type: 'note',
    id: '',
    name: '',
    notesCount: 0,
  });

  const [renameModal, setRenameModal] = useState<{
    isOpen: boolean;
    type: 'year' | 'month' | 'note';
    id: string;
    currentName: string;
  }>({
    isOpen: false,
    type: 'note',
    id: '',
    currentName: '',
  });
  const [renameInputValue, setRenameInputValue] = useState('');

  // Drag and drop state para notas
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [dragOverMonthId, setDragOverMonthId] = useState<string | null>(null);

  // Fechar menu de compartilhamento e context menu ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setIsShareMenuOpen(false);
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleShareClick = () => {
    if (!acceptedSharedDiaries || acceptedSharedDiaries.length === 0) {
      if (onOpenShareModal) onOpenShareModal();
    } else {
      setIsShareMenuOpen((prev) => !prev);
    }
  };

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

  // Ano e data de hoje para destacar o dia atual
  const today = useMemo(() => new Date(), []);
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth() + 1;
  const todayDay = today.getDate();
  const currentYear = todayYear;

  // Chave do mês atual para expansão inicial (ex.: "2026-9" para setembro de 2026)
  const currentMonthKey = `${todayYear}-${todayMonth}`;

  // REGRA 3: Na abertura, o ano atual inicia ABERTO e SOMENTE o mês atual inicia ABERTO (outros 11 fechados)
  const [collapsedYears, setCollapsedYears] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(
    () => new Set([currentMonthKey])
  );

  // Alternadores de acordeão
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

  // Agrupamento da árvore hierárquica do Diário:
  // ANO -> 12 MESES -> DIAS VIRTUAIS + NOTAS
  // Com DEDUPLICAÇÃO DEFENSIVA RIGOROSA: o mesmo ano ou mês nunca aparece duas vezes
  const diaryTree = useMemo(() => {
    // 1. Localiza pastas de Anos (parent_id === null) usando hierarquia real
    const rawYearFolders = folders.filter((f) => isDiaryYearFolder(f));

    // Agrupa anos pelo número do ano (ex: 2026) para eliminar duplicados
    const yearsMap = new Map<number, Folder[]>();
    for (const yf of rawYearFolders) {
      const yNum = extractDiaryYear(yf) || parseInt(yf.name, 10) || currentYear;
      const list = yearsMap.get(yNum) || [];
      list.push(yf);
      yearsMap.set(yNum, list);
    }

    // Se o ano atual não tiver pasta nenhuma, gera uma representação canônica
    if (!yearsMap.has(currentYear)) {
      yearsMap.set(currentYear, [
        {
          id: `virtual-year-${currentYear}`,
          user_id: userId,
          name: String(currentYear),
          parent_id: null,
          position: currentYear,
          color: '#68594d',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
    }

    // Ordena anos decrescente (2026, 2025, 2024...)
    const sortedYearNumbers = Array.from(yearsMap.keys()).sort((a, b) => b - a);

    return sortedYearNumbers.map((yearNum) => {
      const foldersForYear = yearsMap.get(yearNum)!;
      // Seleciona a canônica (a primeira criada ou a primeira com ID real)
      foldersForYear.sort((a, b) => {
        const tA = new Date(a.created_at || 0).getTime();
        const tB = new Date(b.created_at || 0).getTime();
        return tA - tB;
      });
      const canonicalYearFolder = foldersForYear[0];
      const allYearIds = new Set(foldersForYear.map((f) => f.id));

      // 2. Meses deste ano: todas as pastas filhas de qualquer um dos IDs deste ano
      const childMonthFolders = folders.filter(
        (f) => f.parent_id && allYearIds.has(f.parent_id)
      );

      // Agrupa meses por número (1 a 12)
      const monthsByNum = new Map<number, Folder[]>();
      for (const mf of childMonthFolders) {
        const mNum = extractDiaryMonth(mf);
        if (mNum) {
          const list = monthsByNum.get(mNum) || [];
          list.push(mf);
          monthsByNum.set(mNum, list);
        }
      }

      // Garante exatamente os 12 meses (Janeiro a Dezembro)
      const monthsWithNotes = Array.from({ length: 12 }, (_, i) => i + 1).map((monthNum) => {
        const monthName = MONTH_NAMES[monthNum - 1];
        const foldersForMonth = monthsByNum.get(monthNum) || [];

        let canonicalMonthFolder: Folder;
        if (foldersForMonth.length > 0) {
          foldersForMonth.sort((a, b) => {
            const tA = new Date(a.created_at || 0).getTime();
            const tB = new Date(b.created_at || 0).getTime();
            return tA - tB;
          });
          canonicalMonthFolder = foldersForMonth[0];
        } else {
          // Representação canônica do mês caso ainda não sincronizado
          canonicalMonthFolder = {
            id: `virtual-month-${yearNum}-${monthNum}`,
            user_id: userId,
            name: monthName,
            parent_id: canonicalYearFolder.id,
            position: monthNum,
            diary_year: yearNum,
            diary_month: monthNum,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        }

        const allMonthIds = new Set(foldersForMonth.map((f) => f.id));
        allMonthIds.add(canonicalMonthFolder.id);

        const daysInMonth = getDaysInMonth(yearNum, monthNum);

        // 3. Notas deste mês
        let monthNotes = notes.filter((n) => {
          if (n.is_archived) return false;
          if (!isDiaryNote(n, folders)) return false;

          if (n.folder_id && allMonthIds.has(n.folder_id)) return true;
          if (n.diary_year === yearNum && n.diary_month === monthNum) return true;
          if (n.entry_date) {
            const p = parseDiaryDate(n.entry_date);
            return p.year === yearNum && p.month === monthNum;
          }
          return false;
        });

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          monthNotes = monthNotes.filter(
            (n) =>
              n.title.toLowerCase().includes(q) ||
              (n.entry_date && n.entry_date.includes(q)) ||
              (n.content && n.content.toLowerCase().includes(q))
          );
        }

        // Mapa de notas existentes por dia (1 nota por dia)
        // Se houver mais de uma nota para o mesmo dia, prioriza a que tem conteúdo ou a nota ativa
        const notesByDay = new Map<number, Note>();
        monthNotes.forEach((note) => {
          let day = note.diary_day;
          if (!day && note.entry_date) {
            day = parseDiaryDate(note.entry_date).day;
          }
          if (!day && typeof note.position === 'number' && note.position >= 1 && note.position <= daysInMonth) {
            day = note.position;
          }
          if (!day && note.title) {
            const m = note.title.match(/(?:Dia\s+|#\s*)0*([1-9]|[12]\d|3[01])\b/i);
            if (m) day = parseInt(m[1], 10);
          }
          if (day && day >= 1 && day <= daysInMonth) {
            const existing = notesByDay.get(day);
            if (!existing) {
              notesByDay.set(day, note);
            } else {
              const currentContent = (note.content || '').trim();
              const existingContent = (existing.content || '').trim();
              if (note.id === activeNoteId || (!existingContent && currentContent)) {
                notesByDay.set(day, note);
              }
            }
          }
        });

        return {
          monthFolder: canonicalMonthFolder,
          yearNum,
          monthNum,
          daysInMonth,
          notes: monthNotes,
          notesByDay,
        };
      });

      const totalNotesInYear = monthsWithNotes.reduce(
        (acc, m) => acc + m.notesByDay.size,
        0
      );

      return {
        yearFolder: canonicalYearFolder,
        yearNum,
        months: monthsWithNotes,
        totalNotes: totalNotesInYear,
      };
    });
  }, [folders, notes, searchQuery, currentYear, userId, activeNoteId]);

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

  // Trata abertura do Menu de Contexto (botão direito)
  const handleOpenContextMenu = (
    e: React.MouseEvent,
    type: 'year' | 'month' | 'note',
    id: string,
    name: string,
    notesCount: number = 0
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Posição segura na tela
    const clientX = Math.min(e.clientX, window.innerWidth - 180);
    const clientY = Math.min(e.clientY, window.innerHeight - 150);

    setContextMenu({
      x: clientX,
      y: clientY,
      type,
      id,
      name,
      notesCount,
    });
  };

  // Ações do Menu de Contexto
  const handleTriggerRename = () => {
    if (!contextMenu) return;
    setRenameInputValue(contextMenu.name);
    setRenameModal({
      isOpen: true,
      type: contextMenu.type,
      id: contextMenu.id,
      currentName: contextMenu.name,
    });
    setContextMenu(null);
  };

  const handleTriggerDelete = () => {
    if (!contextMenu) return;
    setDeleteModal({
      isOpen: true,
      type: contextMenu.type,
      id: contextMenu.id,
      name: contextMenu.name,
      notesCount: contextMenu.notesCount || 0,
    });
    setContextMenu(null);
  };

  const handleConfirmRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameInputValue.trim() || !renameModal.id) return;

    if (renameModal.type === 'note' && onRenameNote) {
      onRenameNote(renameModal.id, renameInputValue.trim());
    } else if (
      (renameModal.type === 'year' || renameModal.type === 'month') &&
      onRenameFolder
    ) {
      await onRenameFolder(renameModal.id, renameInputValue.trim());
    }

    setRenameModal({ isOpen: false, type: 'note', id: '', currentName: '' });
  };

  const handleConfirmDelete = async () => {
    if (!deleteModal.id) return;

    if (deleteModal.type === 'note') {
      onDeleteNote(deleteModal.id);
    } else if (
      (deleteModal.type === 'year' || deleteModal.type === 'month') &&
      onDeleteFolder
    ) {
      await onDeleteFolder(deleteModal.id, true);
    }

    setDeleteModal({
      isOpen: false,
      type: 'note',
      id: '',
      name: '',
      notesCount: 0,
    });
  };

  return (
    <aside
      id="diary-sidebar-container"
      className="w-full md:w-64 lg:w-72 h-full bg-[#fbf9f4] border-r border-[#eae8e3] flex flex-col justify-between p-3 sm:p-4 select-none shrink-0 relative"
    >
      {/* Top Header: Logo + Switch Discreta + Compartilhamento */}
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

            {/* Botão Circular de Compartilhamento do Diário */}
            <div className="relative" ref={shareMenuRef}>
              <button
                type="button"
                id="diary-share-trigger-btn"
                onClick={handleShareClick}
                className={`w-7 h-7 rounded-full flex items-center justify-center border transition-all cursor-pointer relative ${
                  acceptedSharedDiaries && acceptedSharedDiaries.length > 0
                    ? 'bg-[#f4dfcb] text-[#68594d] border-[#e8d2bd] hover:bg-[#ebd0b7]'
                    : 'bg-[#ffffff] text-[#7f756e] border-[#eae8e3] hover:text-[#1b1c19] hover:bg-[#f0eee9]'
                }`}
                title={
                  acceptedSharedDiaries && acceptedSharedDiaries.length > 0
                    ? 'Diários compartilhados'
                    : 'Compartilhar Diário'
                }
              >
                <CalendarDays className="w-3.5 h-3.5" />
                {acceptedSharedDiaries && acceptedSharedDiaries.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[#68594d] text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-xs">
                    {acceptedSharedDiaries.length}
                  </span>
                )}
              </button>

              {/* Menu dropdown para trocar para Diário compartilhado */}
              {isShareMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-60 bg-white rounded-xl shadow-lg border border-[#e4e2dd] p-1.5 z-50 text-xs font-sans-ui animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-2 py-1 text-[11px] font-semibold text-[#8a8178] uppercase tracking-wider">
                    Diários
                  </div>
                  <div className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#f4dfcb]/60 text-[#5e4b3e] font-medium">
                    <Calendar className="w-3.5 h-3.5 text-[#68594d]" />
                    <span className="truncate">Meu Diário</span>
                  </div>

                  {acceptedSharedDiaries.map((share) => (
                    <button
                      key={share.id}
                      type="button"
                      onClick={() => {
                        setIsShareMenuOpen(false);
                        router.push(`/shared-diary/${share.id}`);
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[#4e453f] hover:bg-[#f0eee9] transition-colors cursor-pointer text-left"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <CalendarDays className="w-3.5 h-3.5 text-[#8c6b4f]" />
                        <span className="truncate">
                          Diário de {share.owner_email ? share.owner_email.split('@')[0] : 'Convidado'}
                        </span>
                      </div>
                    </button>
                  ))}

                  <div className="border-t border-[#f0eee9] mt-1 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsShareMenuOpen(false);
                        if (onOpenShareModal) onOpenShareModal();
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[#68594d] hover:bg-[#f4dfcb]/40 font-medium transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Convidar para meu diário</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Barra de Busca de Entradas */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#7f756e] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            id="diary-search-input"
            type="text"
            placeholder="Buscar no diário..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 text-xs font-sans-ui bg-white/70 border border-[#eae8e3] rounded-xl text-[#1b1c19] placeholder-[#7f756e] focus:outline-hidden focus:ring-1 focus:ring-[#68594d] transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#7f756e] hover:text-[#1b1c19] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Árvore Hierárquica do Diário: ANO -> 12 MESES -> DIAS VIRTUAIS */}
      <div
        id="diary-tree-scroll-container"
        className="flex-1 overflow-y-auto mt-3 mb-2 space-y-1.5 pr-1 -mr-1"
      >
        {diaryTree.length === 0 ? (
          <div className="text-center py-8 px-2">
            <Calendar className="w-8 h-8 text-[#8c6b4f] mx-auto mb-2 opacity-60" />
            <p className="text-xs text-[#7f756e] font-sans-ui">Nenhum ano cadastrado.</p>
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
          diaryTree.map(({ yearFolder, yearNum, months, totalNotes }) => {
            const isYearOpen = !collapsedYears.has(yearFolder.id);

            return (
              <div
                key={`year-group-${yearNum}`}
                className="rounded-xl overflow-hidden bg-white/40 border border-[#eae8e3]/80"
              >
                {/* 1. Nível: ANO */}
                <button
                  type="button"
                  onClick={() => toggleYear(yearFolder.id)}
                  onContextMenu={(e) =>
                    handleOpenContextMenu(
                      e,
                      'year',
                      yearFolder.id,
                      yearFolder.name,
                      totalNotes
                    )
                  }
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

                {/* 2. Nível: OS 12 MESES DO ANO */}
                {isYearOpen && (
                  <div className="pl-3 pr-1 py-1 space-y-1 bg-[#faf8f4]/40 border-t border-[#eae8e3]/60">
                    {months.map(
                      ({
                        monthFolder,
                        monthNum,
                        daysInMonth,
                        notes: monthNotes,
                        notesByDay,
                      }) => {
                        const monthKey = `${yearNum}-${monthNum}`;
                        const isMonthOpen =
                          expandedMonths.has(monthKey) ||
                          expandedMonths.has(monthFolder.id);
                        const isDragOver = dragOverMonthId === monthFolder.id;
                        const filterMode = monthFilter[monthFolder.id] || 'all';

                        return (
                          <div
                            key={`month-${yearNum}-${monthNum}`}
                            onDragOver={(e) => handleMonthDragOver(e, monthFolder.id)}
                            onDragLeave={handleMonthDragLeave}
                            onDrop={(e) => handleMonthDrop(e, monthFolder.id)}
                            className={`rounded-lg transition-colors ${
                              isDragOver ? 'bg-[#f4dfcb]/80 ring-2 ring-[#68594d]' : ''
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleMonth(monthKey, monthFolder.id)}
                              onContextMenu={(e) =>
                                handleOpenContextMenu(
                                  e,
                                  'month',
                                  monthFolder.id,
                                  monthFolder.name,
                                  notesByDay.size
                                )
                              }
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
                                    notesByDay.size > 0
                                      ? 'font-medium text-[#2d2824]'
                                      : 'text-[#7f756e]'
                                  }`}
                                >
                                  {monthFolder.name}
                                </span>
                              </div>
                              {notesByDay.size > 0 ? (
                                <span className="text-[10px] font-sans-ui text-[#68594d] px-1.5 py-0.2 rounded-full bg-[#f4dfcb] font-medium">
                                  {notesByDay.size}
                                </span>
                              ) : (
                                <span className="text-[10px] font-sans-ui text-[#a1968e] px-1">
                                  {daysInMonth}d
                                </span>
                              )}
                            </button>

                            {/* 3. Nível: OS DIAS DO MÊS (VIRTUAIS + NOTAS EXISTENTES) */}
                            {isMonthOpen && (
                              <div className="pl-3 pr-1 py-0.5 space-y-0.5 border-l border-[#e4e0d7] ml-3 mt-0.5">
                                {/* Barra de filtro rápida se houver notas criadas */}
                                {notesByDay.size > 0 && (
                                  <div className="flex items-center justify-between px-1.5 py-1 mb-0.5 text-[10px] font-sans-ui text-[#7f756e]">
                                    <span>
                                      {notesByDay.size} de {daysInMonth} dias
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setMonthFilter((prev) => ({
                                            ...prev,
                                            [monthFolder.id]: 'all',
                                          }));
                                        }}
                                        className={`px-1.5 py-0.5 rounded transition-colors ${
                                          filterMode === 'all'
                                            ? 'bg-[#e4dfd7] text-[#2d2824] font-medium'
                                            : 'text-[#8a8178] hover:text-[#2d2824]'
                                        }`}
                                      >
                                        Todos
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setMonthFilter((prev) => ({
                                            ...prev,
                                            [monthFolder.id]: 'created',
                                          }));
                                        }}
                                        className={`px-1.5 py-0.5 rounded transition-colors ${
                                          filterMode === 'created'
                                            ? 'bg-[#e4dfd7] text-[#2d2824] font-medium'
                                            : 'text-[#8a8178] hover:text-[#2d2824]'
                                        }`}
                                      >
                                        Anotados ({notesByDay.size})
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Lista dos dias do mês (Dia 01 ... Dia 30/31) */}
                                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((dayNum) => {
                                  const existingNote = notesByDay.get(dayNum);
                                  if (filterMode === 'created' && !existingNote) return null;

                                  const dayFormatted = String(dayNum).padStart(2, '0');
                                  const defaultTitle = `Dia ${dayFormatted}`;
                                  const displayTitle = existingNote ? existingNote.title : defaultTitle;
                                  const isToday =
                                    todayYear === yearNum &&
                                    todayMonth === monthNum &&
                                    todayDay === dayNum;
                                  const isActive = existingNote ? existingNote.id === activeNoteId : false;
                                  const hasContent = Boolean(
                                    existingNote && (existingNote.content || '').trim().length > 0
                                  );

                                  if (searchQuery.trim()) {
                                    const q = searchQuery.toLowerCase();
                                    const matches =
                                      displayTitle.toLowerCase().includes(q) ||
                                      dayFormatted.includes(q) ||
                                      (existingNote?.content &&
                                        existingNote.content.toLowerCase().includes(q));
                                    if (!matches) return null;
                                  }

                                  // ==========================================
                                  // CASO 1: DIA COM NOTA EXISTENTE
                                  // REGRA 4: Texto mais escuro/forte, aparência preenchida.
                                  // REGRA 5: Menu de contexto no botão direito permitido.
                                  // ==========================================
                                  if (existingNote) {
                                    return (
                                      <div
                                        key={existingNote.id}
                                        id={`diary-entry-${existingNote.id}`}
                                        draggable
                                        onDragStart={(e) => handleNoteDragStart(e, existingNote.id)}
                                        onClick={() => onSelectNote(existingNote.id)}
                                        onContextMenu={(e) =>
                                          handleOpenContextMenu(
                                            e,
                                            'note',
                                            existingNote.id,
                                            existingNote.title
                                          )
                                        }
                                        className={`group/entry relative flex items-center justify-between px-2 py-1 rounded-lg text-xs font-sans-ui transition-all cursor-pointer ${
                                          isActive
                                            ? 'bg-[#f4dfcb] text-[#5e4b3e] font-semibold border border-[#e8d2bd] shadow-2xs'
                                            : 'text-[#1b1c19] font-medium hover:bg-[#eae8e3]/70'
                                        }`}
                                      >
                                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                          <Calendar
                                            className={`w-3.5 h-3.5 shrink-0 ${
                                              isActive
                                                ? 'text-[#68594d] stroke-[2]'
                                                : 'text-[#68594d] stroke-[1.75]'
                                            }`}
                                          />
                                          <span className="truncate">{displayTitle}</span>
                                          {hasContent && (
                                            <span
                                              className="w-1.5 h-1.5 rounded-full bg-[#68594d] shrink-0"
                                              title="Possui conteúdo escrito"
                                            />
                                          )}
                                          {isToday && (
                                            <span className="shrink-0 text-[9px] font-sans-ui font-medium px-1.5 py-0.2 rounded-full bg-[#e8d2bd] text-[#5e4b3e]">
                                              Hoje
                                            </span>
                                          )}
                                        </div>

                                        {/* Ação rápida de exclusão (hover) */}
                                        <div className="flex items-center opacity-0 group-hover/entry:opacity-100 transition-opacity">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleOpenContextMenu(
                                                e,
                                                'note',
                                                existingNote.id,
                                                existingNote.title
                                              );
                                            }}
                                            className="p-1 text-[#7f756e] hover:text-[#1b1c19] rounded cursor-pointer"
                                            title="Opções da entrada"
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  }

                                  // ==========================================
                                  // CASO 2: DIA SEM NOTA (VIRTUAL)
                                  // REGRA 4: Texto cinza/marrom claro, aparência discreta.
                                  // REGRA 2: Clicar cria a nota (apenas se clicado).
                                  // REGRA 5: Não possui menu de contexto (não é registro real).
                                  // ==========================================
                                  return (
                                    <div
                                      key={`virtual-day-${yearNum}-${monthNum}-${dayNum}`}
                                      id={`diary-virtual-day-${yearNum}-${monthNum}-${dayNum}`}
                                      onClick={() => {
                                        if (onOpenOrCreateDay) {
                                          onOpenOrCreateDay(yearNum, monthNum, dayNum);
                                        }
                                      }}
                                      onContextMenu={(e) => e.preventDefault()}
                                      className="group/virtual relative flex items-center justify-between px-2 py-1 rounded-lg text-xs font-sans-ui text-[#8a8178] hover:text-[#1b1c19] hover:bg-[#eae8e3]/60 transition-colors cursor-pointer"
                                    >
                                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                        <Calendar className="w-3.5 h-3.5 shrink-0 text-[#b5aba2] stroke-[1.2] group-hover/virtual:text-[#68594d]" />
                                        <span className="truncate">{defaultTitle}</span>
                                        {isToday && (
                                          <span className="shrink-0 text-[9px] font-sans-ui font-medium px-1.5 py-0.2 rounded-full bg-[#eae5de] text-[#7f756e] group-hover/virtual:bg-[#e8d2bd] group-hover/virtual:text-[#5e4b3e]">
                                            Hoje
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[10px] font-sans-ui text-[#8a8178] opacity-0 group-hover/virtual:opacity-100 transition-opacity flex items-center gap-0.5">
                                        <Plus className="w-2.5 h-2.5" /> Escrever
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }
                    )}
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

      {/* MENU DE CONTEXTO FLUTUANTE (Botão direito para Ano, Mês e Nota) */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-44 bg-white rounded-xl shadow-xl border border-[#e4e2dd] p-1 font-sans-ui text-xs animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-2.5 py-1 text-[10px] font-semibold text-[#8a8178] uppercase tracking-wider border-b border-[#f0eee9] mb-1 truncate">
            {contextMenu.type === 'year'
              ? `Ano: ${contextMenu.name}`
              : contextMenu.type === 'month'
              ? `Mês: ${contextMenu.name}`
              : `Entrada: ${contextMenu.name}`}
          </div>

          <button
            type="button"
            onClick={handleTriggerRename}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[#2d2824] hover:bg-[#f0eee9] transition-colors cursor-pointer text-left"
          >
            <Edit2 className="w-3.5 h-3.5 text-[#68594d]" />
            <span>Editar (renomear)</span>
          </button>

          <button
            type="button"
            onClick={handleTriggerDelete}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors cursor-pointer text-left"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-600" />
            <span>Excluir</span>
          </button>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO COM AVISO CLARO */}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 font-sans-ui">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-xl border border-[#eae8e3] space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-serif-note font-bold text-base text-[#1b1c19]">
                  {deleteModal.type === 'year'
                    ? `Excluir Ano ${deleteModal.name}?`
                    : deleteModal.type === 'month'
                    ? `Excluir Mês de ${deleteModal.name}?`
                    : `Excluir entrada "${deleteModal.name}"?`}
                </h3>
                <p className="text-xs text-[#7f756e]">Confirmação necessária</p>
              </div>
            </div>

            <p className="text-xs text-[#4e453f] leading-relaxed">
              {deleteModal.type === 'year' && deleteModal.notesCount > 0
                ? `Atenção: Este ano possui ${deleteModal.notesCount} anotação(ões) em seus meses. Ao excluir o ano, todas as suas anotações e pastas de meses serão excluídas.`
                : deleteModal.type === 'month' && deleteModal.notesCount > 0
                ? `Atenção: Este mês possui ${deleteModal.notesCount} anotação(ões). Ao excluir o mês, todas as notas contidas nele serão excluídas.`
                : deleteModal.type === 'note'
                ? 'Deseja realmente excluir esta anotação do diário? Esta ação não pode ser desfeita.'
                : 'Deseja realmente excluir esta pasta?'}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f0eee9]">
              <button
                type="button"
                onClick={() =>
                  setDeleteModal({
                    isOpen: false,
                    type: 'note',
                    id: '',
                    name: '',
                    notesCount: 0,
                  })
                }
                className="px-3 py-1.5 text-xs font-medium text-[#7f756e] hover:bg-[#f0eee9] rounded-lg transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                Sim, Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE RENOMEAR */}
      {renameModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 font-sans-ui">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-xl border border-[#eae8e3] space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="font-serif-note font-bold text-base text-[#1b1c19]">
              {renameModal.type === 'year'
                ? 'Renomear Ano'
                : renameModal.type === 'month'
                ? 'Renomear Mês'
                : 'Renomear Entrada'}
            </h3>

            <form onSubmit={handleConfirmRename} className="space-y-4">
              <input
                type="text"
                value={renameInputValue}
                onChange={(e) => setRenameInputValue(e.target.value)}
                placeholder="Novo nome..."
                autoFocus
                className="w-full px-3 py-2 text-xs font-sans-ui bg-white border border-[#e4e2dd] rounded-xl text-[#1b1c19] focus:outline-hidden focus:ring-1 focus:ring-[#68594d]"
              />

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setRenameModal({
                      isOpen: false,
                      type: 'note',
                      id: '',
                      currentName: '',
                    })
                  }
                  className="px-3 py-1.5 text-xs font-medium text-[#7f756e] hover:bg-[#f0eee9] rounded-lg transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-medium text-white bg-[#68594d] hover:bg-[#53463c] rounded-lg shadow-2xs transition-colors cursor-pointer"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Configurações */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        userId={userId}
        notes={notes}
        userEmail={userEmail || ''}
        onOpenShareModal={onOpenShareModal}
      />
    </aside>
  );
}
