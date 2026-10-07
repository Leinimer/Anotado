'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Menu,
  FilePlus,
  FileText,
  Minus,
  Plus,
  Search,
  Calendar,
} from 'lucide-react';
import { Editor } from '@tiptap/react';
import { Note as NoteType } from '../types';
import { NoteEditor } from './NoteEditor';
import { EditorToolbar } from './EditorToolbar';
import { NoteTagsBar } from './NoteTagsBar';
import { formatDateReadable } from '../utils/diary-date';
import { InternalNoteReferenceModal } from './InternalNoteReferenceModal';
import { ExtendedNote } from '../db/indexed-db';
import { NoteTabs, NoteTabItem } from './NoteTabs';
import { NoteEditorPanel } from './NoteEditorPanel';
import {
  getInternalNavigationContext,
  returnToSourceNote,
  executeInternalNoteNavigation,
  InternalNavigationContext,
} from '../utils/internal-note-navigation';
import { getBacklinks } from '../utils/knowledge-graph';

interface NoteCanvasProps {
  activeNote: NoteType | null;
  userId?: string;
  onUpdateTitle: (noteId: string, newTitle: string) => void;
  onUpdateContent: (noteId: string, newContent: string) => void;
  onUpdateTags: (noteId: string, newTags: string[]) => void;
  onDeleteNote?: (noteId: string) => void;
  onCreateNewNote: () => void;
  onOpenMobileMenu?: () => void;
  isNewNoteJustCreated?: boolean;
  readOnly?: boolean;
  currentWorkspace?: 'notes' | 'diary';
  onSelectNote?: (noteId: string) => void;
  tabs?: NoteTabItem[];
  activeTabId?: string | null;
  notes?: NoteType[];
  onSelectTab?: (tabId: string) => void;
  onCloseTab?: (tabId: string) => void;
  onNewTab?: () => void;
  isSplit?: boolean;
  splitLeftTabId?: string | null;
  splitRightTabId?: string | null;
  splitLeftNote?: NoteType | null;
  splitRightNote?: NoteType | null;
  activeSplitPane?: 'left' | 'right';
  onFocusSplitPane?: (pane: 'left' | 'right') => void;
  onSplitTab?: (tabId: string) => void;
  onUnsplitTab?: (tabId?: string) => void;
  onSwapSplitPanes?: () => void;
  notePathLabel?: string;
}

export function NoteCanvas({
  activeNote,
  userId,
  onUpdateTitle,
  onUpdateContent,
  onUpdateTags,
  onCreateNewNote,
  onOpenMobileMenu,
  isNewNoteJustCreated = false,
  readOnly = false,
  currentWorkspace,
  onSelectNote,
  tabs,
  activeTabId,
  notes,
  onSelectTab,
  onCloseTab,
  onNewTab,
  isSplit = false,
  splitLeftTabId = null,
  splitRightTabId = null,
  splitLeftNote = null,
  splitRightNote = null,
  activeSplitPane = 'left',
  onFocusSplitPane,
  onSplitTab,
  onUnsplitTab,
  onSwapSplitPanes,
  notePathLabel = '',
}: NoteCanvasProps) {
  const router = useRouter();
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [leftEditorInstance, setLeftEditorInstance] = useState<Editor | null>(null);
  const [rightEditorInstance, setRightEditorInstance] = useState<Editor | null>(null);

  // Estados de Referência Interna e Navegação de Retorno
  const [navContext, setNavContext] = useState<InternalNavigationContext | null>(() =>
    getInternalNavigationContext()
  );
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState(false);
  const [referenceSelectedText, setReferenceSelectedText] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Workspace efetivo atual
  const effectiveWorkspace: 'notes' | 'diary' =
    currentWorkspace ||
    (activeNote?.workspace_type === 'diary' ||
    Boolean(activeNote?.entry_date) ||
    Boolean(activeNote?.diary_year)
      ? 'diary'
      : 'notes');

  // Monitora alterações no contexto de navegação interna (sessionStorage)
  useEffect(() => {
    const handleNavChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ context: InternalNavigationContext | null }>;
      setNavContext(customEvent.detail?.context || null);
    };
    window.addEventListener('anotado:internal-nav-changed', handleNavChange);
    return () => window.removeEventListener('anotado:internal-nav-changed', handleNavChange);
  }, []);

  // Ouve evento para abrir modal de seleção de referência de nota
  useEffect(() => {
    const handleOpenRefModal = () => {
      if (!editorInstance) return;
      const { from, to, empty } = editorInstance.state.selection;
      if (empty) return;
      const text = editorInstance.state.doc.textBetween(from, to, ' ');
      setReferenceSelectedText(text);
      setIsReferenceModalOpen(true);
    };

    window.addEventListener('anotado:open-reference-modal', handleOpenRefModal);
    return () => window.removeEventListener('anotado:open-reference-modal', handleOpenRefModal);
  }, [editorInstance]);

  // Ouve cliques em links de referência interna no editor para executar navegação com preservação de contexto
  useEffect(() => {
    const handleNavigate = async (e: Event) => {
      const customEvent = e as CustomEvent<{ noteId: string }>;
      const targetNoteId = customEvent.detail?.noteId;
      if (!targetNoteId) return;

      const effectiveUserId = userId || activeNote?.user_id || 'demo-user';
      await executeInternalNoteNavigation(
        targetNoteId,
        effectiveUserId,
        activeNote,
        effectiveWorkspace,
        router,
        onSelectNote
      );
    };

    window.addEventListener('anotado:navigate-internal-note', handleNavigate);
    return () => window.removeEventListener('anotado:navigate-internal-note', handleNavigate);
  }, [activeNote, effectiveWorkspace, onSelectNote, router, userId]);

  // Ouve avisos de toast gerais
  useEffect(() => {
    const handleToast = (e: Event) => {
      const customEvent = e as CustomEvent<{ message: string }>;
      if (customEvent.detail?.message) {
        setToastMessage(customEvent.detail.message);
        setTimeout(() => setToastMessage(null), 3500);
      }
    };
    window.addEventListener('anotado:toast-warning', handleToast);
    return () => window.removeEventListener('anotado:toast-warning', handleToast);
  }, []);

  // Aplica a referência interna escolhida ao texto selecionado
  const handleApplyInternalReference = (targetNote: ExtendedNote) => {
    if (!editorInstance) return;
    editorInstance
      .chain()
      .focus()
      .setInternalNoteLink({ noteId: targetNote.id })
      .run();
    setIsReferenceModalOpen(false);
  };

  // Retorna à nota de origem
  const handleReturnToSource = async () => {
    await returnToSourceNote(router, effectiveWorkspace, onSelectNote);
  };

  // O botão "Voltar..." só deve aparecer se a nota ativa foi aberta através de uma referência interna
  const shouldShowReturnButton = Boolean(navContext && navContext.targetNoteId === activeNote?.id);

  const returnButtonLabel =
    navContext?.sourceWorkspace === 'diary'
      ? 'Voltar ao Diário'
      : navContext?.sourceWorkspace === 'notes'
      ? 'Voltar às Notas'
      : 'Voltar';

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

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastPendingContentRef = useRef<string | null>(null);
  const activeNoteIdRef = useRef<string | null>(activeNote?.id || null);

  useEffect(() => {
    activeNoteIdRef.current = activeNote?.id || null;
  }, [activeNote?.id]);

  // Posiciona o cursor no conteúdo e foca para digitação imediata ao criar nova nota
  useEffect(() => {
    if (isNewNoteJustCreated && editorInstance && !editorInstance.isDestroyed) {
      const timer = setTimeout(() => {
        try {
          editorInstance.commands.focus('end');
        } catch {}
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [isNewNoteJustCreated, editorInstance]);

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

  // Estado Vazio: Nenhuma nota selecionada
  if (!activeNote) {
    return (
      <main
        id="main-note-workspace"
        className="flex-1 flex flex-col h-full bg-[#fbf9f4] dark:bg-[#000000] select-none relative overflow-hidden"
      >
        {/* Barra Superior da Área de Edição */}
        <header
          id="editor-top-bar"
          className="w-full px-4 sm:px-6 h-9 flex items-center justify-between border-b border-[#eae8e3]/80 dark:border-[#1a1a1a] bg-[#fbf9f4] dark:bg-[#000000] shrink-0 select-none z-20"
        >
          <div className="flex items-center gap-2">
            {onOpenMobileMenu && (
              <button
                id="empty-state-mobile-menu-btn"
                onClick={onOpenMobileMenu}
                className="p-1.5 text-[#4e453f] hover:text-[#1b1c19] hover:bg-[#eae8e3] dark:text-[#a1a1aa] dark:hover:text-white dark:hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer md:hidden"
                aria-label="Abrir Menu Lateral"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}
            <span className="text-[11px] font-sans-ui font-semibold text-[#8c7e72] dark:text-[#737373] tracking-wider uppercase">
              {effectiveWorkspace === 'diary' ? 'Diário' : 'Notas'}
            </span>
          </div>
        </header>

        {/* Sistema de Abas (Visível mesmo no estado vazio se houver abas ou para criar nova via +) */}
        {tabs && onSelectTab && onCloseTab && onNewTab && (
          <NoteTabs
            tabs={tabs}
            activeTabId={activeTabId || null}
            notes={notes || []}
            onSelectTab={onSelectTab}
            onCloseTab={onCloseTab}
            onNewTab={onNewTab}
            isSplit={isSplit}
            splitLeftTabId={splitLeftTabId}
            splitRightTabId={splitRightTabId}
            activeSplitPane={activeSplitPane}
            onSplitTab={onSplitTab}
            onUnsplitTab={onUnsplitTab}
            onSwapSplitPanes={onSwapSplitPanes}
          />
        )}

        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md space-y-4">
            <div className="w-16 h-16 rounded-full bg-[#e4e2dd] dark:bg-[#141414] text-[#68594d] dark:text-[#a1a1aa] mx-auto flex items-center justify-center">
              <FileText className="w-8 h-8 stroke-[1.5]" />
            </div>
            <h2 className="font-serif-note font-bold text-2xl text-[#1b1c19] dark:text-[#ffffff]">
              {readOnly ? 'Nenhuma entrada selecionada' : 'Nenhuma nota selecionada'}
            </h2>
            <p className="font-sans-ui text-sm text-[#7f756e] dark:text-[#a1a1aa] leading-relaxed">
              {readOnly
                ? 'Selecione uma entrada no menu lateral para visualizar seu conteúdo.'
                : 'Selecione uma nota na barra lateral para começar a ler ou editar, ou crie uma nova anotação agora.'}
            </p>
            {!readOnly && (
              <div className="pt-2">
                <button
                  id="empty-state-new-note-btn"
                  onClick={onNewTab || onCreateNewNote}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#68594d] dark:bg-[#2e2620] dark:border dark:border-[#4a3b2c] text-white rounded-xl text-xs font-sans-ui font-medium hover:bg-[#53463c] dark:hover:bg-[#3d3229] transition-colors cursor-pointer shadow-xs"
                >
                  <FilePlus className="w-4 h-4" />
                  <span>Criar Nova Nota</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  const backlinksForNote = useCallback(
    (note: NoteType | null) => {
      if (!note || !notes) return [];
      return getBacklinks(note.id, notes);
    },
    [notes]
  );

  const handleOpenBacklink = useCallback(
    (noteId: string, workspace: 'notes' | 'diary') => {
      if (workspace === effectiveWorkspace) {
        onSelectNote?.(noteId);
        return;
      }
      router.push(workspace === 'diary' ? '/diary' : '/notes');
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('anotado:open-note', {
            detail: { noteId, workspace },
          })
        );
      }, 250);
    },
    [effectiveWorkspace, onSelectNote, router]
  );

  const showZoomControls = isZoomHovered || isZoomOpen;

  return (
    <main
      id="main-note-workspace"
      className="flex-1 flex flex-col h-full overflow-hidden bg-[#fbf9f4] dark:bg-[#000000] relative"
    >
      {/* 1. Barra Superior da Área de Edição */}
      <header
        id="editor-top-bar"
        className="w-full px-4 sm:px-6 h-9 flex items-center justify-between border-b border-[#eae8e3]/80 dark:border-[#1a1a1a] bg-[#fbf9f4] dark:bg-[#000000] shrink-0 select-none z-20"
      >
        <div className="flex items-center gap-2">
          {onOpenMobileMenu && (
            <button
              id="header-mobile-menu-btn"
              onClick={onOpenMobileMenu}
              className="p-1.5 text-[#4e453f] hover:text-[#1b1c19] hover:bg-[#eae8e3] dark:text-[#a1a1aa] dark:hover:text-white dark:hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer md:hidden"
              aria-label="Abrir Menu Lateral"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}
          <span className="text-[11px] font-sans-ui font-semibold text-[#8c7e72] dark:text-[#737373] tracking-wider uppercase">
            {effectiveWorkspace === 'diary' ? 'Diário' : 'Notas'}
          </span>
        </div>


      </header>

      {/* 2. SISTEMA DE ABAS (Logo abaixo da barra superior e acima do título da nota) */}
      {tabs && onSelectTab && onCloseTab && onNewTab && (
        <NoteTabs
          tabs={tabs}
          activeTabId={activeTabId || null}
          notes={notes || []}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
          onNewTab={onNewTab}
          isSplit={isSplit}
          splitLeftTabId={splitLeftTabId}
          splitRightTabId={splitRightTabId}
          activeSplitPane={activeSplitPane}
          onSplitTab={onSplitTab}
          onUnsplitTab={onUnsplitTab}
          onSwapSplitPanes={onSwapSplitPanes}
        />
      )}

      {/* 3. Área de Edição: Painel Único ou Divisão Vertical em Dois Painéis */}
      {isSplit && splitLeftNote && splitRightNote ? (
        <div
          id="split-editor-workspace"
          className="flex-1 flex flex-col md:flex-row overflow-hidden relative divide-y md:divide-y-0 md:divide-x divide-[#eae8e3] dark:divide-[#1f1f1f]"
        >
          {/* Painel Esquerdo */}
          <NoteEditorPanel
            key={`panel-left-${splitLeftNote.id}`}
            note={splitLeftNote}
            userId={userId}
            readOnly={readOnly}
            isSplit={true}
            paneSide="left"
            isActivePane={activeSplitPane === 'left'}
            onFocusPane={() => onFocusSplitPane?.('left')}
            onUnsplit={() => onUnsplitTab?.(splitLeftTabId || undefined)}
            onUpdateTitle={onUpdateTitle}
            onUpdateContent={onUpdateContent}
            onUpdateTags={onUpdateTags}
            onEditorReady={setLeftEditorInstance}
            zoomLevel={zoomLevel}
            notePathLabel={notePathLabel ? notePathLabel : ''}
            shouldShowReturnButton={shouldShowReturnButton && splitLeftNote.id === activeNote.id}
            returnButtonLabel={returnButtonLabel}
            onReturnToSource={handleReturnToSource}
            backlinks={backlinksForNote(splitLeftNote)}
            onOpenBacklink={handleOpenBacklink}
          />

          {/* Painel Direito */}
          <NoteEditorPanel
            key={`panel-right-${splitRightNote.id}`}
            note={splitRightNote}
            userId={userId}
            readOnly={readOnly}
            isSplit={true}
            paneSide="right"
            isActivePane={activeSplitPane === 'right'}
            onFocusPane={() => onFocusSplitPane?.('right')}
            onUnsplit={() => onUnsplitTab?.(splitRightTabId || undefined)}
            onUpdateTitle={onUpdateTitle}
            onUpdateContent={onUpdateContent}
            onUpdateTags={onUpdateTags}
            onEditorReady={setRightEditorInstance}
            zoomLevel={zoomLevel}
            notePathLabel={notePathLabel ? notePathLabel : ''}
            shouldShowReturnButton={shouldShowReturnButton && splitRightNote.id === activeNote.id}
            returnButtonLabel={returnButtonLabel}
            onReturnToSource={handleReturnToSource}
            backlinks={backlinksForNote(splitRightNote)}
            onOpenBacklink={handleOpenBacklink}
          />
        </div>
      ) : (
        /* Modo Normal: Painel Único */
        <NoteEditorPanel
          key={`panel-single-${activeNote.id}`}
          note={activeNote}
          userId={userId}
          readOnly={readOnly}
          isSplit={false}
          onUpdateTitle={onUpdateTitle}
          onUpdateContent={onUpdateContent}
          onUpdateTags={onUpdateTags}
          onEditorReady={setEditorInstance}
          isNewNoteJustCreated={isNewNoteJustCreated}
          zoomLevel={zoomLevel}
          notePathLabel={notePathLabel}
          shouldShowReturnButton={shouldShowReturnButton}
          returnButtonLabel={returnButtonLabel}
          onReturnToSource={handleReturnToSource}
          backlinks={backlinksForNote(activeNote)}
          onOpenBacklink={handleOpenBacklink}
        />
      )}

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
          className={`transition-all duration-200 ease-out origin-bottom-right flex items-center bg-[#ffffff]/95 dark:bg-[#0d0d0d]/95 backdrop-blur-md border border-[#e4e2dd] dark:border-[#222222] shadow-md rounded-xl p-1 gap-1 text-[#4e453f] dark:text-[#a1a1aa] font-sans-ui text-xs ${
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
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#f0eee9] hover:text-[#1b1c19] dark:hover:bg-[#1f1f1f] dark:hover:text-[#ffffff] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
            title="Diminuir zoom (-10%)"
            aria-label="Diminuir zoom"
          >
            <Minus className="w-3.5 h-3.5 stroke-[2.25]" />
          </button>

          <button
            type="button"
            id="note-zoom-reset-btn"
            onClick={handleResetZoom}
            className="px-2 py-1 rounded-lg hover:bg-[#f0eee9] dark:hover:bg-[#1f1f1f] text-xs font-semibold text-[#1b1c19] dark:text-[#ffffff] tabular-nums transition-colors cursor-pointer"
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
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#f0eee9] hover:text-[#1b1c19] dark:hover:bg-[#1f1f1f] dark:hover:text-[#ffffff] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
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
          className={`w-8 h-8 rounded-xl flex items-center justify-center bg-[#ffffff]/90 hover:bg-[#ffffff] text-[#68594d] hover:text-[#1b1c19] dark:bg-[#0d0d0d]/90 dark:hover:bg-[#1a1a1a] dark:text-[#a1a1aa] dark:hover:text-[#ffffff] border border-[#e4e2dd] dark:border-[#222222] shadow-xs backdrop-blur-md transition-all cursor-pointer ${
            showZoomControls ? 'ring-2 ring-[#68594d]/30 dark:ring-[#a1a1aa]/30 text-[#1b1c19] dark:text-[#ffffff] bg-[#ffffff] dark:bg-[#1a1a1a]' : ''
          }`}
          title="Ajustar zoom da folha"
          aria-label="Ajustar zoom da folha"
        >
          <Search className="w-4 h-4 stroke-[2]" />
        </button>
      </div>

      {/* Barra de Ferramentas Rica no Rodapé (Oculta em Modo Somente Leitura) */}
      {!readOnly && (
        <EditorToolbar
          editor={
            isSplit
              ? activeSplitPane === 'right'
                ? rightEditorInstance
                : leftEditorInstance
              : editorInstance
          }
          activeNoteId={
            isSplit
              ? (activeSplitPane === 'right' ? splitRightNote?.id : splitLeftNote?.id) || activeNote.id
              : activeNote.id
          }
          userId={userId || activeNote.user_id}
        />
      )}

      {/* Modal de Referência Interna de Notas */}
      <InternalNoteReferenceModal
        isOpen={isReferenceModalOpen}
        onClose={() => setIsReferenceModalOpen(false)}
        onSelectNote={handleApplyInternalReference}
        userId={userId || activeNote.user_id || 'demo-user'}
        currentNoteId={activeNote.id}
        selectedText={referenceSelectedText}
      />

      {/* Toast de Alerta */}
      {toastMessage && (
        <div
          id="canvas-toast-warning"
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[10000] bg-[#1b1c19] text-[#fbf9f4] px-4 py-2.5 rounded-2xl shadow-xl text-xs font-sans-ui flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200 pointer-events-none"
        >
          <span>{toastMessage}</span>
        </div>
      )}
    </main>
  );
}
