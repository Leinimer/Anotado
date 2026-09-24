'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, FileText, Calendar, X, ArrowRight, CornerDownLeft } from 'lucide-react';
import { indexedDBStorage, ExtendedNote, ExtendedFolder } from '../db/indexed-db';
import { formatDateReadable } from '../utils/diary-date';
import { isDiaryNote } from '../utils/diary-hierarchy';

interface InternalNoteReferenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectNote: (note: ExtendedNote) => void;
  userId: string;
  currentNoteId?: string | null;
  selectedText?: string;
}

export function InternalNoteReferenceModal({
  isOpen,
  onClose,
  onSelectNote,
  userId,
  currentNoteId,
  selectedText,
}: InternalNoteReferenceModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [allNotes, setAllNotes] = useState<ExtendedNote[]>([]);
  const [allFolders, setAllFolders] = useState<ExtendedFolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Carrega todas as notas e pastas do IndexedDB
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    const loadData = async () => {
      try {
        const [notes, folders] = await Promise.all([
          indexedDBStorage.getAllNotes(userId),
          indexedDBStorage.getAllFolders(userId),
        ]);
        if (isMounted) {
          setAllNotes(notes || []);
          setAllFolders(folders || []);
          setIsLoading(false);
          setSearchQuery('');
          setSelectedIndex(0);
        }
      } catch (err) {
        console.error('[InternalNoteReferenceModal] Erro ao carregar notas:', err);
        if (isMounted) setIsLoading(false);
      }
    };

    loadData();

    // Auto-foco imediato no campo de busca
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [isOpen, userId]);

  // Mapa de pastas por ID para resolução rápida de contexto
  const folderMap = useMemo(() => {
    const map = new Map<string, ExtendedFolder>();
    for (const f of allFolders) {
      map.set(f.id, f);
    }
    return map;
  }, [allFolders]);

  // Filtra e classifica as notas com prioridade para TÍTULO > TAGS > CONTEÚDO
  const filteredNotes = useMemo(() => {
    // Exclui a própria nota atual e notas arquivadas
    const candidates = allNotes.filter((n) => {
      if (currentNoteId && n.id === currentNoteId) return false;
      if (n.is_archived) return false;
      return true;
    });

    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      // Sem query: exibe as notas ordenadas pelas mais recentes
      return candidates.sort((a, b) => {
        const timeA = new Date(a.updated_at || a.created_at || 0).getTime();
        const timeB = new Date(b.updated_at || b.created_at || 0).getTime();
        return timeB - timeA;
      });
    }

    const titleMatches: ExtendedNote[] = [];
    const tagMatches: ExtendedNote[] = [];
    const contentMatches: ExtendedNote[] = [];

    for (const note of candidates) {
      const title = (note.title || '').toLowerCase();
      const entryDate = (note.entry_date || '').toLowerCase();
      const readableDate = note.entry_date ? formatDateReadable(note.entry_date).toLowerCase() : '';
      const tags = (note.tags || []).map((t) => t.toLowerCase());
      const content = (note.content || '').toLowerCase();

      if (title.includes(query) || entryDate.includes(query) || readableDate.includes(query)) {
        titleMatches.push(note);
      } else if (tags.some((t) => t.includes(query))) {
        tagMatches.push(note);
      } else if (content.includes(query)) {
        contentMatches.push(note);
      }
    }

    // Une os resultados mantendo estrita prioridade
    return [...titleMatches, ...tagMatches, ...contentMatches];
  }, [allNotes, currentNoteId, searchQuery]);

  // Índice seguro derivado para seleção
  const safeSelectedIndex = Math.min(selectedIndex, Math.max(0, filteredNotes.length - 1));

  // Navegação por teclado
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filteredNotes.length - 1 ? prev + 1 : prev));
      scrollSelectedIntoView(safeSelectedIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      scrollSelectedIntoView(safeSelectedIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filteredNotes[safeSelectedIndex];
      if (target) {
        onSelectNote(target);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const scrollSelectedIntoView = (index: number) => {
    if (!listRef.current) return;
    const elements = listRef.current.querySelectorAll('[data-note-item]');
    const el = elements[index] as HTMLElement | undefined;
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="internal-note-reference-backdrop"
      className="fixed inset-0 z-[10000] bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-100 font-sans-ui"
      onClick={onClose}
    >
      <div
        id="internal-note-reference-modal"
        className="bg-[#ffffff] border border-[#e4e2dd] rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Cabeçalho do Seletor */}
        <div className="p-4 sm:p-5 border-b border-[#eae8e3] flex items-center justify-between gap-3 bg-[#fbfaf8]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#68594d]/10 text-[#68594d] flex items-center justify-center shrink-0">
              <Search className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-serif-note font-bold text-base text-[#1b1c19] truncate">
                Referenciar Nota
              </h3>
              {selectedText ? (
                <p className="text-xs text-[#7f756e] truncate">
                  Vincular &ldquo;<span className="font-medium text-[#4e453f]">{selectedText}</span>&rdquo; a:
                </p>
              ) : (
                <p className="text-xs text-[#7f756e]">Escolha a nota de destino</p>
              )}
            </div>
          </div>

          <button
            type="button"
            id="close-internal-reference-modal-btn"
            onClick={onClose}
            className="p-1.5 text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#f0eee9] rounded-xl transition-colors cursor-pointer shrink-0"
            title="Fechar (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Campo de Pesquisa */}
        <div className="p-3 sm:p-4 border-b border-[#eae8e3]">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-[#7f756e] absolute left-3.5 pointer-events-none" />
            <input
              ref={inputRef}
              id="internal-note-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Buscar por título, conteúdo ou tag..."
              className="w-full pl-9 pr-4 py-2.5 bg-[#fbf9f4] border border-[#e4e2dd] rounded-xl text-sm text-[#1b1c19] placeholder-[#7f756e] focus:outline-none focus:border-[#68594d] focus:ring-1 focus:ring-[#68594d] transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  inputRef.current?.focus();
                }}
                className="absolute right-3 p-1 text-[#7f756e] hover:text-[#1b1c19] rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Lista de Resultados */}
        <div
          ref={listRef}
          id="internal-note-results-list"
          className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-1 min-h-[220px] max-h-[380px]"
        >
          {isLoading ? (
            <div className="py-12 text-center text-xs text-[#7f756e]">
              Carregando notas...
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="py-12 text-center space-y-1.5">
              <p className="font-serif-note text-sm text-[#4e453f] font-medium">
                Nenhuma nota encontrada
              </p>
              <p className="text-xs text-[#7f756e]">
                {searchQuery ? 'Tente buscar com outros termos.' : 'Crie outras notas para poder referenciá-las.'}
              </p>
            </div>
          ) : (
            filteredNotes.map((note, idx) => {
              const isDiary = isDiaryNote(note, allFolders);
              const isSelected = idx === safeSelectedIndex;

              // Contexto visual da nota (ex: "Notes / Estudos" ou "Diário / Setembro 2026")
              let contextLabel = 'Notes';
              if (isDiary) {
                if (note.entry_date) {
                  const parts = note.entry_date.split('-');
                  if (parts.length === 3) {
                    const y = parts[0];
                    const m = parseInt(parts[1], 10);
                    const monthNames = [
                      'Janeiro',
                      'Fevereiro',
                      'Março',
                      'Abril',
                      'Maio',
                      'Junho',
                      'Julho',
                      'Agosto',
                      'Setembro',
                      'Outubro',
                      'Novembro',
                      'Dezembro',
                    ];
                    contextLabel = `Diário / ${monthNames[m - 1] || ''} ${y}`;
                  } else {
                    contextLabel = 'Diário';
                  }
                } else {
                  contextLabel = 'Diário';
                }
              } else if (note.folder_id && folderMap.has(note.folder_id)) {
                contextLabel = `Notes / ${folderMap.get(note.folder_id)?.name || 'Pasta'}`;
              }

              const displayTitle = isDiary
                ? note.title && note.title !== 'Sem título' && note.title !== 'Sem Título'
                  ? note.title
                  : note.entry_date
                  ? formatDateReadable(note.entry_date)
                  : 'Entrada do Diário'
                : note.title || 'Sem título';

              return (
                <div
                  key={note.id}
                  data-note-item
                  data-selected={isSelected}
                  onClick={() => onSelectNote(note)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full p-2.5 sm:p-3 rounded-2xl flex items-center justify-between gap-3 text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#f4dfcb]/60 border border-[#e8d2bd] shadow-2xs'
                      : 'hover:bg-[#fbf9f4] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isDiary
                          ? 'bg-[#f4dfcb] text-[#68594d]'
                          : 'bg-[#f0eee9] text-[#4e453f]'
                      }`}
                    >
                      {isDiary ? (
                        <Calendar className="w-4 h-4 stroke-[1.75]" />
                      ) : (
                        <FileText className="w-4 h-4 stroke-[1.75]" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-serif-note font-semibold text-sm text-[#1b1c19] truncate">
                          {displayTitle}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[#7f756e] mt-0.5 truncate">
                        <span className="font-medium text-[#68594d]">{contextLabel}</span>
                        {note.tags && note.tags.length > 0 && (
                          <>
                            <span>•</span>
                            <span className="truncate opacity-80">
                              {note.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-1.5 text-xs text-[#7f756e]">
                    {isSelected ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#68594d] text-white font-medium text-[11px] shadow-2xs">
                        <span>Escolher</span>
                        <CornerDownLeft className="w-3 h-3" />
                      </span>
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5 text-[#d1c4bc] opacity-0 sm:opacity-100" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Rodapé com Dica de Teclado */}
        <div className="p-3 bg-[#fbfaf8] border-t border-[#eae8e3] flex items-center justify-between text-[11px] text-[#7f756e] select-none">
          <div className="flex items-center gap-2">
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-white border border-[#e4e2dd] font-mono text-[10px]">
                ↑
              </kbd>{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-white border border-[#e4e2dd] font-mono text-[10px]">
                ↓
              </kbd>{' '}
              Navegar
            </span>
            <span>•</span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-white border border-[#e4e2dd] font-mono text-[10px]">
                Enter
              </kbd>{' '}
              Selecionar
            </span>
          </div>
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-white border border-[#e4e2dd] font-mono text-[10px]">
              Esc
            </kbd>{' '}
            Cancelar
          </span>
        </div>
      </div>
    </div>
  );
}
