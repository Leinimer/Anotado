'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Plus, StickyNote as StickyNoteIcon, X } from 'lucide-react';
import { AppHeader } from '@/src/features/core_layout/ui/AppHeader';
import {
  STICKY_DEFAULT_WIDTH,
  StickyNote,
  StickyNoteColorKey,
  StickyNoteGroup,
  STICKY_COLORS,
} from '../types';
import {
  createStickyNote,
  deleteStickyNote,
  fetchStickyNotes,
  getAuthenticatedStickyUser,
  updateStickyNote,
  UpdateStickyNotePatch,
  fetchStickyNoteGroups,
  createStickyNoteGroup,
  updateStickyNoteGroup,
  deleteStickyNoteGroup,
  updateStickyNoteGroupsOrder,
} from '../api/sticky-notes-api';
import { StickyNoteCard, StickyEditorActions, StickyEditorAction } from './StickyNoteCard';
import { StickyNotesToolbar, StickySaveState } from './StickyNotesToolbar';
import { StickyGroupsSidebar } from './StickyGroupsSidebar';
import { StickyNoteReferenceModal, StickyNoteReferencePreview } from './StickyNoteReferenceModal';
import type { ReferenceType } from './StickyNoteReferenceModal';
import { StickyReminderSettingsModal } from './StickyReminderSettingsModal';
import { fetchStickyReminderNoteIds } from '../api/sticky-reminders-api';
import { useStickyTabletMode } from '../hooks/useStickyTabletMode';
import { reorderStickyGroups, StickyResizePatch } from '../lib/sticky-interactions';
import {
  ACTIVE_STICKY_ID_KEY,
  LEGACY_PENDING_CONVERSION_KEY,
  clearConvertedStickHandoff,
  computeCanvasPanToCenterStick,
  convertNoteContentForStick,
  estimateStickyCardHeight,
  findNonOverlappingStickPosition,
  readConvertedStickHandoff,
} from '../lib/note-to-stick';

const DEBOUNCE_MS = 450;

export function StickyNotesLayout() {
  const [userId, setUserId] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [noteHeights, setNoteHeights] = useState<Record<string, number>>({});
  const noteHeightsRef = useRef<Record<string, number>>({});
  const [groups, setGroups] = useState<StickyNoteGroup[]>([]);
  const [movingGroupNoteIds, setMovingGroupNoteIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{kind:'note'|'group';id:string;x:number;y:number}|null>(null);
  const [editingGroupTitleId, setEditingGroupTitleId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeColor, setActiveColor] = useState<StickyNoteColorKey>('yellow');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [highlightMode, setHighlightMode] = useState(false);
  const [newlyCreatedId, setNewlyCreatedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<StickySaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conversionNoticeError, setConversionNoticeError] = useState<string | null>(null);
  const [referenceModalOpen, setReferenceModalOpen] = useState(false);
  const [referenceSelectedText, setReferenceSelectedText] = useState('');
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasPan, setCanvasPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const spacePressedRef = useRef(false);
  const [reminderNoteIds, setReminderNoteIds] = useState<Set<string>>(new Set());
  const [reminderDialogNoteId, setReminderDialogNoteId] = useState<string | null>(null);
  const [groupsSidebarOpen, setGroupsSidebarOpen] = useState(false);
  const [referencePreview, setReferencePreview] = useState<{id:string;type:ReferenceType;left:number;top:number}|null>(null);

  const { isTablet } = useStickyTabletMode();
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const editorActionsRef = useRef<Map<string, StickyEditorActions>>(new Map());
  const pendingPatchesRef = useRef<Map<string, UpdateStickyNotePatch>>(new Map());
  const debounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const notesRef = useRef<StickyNote[]>(notes);
  const groupsRef = useRef<StickyNoteGroup[]>(groups);
  const resizingNoteIdRef = useRef<string | null>(null);
  const resizeInitialSizeRef = useRef<{ width_px: number; height_px: number | null; position_x: number; position_y: number } | null>(null);
  const userIdRef = useRef<string>(userId);
  const canvasZoomRef = useRef<number>(canvasZoom);
  const canvasPanRef = useRef<{ x: number; y: number }>(canvasPan);
  const isPinchingRef = useRef<boolean>(false);

  useLayoutEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useLayoutEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    canvasZoomRef.current = canvasZoom;
  }, [canvasZoom]);

  useEffect(() => {
    canvasPanRef.current = canvasPan;
  }, [canvasPan]);

  // Zoom por pinça exclusivo do quadro no modo tablet, reutilizando o mesmo
  // estado canvasZoom / canvasPan já usado no zoom desktop (Space + scroll).
  useEffect(() => {
    if (!isTablet) {
      isPinchingRef.current = false;
      return;
    }
    const boardEl = boardScrollRef.current;
    if (!boardEl) return;

    const activePointers = new Map<number, { x: number; y: number }>();
    let pinchAnchor: {
      startDist: number;
      startZoom: number;
      worldX: number;
      worldY: number;
    } | null = null;

    const initPinch = () => {
      const points = Array.from(activePointers.values());
      if (points.length < 2) return;
      const [p1, p2] = points;
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (dist < 4) return;
      const rect = boardEl.getBoundingClientRect();
      const midX = (p1.x + p2.x) / 2 - rect.left;
      const midY = (p1.y + p2.y) / 2 - rect.top;
      const currentZoom = canvasZoomRef.current || 1;
      const currentPan = canvasPanRef.current;
      pinchAnchor = {
        startDist: dist,
        startZoom: currentZoom,
        worldX: (midX - currentPan.x) / currentZoom,
        worldY: (midY - currentPan.y) / currentZoom,
      };
      isPinchingRef.current = true;
      window.dispatchEvent(new CustomEvent('anotado:sticky-pinch-start'));
    };

    const handlePointerDownCapture = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointers.size === 2) {
        initPinch();
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !activePointers.has(event.pointerId)) return;
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointers.size < 2) return;
      if (!pinchAnchor) {
        initPinch();
        if (!pinchAnchor) return;
      }
      const points = Array.from(activePointers.values());
      const [p1, p2] = points;
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (dist < 4 || pinchAnchor.startDist < 4) return;

      const rect = boardEl.getBoundingClientRect();
      const midX = (p1.x + p2.x) / 2 - rect.left;
      const midY = (p1.y + p2.y) / 2 - rect.top;
      const nextZoom = Math.max(
        0.15,
        Math.min(2.5, pinchAnchor.startZoom * (dist / pinchAnchor.startDist))
      );
      const nextPan = {
        x: midX - pinchAnchor.worldX * nextZoom,
        y: midY - pinchAnchor.worldY * nextZoom,
      };

      canvasZoomRef.current = nextZoom;
      canvasPanRef.current = nextPan;
      setCanvasZoom(nextZoom);
      setCanvasPan(nextPan);
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      if (!activePointers.has(event.pointerId)) return;
      activePointers.delete(event.pointerId);
      if (activePointers.size < 2) {
        pinchAnchor = null;
      }
      if (activePointers.size === 0) {
        isPinchingRef.current = false;
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length >= 2 || isPinchingRef.current) {
        event.preventDefault();
      }
    };

    const preventSafariGesture = (event: Event) => {
      event.preventDefault();
    };

    boardEl.addEventListener('pointerdown', handlePointerDownCapture, { capture: true });
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    boardEl.addEventListener('touchmove', handleTouchMove, { passive: false });
    boardEl.addEventListener('gesturestart', preventSafariGesture, { passive: false });
    boardEl.addEventListener('gesturechange', preventSafariGesture, { passive: false });
    boardEl.addEventListener('gestureend', preventSafariGesture, { passive: false });

    return () => {
      isPinchingRef.current = false;
      activePointers.clear();
      boardEl.removeEventListener('pointerdown', handlePointerDownCapture, { capture: true });
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      boardEl.removeEventListener('touchmove', handleTouchMove);
      boardEl.removeEventListener('gesturestart', preventSafariGesture);
      boardEl.removeEventListener('gesturechange', preventSafariGesture);
      boardEl.removeEventListener('gestureend', preventSafariGesture);
    };
  }, [isTablet]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isEditableTarget(event.target)) return;
      spacePressedRef.current = true;
      setIsSpacePressed(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spacePressedRef.current = false;
        setIsSpacePressed(false);
      }
    };
    const handleWindowBlur = () => {
      spacePressedRef.current = false;
      setIsSpacePressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    const handleDeleted = (event: Event) => {
      const detail = (event as CustomEvent<{ noteId?: string }>).detail;
      if (!detail?.noteId) return;
      setNotes(previous => previous.filter(note => note.id !== detail.noteId));
      setSelectedNoteId(previous => previous === detail.noteId ? null : previous);
      setReminderNoteIds(previous => {
        const next = new Set(previous);
        next.delete(detail.noteId!);
        return next;
      });
    };
    const handleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ noteId?: string; title?: string; content?: string }>).detail;
      if (!detail?.noteId) return;
      setNotes(previous => previous.map(note => note.id === detail.noteId
        ? { ...note, title: detail.title ?? note.title, content: detail.content ?? note.content }
        : note
      ));
    };
    window.addEventListener('anotado:sticky-note-deleted', handleDeleted);
    window.addEventListener('anotado:sticky-note-updated', handleUpdated);
    return () => {
      window.removeEventListener('anotado:sticky-note-deleted', handleDeleted);
      window.removeEventListener('anotado:sticky-note-updated', handleUpdated);
    };
  }, []);

  const registerEditorActions = useCallback((noteId: string, actions: StickyEditorActions | null) => {
    if (actions) editorActionsRef.current.set(noteId, actions);
    else editorActionsRef.current.delete(noteId);
  }, []);
  const handleEditorFormat = useCallback((action: StickyEditorAction) => {
    if (action === 'highlight') {
      setHighlightMode(current => !current);
      return;
    }
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
  const handlePreviewLinkedNote = useCallback((id: string, type: ReferenceType, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(530, window.innerWidth - 24);
    const left = rect.right + 10 + width <= window.innerWidth - 12
      ? rect.right + 10
      : Math.max(12, rect.left - width - 10);
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 605));
    setReferencePreview({ id, type, left, top });
  }, []);

  useEffect(() => {
    if (!referencePreview) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-sticky-reference-preview]') || target.closest('a[data-sticky-reference-id]')) return;
      setReferencePreview(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [referencePreview]);

  const centerViewportOnStick = useCallback((target: StickyNote) => {
    const applyCenter = () => {
      const viewport = boardScrollRef.current;
      if (!viewport || viewport.clientWidth === 0 || viewport.clientHeight === 0) return false;
      const element = document.getElementById('sticky-note-' + target.id);
      const measuredHeight =
        target.height_px ??
        noteHeightsRef.current[target.id] ??
        (element && element.offsetHeight > 0 ? element.offsetHeight : undefined);
      const zoom = canvasZoomRef.current || 1;
      const nextPan = computeCanvasPanToCenterStick(
        target,
        { width: viewport.clientWidth, height: viewport.clientHeight },
        zoom,
        measuredHeight
      );
      canvasPanRef.current = nextPan;
      setCanvasPan(nextPan);
      return true;
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!applyCenter()) {
          setTimeout(() => {
            applyCenter();
          }, 80);
        }
      });
    });
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
          // As três consultas são independentes: executá-las juntas reduz o tempo
          // total de abertura sem alterar a origem nem a consistência dos dados.
          const [loaded, loadedGroups, activeReminderIds] = await Promise.all([
            fetchStickyNotes(authUser.userId),
            fetchStickyNoteGroups(authUser.userId),
            fetchStickyReminderNoteIds(authUser.userId).catch((reminderError) => {
              console.warn('[Stick] Não foi possível carregar os indicadores de lembrete:', reminderError);
              return [] as string[];
            }),
          ]);
          if (!isMounted) return;

          const convertedHandoff = readConvertedStickHandoff();
          const linkedStickyId = sessionStorage.getItem(ACTIVE_STICKY_ID_KEY);

          let mergedNotes = loaded;
          if (
            convertedHandoff &&
            convertedHandoff.user_id === authUser.userId &&
            !loaded.some((note) => note.id === convertedHandoff.id)
          ) {
            mergedNotes = [...loaded, convertedHandoff];
          }

          notesRef.current = mergedNotes;
          setNotes(mergedNotes);
          setGroups(loadedGroups);
          setReminderNoteIds(new Set(activeReminderIds));

          const targetId =
            (convertedHandoff && convertedHandoff.user_id === authUser.userId
              ? convertedHandoff.id
              : null) || linkedStickyId;

          if (targetId) {
            const targetNote = mergedNotes.find((note) => note.id === targetId);
            if (targetNote) {
              setSelectedNoteId(targetNote.id);
              if (convertedHandoff && targetNote.id === convertedHandoff.id) {
                setNewlyCreatedId(targetNote.id);
              }
              clearConvertedStickHandoff();
              centerViewportOnStick(targetNote);
            } else if (convertedHandoff) {
              clearConvertedStickHandoff();
              setConversionNoticeError(
                'O Stick foi criado, mas não foi possível localizá-lo na lista atualizada. Recarregue a página para verificar.'
              );
            }
          }
        } else {
          const hasPendingConversion =
            Boolean(sessionStorage.getItem(LEGACY_PENDING_CONVERSION_KEY)) ||
            Boolean(readConvertedStickHandoff());
          if (hasPendingConversion) {
            setConversionNoticeError(
              'Sua sessão não está autenticada. Faça login novamente para visualizar ou criar o Stick.'
            );
          }
        }
      } catch (error) {
        if (!isMounted) return;
        const message =
          error instanceof Error ? error.message : 'Erro ao carregar Stick.';
        setLoadError(message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    init();

    return () => {
      isMounted = false;
    };
  }, [centerViewportOnStick]);

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

  const handleConvertPendingNoteToStick = useCallback(
    async (
      payload: { title?: string; content?: string },
      authenticatedUserId: string
    ): Promise<boolean> => {
      const uid = authenticatedUserId;
      const currentNotes = notesRef.current;
      const title = (payload.title || '').trim();
      const formattedContent = convertNoteContentForStick(payload.content || '');
      const width = STICKY_DEFAULT_WIDTH;
      const estimatedHeight = estimateStickyCardHeight(title, formattedContent || payload.content, width);
      const position = findNonOverlappingStickPosition(currentNotes, {
        widthPx: width,
        estimatedHeight,
        measuredHeights: noteHeightsRef.current,
      });

      const nextZ = getNextZIndex(currentNotes);
      setSaveState('saving');
      setSaveError(null);
      setConversionNoticeError(null);

      try {
        const created = await createStickyNote(uid, {
          title,
          content: formattedContent,
          color: activeColor,
          position_x: Math.round(position.x),
          position_y: Math.round(position.y),
          width_px: width,
          z_index: nextZ,
        });

        if (!created?.id || created.user_id !== uid) {
          throw new Error(
            'O Stick foi enviado, mas o registro confirmado não foi retornado pelo banco de dados.'
          );
        }

        const nextNotes = currentNotes.some((item) => item.id === created.id)
          ? currentNotes
          : [...currentNotes, created];
        notesRef.current = nextNotes;
        setNotes(nextNotes);
        setSelectedNoteId(created.id);
        setNewlyCreatedId(created.id);
        setSaveState('saved');
        centerViewportOnStick(created);
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Erro ao transformar nota em Stick.';
        setSaveState('error');
        setSaveError(message);
        setConversionNoticeError(message);
        console.error('[Stick] Falha ao converter nota pendente:', error);
        return false;
      }
    },
    [activeColor, getNextZIndex, centerViewportOnStick]
  );

  // Fallback seguro para solicitações legadas ainda presentes no sessionStorage.
  // Só consome após autenticação e carregamento concluídos, evitando user_id temporário.
  const conversionInProgressRef = useRef(false);
  useEffect(() => {
    if (isLoading || !userId || userId === 'demo-user' || conversionInProgressRef.current) return;
    const pendingConversion = sessionStorage.getItem(LEGACY_PENDING_CONVERSION_KEY);
    if (!pendingConversion) return;

    conversionInProgressRef.current = true;
    void (async () => {
      try {
        const payload = JSON.parse(pendingConversion) as { title?: string; content?: string };
        const created = await handleConvertPendingNoteToStick(payload, userId);
        if (created) {
          sessionStorage.removeItem(LEGACY_PENDING_CONVERSION_KEY);
        }
      } catch (error) {
        console.error('[Stick] Não foi possível concluir a conversão pendente:', error);
        setConversionNoticeError(
          'Não foi possível transformar a nota em Stick. Tente novamente a partir da lista de Notas.'
        );
      } finally {
        conversionInProgressRef.current = false;
      }
    })();
  }, [isLoading, userId, handleConvertPendingNoteToStick]);

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
      const message = error instanceof Error ? error.message : 'Erro ao criar Stick.';
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

  const handleNoteHeightChange = useCallback((noteId: string, height: number) => {
    const previousHeight = noteHeightsRef.current[noteId] || 0;
    noteHeightsRef.current[noteId] = height;
    setNoteHeights(previous => previous[noteId] === height ? previous : { ...previous, [noteId]: height });

    // Durante o redimensionamento manual, apenas atualiza a altura medida sem empurrar cartões no meio do gesto.
    if (resizingNoteIdRef.current === noteId) return;

    // Só empurra os outros Sticks quando este cartão cresce (por exemplo,
    // ao adicionar uma linha), sem reorganizar a posição inicial ao carregar.
    if (!previousHeight || height <= previousHeight + 1) return;
    const source = notesRef.current.find(note => note.id === noteId);
    if (!source) return;

    const gap = 16;
    const candidates = notesRef.current
      .filter(note => note.id !== noteId &&
        note.position_x < source.position_x + source.width_px &&
        note.position_x + note.width_px > source.position_x &&
        note.position_y >= source.position_y)
      .sort((a, b) => a.position_y - b.position_y);

    const nextY = new Map<string, number>();
    const placed: Array<{ x: number; y: number; width: number; height: number }> = [
      { x: source.position_x, y: source.position_y, width: source.width_px, height }
    ];
    for (const note of candidates) {
      let y = note.position_y;
      const noteHeight = note.height_px ?? noteHeightsRef.current[note.id] ?? 280;
      let moved = true;
      while (moved) {
        moved = false;
        for (const above of placed) {
          const horizontalOverlap = note.position_x < above.x + above.width &&
            note.position_x + note.width_px > above.x;
          const verticalOverlap = y < above.y + above.height + gap &&
            y + noteHeight > above.y;
          if (horizontalOverlap && verticalOverlap) {
            y = above.y + above.height + gap;
            moved = true;
          }
        }
      }
      nextY.set(note.id, y);
      placed.push({ x: note.position_x, y, width: note.width_px, height: noteHeight });
    }

    if (nextY.size) {
      setNotes(previous => previous.map(note => {
        const y = nextY.get(note.id);
        return y !== undefined && y !== note.position_y ? { ...note, position_y: y } : note;
      }));
      nextY.forEach((y, id) => {
        const current = notesRef.current.find(note => note.id === id);
        if (current && current.position_y !== y) void persistPatch(id, { position_y: y });
      });
    }
  }, [persistPatch]);

  // A única medição de altura fica no quadro. Usa offsetHeight (não afetado por canvasZoom)
  // para medir a altura real no espaço do quadro sem distorções durante zoom/pinça.
  useLayoutEffect(() => {
    if (isLoading || typeof ResizeObserver === 'undefined') return;

    const elements = notes
      .map(note => document.getElementById('sticky-note-' + note.id))
      .filter((element): element is HTMLElement => Boolean(element));

    const reportHeight = (element: HTMLElement) => {
      const noteId = element.dataset.stickyNoteId;
      if (!noteId) return;
      const height = Math.ceil(element.offsetHeight);
      if (height > 0) handleNoteHeightChange(noteId, height);
    };

    elements.forEach(reportHeight);
    const observer = new ResizeObserver(entries => {
      entries.forEach(entry => reportHeight(entry.target as HTMLElement));
    });
    elements.forEach(element => observer.observe(element));

    return () => observer.disconnect();
  }, [notes, isLoading, handleNoteHeightChange]);

  const handleMoveLive = useCallback((noteId: string, x: number, y: number) => {
    setNotes((prev) => {
      const next = prev.map((item) =>
        item.id === noteId ? { ...item, position_x: x, position_y: y } : item
      );
      // Keep the live ref synchronized so the final drop always persists the
      // exact position shown on screen, even on a very fast pointer release.
      notesRef.current = next;
      return next;
    });
  }, []);

  const handleMoveEnd = useCallback(
    (noteId: string, x: number, y: number) => {
      const target = notesRef.current.find((n) => n.id === noteId);
      void persistPatch(noteId, {
        position_x: x,
        position_y: y,
        z_index: target?.z_index,
      });

      // Soltar um Stick sobre um agrupamento o adiciona automaticamente,
      // mantendo a cor original do Stick e posicionando-o ao lado dos demais.
      const noteElement = document.getElementById('sticky-note-' + noteId);
      const noteRect = noteElement?.getBoundingClientRect();
      if (!noteRect) return;
      const centerX = noteRect.left + noteRect.width / 2;
      const centerY = noteRect.top + noteRect.height / 2;
      const hitGroup = Array.from(document.querySelectorAll<HTMLElement>('[data-sticky-group-id]'))
        .find(element => {
          const rect = element.getBoundingClientRect();
          return centerX >= rect.left && centerX <= rect.right && centerY >= rect.top && centerY <= rect.bottom;
        });
      if (!hitGroup) return;
      const groupId = hitGroup.dataset.stickyGroupId;
      if (!groupId || target?.group_id === groupId) return;
      const members = notesRef.current.filter(note => note.group_id === groupId && note.id !== noteId);
      const maxRight = members.reduce((right, note) => Math.max(right, note.position_x + note.width_px), 0);
      const rowY = members.length ? Math.min(...members.map(note => note.position_y)) : y;
      const nextX = members.length ? maxRight + 18 : x;
      setNotes(previous => previous.map(note => note.id === noteId
        ? { ...note, group_id: groupId, position_x: nextX, position_y: rowY }
        : note));
      void persistPatch(noteId, { group_id: groupId, position_x: nextX, position_y: rowY });
    },
    [persistPatch]
  );

  const handleResizeStart = useCallback((noteId: string) => {
    const target = notesRef.current.find((item) => item.id === noteId);
    resizingNoteIdRef.current = noteId;
    resizeInitialSizeRef.current = target
      ? { width_px: target.width_px, height_px: target.height_px ?? null, position_x: target.position_x, position_y: target.position_y }
      : null;
  }, []);

  const handleResizeLive = useCallback((noteId: string, size: StickyResizePatch) => {
    if (size.height_px != null) noteHeightsRef.current[noteId] = size.height_px;
    setNotes((prev) =>
      prev.map((item) => item.id === noteId
        ? {
            ...item,
            width_px: size.width_px,
            ...(size.height_px !== undefined ? { height_px: size.height_px } : {}),
            ...(size.position_x !== undefined ? { position_x: size.position_x } : {}),
            ...(size.position_y !== undefined ? { position_y: size.position_y } : {}),
          }
        : item
      )
    );
  }, []);

  const handleResizeEnd = useCallback(
    (noteId: string, size: StickyResizePatch) => {
      const initial = resizeInitialSizeRef.current;
      resizingNoteIdRef.current = null;
      resizeInitialSizeRef.current = null;

      const nextHeight = size.height_px ?? null;
      const widthChanged = !initial || initial.width_px !== size.width_px;
      const heightChanged = !initial || initial.height_px !== nextHeight;
      const xChanged = !initial || initial.position_x !== (size.position_x ?? initial.position_x);
      const yChanged = !initial || initial.position_y !== (size.position_y ?? initial.position_y);
      if (!widthChanged && !heightChanged && !xChanged && !yChanged) return;

      const patch: UpdateStickyNotePatch = { width_px: size.width_px };
      if (heightChanged) patch.height_px = nextHeight;
      if (xChanged && size.position_x !== undefined) patch.position_x = size.position_x;
      if (yChanged && size.position_y !== undefined) patch.position_y = size.position_y;
      void persistPatch(noteId, patch);
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
    setReminderNoteIds((prev) => { const next = new Set(prev); next.delete(noteId); return next; });

    const uid = userIdRef.current;
    if (!uid || uid === 'demo-user') return;

    setSaveState('saving');
    setSaveError(null);
    try {
      await deleteStickyNote(uid, noteId);
      setSaveState('saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao excluir Stick.';
      setNotes(snapshot);
      setSaveState('error');
      setSaveError(message);
    }
  }, []);

  const handleCreateGroupForNote = useCallback(async (noteId: string) => {
    const note = notesRef.current.find(item => item.id === noteId);
    if (!note || note.group_id) return;
    try {
      const created = await createStickyNoteGroup(userIdRef.current, (note.color || 'yellow') as StickyNoteColorKey);
      setGroups(previous => [...previous, created]);
      setNotes(previous => previous.map(item => item.id === noteId ? { ...item, group_id: created.id } : item));
      await persistPatch(noteId, { group_id: created.id });
    } catch (error) {
      setSaveState('error');
      setSaveError(error instanceof Error ? error.message : 'Não foi possível agrupar o Stick.');
    }
    setContextMenu(null);
  }, [persistPatch]);

  const handleDeleteGroup = useCallback(async (groupId: string) => {
    try {
      await deleteStickyNoteGroup(userIdRef.current, groupId);
      setGroups(previous => previous.filter(group => group.id !== groupId));
      setNotes(previous => previous.map(note => note.group_id === groupId ? { ...note, group_id: null } : note));
    } catch (error) {
      setSaveState('error');
      setSaveError(error instanceof Error ? error.message : 'Não foi possível desagrupar.');
    }
    setContextMenu(null);
  }, []);

  const handleGroupPointerDown = useCallback((groupId: string, event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.button !== 0 && event.pointerType === 'mouse') || event.target !== event.currentTarget) return;
    if (isPinchingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const zoom = canvasZoom || 1;
    const members = notesRef.current.filter(note => note.group_id === groupId).map(note => ({ ...note }));
    if (!members.length) return;
    // Enquanto o agrupamento se move, desative as transições individuais dos
    // cartões: caso contrário cada Stick tenta animar até a nova posição e fica
    // visualmente para trás, criando o efeito de movimento fantasma.
    setMovingGroupNoteIds(new Set(members.map(member => member.id)));
    let cancelledByPinch = false;

    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('anotado:sticky-pinch-start', abortForPinch);
      setMovingGroupNoteIds(new Set());
    };
    const restoreInitialPositions = () => {
      const restored = notesRef.current.map(note => {
        const initial = members.find(member => member.id === note.id);
        return initial ? { ...note, position_x: initial.position_x, position_y: initial.position_y } : note;
      });
      notesRef.current = restored;
      setNotes(restored);
    };
    const abortForPinch = () => {
      if (cancelledByPinch) return;
      cancelledByPinch = true;
      cleanup();
      restoreInitialPositions();
    };
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      if (isPinchingRef.current) { abortForPinch(); return; }
      const dx = (pointer.clientX - startX) / zoom;
      const dy = (pointer.clientY - startY) / zoom;
      const next = notesRef.current.map(note => {
        const initial = members.find(member => member.id === note.id);
        return initial ? { ...note, position_x: initial.position_x + dx, position_y: initial.position_y + dy } : note;
      });
      // Atualização síncrona da referência mantém todos os membros no mesmo
      // frame e evita que o próximo evento use posições antigas.
      notesRef.current = next;
      setNotes(next);
    };
    const cancel = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      cleanup();
      restoreInitialPositions();
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      const dx = (pointer.clientX - startX) / zoom;
      const dy = (pointer.clientY - startY) / zoom;
      cleanup();
      if (cancelledByPinch) return;
      const finalNotes = notesRef.current.map(note => {
        const initial = members.find(member => member.id === note.id);
        return initial ? { ...note, position_x: Math.round(initial.position_x + dx), position_y: Math.round(initial.position_y + dy) } : note;
      });
      notesRef.current = finalNotes;
      setNotes(finalNotes);
      members.forEach(member => {
        void persistPatch(member.id, {
          position_x: Math.round(member.position_x + dx),
          position_y: Math.round(member.position_y + dy),
        });
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('anotado:sticky-pinch-start', abortForPinch);
  }, [canvasZoom, persistPatch]);

  const handleReorderGroups = useCallback(async (sourceId: string, targetId: string) => {
    const previous = groupsRef.current;
    const next = reorderStickyGroups(previous, sourceId, targetId);
    if (!next) return;

    groupsRef.current = next;
    setGroups(next);
    setSaveState('saving');
    setSaveError(null);
    try {
      await updateStickyNoteGroupsOrder(
        next.map((group) => group.id),
        userIdRef.current
      );
      setSaveState('saved');
    } catch (error) {
      groupsRef.current = previous;
      setGroups(previous);
      setSaveState('error');
      setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar a ordem dos campos.');
    }
  }, []);

  const handleSelectGroupFromSidebar = useCallback((groupId: string) => {
    const members = notesRef.current.filter((note) => note.group_id === groupId);
    if (members.length && boardScrollRef.current) {
      const left = Math.min(...members.map((note) => note.position_x));
      const top = Math.min(...members.map((note) => note.position_y));
      const right = Math.max(...members.map((note) => note.position_x + note.width_px));
      const bottom = Math.max(
        ...members.map((note) => {
          const element = document.getElementById('sticky-note-' + note.id);
          return note.position_y + (note.height_px ?? noteHeightsRef.current[note.id] ?? element?.offsetHeight ?? 280);
        })
      );
      const viewport = boardScrollRef.current;
      const zoom = canvasZoomRef.current || 1;
      setCanvasPan({
        x: viewport.clientWidth / 2 - ((left + right) / 2) * zoom,
        y: viewport.clientHeight / 2 - ((top + bottom) / 2) * zoom,
      });
    }
    setGroupsSidebarOpen(false);
  }, []);

  const handleGroupTitleChange = useCallback((groupId: string, title: string) => {
    setGroups(previous => previous.map(group => group.id === groupId ? { ...group, title } : group));
  }, []);

  const handleSaveGroupTitle = useCallback(async (groupId: string) => {
    const title = groups.find(group => group.id === groupId)?.title ?? '';
    try {
      await updateStickyNoteGroup(userIdRef.current, groupId, { title });
    } catch (error) {
      setSaveState('error');
      setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar o título.');
    }
    setEditingGroupTitleId(null);
  }, [groups]);

  const handleGroupColor = useCallback(async (groupId: string, color: StickyNoteColorKey) => {
    try {
      await updateStickyNoteGroup(userIdRef.current, groupId, { color });
      setGroups(previous => previous.map(group => group.id === groupId ? { ...group, color } : group));
    } catch (error) {
      setSaveState('error');
      setSaveError(error instanceof Error ? error.message : 'Não foi possível mudar a cor do agrupamento.');
    }
    setContextMenu(null);
  }, []);

  const handleNoteContextMenu = useCallback((note: StickyNote, x: number, y: number) => {
    setContextMenu({ kind: 'note', id: note.id, x: Math.min(x, window.innerWidth - 190), y: Math.min(y, window.innerHeight - 240) });
  }, []);

  const handleGroupContextMenu = useCallback((groupId: string, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ kind: 'group', id: groupId, x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 190) });
  }, []);

  const groupBounds = useMemo(() => groups.map(group => {
    const members = notes.filter(note => note.group_id === group.id);
    if (!members.length) return null;
    const left = Math.min(...members.map(note => note.position_x));
    const top = Math.min(...members.map(note => note.position_y));
    const right = Math.max(...members.map(note => note.position_x + note.width_px));
    const bottom = Math.max(...members.map(note => {
      const element = typeof document !== 'undefined' ? document.getElementById('sticky-note-' + note.id) : null;
      const height = note.height_px ?? noteHeights[note.id] ?? element?.offsetHeight ?? 280;
      return note.position_y + height;
    }));
    return { group, left: left - 22, top: top - 42, width: right - left + 44, height: bottom - top + 66 };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item)), [groups, notes, noteHeights]);

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
        tabletStatus={isTablet ? <StickyNotesToolbar
          layoutMode="tablet-status"
          activeColor={activeColor}
          selectedNoteColor={selectedNote?.color}
          hasSelectedNote={Boolean(selectedNote)}
          notesCount={notes.length}
          saveState={saveState}
          errorMessage={saveError}
          onCreateNote={handleCreateNote}
          onToggleGroups={() => setGroupsSidebarOpen(open => !open)}
          groupsOpen={groupsSidebarOpen}
          onSelectColor={handleToolbarSelectColor}
          onFormat={handleEditorFormat}
          highlightMode={highlightMode}
          onInsertNoteLink={handleInsertNoteLink}
        /> : undefined}
        toolbar={<StickyNotesToolbar
          layoutMode={isTablet ? 'tablet-primary' : 'default'}
          activeColor={activeColor}
          selectedNoteColor={selectedNote?.color}
          hasSelectedNote={Boolean(selectedNote)}
          notesCount={notes.length}
          saveState={saveState}
          errorMessage={saveError}
          onCreateNote={handleCreateNote}
          onToggleGroups={() => setGroupsSidebarOpen(open => !open)}
          groupsOpen={groupsSidebarOpen}
          onSelectColor={handleToolbarSelectColor}
          onFormat={handleEditorFormat}
          onInsertNoteLink={handleInsertNoteLink}
        />}
        secondaryToolbar={isTablet ? (
          <StickyNotesToolbar
            layoutMode="tablet-editing"
            activeColor={activeColor}
            selectedNoteColor={selectedNote?.color}
            hasSelectedNote={Boolean(selectedNote)}
            notesCount={notes.length}
            saveState={saveState}
            errorMessage={saveError}
            onCreateNote={handleCreateNote}
            onToggleGroups={() => setGroupsSidebarOpen(open => !open)}
            groupsOpen={groupsSidebarOpen}
            onSelectColor={handleToolbarSelectColor}
            onFormat={handleEditorFormat}
            onInsertNoteLink={handleInsertNoteLink}
          />
        ) : undefined}
      />

      {groupsSidebarOpen && (
        <StickyGroupsSidebar
          isTablet={isTablet}
          groups={groups}
          notes={notes}
          onClose={() => setGroupsSidebarOpen(false)}
          onSelectGroup={handleSelectGroupFromSidebar}
          onReorderGroups={(activeId, overId) => {
            void handleReorderGroups(activeId, overId);
          }}
        />
      )}

      {referencePreview && userId && <StickyNoteReferencePreview
        targetId={referencePreview.id}
        type={referencePreview.type}
        userId={userId}
        left={referencePreview.left}
        top={referencePreview.top}
        onClose={() => setReferencePreview(null)}
      />}
      <StickyNoteReferenceModal isOpen={referenceModalOpen} onClose={() => setReferenceModalOpen(false)} onSelectTarget={handleChooseReferencedNote} userId={userId} selectedText={referenceSelectedText} />
      <StickyReminderSettingsModal
        isOpen={Boolean(reminderDialogNoteId)}
        userId={userId}
        note={notes.find(note => note.id === reminderDialogNoteId) || null}
        onClose={() => setReminderDialogNoteId(null)}
        onSaved={(enabled) => setReminderNoteIds(previous => {
          const next = new Set(previous);
          if (reminderDialogNoteId) {
            if (enabled) next.add(reminderDialogNoteId);
            else next.delete(reminderDialogNoteId);
          }
          return next;
        })}
      />

      {/* Área livre do quadro de post-its, sem sidebar */}
      <main
        ref={boardScrollRef}
        id="sticky-notes-board-viewport"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          const isBackground = target === event.currentTarget || target.dataset.stickyCanvas === 'true';
          if (event.button === 1) {
            event.preventDefault();
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
          if (spacePressedRef.current && isBackground && event.button === 0) {
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
          if (isBackground && !isPinchingRef.current) setSelectedNoteId(null);
        }}
        onWheel={(event) => {
          if (!spacePressedRef.current) return;
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
          cursor: isPanning ? 'grabbing' : isSpacePressed ? 'grab' : undefined,
          touchAction: isTablet ? 'none' : undefined,
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
          {groupBounds.map(({group,left,top,width,height}) => {
            const palette = STICKY_COLORS.find(color => color.key === group.color) || STICKY_COLORS[0];
            const tint = palette.swatchLight;
            const titleColorClass = ({
              yellow: 'text-[#8a741f] dark:text-[#f5df78]',
              green: 'text-[#39794a] dark:text-[#8fd59d]',
              blue: 'text-[#376f9b] dark:text-[#8fcdf4]',
              pink: 'text-[#a34d75] dark:text-[#f3a9c9]',
              lilac: 'text-[#7055a8] dark:text-[#c4b2fa]',
              orange: 'text-[#a5652d] dark:text-[#f5bd83]',
              red: 'text-[#a34444] dark:text-[#f4a0a0]',
              gray: 'text-[#59616c] dark:text-[#c2c8d0]',
            } as Record<string, string>)[group.color] || 'text-[#376f9b] dark:text-[#8fcdf4]';
            return <React.Fragment key={group.id}>
              <div
                data-sticky-group-id={group.id}
                onPointerDown={event => handleGroupPointerDown(group.id, event)}
                onContextMenu={event => handleGroupContextMenu(group.id, event)}
                title="Arraste para mover o agrupamento; clique com o botão direito para opções"
                style={{
                  position: 'absolute', left, top, width, height,
                  borderRadius: 22,
                  background: `color-mix(in srgb, ${tint} 34%, transparent)`,
                  border: `2px solid color-mix(in srgb, ${tint} 78%, #9a7658)`,
                  boxShadow: '0 5px 18px rgba(65,45,28,.08)',
                  zIndex: 0,
                  cursor: 'grab',
                  touchAction: 'none',
                }}
              />
              <div
                onContextMenu={event => handleGroupContextMenu(group.id, event)}
                style={{
                  position: 'absolute', left: left + width / 2, top: top + 7,
                  transform: 'translateX(-50%)', width: Math.max(120, Math.min(width - 32, 360)),
                  zIndex: 2, textAlign: 'center', pointerEvents: 'auto',
                }}
              >
                {editingGroupTitleId === group.id ? (
                  <input
                    autoFocus
                    value={group.title || ''}
                    onChange={event => handleGroupTitleChange(group.id, event.target.value)}
                    onBlur={() => void handleSaveGroupTitle(group.id)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                    }}
                    placeholder="Título do agrupamento"
                    aria-label="Título do agrupamento"
                    className={`w-full rounded-lg border border-transparent bg-transparent px-3 py-1 text-center text-base font-semibold outline-none placeholder:text-[#927f6a] focus:border-[#92704f]/40 dark:placeholder:text-[#a99681] ${titleColorClass}`}
                  />
                ) : group.title ? (
                  <button
                    type="button"
                    onClick={() => setEditingGroupTitleId(group.id)}
                    className={`max-w-full rounded-md bg-transparent px-3 py-0.5 text-base font-semibold hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent ${titleColorClass}`}
                    title="Clique para editar o título"
                  >{group.title}</button>
                ) : null}
              </div>
            </React.Fragment>;
          })}
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
                isMovingWithGroup={movingGroupNoteIds.has(note.id)}
                canvasZoom={canvasZoom}
                isPinchingRef={isPinchingRef}
                snapTargets={notes.filter(other => other.id !== note.id).map(other => ({
                  id: other.id,
                  x: other.position_x,
                  y: other.position_y,
                  width: other.width_px,
                  height: other.height_px ?? noteHeights[other.id] ?? 280,
                }))}
                isSelected={selectedNoteId === note.id}
                highlightMode={highlightMode}
                autoFocus={newlyCreatedId === note.id}
                onSelect={handleSelectNote}
                onChangeTitle={handleChangeTitle}
                onChangeContent={handleChangeContent}
                onChangeColor={handleChangeNoteColor}
                onMoveLive={handleMoveLive}
                onMoveEnd={handleMoveEnd}
                onResizeStart={handleResizeStart}
                onResizeLive={handleResizeLive}
                onResizeEnd={handleResizeEnd}
                onDelete={handleDeleteNote}
                hasReminder={reminderNoteIds.has(note.id)}
                onOpenReminder={(targetNote) => setReminderDialogNoteId(targetNote.id)}
                onContextMenu={handleNoteContextMenu}
                registerEditorActions={registerEditorActions}
                onOpenLinkedNote={handleOpenLinkedNote}
                onPreviewLinkedNote={handlePreviewLinkedNote}
              />
            ))
          )}
        </div>
        {contextMenu && <div
          className="fixed inset-0 z-[11100]"
          onPointerDown={() => setContextMenu(null)}
          onContextMenu={event => { event.preventDefault(); setContextMenu(null); }}
        >
          <div
            className="fixed min-w-[176px] rounded-xl border border-[#e5d9cc] bg-[#fffdf9] p-1.5 shadow-[0_12px_35px_rgba(40,28,18,.22)] dark:border-[#494038] dark:bg-[#211e1b]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={event => event.stopPropagation()}
          >
            {contextMenu.kind === 'note' ? <>
              {!notes.find(note => note.id === contextMenu.id)?.group_id && <button type="button" onClick={() => void handleCreateGroupForNote(contextMenu.id)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-[#514235] hover:bg-[#f2ebe3] dark:text-[#eadccd] dark:hover:bg-[#342c25]">Agrupar</button>}
              <button type="button" onClick={() => { void handleDeleteNote(contextMenu.id); setContextMenu(null); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-[#a24e42] hover:bg-[#faeae5] dark:hover:bg-[#3d2521]">Excluir</button>
              <div className="my-1 border-t border-[#eee5dc] dark:border-[#40372f]"/>
              <p className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[#988777]">Mudar cor do Stick</p>
              <div className="flex flex-wrap gap-2 px-3 py-2">
                {STICKY_COLORS.map(color => <button key={color.key} type="button" title={color.label} onClick={() => { handleChangeNoteColor(contextMenu.id, color.key); setContextMenu(null); }} className="h-5 w-5 rounded-full border border-black/10 ring-offset-1 hover:ring-2 hover:ring-[#80634f]" style={{ backgroundColor: color.swatchLight }}/>)}
              </div>
            </> : <>
              <button type="button" onClick={() => { setEditingGroupTitleId(contextMenu.id); setContextMenu(null); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-[#514235] hover:bg-[#f2ebe3] dark:text-[#eadccd] dark:hover:bg-[#342c25]">{groups.find(group => group.id === contextMenu.id)?.title ? 'Editar título' : 'Adicionar título'}</button>
              <button type="button" onClick={() => void handleDeleteGroup(contextMenu.id)} className="w-full rounded-lg px-3 py-2 text-left text-sm text-[#514235] hover:bg-[#f2ebe3] dark:text-[#eadccd] dark:hover:bg-[#342c25]">Desagrupar</button>
              <div className="my-1 border-t border-[#eee5dc] dark:border-[#40372f]"/>
              <p className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[#988777]">Mudar cor do campo</p>
              <div className="flex flex-wrap gap-2 px-3 py-2">
                {STICKY_COLORS.map(color => <button key={color.key} type="button" title={color.label} onClick={() => void handleGroupColor(contextMenu.id, color.key)} className="h-5 w-5 rounded-full border border-black/10 ring-offset-1 hover:ring-2 hover:ring-[#80634f]" style={{ backgroundColor: color.swatchLight }}/>)}
              </div>
            </>}
          </div>
        </div>}
        {conversionNoticeError && (
          <div
            role="alert"
            aria-live="assertive"
            className="fixed bottom-4 right-4 z-[11150] flex max-w-sm items-start gap-2.5 rounded-xl border border-[#efc9c9] dark:border-[#5a2b2b] bg-[#fff8f8] dark:bg-[#241515] px-3.5 py-2.5 text-xs text-[#8f2424] dark:text-[#fecaca] shadow-lg"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#ba1a1a] dark:text-[#f87171]" />
            <span className="leading-relaxed">{conversionNoticeError}</span>
            <button
              type="button"
              onClick={() => setConversionNoticeError(null)}
              aria-label="Fechar aviso"
              className="ml-1 rounded-md p-0.5 text-[#8f2424]/70 hover:text-[#8f2424] dark:text-[#fecaca]/70 dark:hover:text-[#fecaca] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
