'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, StickyNote as StickyNoteIcon } from 'lucide-react';
import { AppHeader } from '@/src/features/core_layout/ui/AppHeader';
import {
  STICKY_DEFAULT_WIDTH,
  StickyNote,
  StickyNoteColorKey,
} from '../types';
import {
  createStickyNote,
  deleteStickyNote,
  fetchStickyNotes,
  getAuthenticatedStickyUser,
  updateStickyNote,
  UpdateStickyNotePatch,
} from '../api/sticky-notes-api';
import { StickyNoteCard, StickyEditorActions, StickyEditorAction } from './StickyNoteCard';
import { StickyNotesToolbar, StickySaveState } from './StickyNotesToolbar';
import { StickyNoteReferenceModal } from './StickyNoteReferenceModal';

const DEBOUNCE_MS = 450;

export function StickyNotesLayout() {
  const [userId, setUserId] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeColor, setActiveColor] = useState<StickyNoteColorKey>('yellow');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [newlyCreatedId, setNewlyCreatedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<StickySaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [referenceModalOpen, setReferenceModalOpen] = useState(false);
  const [referenceSelectedText, setReferenceSelectedText] = useState('');
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const boardScrollRef = useRef<HTMLDivElement>(null);
  const editorActionsRef = useRef<Map<string, StickyEditorActions>>(new Map());
  const pendingPatchesRef = useRef<Map<string, UpdateStickyNotePatch>>(new Map());
  const debounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const notesRef = useRef<StickyNote[]>(notes);
  const userIdRef = useRef<string>(userId);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const registerEditorActions = useCallback((noteId: string, actions: StickyEditorActions | null) => {
    if (actions) editorActionsRef.current.set(noteId, actions);
    else editorActionsRef.current.delete(noteId);
  }, []);
  const handleEditorFormat = useCallback((action: StickyEditorAction) => {
    if (selectedNoteId) editorActionsRef.current.get(selectedNoteId)?.format(action);
  }, [selectedNoteId]);
  const handleInsertNoteLink = useCallback(() => {
    if (!selectedNoteId) return;
    const selectedText = editorActionsRef.current.get(selectedNoteId)?.prepareNoteReference() || '';
    setReferenceSelectedText(selectedText);
    setReferenceModalOpen(true);
  }, [selectedNoteId]);
  const handleChooseReferencedNote = useCallback((target: { id: string; title: string; type: 'note' | 'sticky' | 'diary' }) => {
    if (selectedNoteId) editorActionsRef.current.get(selectedNoteId)?.insertNoteLink(target.id, target.title || 'Sem título', target.type);
    setReferenceModalOpen(false);
    setReferenceSelectedText('');
  }, [selectedNoteId]);
  const handleOpenLinkedNote = useCallback((id: string, type: 'note' | 'sticky' | 'diary') => {
    if (type === 'sticky') {
      sessionStorage.setItem('anotado_active_sticky_id', id);
      window.location.href = '/sticky-notes';
    } else if (type === 'diary') {
      sessionStorage.setItem('anotado_active_diary_id', id);
      window.location.href = '/diary';
    } else {
      sessionStorage.setItem('anotado_reference_notes_id', id);
      window.location.href = '/notes';
    }
  }, []);

  // Carrega usuário autenticado e notas adesivas do Supabase.
  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const authUser = await getAuthenticatedStickyUser();
        const uid = authUser?.userId || 'demo-user';
        const email = authUser?.email || '';

        if (!isMounted) return;
        setUserId(uid);
        setUserEmail(email);

        if (authUser?.userId) {
          const loaded = await fetchStickyNotes(authUser.userId);
          if (!isMounted) return;
          setNotes(loaded);
          const linkedStickyId = sessionStorage.getItem('anotado_active_sticky_id');
          if (linkedStickyId && loaded.some(note => note.id === linkedStickyId)) {
            setSelectedNoteId(linkedStickyId);
            sessionStorage.removeItem('anotado_active_sticky_id');
            requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('sticky-note-' + linkedStickyId)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })));
          }
        }
      } catch (error) {
        if (!isMounted) return;
        const message =
          error instanceof Error ? error.message : 'Erro ao carregar notas adesivas.';
        setLoadError(message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    init();

    return () => {
      isMounted = false;
    };
  }, []);

  const persistPatch = useCallback(async (noteId: string, patch: UpdateStickyNotePatch) => {
    const uid = userIdRef.current;
    if (!uid || uid === 'demo-user') return;

    setSaveState('saving');
    setSaveError(null);
    try {
      await updateStickyNote(uid, noteId, patch);
      setSaveState('saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao salvar alterações.';
      setSaveState('error');
      setSaveError(message);
    }
  }, []);

  const flushPendingPatches = useCallback(() => {
    debounceTimersRef.current.forEach((timer) => clearTimeout(timer));
    debounceTimersRef.current.clear();

    const entries = Array.from(pendingPatchesRef.current.entries());
    pendingPatchesRef.current.clear();

    for (const [noteId, patch] of entries) {
      void persistPatch(noteId, patch);
    }
  }, [persistPatch]);

  // Garante envio de alterações pendentes antes de sair da página.
  useEffect(() => {
    const handlePageHide = () => {
      flushPendingPatches();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      flushPendingPatches();
    };
  }, [flushPendingPatches]);

  const schedulePatch = useCallback(
    (noteId: string, patch: UpdateStickyNotePatch) => {
      const existing = pendingPatchesRef.current.get(noteId) || {};
      pendingPatchesRef.current.set(noteId, { ...existing, ...patch });

      const currentTimer = debounceTimersRef.current.get(noteId);
      if (currentTimer) clearTimeout(currentTimer);

      setSaveState('saving');
      setSaveError(null);

      const timer = setTimeout(() => {
        debounceTimersRef.current.delete(noteId);
        const queuedPatch = pendingPatchesRef.current.get(noteId);
        pendingPatchesRef.current.delete(noteId);
        if (queuedPatch) {
          void persistPatch(noteId, queuedPatch);
        }
      }, DEBOUNCE_MS);

      debounceTimersRef.current.set(noteId, timer);
    },
    [persistPatch]
  );

  const getNextZIndex = useCallback((list: StickyNote[]) => {
    let maxZ = 0;
    for (const item of list) {
      if (item.z_index > maxZ) maxZ = item.z_index;
    }
    return maxZ + 1;
  }, []);

  const handleSelectNote = useCallback(
    (noteId: string) => {
      setSelectedNoteId(noteId);

      const currentNotes = notesRef.current;
      const target = currentNotes.find((n) => n.id === noteId);
      if (!target) return;

      const maxZ = currentNotes.reduce((acc, item) => Math.max(acc, item.z_index), 0);
      if (target.z_index < maxZ || (currentNotes.length > 1 && target.z_index === maxZ && currentNotes.filter((n) => n.z_index === maxZ).length > 1)) {
        const nextZ = maxZ + 1;
        setNotes((prev) =>
          prev.map((item) => (item.id === noteId ? { ...item, z_index: nextZ } : item))
        );
        schedulePatch(noteId, { z_index: nextZ });
      }
    },
    [schedulePatch]
  );

  const handleCreateNote = useCallback(async () => {
    const uid = userIdRef.current || 'demo-user';
    const currentNotes = notesRef.current;
    const nextZ = getNextZIndex(currentNotes);

    // Posiciona em cascata visível na área atualmente rolada do painel.
    const viewport = boardScrollRef.current;
    const rect = viewport?.getBoundingClientRect();
    const cascade = (currentNotes.length % 7) * 28;
    const centerX = rect ? (rect.width / 2 - canvasPan.x) / canvasZoom : 320;
    const centerY = rect ? (rect.height / 2 - canvasPan.y) / canvasZoom : 240;
    const position_x = Math.max(12, Math.round(centerX - STICKY_DEFAULT_WIDTH / 2 + cascade));
    const position_y = Math.max(12, Math.round(centerY - 90 + cascade));

    setSaveState('saving');
    setSaveError(null);
    setLoadError(null);

    try {
      const created = await createStickyNote(uid, {
        title: '',
        content: '',
        color: activeColor,
        position_x,
        position_y,
        width_px: STICKY_DEFAULT_WIDTH,
        z_index: nextZ,
      });

      setNotes((prev) => [...prev, created]);
      setSelectedNoteId(created.id);
      setNewlyCreatedId(created.id);
      setSaveState(uid !== 'demo-user' ? 'saved' : 'idle');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao criar nota adesiva.';
      setSaveState('error');
      setSaveError(message);
    }
  }, [activeColor, getNextZIndex, canvasPan, canvasZoom]);

  const handleChangeTitle = useCallback(
    (noteId: string, title: string) => {
      setNotes((prev) =>
        prev.map((item) => (item.id === noteId ? { ...item, title } : item))
      );
      schedulePatch(noteId, { title });
    },
    [schedulePatch]
  );

  const handleChangeContent = useCallback(
    (noteId: string, content: string) => {
      setNotes((prev) =>
        prev.map((item) => (item.id === noteId ? { ...item, content } : item))
      );
      schedulePatch(noteId, { content });
    },
    [schedulePatch]
  );

  const handleChangeNoteColor = useCallback(
    (noteId: string, color: StickyNoteColorKey) => {
      setActiveColor(color);
      setNotes((prev) =>
        prev.map((item) => (item.id === noteId ? { ...item, color } : item))
      );
      void persistPatch(noteId, { color });
    },
    [persistPatch]
  );

  const handleToolbarSelectColor = useCallback(
    (color: StickyNoteColorKey) => {
      setActiveColor(color);
      if (selectedNoteId) {
        setNotes((prev) =>
          prev.map((item) => (item.id === selectedNoteId ? { ...item, color } : item))
        );
        void persistPatch(selectedNoteId, { color });
      }
    },
    [selectedNoteId, persistPatch]
  );

  const handleMoveLive = useCallback((noteId: string, x: number, y: number) => {
    setNotes((prev) =>
      prev.map((item) =>
        item.id === noteId ? { ...item, position_x: x, position_y: y } : item
      )
    );
  }, []);

  const handleMoveEnd = useCallback(
    (noteId: string, x: number, y: number) => {
      const target = notesRef.current.find((n) => n.id === noteId);
      void persistPatch(noteId, {
        position_x: x,
        position_y: y,
        z_index: target?.z_index,
      });
    },
    [persistPatch]
  );

  const handleResizeLive = useCallback((noteId: string, widthPx: number) => {
    setNotes((prev) =>
      prev.map((item) => (item.id === noteId ? { ...item, width_px: widthPx } : item))
    );
  }, []);

  const handleResizeEnd = useCallback(
    (noteId: string, widthPx: number) => {
      void persistPatch(noteId, { width_px: widthPx });
    },
    [persistPatch]
  );

  const handleDeleteNote = useCallback(async (noteId: string) => {
    const timer = debounceTimersRef.current.get(noteId);
    if (timer) {
      clearTimeout(timer);
      debounceTimersRef.current.delete(noteId);
    }
    pendingPatchesRef.current.delete(noteId);

    const snapshot = notesRef.current;
    setNotes((prev) => prev.filter((item) => item.id !== noteId));
    setSelectedNoteId((prev) => (prev === noteId ? null : prev));

    const uid = userIdRef.current;
    if (!uid || uid === 'demo-user') return;

    setSaveState('saving');
    setSaveError(null);
    try {
      await deleteStickyNote(uid, noteId);
      setSaveState('saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao excluir nota adesiva.';
      setNotes(snapshot);
      setSaveState('error');
      setSaveError(message);
    }
  }, []);

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) || null,
    [notes, selectedNoteId]
  );

  return (
    <div
      id="sticky-notes-app-container"
      className="flex flex-col h-screen w-screen min-h-0 min-w-0 overflow-hidden bg-[#f7f4ed] dark:bg-[#050505] font-sans-ui"
    >
      <AppHeader
        activeSection="sticky-notes"
        userId={userId}
        userEmail={userEmail}
        onBeforeNavigate={flushPendingPatches}
        toolbar={<StickyNotesToolbar
          activeColor={activeColor}
          selectedNoteColor={selectedNote?.color}
          hasSelectedNote={Boolean(selectedNote)}
          notesCount={notes.length}
          saveState={saveState}
          errorMessage={saveError}
          onCreateNote={handleCreateNote}
          onSelectColor={handleToolbarSelectColor}
          onFormat={handleEditorFormat}
          onInsertNoteLink={handleInsertNoteLink}
        />}
      />

      <StickyNoteReferenceModal isOpen={referenceModalOpen} onClose={() => setReferenceModalOpen(false)} onSelectTarget={handleChooseReferencedNote} userId={userId} selectedText={referenceSelectedText} />

      {/* Área livre do quadro de post-its, sem sidebar */}
      <main
        ref={boardScrollRef}
        id="sticky-notes-board-viewport"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          const isBackground = target === event.currentTarget || target.dataset.stickyCanvas === 'true';
          if (event.ctrlKey && isBackground && event.button === 0) {
            event.preventDefault();
            setSelectedNoteId(null);
            setIsPanning(true);
            const startX = event.clientX;
            const startY = event.clientY;
            const initial = canvasPan;
            const move = (pointer: PointerEvent) => {
              setCanvasPan({ x: initial.x + pointer.clientX - startX, y: initial.y + pointer.clientY - startY });
            };
            const finish = () => {
              setIsPanning(false);
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', finish);
              window.removeEventListener('pointercancel', finish);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', finish);
            window.addEventListener('pointercancel', finish);
            return;
          }
          if (isBackground) setSelectedNoteId(null);
        }}
        onWheel={(event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const pointerX = event.clientX - rect.left;
          const pointerY = event.clientY - rect.top;
          const nextZoom = Math.max(0.15, Math.min(2.5, canvasZoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
          const worldX = (pointerX - canvasPan.x) / canvasZoom;
          const worldY = (pointerY - canvasPan.y) / canvasZoom;
          setCanvasPan({ x: pointerX - worldX * nextZoom, y: pointerY - worldY * nextZoom });
          setCanvasZoom(nextZoom);
        }}
        className="flex-1 min-h-0 min-w-0 overflow-hidden relative bg-[#f7f4ed] dark:bg-[#050505] sticky-board-viewport"
        style={{
          backgroundSize: `${24 * canvasZoom}px ${24 * canvasZoom}px`,
          backgroundPosition: `${canvasPan.x}px ${canvasPan.y}px`,
          cursor: isPanning ? 'grabbing' : undefined,
        }}
      >
        <div
          data-sticky-canvas="true"
          style={{
            width: '100000px',
            height: '100000px',
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${canvasZoom})`,
            transformOrigin: '0 0',
          }}
          className="relative"
        >
          {isLoading ? (
            <div className="sticky inset-0 flex h-[calc(100vh-110px)] w-full items-center justify-center text-xs text-[#7f756e] dark:text-[#a1a1aa]">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span>Carregando Stick...</span>
            </div>
          ) : loadError ? (
            <div className="sticky inset-0 flex h-[calc(100vh-110px)] w-full items-center justify-center p-6">
              <div className="max-w-md rounded-2xl border border-[#e4d5c7] dark:border-[#3d2626] bg-white dark:bg-[#141010] p-5 text-center shadow-sm space-y-2">
                <p className="text-sm font-semibold text-[#ba1a1a] dark:text-[#fca5a5]">
                  Não foi possível carregar o Stick
                </p>
                <p className="text-xs text-[#68594d] dark:text-[#a1a1aa] leading-relaxed">
                  {loadError}
                </p>
              </div>
            </div>
          ) : notes.length === 0 ? (
            <div
              data-sticky-canvas="true"
              className="sticky inset-0 flex h-[calc(100vh-110px)] w-full items-center justify-center p-6"
            >
              <div className="max-w-sm text-center space-y-3 select-none">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-[#fef5b7] dark:bg-[#383014] border border-[#eadb85] dark:border-[#5b4d20] text-[#68594d] dark:text-[#fbf3cf] flex items-center justify-center shadow-xs">
                  <StickyNoteIcon className="w-7 h-7 stroke-[1.6]" />
                </div>
                <h2 className="font-serif-note font-bold text-xl text-[#1b1c19] dark:text-[#ffffff]">
                  Stick
                </h2>
                <p className="text-xs text-[#7f756e] dark:text-[#a1a1aa] leading-relaxed">
                  Organize lembretes, ideias rápidas e listas visualmente. Crie seu primeiro Stick e arraste livremente pelo espaço.
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleCreateNote}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#68594d] hover:bg-[#53463c] dark:bg-[#2e2620] dark:border dark:border-[#4a3b2c] dark:hover:bg-[#3d3229] text-white text-xs font-medium transition-colors cursor-pointer shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Criar primeiro Stick</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            notes.map((note) => (
              <StickyNoteCard
                key={note.id}
                note={note}
                isSelected={selectedNoteId === note.id}
                autoFocus={newlyCreatedId === note.id}
                onSelect={handleSelectNote}
                onChangeTitle={handleChangeTitle}
                onChangeContent={handleChangeContent}
                onChangeColor={handleChangeNoteColor}
                onMoveLive={handleMoveLive}
                onMoveEnd={handleMoveEnd}
                onResizeLive={handleResizeLive}
                onResizeEnd={handleResizeEnd}
                onDelete={handleDeleteNote}
                registerEditorActions={registerEditorActions}
                onOpenLinkedNote={handleOpenLinkedNote}
              />
            ))
          )}
        </div>
      </main>
    </div>
  );
}
