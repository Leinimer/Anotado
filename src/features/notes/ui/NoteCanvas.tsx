'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Menu,
  FilePlus,
  FileText,
  Minus,
  Plus,
  Search,
} from 'lucide-react';
import { Editor } from '@tiptap/react';
import { Note as NoteType } from '../types';
import { NoteEditor } from './NoteEditor';
import { EditorToolbar } from './EditorToolbar';
import { NoteTagsBar } from './NoteTagsBar';

interface NoteCanvasProps {
  activeNote: NoteType | null;
  onUpdateTitle: (noteId: string, newTitle: string) => void;
  onUpdateContent: (noteId: string, newContent: string) => void;
  onUpdateTags: (noteId: string, newTags: string[]) => void;
  onDeleteNote?: (noteId: string) => void;
  onCreateNewNote: () => void;
  onOpenMobileMenu?: () => void;
  isNewNoteJustCreated?: boolean;
}

export function NoteCanvas({
  activeNote,
  onUpdateTitle,
  onUpdateContent,
  onUpdateTags,
  onCreateNewNote,
  onOpenMobileMenu,
  isNewNoteJustCreated = false,
}: NoteCanvasProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(isNewNoteJustCreated);
  const [localTitle, setLocalTitle] = useState(activeNote?.title || '');
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);

  // Zoom da folha da nota persistido localmente
  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('anotado_note_zoom');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 50 && parsed <= 200) return parsed;
      }
    }
    return 100;
  });

  // Estado de visibilidade dos controles de zoom (Lupa)
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const [isZoomHovered, setIsZoomHovered] = useState(false);
  const zoomHoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const zoomContainerRef = useRef<HTMLDivElement>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastPendingContentRef = useRef<string | null>(null);
  const activeNoteIdRef = useRef<string | null>(activeNote?.id || null);

  useEffect(() => {
    activeNoteIdRef.current = activeNote?.id || null;
  }, [activeNote?.id]);

  // Função central para forçar o envio do conteúdo pendente no debounce imediatamente
  const flushPendingContent = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (lastPendingContentRef.current !== null && activeNoteIdRef.current) {
      const contentToSave = lastPendingContentRef.current;
      lastPendingContentRef.current = null;
      onUpdateContent(activeNoteIdRef.current, contentToSave);
    }
  }, [onUpdateContent]);

  // Flush ao desmontar ou trocar de nota
  useEffect(() => {
    return () => {
      flushPendingContent();
    };
  }, [flushPendingContent]);

  // Proteção auxiliar: flush imediato ao trocar de aba ou fechar janela
  useEffect(() => {
    const handleVisibilityOrPageHide = () => {
      flushPendingContent();
    };
    document.addEventListener('visibilitychange', handleVisibilityOrPageHide);
    window.addEventListener('pagehide', handleVisibilityOrPageHide);
    window.addEventListener('beforeunload', handleVisibilityOrPageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrPageHide);
      window.removeEventListener('pagehide', handleVisibilityOrPageHide);
      window.removeEventListener('beforeunload', handleVisibilityOrPageHide);
    };
  }, [flushPendingContent]);

  // Foco no input do título ao iniciar edição
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Controles de zoom (50% até 200% em passos de 10%)
  const handleZoomIn = () => {
    setZoomLevel((prev) => {
      const next = Math.min(200, prev + 10);
      if (typeof window !== 'undefined') localStorage.setItem('anotado_note_zoom', next.toString());
      return next;
    });
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => {
      const next = Math.max(50, prev - 10);
      if (typeof window !== 'undefined') localStorage.setItem('anotado_note_zoom', next.toString());
      return next;
    });
  };

  const handleResetZoom = () => {
    setZoomLevel(100);
    if (typeof window !== 'undefined') localStorage.setItem('anotado_note_zoom', '100');
  };

  // Hover handlers para Desktop com bridge de tolerância para evitar flicker
  const handleZoomMouseEnter = () => {
    if (zoomHoverTimerRef.current) {
      clearTimeout(zoomHoverTimerRef.current);
      zoomHoverTimerRef.current = null;
    }
    setIsZoomHovered(true);
  };

  const handleZoomMouseLeave = () => {
    zoomHoverTimerRef.current = setTimeout(() => {
      setIsZoomHovered(false);
    }, 250);
  };

  // Fechar controles de zoom ao clicar/tocar fora (Mobile/Tablet & Desktop)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (zoomContainerRef.current && !zoomContainerRef.current.contains(e.target as Node)) {
        setIsZoomOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      if (zoomHoverTimerRef.current) clearTimeout(zoomHoverTimerRef.current);
    };
  }, []);

  // Salva o título ao concluir edição
  const handleSaveTitle = useCallback(() => {
    if (!activeNote) return;
    const trimmed = localTitle.trim();
    const finalTitle = trimmed || 'Sem título';
    setLocalTitle(finalTitle);
    setIsEditingTitle(false);
    if (finalTitle !== activeNote.title) {
      onUpdateTitle(activeNote.id, finalTitle);
    }
  }, [activeNote, localTitle, onUpdateTitle]);

  // Handler de alteração no editor Tiptap com debounce de 400ms e rastreamento de pendência
  const handleEditorChange = useCallback(
    (htmlContent: string) => {
      if (!activeNote) return;

      lastPendingContentRef.current = htmlContent;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        lastPendingContentRef.current = null;
        onUpdateContent(activeNote.id, htmlContent);
      }, 400);
    },
    [activeNote, onUpdateContent]
  );

  // Estado Vazio: Nenhuma nota selecionada
  if (!activeNote) {
    return (
      <main
        id="main-note-workspace"
        className="flex-1 flex flex-col h-full bg-[#fbf9f4] items-center justify-center p-6 text-center select-none relative"
      >
        {onOpenMobileMenu && (
          <div className="absolute left-4 top-3.5 flex items-center md:hidden">
            <button
              id="empty-state-mobile-menu-btn"
              onClick={onOpenMobileMenu}
              className="p-2 text-[#4e453f] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-lg transition-colors cursor-pointer"
              aria-label="Abrir Menu Lateral"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        )}

        <div className="max-w-md space-y-4">
          <div className="w-16 h-16 rounded-full bg-[#e4e2dd] text-[#68594d] mx-auto flex items-center justify-center">
            <FileText className="w-8 h-8 stroke-[1.5]" />
          </div>
          <h2 className="font-serif-note font-bold text-2xl text-[#1b1c19]">
            Nenhuma nota selecionada
          </h2>
          <p className="font-sans-ui text-sm text-[#7f756e] leading-relaxed">
            Selecione uma nota na barra lateral para começar a ler ou editar, ou crie uma nova anotação agora.
          </p>
          <div className="pt-2">
            <button
              id="empty-state-new-note-btn"
              onClick={onCreateNewNote}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#68594d] text-white rounded-xl text-xs font-sans-ui font-medium hover:bg-[#53463c] transition-colors cursor-pointer shadow-xs"
            >
              <FilePlus className="w-4 h-4" />
              <span>Criar Nova Nota</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  const showZoomControls = isZoomHovered || isZoomOpen;

  return (
    <main
      id="main-note-workspace"
      className="flex-1 flex flex-col h-full overflow-hidden bg-[#fbf9f4] relative"
    >
      {/* Top Header Bar (Título centralizado horizontalmente na área principal) */}
      <header
        id="note-header-bar"
        className="w-full px-4 sm:px-8 pt-3 sm:pt-3.5 pb-3 relative flex items-center justify-center border-b border-[#eae8e3]/80 shrink-0 select-none bg-[#fbf9f4]/90 backdrop-blur-xs z-10"
      >
        {onOpenMobileMenu && (
          <div className="absolute left-4 sm:left-6 top-3 sm:top-3.5 flex items-center md:hidden">
            <button
              id="header-mobile-menu-btn"
              onClick={onOpenMobileMenu}
              className="p-2 text-[#4e453f] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-lg transition-colors cursor-pointer"
              aria-label="Abrir Menu Lateral"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Note Title (Centralizado horizontalmente em relação à área principal) */}
        <div className="w-full max-w-[850px] mx-auto text-center px-10 min-w-0">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              id="header-title-input"
              type="text"
              value={localTitle}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') {
                  setLocalTitle(activeNote.title);
                  setIsEditingTitle(false);
                }
              }}
              onChange={(e) => setLocalTitle(e.target.value)}
              className="font-serif-note font-bold text-xl sm:text-2xl md:text-3xl text-[#1b1c19] bg-transparent text-center border-b border-[#68594d] focus:outline-none w-full max-w-lg mx-auto"
              placeholder="Título da anotação..."
            />
          ) : (
            <h1
              id="header-note-title"
              onClick={() => setIsEditingTitle(true)}
              className="font-serif-note font-bold text-xl sm:text-2xl md:text-3xl text-[#1b1c19] cursor-pointer hover:opacity-80 transition-opacity tracking-tight truncate inline-block max-w-full"
              title="Clique para editar o título"
            >
              {localTitle || 'Sem título'}
            </h1>
          )}
        </div>
      </header>

      {/* Região de Gerenciamento de Tags (Abaixo da linha divisória do título e acima do corpo da nota) */}
      <div id="note-tags-section-wrapper" className="w-full shrink-0 pt-2 pb-1 bg-[#fbf9f4]">
        <NoteTagsBar
          tags={activeNote.tags || []}
          onUpdateTags={(newTags) => onUpdateTags(activeNote.id, newTags)}
        />
      </div>

      {/* Note Canvas Sheet Area com Zoom da Folha (Papyrus & Ink) */}
      <div
        id="note-scroll-container"
        className="flex-1 overflow-y-auto px-3 sm:px-6 md:px-12 py-4 sm:py-6 flex justify-center items-start"
      >
        <article
          id="note-paper-sheet"
          style={{
            transform: `scale(${zoomLevel / 100})`,
            transformOrigin: 'top center',
            transition: 'transform 0.15s ease-out',
          }}
          className="paper-sheet rounded-2xl w-full max-w-[850px] p-6 sm:p-10 md:p-12 text-[#1b1c19] font-serif-note shadow-sm relative flex flex-col min-h-[550px] h-auto mb-12"
        >
          <NoteEditor
            key={activeNote.id}
            noteId={activeNote.id}
            content={activeNote.content}
            onChange={handleEditorChange}
            onEditorReady={setEditorInstance}
          />
        </article>
      </div>

      {/* Controles de Zoom Discretos com Lupa no Canto Inferior Direito */}
      <div
        ref={zoomContainerRef}
        id="note-zoom-wrapper"
        onMouseEnter={handleZoomMouseEnter}
        onMouseLeave={handleZoomMouseLeave}
        className="absolute bottom-16 sm:bottom-16 right-4 sm:right-6 z-20 flex flex-col items-end gap-1.5 select-none"
      >
        {/* Caixa Flutuante dos Controles de Zoom (- 100% +) */}
        <div
          id="note-zoom-expanded-controls"
          className={`transition-all duration-200 ease-out origin-bottom-right flex items-center bg-[#ffffff]/95 backdrop-blur-md border border-[#e4e2dd] shadow-md rounded-xl p-1 gap-1 text-[#4e453f] font-sans-ui text-xs ${
            showZoomControls
              ? 'opacity-100 scale-100 pointer-events-auto translate-y-0'
              : 'opacity-0 scale-90 pointer-events-none translate-y-2'
          }`}
        >
          <button
            type="button"
            id="note-zoom-out-btn"
            onClick={handleZoomOut}
            disabled={zoomLevel <= 50}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#f0eee9] hover:text-[#1b1c19] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
            title="Diminuir zoom (-10%)"
            aria-label="Diminuir zoom"
          >
            <Minus className="w-3.5 h-3.5 stroke-[2.25]" />
          </button>

          <button
            type="button"
            id="note-zoom-reset-btn"
            onClick={handleResetZoom}
            className="px-2 py-1 rounded-lg hover:bg-[#f0eee9] text-xs font-semibold text-[#1b1c19] tabular-nums transition-colors cursor-pointer"
            title="Restaurar zoom original (100%)"
            aria-label="Restaurar zoom"
          >
            {zoomLevel}%
          </button>

          <button
            type="button"
            id="note-zoom-in-btn"
            onClick={handleZoomIn}
            disabled={zoomLevel >= 200}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#f0eee9] hover:text-[#1b1c19] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
            title="Aumentar zoom (+10%)"
            aria-label="Aumentar zoom"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.25]" />
          </button>
        </div>

        {/* Botão de Lupa (Discreto) */}
        <button
          type="button"
          id="note-zoom-trigger-btn"
          onClick={() => setIsZoomOpen((prev) => !prev)}
          className={`w-8 h-8 rounded-xl flex items-center justify-center bg-[#ffffff]/90 hover:bg-[#ffffff] text-[#68594d] hover:text-[#1b1c19] border border-[#e4e2dd] shadow-xs backdrop-blur-md transition-all cursor-pointer ${
            showZoomControls ? 'ring-2 ring-[#68594d]/30 text-[#1b1c19] bg-[#ffffff]' : ''
          }`}
          title="Ajustar zoom da folha"
          aria-label="Ajustar zoom da folha"
        >
          <Search className="w-4 h-4 stroke-[2]" />
        </button>
      </div>

      {/* Barra de Ferramentas Rica no Rodapé */}
      <EditorToolbar editor={editorInstance} />
    </main>
  );
}
