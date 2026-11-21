'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, MoreVertical, Move, Plus, StickyNote as StickyNoteIcon, X } from 'lucide-react';
import { AppHeader } from '@/src/features/core_layout/ui/AppHeader';
import {
  STICKY_DEFAULT_WIDTH,
  StickyBoardLayoutData,
  StickyLayoutType,
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
import {
  fetchStickyBoardLayout,
  saveStickyBoardLayout,
} from '../api/sticky-layouts-api';
import { StickyNoteCard, StickyEditorActions, StickyEditorAction } from './StickyNoteCard';
import { StickyNotesToolbar, StickySaveState } from './StickyNotesToolbar';
import { StickyGroupsSidebar } from './StickyGroupsSidebar';
import { StickyNoteReferenceModal, StickyNoteReferencePreview } from './StickyNoteReferenceModal';
import type { ReferenceType } from './StickyNoteReferenceModal';
import { StickyReminderSettingsModal } from './StickyReminderSettingsModal';
import { fetchStickyReminderNoteIds } from '../api/sticky-reminders-api';
import { useStickyDeviceMode } from '../hooks/useStickyDeviceMode';
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
import {
  commitGroupMoveToLayout,
  commitStickMoveToLayout,
  commitStickResizeToLayout,
  computeSmartDesktopNewStickPosition,
  resolveBoardLayout,
  ResolvedBoardLayout,
  snapshotResolvedLayout,
} from '../lib/device-layouts';

const DEBOUNCE_MS = 450;
const TABLET_GROUP_HOLD_MS = 1500;
const TABLET_CONTEXT_MENU_DELAY_MS = 1000;
const TABLET_HOLD_CANCEL_PX = 10;

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
  const [deleteGroupConfirmationId, setDeleteGroupConfirmationId] = useState<string | null>(null);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [groupDeletionError, setGroupDeletionError] = useState<string | null>(null);
  const [referencePreview, setReferencePreview] = useState<{id:string;type:ReferenceType;left:number;top:number}|null>(null);

  const { layoutType, isDesktop, isTablet, isMobile, isResolved } = useStickyDeviceMode();
  const isTouchLayout = isTablet || isMobile;
  const [boardViewportWidth, setBoardViewportWidth] = useState<number>(820);
  const [deviceLayouts, setDeviceLayouts] = useState<
    Partial<Record<StickyLayoutType, StickyBoardLayoutData | null>>
  >({});
  const deviceLayoutsRef = useRef<
    Partial<Record<StickyLayoutType, StickyBoardLayoutData | null>>
  >({});
  const layoutTypeRef = useRef<StickyLayoutType>(layoutType);
  const loadedLayoutKeysRef = useRef<Set<string>>(new Set());
  const resolvedLayoutRef = useRef<ResolvedBoardLayout | null>(null);
  const draggingNoteIdRef = useRef<string | null>(null);
  const [touchMovingGroupId, setTouchMovingGroupId] = useState<string | null>(null);

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

  useLayoutEffect(() => {
    layoutTypeRef.current = layoutType;
  }, [layoutType]);

  useLayoutEffect(() => {
    deviceLayoutsRef.current = deviceLayouts;
  }, [deviceLayouts]);

  useEffect(() => {
    canvasZoomRef.current = canvasZoom;
  }, [canvasZoom]);

  useEffect(() => {
    canvasPanRef.current = canvasPan;
  }, [canvasPan]);

  // Monitora a largura real do quadro no tablet e no mobile para calcular o layout inicial.
  useEffect(() => {
    if (!isTouchLayout || typeof ResizeObserver === 'undefined') return;
    const boardEl = boardScrollRef.current;
    if (!boardEl) return;

    const updateWidth = () => {
      const nextWidth = Math.round(boardEl.clientWidth);
      if (nextWidth > 0) {
        setBoardViewportWidth((previous) => (previous === nextWidth ? previous : nextWidth));
      }
    };

    const observer = new ResizeObserver(updateWidth);
    observer.observe(boardEl);
    return () => observer.disconnect();
  }, [isTouchLayout]);

  // Zoom por pinça exclusivo do quadro nos modos sensíveis ao toque (tablet/mobile),
  // ancorado no ponto médio entre os dois dedos e bloqueando o zoom nativo do navegador.
  useEffect(() => {
    if (!isTouchLayout) {
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
        0.3,
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

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        event.preventDefault();
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
    boardEl.addEventListener('touchstart', handleTouchStart, { passive: false });
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
      boardEl.removeEventListener('touchstart', handleTouchStart);
      boardEl.removeEventListener('touchmove', handleTouchMove);
      boardEl.removeEventListener('gesturestart', preventSafariGesture);
      boardEl.removeEventListener('gesturechange', preventSafariGesture);
      boardEl.removeEventListener('gestureend', preventSafariGesture);
    };
  }, [isTouchLayout]);

  // Navegação fluida com 1 dedo pelo quadro no modo tablet (fundo e arraste rápido sobre campos).
  const startTabletBoardPan = useCallback(
    (
      pointerId: number,
      startX: number,
      startY: number,
      options?: { deselectOnTap?: boolean; immediate?: boolean; currentX?: number; currentY?: number }
    ) => {
      const initialPan = canvasPanRef.current;
      const previousUserSelect = document.body.style.userSelect;
      let moved = Boolean(options?.immediate);

      if (moved) {
        document.body.style.userSelect = 'none';
        window.getSelection()?.removeAllRanges();
      }

      if (moved && options?.currentX !== undefined && options?.currentY !== undefined) {
        const nextPan = {
          x: initialPan.x + (options.currentX - startX),
          y: initialPan.y + (options.currentY - startY),
        };
        canvasPanRef.current = nextPan;
        setCanvasPan(nextPan);
        setIsPanning(true);
      }

      const cleanup = () => {
        document.body.style.userSelect = previousUserSelect;
        setIsPanning(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('anotado:sticky-pinch-start', onAbortForPinch);
      };

      const onAbortForPinch = () => {
        cleanup();
      };

      const onMove = (pointer: PointerEvent) => {
        if (pointer.pointerId !== pointerId) return;
        if (isPinchingRef.current) {
          cleanup();
          return;
        }
        const dx = pointer.clientX - startX;
        const dy = pointer.clientY - startY;
        if (!moved) {
          if (Math.hypot(dx, dy) <= 6) return;
          moved = true;
          document.body.style.userSelect = 'none';
          window.getSelection()?.removeAllRanges();
          setIsPanning(true);
        }
        const nextPan = { x: initialPan.x + dx, y: initialPan.y + dy };
        canvasPanRef.current = nextPan;
        setCanvasPan(nextPan);
      };

      const onCancel = (pointer: PointerEvent) => {
        if (pointer.pointerId !== pointerId) return;
        cleanup();
      };

      const onEnd = (pointer: PointerEvent) => {
        if (pointer.pointerId !== pointerId) return;
        cleanup();
        if (!moved && options?.deselectOnTap && !isPinchingRef.current) {
          setSelectedNoteId(null);
          if (document.activeElement instanceof HTMLElement && boardScrollRef.current?.contains(document.activeElement)) {
            document.activeElement.blur();
          }
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('anotado:sticky-pinch-start', onAbortForPinch);
    },
    []
  );

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

  const applyDeviceLayoutState = useCallback(
    (targetType: StickyLayoutType, nextLayout: StickyBoardLayoutData | null) => {
      const nextMap = { ...deviceLayoutsRef.current, [targetType]: nextLayout };
      deviceLayoutsRef.current = nextMap;
      setDeviceLayouts(nextMap);
    },
    []
  );

  const commitAndSaveDeviceLayout = useCallback(
    async (targetType: StickyLayoutType, nextLayout: StickyBoardLayoutData) => {
      applyDeviceLayoutState(targetType, nextLayout);
      const uid = userIdRef.current || 'demo-user';
      setSaveState('saving');
      setSaveError(null);
      try {
        await saveStickyBoardLayout(uid, targetType, nextLayout);
        setSaveState(uid !== 'demo-user' ? 'saved' : 'idle');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Erro ao salvar posicionamento deste dispositivo.';
        setSaveState('error');
        setSaveError(message);
      }
    },
    [applyDeviceLayoutState]
  );

  const centerViewportOnStick = useCallback((target: StickyNote) => {
    const applyCenter = () => {
      const viewport = boardScrollRef.current;
      if (!viewport || viewport.clientWidth === 0 || viewport.clientHeight === 0) return false;
      const element = document.getElementById('sticky-note-' + target.id);
      const resolvedFrame = resolvedLayoutRef.current?.noteFrames[target.id];
      const zoom = canvasZoomRef.current || 1;
      if (resolvedFrame) {
        const nextPan = {
          x: Math.round(viewport.clientWidth / 2 - (resolvedFrame.x + resolvedFrame.width / 2) * zoom),
          y: Math.round(viewport.clientHeight / 2 - (resolvedFrame.y + resolvedFrame.height / 2) * zoom),
        };
        canvasPanRef.current = nextPan;
        setCanvasPan(nextPan);
        return true;
      }
      const measuredHeight =
        target.height_px ??
        noteHeightsRef.current[target.id] ??
        (element && element.offsetHeight > 0 ? element.offsetHeight : undefined);
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

  // Carrega o layout específico do dispositivo sempre que o usuário e a modalidade estiverem prontos.
  useEffect(() => {
    if (!isResolved || !userId) return;
    const key = `${userId}:${layoutType}`;
    if (loadedLayoutKeysRef.current.has(key)) return;
    loadedLayoutKeysRef.current.add(key);

    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchStickyBoardLayout(userId, layoutType);
        if (cancelled) return;
        applyDeviceLayoutState(layoutType, result.data);
      } catch (error) {
        console.warn('[Stick] Erro ao carregar layout independente do dispositivo:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isResolved, userId, layoutType, applyDeviceLayoutState]);

  // Carrega usuário autenticado, notas adesivas, grupos e layout inicial do dispositivo.
  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const authUser = await getAuthenticatedStickyUser();
        const uid = authUser?.userId || 'demo-user';
        const email = authUser?.email || '';
        const initialLayoutType = layoutTypeRef.current;

        if (!isMounted) return;
        setUserId(uid);
        setUserEmail(email);

        if (authUser?.userId) {
          const layoutCacheKey = `${authUser.userId}:${initialLayoutType}`;
          loadedLayoutKeysRef.current.add(layoutCacheKey);

          const [loaded, loadedGroups, activeReminderIds, initialLayoutResult] = await Promise.all([
            fetchStickyNotes(authUser.userId),
            fetchStickyNoteGroups(authUser.userId),
            fetchStickyReminderNoteIds(authUser.userId).catch((reminderError) => {
              console.warn('[Stick] Não foi possível carregar os indicadores de lembrete:', reminderError);
              return [] as string[];
            }),
            fetchStickyBoardLayout(authUser.userId, initialLayoutType).catch((layoutError) => {
              console.warn('[Stick] Não foi possível carregar o layout salvo do dispositivo:', layoutError);
              return { data: null, source: 'none' as const, tableMissing: false };
            }),
          ]);
          if (!isMounted) return;

          applyDeviceLayoutState(initialLayoutType, initialLayoutResult.data);

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
          const demoKey = `demo-user:${initialLayoutType}`;
          loadedLayoutKeysRef.current.add(demoKey);
          const localLayout = await fetchStickyBoardLayout('demo-user', initialLayoutType);
          if (isMounted) {
            applyDeviceLayoutState(initialLayoutType, localLayout.data);
          }

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
  }, [centerViewportOnStick, applyDeviceLayoutState]);

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
    const activeType = layoutTypeRef.current;
    const viewport = boardScrollRef.current;
    const rect = viewport?.getBoundingClientRect();

    // Calcula posição inteligente sem sobreposição para a tabela base (desktop),
    // preservando integralmente todos os Sticks posicionados manualmente.
    const desktopPos = computeSmartDesktopNewStickPosition({
      notes: currentNotes,
      resolvedDesktopFrames:
        activeType === 'desktop' ? resolvedLayoutRef.current?.noteFrames : undefined,
      noteHeights: noteHeightsRef.current,
      viewportRect: activeType === 'desktop' && rect ? { width: rect.width, height: rect.height } : null,
      canvasPan: canvasPanRef.current,
      canvasZoom: canvasZoomRef.current,
      widthPx: STICKY_DEFAULT_WIDTH,
    });

    setSaveState('saving');
    setSaveError(null);
    setLoadError(null);

    try {
      const created = await createStickyNote(uid, {
        title: '',
        content: '',
        color: activeColor,
        position_x: desktopPos.x,
        position_y: desktopPos.y,
        width_px: STICKY_DEFAULT_WIDTH,
        z_index: nextZ,
      });

      const nextNotes = [...notesRef.current, created];
      notesRef.current = nextNotes;
      setNotes(nextNotes);
      setSelectedNoteId(created.id);
      setNewlyCreatedId(created.id);

      // Se o dispositivo ativo já possui layout salvo personalizado, registra o novo Stick
      // em um espaço livre sem alterar as posições manuais existentes neste ou nos outros dispositivos.
      const existingDeviceLayout = deviceLayoutsRef.current[activeType] ?? null;
      if (existingDeviceLayout) {
        const vpWidth = viewport?.clientWidth || boardViewportWidth;
        const nextResolved = resolveBoardLayout({
          layoutType: activeType,
          notes: nextNotes,
          groups: groupsRef.current,
          savedLayout: existingDeviceLayout,
          viewportWidth: vpWidth,
          noteHeights: noteHeightsRef.current,
        });
        const nextLayoutData = snapshotResolvedLayout(
          nextResolved,
          nextNotes,
          existingDeviceLayout,
          vpWidth
        );
        await commitAndSaveDeviceLayout(activeType, nextLayoutData);
      } else {
        setSaveState(uid !== 'demo-user' ? 'saved' : 'idle');
      }

      if (activeType !== 'desktop') {
        centerViewportOnStick(created);
      } else if (rect) {
        const zoom = canvasZoomRef.current || 1;
        const pan = canvasPanRef.current;
        const screenX = desktopPos.x * zoom + pan.x;
        const screenY = desktopPos.y * zoom + pan.y;
        const outOfView =
          screenX < 0 ||
          screenY < 0 ||
          screenX + STICKY_DEFAULT_WIDTH * zoom > rect.width ||
          screenY + 200 * zoom > rect.height;
        if (outOfView) {
          centerViewportOnStick(created);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao criar Stick.';
      setSaveState('error');
      setSaveError(message);
    }
  }, [
    activeColor,
    getNextZIndex,
    boardViewportWidth,
    commitAndSaveDeviceLayout,
    centerViewportOnStick,
  ]);

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

  const handleNoteHeightChange = useCallback(
    (noteId: string, height: number) => {
      const previousHeight = noteHeightsRef.current[noteId] || 0;
      noteHeightsRef.current[noteId] = height;
      setNoteHeights((previous) =>
        previous[noteId] === height ? previous : { ...previous, [noteId]: height }
      );

      // No tablet e no mobile, o layout próprio de cada dispositivo controla as posições
      // sem nunca alterar position_y da versão desktop.
      if (layoutTypeRef.current !== 'desktop') return;

      // Durante arraste ou redimensionamento manual, não empurra cartões no meio do gesto.
      if (resizingNoteIdRef.current === noteId || draggingNoteIdRef.current) return;

      // Só empurra os outros Sticks quando este cartão cresce ao digitar,
      // sem reorganizar posições ao carregar.
      if (!previousHeight || height <= previousHeight + 1) return;
      const frames = resolvedLayoutRef.current?.noteFrames;
      const sourceNote = notesRef.current.find((note) => note.id === noteId);
      if (!sourceNote) return;
      const sourceFrame = frames?.[noteId] ?? {
        x: sourceNote.position_x,
        y: sourceNote.position_y,
        width: sourceNote.width_px,
        height,
      };

      const gap = 16;
      const candidates = notesRef.current
        .filter((note) => {
          if (note.id === noteId) return false;
          const frame = frames?.[note.id];
          const nx = frame ? frame.x : note.position_x;
          const ny = frame ? frame.y : note.position_y;
          const nw = frame ? frame.width : note.width_px;
          return (
            nx < sourceFrame.x + sourceFrame.width &&
            nx + nw > sourceFrame.x &&
            ny >= sourceFrame.y
          );
        })
        .sort((a, b) => {
          const ay = frames?.[a.id]?.y ?? a.position_y;
          const by = frames?.[b.id]?.y ?? b.position_y;
          return ay - by;
        });

      const nextY = new Map<string, number>();
      const placed: Array<{ x: number; y: number; width: number; height: number }> = [
        { x: sourceFrame.x, y: sourceFrame.y, width: sourceFrame.width, height },
      ];
      for (const note of candidates) {
        const frame = frames?.[note.id];
        const nx = frame ? frame.x : note.position_x;
        const nw = frame ? frame.width : note.width_px;
        const startY = frame ? frame.y : note.position_y;
        let y = startY;
        const noteHeight =
          frame?.heightPx ?? note.height_px ?? noteHeightsRef.current[note.id] ?? 280;
        let moved = true;
        while (moved) {
          moved = false;
          for (const above of placed) {
            const horizontalOverlap = nx < above.x + above.width && nx + nw > above.x;
            const verticalOverlap = y < above.y + above.height + gap && y + noteHeight > above.y;
            if (horizontalOverlap && verticalOverlap) {
              y = above.y + above.height + gap;
              moved = true;
            }
          }
        }
        if (y !== startY) {
          nextY.set(note.id, Math.round(y));
        }
        placed.push({ x: nx, y, width: nw, height: noteHeight });
      }

      if (nextY.size) {
        const updatedNotes = notesRef.current.map((note) => {
          const y = nextY.get(note.id);
          return y !== undefined && y !== note.position_y ? { ...note, position_y: y } : note;
        });
        notesRef.current = updatedNotes;
        setNotes(updatedNotes);

        nextY.forEach((y, id) => {
          void persistPatch(id, { position_y: y });
        });

        const desktopLayout = deviceLayoutsRef.current.desktop;
        const resolved = resolvedLayoutRef.current;
        if (desktopLayout && resolved) {
          const updatedDesktop = snapshotResolvedLayout(
            resolved,
            updatedNotes,
            desktopLayout,
            boardScrollRef.current?.clientWidth
          );
          const now = new Date().toISOString();
          nextY.forEach((y, id) => {
            const existing = updatedDesktop.notes[id];
            if (existing) {
              updatedDesktop.notes[id] = { ...existing, y, updated_at: now };
            }
          });
          updatedDesktop.updated_at = now;
          void commitAndSaveDeviceLayout('desktop', updatedDesktop);
        }
      }
    },
    [persistPatch, commitAndSaveDeviceLayout]
  );

  const noteIdsKey = useMemo(() => notes.map((note) => note.id).join(','), [notes]);

  // A medição de altura fica no quadro e depende apenas da lista de IDs (nunca de x/y),
  // evitando desconectar e recriar ResizeObservers durante cada pixel de arraste.
  useLayoutEffect(() => {
    if (isLoading || typeof ResizeObserver === 'undefined') return;

    const elements = notesRef.current
      .map((note) => document.getElementById('sticky-note-' + note.id))
      .filter((element): element is HTMLElement => Boolean(element));

    const reportHeight = (element: HTMLElement) => {
      const noteId = element.dataset.stickyNoteId;
      if (!noteId) return;
      const height = Math.ceil(element.offsetHeight);
      if (height > 0) handleNoteHeightChange(noteId, height);
    };

    elements.forEach(reportHeight);
    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => reportHeight(entry.target as HTMLElement));
    });
    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, [noteIdsKey, isLoading, handleNoteHeightChange]);

  const handleMoveStart = useCallback((noteId: string) => {
    draggingNoteIdRef.current = noteId;
  }, []);

  const handleMoveLive = useCallback(
    (noteId: string, x: number, y: number) => {
      const activeType = layoutTypeRef.current;
      const safeX = activeType === 'desktop' ? Math.round(x) : Math.max(12, Math.round(x));
      const safeY = activeType === 'desktop' ? Math.round(y) : Math.max(12, Math.round(y));
      const resolved = resolvedLayoutRef.current;

      if (resolved) {
        const nextLayout = commitStickMoveToLayout({
          resolved,
          notes: notesRef.current,
          previousLayout: deviceLayoutsRef.current[activeType] ?? null,
          noteId,
          x: safeX,
          y: safeY,
          viewportWidth: boardScrollRef.current?.clientWidth,
        });
        applyDeviceLayoutState(activeType, nextLayout);
      }

      if (activeType === 'desktop') {
        const next = notesRef.current.map((item) =>
          item.id === noteId ? { ...item, position_x: safeX, position_y: safeY } : item
        );
        notesRef.current = next;
        setNotes(next);
      }
    },
    [applyDeviceLayoutState]
  );

  const handleMoveEnd = useCallback(
    (noteId: string, x: number, y: number) => {
      draggingNoteIdRef.current = null;
      const activeType = layoutTypeRef.current;
      const safeX = activeType === 'desktop' ? Math.round(x) : Math.max(12, Math.round(x));
      const safeY = activeType === 'desktop' ? Math.round(y) : Math.max(12, Math.round(y));
      const target = notesRef.current.find((n) => n.id === noteId);
      const resolved = resolvedLayoutRef.current;

      // Soltar um Stick sobre um campo o adiciona automaticamente ao agrupamento,
      // mantendo a cor original do Stick e preservando o isolamento de layout entre dispositivos.
      const noteElement = document.getElementById('sticky-note-' + noteId);
      const noteRect = noteElement?.getBoundingClientRect();
      let hitGroupId: string | undefined;
      if (noteRect) {
        const centerX = noteRect.left + noteRect.width / 2;
        const centerY = noteRect.top + noteRect.height / 2;
        const hitGroup = Array.from(
          document.querySelectorAll<HTMLElement>('[data-sticky-group-id]')
        ).find((element) => {
          const rect = element.getBoundingClientRect();
          return (
            centerX >= rect.left &&
            centerX <= rect.right &&
            centerY >= rect.top &&
            centerY <= rect.bottom
          );
        });
        hitGroupId = hitGroup?.dataset.stickyGroupId;
      }

      if (hitGroupId && target && target.group_id !== hitGroupId) {
        if (activeType === 'desktop') {
          const members = notesRef.current.filter(
            (note) => note.group_id === hitGroupId && note.id !== noteId
          );
          const memberFrames = members.map((member) => {
            const frame = resolved?.noteFrames[member.id];
            return {
              x: frame ? frame.x : member.position_x,
              y: frame ? frame.y : member.position_y,
              width: frame ? frame.width : member.width_px,
            };
          });
          const maxRight = memberFrames.reduce((right, f) => Math.max(right, f.x + f.width), 0);
          const rowY = memberFrames.length ? Math.min(...memberFrames.map((f) => f.y)) : safeY;
          const nextX = memberFrames.length ? Math.round(maxRight + 18) : safeX;

          const updatedNotes = notesRef.current.map((note) =>
            note.id === noteId
              ? { ...note, group_id: hitGroupId, position_x: nextX, position_y: rowY }
              : note
          );
          notesRef.current = updatedNotes;
          setNotes(updatedNotes);

          if (resolved) {
            const nextLayout = commitStickMoveToLayout({
              resolved,
              notes: updatedNotes,
              previousLayout: deviceLayoutsRef.current.desktop ?? null,
              noteId,
              x: nextX,
              y: rowY,
              groupId: hitGroupId,
              viewportWidth: boardScrollRef.current?.clientWidth,
            });
            void commitAndSaveDeviceLayout('desktop', nextLayout);
          }

          void persistPatch(noteId, {
            group_id: hitGroupId,
            position_x: nextX,
            position_y: rowY,
            z_index: target.z_index,
          });
          return;
        }

        // Em tablet/mobile: vincula ao campo sem alterar coordenadas desktop em sticky_notes,
        // e encaixa o Stick em um espaço livre dentro do campo no layout do dispositivo ativo.
        const updatedNotes = notesRef.current.map((note) =>
          note.id === noteId ? { ...note, group_id: hitGroupId } : note
        );
        notesRef.current = updatedNotes;
        setNotes(updatedNotes);

        const vpWidth = boardScrollRef.current?.clientWidth || boardViewportWidth;
        const currentSaved = deviceLayoutsRef.current[activeType] ?? null;
        const cleanedSaved: StickyBoardLayoutData | null = currentSaved
          ? {
              ...currentSaved,
              notes: Object.fromEntries(
                Object.entries(currentSaved.notes).filter(([id]) => id !== noteId)
              ),
            }
          : null;
        const nextResolved = resolveBoardLayout({
          layoutType: activeType,
          notes: updatedNotes,
          groups: groupsRef.current,
          savedLayout: cleanedSaved,
          viewportWidth: vpWidth,
          noteHeights: noteHeightsRef.current,
        });
        const nextLayout = snapshotResolvedLayout(
          nextResolved,
          updatedNotes,
          cleanedSaved,
          vpWidth
        );
        if (nextLayout.notes[noteId]) {
          nextLayout.notes[noteId] = {
            ...nextLayout.notes[noteId],
            group_id: hitGroupId,
            manual: true,
          };
        }
        void commitAndSaveDeviceLayout(activeType, nextLayout);
        void persistPatch(noteId, { group_id: hitGroupId });
        return;
      }

      // Movimentação normal dentro do dispositivo ativo: salva apenas o layout deste dispositivo.
      if (resolved) {
        const nextLayout = commitStickMoveToLayout({
          resolved,
          notes: notesRef.current,
          previousLayout: deviceLayoutsRef.current[activeType] ?? null,
          noteId,
          x: safeX,
          y: safeY,
          viewportWidth: boardScrollRef.current?.clientWidth,
        });
        void commitAndSaveDeviceLayout(activeType, nextLayout);
      }

      if (activeType === 'desktop') {
        const updatedNotes = notesRef.current.map((item) =>
          item.id === noteId ? { ...item, position_x: safeX, position_y: safeY } : item
        );
        notesRef.current = updatedNotes;
        setNotes(updatedNotes);
        void persistPatch(noteId, {
          position_x: safeX,
          position_y: safeY,
          z_index: target?.z_index,
        });
      }
    },
    [boardViewportWidth, commitAndSaveDeviceLayout, persistPatch]
  );

  const handleResizeStart = useCallback((noteId: string) => {
    const target = notesRef.current.find((item) => item.id === noteId);
    const frame = resolvedLayoutRef.current?.noteFrames[noteId];
    resizingNoteIdRef.current = noteId;
    resizeInitialSizeRef.current = frame
      ? {
          width_px: frame.width,
          height_px: frame.heightPx,
          position_x: frame.x,
          position_y: frame.y,
        }
      : target
        ? {
            width_px: target.width_px,
            height_px: target.height_px ?? null,
            position_x: target.position_x,
            position_y: target.position_y,
          }
        : null;
  }, []);

  const handleResizeLive = useCallback(
    (noteId: string, size: StickyResizePatch) => {
      if (size.height_px != null) noteHeightsRef.current[noteId] = size.height_px;
      const activeType = layoutTypeRef.current;
      const resolved = resolvedLayoutRef.current;

      if (resolved) {
        const nextLayout = commitStickResizeToLayout({
          resolved,
          notes: notesRef.current,
          previousLayout: deviceLayoutsRef.current[activeType] ?? null,
          noteId,
          size,
          viewportWidth: boardScrollRef.current?.clientWidth,
        });
        applyDeviceLayoutState(activeType, nextLayout);
      }

      if (activeType === 'desktop') {
        const next = notesRef.current.map((item) =>
          item.id === noteId
            ? {
                ...item,
                width_px: size.width_px,
                ...(size.height_px !== undefined ? { height_px: size.height_px } : {}),
                ...(size.position_x !== undefined ? { position_x: size.position_x } : {}),
                ...(size.position_y !== undefined ? { position_y: size.position_y } : {}),
              }
            : item
        );
        notesRef.current = next;
        setNotes(next);
      }
    },
    [applyDeviceLayoutState]
  );

  const handleResizeEnd = useCallback(
    (noteId: string, size: StickyResizePatch) => {
      const initial = resizeInitialSizeRef.current;
      resizingNoteIdRef.current = null;
      resizeInitialSizeRef.current = null;

      const activeType = layoutTypeRef.current;
      const nextHeight = size.height_px ?? null;
      const widthChanged = !initial || initial.width_px !== size.width_px;
      const heightChanged = !initial || initial.height_px !== nextHeight;
      const xChanged = !initial || initial.position_x !== (size.position_x ?? initial.position_x);
      const yChanged = !initial || initial.position_y !== (size.position_y ?? initial.position_y);
      if (!widthChanged && !heightChanged && !xChanged && !yChanged) return;

      const resolved = resolvedLayoutRef.current;
      if (resolved) {
        const nextLayout = commitStickResizeToLayout({
          resolved,
          notes: notesRef.current,
          previousLayout: deviceLayoutsRef.current[activeType] ?? null,
          noteId,
          size,
          viewportWidth: boardScrollRef.current?.clientWidth,
        });
        void commitAndSaveDeviceLayout(activeType, nextLayout);
      }

      // Somente o desktop sincroniza dimensões/coordenadas na tabela base sticky_notes.
      // Tablet e mobile salvam exclusivamente em sticky_board_layouts (layout_type próprio).
      if (activeType !== 'desktop') return;

      const patch: UpdateStickyNotePatch = { width_px: size.width_px };
      if (heightChanged) patch.height_px = nextHeight;
      if (xChanged && size.position_x !== undefined) patch.position_x = size.position_x;
      if (yChanged && size.position_y !== undefined) patch.position_y = size.position_y;
      void persistPatch(noteId, patch);
    },
    [commitAndSaveDeviceLayout, persistPatch]
  );

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      const timer = debounceTimersRef.current.get(noteId);
      if (timer) {
        clearTimeout(timer);
        debounceTimersRef.current.delete(noteId);
      }
      pendingPatchesRef.current.delete(noteId);

      const snapshot = notesRef.current;
      const nextNotes = snapshot.filter((item) => item.id !== noteId);
      notesRef.current = nextNotes;
      setNotes(nextNotes);
      setSelectedNoteId((prev) => (prev === noteId ? null : prev));
      setReminderNoteIds((prev) => {
        const next = new Set(prev);
        next.delete(noteId);
        return next;
      });

      const activeType = layoutTypeRef.current;
      const currentSaved = deviceLayoutsRef.current[activeType];
      if (currentSaved && currentSaved.notes[noteId]) {
        const remainingNotes = { ...currentSaved.notes };
        delete remainingNotes[noteId];
        void commitAndSaveDeviceLayout(activeType, {
          ...currentSaved,
          notes: remainingNotes,
          updated_at: new Date().toISOString(),
        });
      }

      const uid = userIdRef.current;
      if (!uid || uid === 'demo-user') return;

      setSaveState('saving');
      setSaveError(null);
      try {
        await deleteStickyNote(uid, noteId);
        setSaveState('saved');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro ao excluir Stick.';
        notesRef.current = snapshot;
        setNotes(snapshot);
        setSaveState('error');
        setSaveError(message);
      }
    },
    [commitAndSaveDeviceLayout]
  );

  const handleCreateGroupForNote = useCallback(
    async (noteId: string) => {
      const note = notesRef.current.find((item) => item.id === noteId);
      if (!note || note.group_id) return;
      try {
        const created = await createStickyNoteGroup(
          userIdRef.current,
          (note.color || 'yellow') as StickyNoteColorKey
        );
        const nextGroups = [...groupsRef.current, created];
        groupsRef.current = nextGroups;
        setGroups(nextGroups);
        const nextNotes = notesRef.current.map((item) =>
          item.id === noteId ? { ...item, group_id: created.id } : item
        );
        notesRef.current = nextNotes;
        setNotes(nextNotes);

        const activeType = layoutTypeRef.current;
        const currentSaved = deviceLayoutsRef.current[activeType];
        if (currentSaved && currentSaved.notes[noteId]) {
          void commitAndSaveDeviceLayout(activeType, {
            ...currentSaved,
            notes: {
              ...currentSaved.notes,
              [noteId]: {
                ...currentSaved.notes[noteId],
                group_id: created.id,
                updated_at: new Date().toISOString(),
              },
            },
            updated_at: new Date().toISOString(),
          });
        }

        await persistPatch(noteId, { group_id: created.id });
      } catch (error) {
        setSaveState('error');
        setSaveError(error instanceof Error ? error.message : 'Não foi possível agrupar o Stick.');
      }
      setContextMenu(null);
    },
    [commitAndSaveDeviceLayout, persistPatch]
  );

  const handleDeleteGroup = useCallback(
    async (groupId: string, deleteSticks = false) => {
      const uid = userIdRef.current || 'demo-user';
      const affectedNotes = notesRef.current.filter((note) => note.group_id === groupId);
      const affectedIds = new Set(affectedNotes.map((note) => note.id));
      let groupWasDeleted = false;

      setIsDeletingGroup(true);
      setGroupDeletionError(null);
      setSaveState('saving');
      setSaveError(null);

      try {
        await deleteStickyNoteGroup(uid, groupId, deleteSticks);
        groupWasDeleted = true;

        const nextGroups = groupsRef.current.filter((group) => group.id !== groupId);
        groupsRef.current = nextGroups;
        setGroups(nextGroups);

        const nextNotes = deleteSticks
          ? notesRef.current.filter((note) => note.group_id !== groupId)
          : notesRef.current.map((note) =>
              note.group_id === groupId ? { ...note, group_id: null } : note
            );
        notesRef.current = nextNotes;
        setNotes(nextNotes);

        if (deleteSticks) {
          affectedIds.forEach((id) => {
            const timer = debounceTimersRef.current.get(id);
            if (timer) clearTimeout(timer);
            debounceTimersRef.current.delete(id);
            pendingPatchesRef.current.delete(id);
            editorActionsRef.current.delete(id);
          });
          setSelectedNoteId((current) => (current && affectedIds.has(current) ? null : current));
          setReminderNoteIds((current) => {
            const next = new Set(current);
            affectedIds.forEach((id) => next.delete(id));
            return next;
          });
          setNoteHeights((current) => {
            const next = { ...current };
            affectedIds.forEach((id) => delete next[id]);
            noteHeightsRef.current = next;
            return next;
          });
        }

        setDeleteGroupConfirmationId(null);
        setGroupDeletionError(null);
        setContextMenu(null);

        // Limpa os registros do campo em todos os layouts, sem compartilhar ou
        // sobrescrever coordenadas entre desktop, tablet e mobile.
        const layoutTypes: StickyLayoutType[] = ['desktop', 'tablet', 'mobile'];
        const layoutErrors: string[] = [];
        const now = new Date().toISOString();

        for (const targetType of layoutTypes) {
          try {
            let savedLayout = deviceLayoutsRef.current[targetType];
            if (savedLayout === undefined) {
              savedLayout = (await fetchStickyBoardLayout(uid, targetType)).data;
            }
            if (!savedLayout) continue;

            const nextSavedNotes = { ...savedLayout.notes };
            affectedIds.forEach((id) => {
              if (deleteSticks) {
                delete nextSavedNotes[id];
              } else if (nextSavedNotes[id]) {
                nextSavedNotes[id] = {
                  ...nextSavedNotes[id],
                  group_id: null,
                  updated_at: now,
                };
              }
            });

            const nextSavedGroups = { ...savedLayout.groups };
            delete nextSavedGroups[groupId];
            const nextLayout = {
              ...savedLayout,
              notes: nextSavedNotes,
              groups: nextSavedGroups,
              updated_at: now,
            };

            applyDeviceLayoutState(targetType, nextLayout);
            await saveStickyBoardLayout(uid, targetType, nextLayout);
          } catch (layoutError) {
            layoutErrors.push(
              layoutError instanceof Error
                ? layoutError.message
                : `Não foi possível atualizar o layout ${targetType}.`
            );
          }
        }

        if (layoutErrors.length) {
          setSaveState('error');
          setSaveError(
            `O campo foi excluído, mas houve falha ao sincronizar um ou mais layouts: ${layoutErrors.join(' ')}`
          );
        } else {
          setSaveState(uid !== 'demo-user' ? 'saved' : 'idle');
        }
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'Não foi possível excluir o campo.';
        if (!groupWasDeleted) {
          setGroupDeletionError(message);
        } else {
          setSaveError(`O campo foi excluído, mas ocorreu um erro ao atualizar os layouts: ${message}`);
          setSaveState('error');
        }
      } finally {
        setIsDeletingGroup(false);
        setContextMenu(null);
      }
    },
    [applyDeviceLayoutState]
  );

  const handleGroupPointerDown = useCallback(
    (groupId: string, event: React.PointerEvent<HTMLDivElement>) => {
      if (isPinchingRef.current) return;

      // No tablet e mobile com toque: movimentação do campo somente após pressionar e segurar por
      // 1,5 segundo completo. Antes disso, o menu contextual permanece disponível e o gesto persiste
      // exclusivamente no layout do dispositivo atual (sem alterar desktop).
      if (isTouchLayout && event.pointerType !== 'mouse') {
        const targetEl = event.target as HTMLElement | null;
        if (targetEl?.closest('input, button, textarea, a, [contenteditable="true"]')) return;
        const members = notesRef.current.filter((note) => note.group_id === groupId);

        event.stopPropagation();
        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startY = event.clientY;
        let currentClientX = startX;
        let currentClientY = startY;
        let dragStartX = startX;
        let dragStartY = startY;
        let activated = false;
        let aborted = false;

        const startLayoutType = layoutTypeRef.current;
        let startResolved: ResolvedBoardLayout | null = null;
        let startSavedLayout: StickyBoardLayoutData | null = null;

        let contextMenuTimer: ReturnType<typeof setTimeout> | null = null;
        let holdTimer: ReturnType<typeof setTimeout> | null = null;

        contextMenuTimer = setTimeout(() => {
          if (!activated && !aborted) {
            setContextMenu({
              kind: 'group',
              id: groupId,
              x: Math.max(12, Math.min(startX - 110, window.innerWidth - 242)),
              y: Math.max(12, Math.min(startY + 12, window.innerHeight - 292)),
            });
          }
        }, TABLET_CONTEXT_MENU_DELAY_MS);

        const clearHoldTimers = () => {
          if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
          }
          if (contextMenuTimer) {
            clearTimeout(contextMenuTimer);
            contextMenuTimer = null;
          }
        };

        const cleanup = () => {
          clearHoldTimers();
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onFinish);
          window.removeEventListener('pointercancel', onCancel);
          window.removeEventListener('anotado:sticky-pinch-start', onAbortForPinch);
          setTouchMovingGroupId((prev) => (prev === groupId ? null : prev));
          setMovingGroupNoteIds(new Set());
        };

        const restoreBaseLayout = () => {
          applyDeviceLayoutState(startLayoutType, startSavedLayout);
        };

        const onAbortForPinch = () => {
          if (aborted) return;
          aborted = true;
          const wasActivated = activated;
          cleanup();
          if (wasActivated) restoreBaseLayout();
          setContextMenu(null);
        };

        if (members.length) {
          holdTimer = setTimeout(() => {
            if (aborted || isPinchingRef.current) return;
            clearHoldTimers();
            activated = true;
            dragStartX = currentClientX;
            dragStartY = currentClientY;
            startResolved = resolvedLayoutRef.current;
            startSavedLayout = deviceLayoutsRef.current[startLayoutType] ?? null;
            setContextMenu(null);
            setTouchMovingGroupId(groupId);
            setMovingGroupNoteIds(new Set(members.map((member) => member.id)));
            try {
              navigator.vibrate?.(35);
            } catch {
              // Alguns tablets/navegadores não oferecem vibração háptica.
            }
          }, TABLET_GROUP_HOLD_MS);
        }

        const onMove = (pointer: PointerEvent) => {
          if (pointer.pointerId !== pointerId) return;
          if (isPinchingRef.current) {
            onAbortForPinch();
            return;
          }
          currentClientX = pointer.clientX;
          currentClientY = pointer.clientY;

          if (!activated) {
            if (
              Math.hypot(pointer.clientX - startX, pointer.clientY - startY) >
              TABLET_HOLD_CANCEL_PX
            ) {
              aborted = true;
              cleanup();
              setContextMenu(null);
              startTabletBoardPan(pointerId, startX, startY, {
                immediate: true,
                currentX: pointer.clientX,
                currentY: pointer.clientY,
              });
            }
            return;
          }

          if (!startResolved) return;
          const zoom = canvasZoomRef.current || 1;
          const dx = Math.round((pointer.clientX - dragStartX) / zoom);
          const dy = Math.round((pointer.clientY - dragStartY) / zoom);
          const nextLayout = commitGroupMoveToLayout({
            resolved: startResolved,
            notes: notesRef.current,
            previousLayout: startSavedLayout,
            groupId,
            dx,
            dy,
            viewportWidth: boardScrollRef.current?.clientWidth,
          });
          applyDeviceLayoutState(startLayoutType, nextLayout);
        };

        const onCancel = (pointer: PointerEvent) => {
          if (pointer.pointerId !== pointerId) return;
          const wasActivated = activated;
          aborted = true;
          cleanup();
          if (wasActivated) restoreBaseLayout();
        };

        const onFinish = (pointer: PointerEvent) => {
          if (pointer.pointerId !== pointerId) return;
          const wasActivated = activated;
          const wasAborted = aborted;
          cleanup();
          if (!wasActivated || wasAborted || !startResolved) return;

          const zoom = canvasZoomRef.current || 1;
          const dx = Math.round((pointer.clientX - dragStartX) / zoom);
          const dy = Math.round((pointer.clientY - dragStartY) / zoom);
          const finalLayout = commitGroupMoveToLayout({
            resolved: startResolved,
            notes: notesRef.current,
            previousLayout: startSavedLayout,
            groupId,
            dx,
            dy,
            viewportWidth: boardScrollRef.current?.clientWidth,
          });
          // Salva exclusivamente no layout do dispositivo atual (tablet ou mobile),
          // preservando integralmente as posições desktop em sticky_notes.
          void commitAndSaveDeviceLayout(startLayoutType, finalLayout);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onFinish);
        window.addEventListener('pointercancel', onCancel);
        window.addEventListener('anotado:sticky-pinch-start', onAbortForPinch);
        return;
      }

      if ((event.button !== 0 && event.pointerType === 'mouse') || event.target !== event.currentTarget)
        return;
      event.preventDefault();
      event.stopPropagation();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const zoom = canvasZoomRef.current || 1;
      const startLayoutType = layoutTypeRef.current;
      const startResolved = resolvedLayoutRef.current;
      const startSavedLayout = deviceLayoutsRef.current[startLayoutType] ?? null;
      const members = notesRef.current
        .filter((note) => note.group_id === groupId)
        .map((note) => ({ ...note }));
      if (!members.length || !startResolved) return;

      // Enquanto o agrupamento se move, desativa as transições individuais dos cartões
      // para evitar efeito de movimento fantasma.
      setMovingGroupNoteIds(new Set(members.map((member) => member.id)));
      let cancelledByPinch = false;

      const cleanup = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('anotado:sticky-pinch-start', abortForPinch);
        setMovingGroupNoteIds(new Set());
      };
      const restoreInitialPositions = () => {
        applyDeviceLayoutState(startLayoutType, startSavedLayout);
        if (startLayoutType === 'desktop') {
          const restored = notesRef.current.map((note) => {
            const initial = members.find((member) => member.id === note.id);
            return initial
              ? { ...note, position_x: initial.position_x, position_y: initial.position_y }
              : note;
          });
          notesRef.current = restored;
          setNotes(restored);
        }
      };
      const abortForPinch = () => {
        if (cancelledByPinch) return;
        cancelledByPinch = true;
        cleanup();
        restoreInitialPositions();
      };
      const move = (pointer: PointerEvent) => {
        if (pointer.pointerId !== pointerId) return;
        if (isPinchingRef.current) {
          abortForPinch();
          return;
        }
        const dx = (pointer.clientX - startX) / zoom;
        const dy = (pointer.clientY - startY) / zoom;
        const nextLayout = commitGroupMoveToLayout({
          resolved: startResolved,
          notes: notesRef.current,
          previousLayout: startSavedLayout,
          groupId,
          dx,
          dy,
          viewportWidth: boardScrollRef.current?.clientWidth,
        });
        applyDeviceLayoutState(startLayoutType, nextLayout);

        if (startLayoutType === 'desktop') {
          const next = notesRef.current.map((note) => {
            const entry = nextLayout.notes[note.id];
            return note.group_id === groupId && entry
              ? { ...note, position_x: entry.x, position_y: entry.y }
              : note;
          });
          notesRef.current = next;
          setNotes(next);
        }
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
        const finalLayout = commitGroupMoveToLayout({
          resolved: startResolved,
          notes: notesRef.current,
          previousLayout: startSavedLayout,
          groupId,
          dx,
          dy,
          viewportWidth: boardScrollRef.current?.clientWidth,
        });
        void commitAndSaveDeviceLayout(startLayoutType, finalLayout);

        if (startLayoutType === 'desktop') {
          const finalNotes = notesRef.current.map((note) => {
            const entry = finalLayout.notes[note.id];
            return note.group_id === groupId && entry
              ? { ...note, position_x: entry.x, position_y: entry.y }
              : note;
          });
          notesRef.current = finalNotes;
          setNotes(finalNotes);
          members.forEach((member) => {
            const entry = finalLayout.notes[member.id];
            if (entry) {
              void persistPatch(member.id, {
                position_x: entry.x,
                position_y: entry.y,
              });
            }
          });
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('anotado:sticky-pinch-start', abortForPinch);
    },
    [
      isTouchLayout,
      applyDeviceLayoutState,
      commitAndSaveDeviceLayout,
      persistPatch,
      startTabletBoardPan,
    ]
  );

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
    const viewport = boardScrollRef.current;
    if (viewport) {
      const zoom = canvasZoomRef.current || 1;
      const bound = resolvedLayoutRef.current?.groupBounds.find(
        (item) => item.group.id === groupId
      );
      if (bound) {
        const x = Math.round(viewport.clientWidth / 2 - (bound.left + bound.width / 2) * zoom);
        const fitsVertically = bound.height * zoom <= viewport.clientHeight - 40;
        const y = fitsVertically
          ? Math.round(viewport.clientHeight / 2 - (bound.top + bound.height / 2) * zoom)
          : Math.round(20 - bound.top * zoom);
        canvasPanRef.current = { x, y };
        setCanvasPan({ x, y });
        setGroupsSidebarOpen(false);
        return;
      }

      const members = notesRef.current.filter((note) => note.group_id === groupId);
      if (members.length) {
        const left = Math.min(...members.map((note) => note.position_x));
        const top = Math.min(...members.map((note) => note.position_y));
        const right = Math.max(...members.map((note) => note.position_x + note.width_px));
        const bottom = Math.max(
          ...members.map((note) => {
            const element = document.getElementById('sticky-note-' + note.id);
            return (
              note.position_y +
              (note.height_px ?? noteHeightsRef.current[note.id] ?? element?.offsetHeight ?? 280)
            );
          })
        );
        const nextPan = {
          x: viewport.clientWidth / 2 - ((left + right) / 2) * zoom,
          y: viewport.clientHeight / 2 - ((top + bottom) / 2) * zoom,
        };
        canvasPanRef.current = nextPan;
        setCanvasPan(nextPan);
      }
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
    if (isTouchLayout) return; // Em tablet/mobile, o menu contextual é aberto pelo botão explícito.
    const menuWidth = 190;
    const menuHeight = 240;
    setContextMenu({
      kind: 'note',
      id: note.id,
      x: Math.max(12, Math.min(x, window.innerWidth - menuWidth)),
      y: Math.max(12, Math.min(y, window.innerHeight - menuHeight)),
    });
  }, [isTouchLayout]);

  const handleOpenTabletNoteMenu = useCallback((note: StickyNote, x: number, y: number) => {
    const menuWidth = 230;
    const menuHeight = 310;
    setContextMenu({
      kind: 'note',
      id: note.id,
      x: Math.max(12, Math.min(x, window.innerWidth - menuWidth)),
      y: Math.max(12, Math.min(y, window.innerHeight - menuHeight)),
    });
  }, []);

  const handleGroupContextMenu = useCallback((groupId: string, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (isTouchLayout) return; // Evita o menu nativo de toque/long press; o timer do campo controla a abertura.
    event.stopPropagation();
    const menuWidth = 190;
    const menuHeight = 190;
    setContextMenu({
      kind: 'group',
      id: groupId,
      x: Math.max(12, Math.min(event.clientX, window.innerWidth - menuWidth)),
      y: Math.max(12, Math.min(event.clientY, window.innerHeight - menuHeight)),
    });
  }, [isTouchLayout]);

  const handleOpenTabletGroupMenu = useCallback((groupId: string, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    setContextMenu({
      kind: 'group',
      id: groupId,
      x: Math.max(12, Math.min(rect.right - 220, window.innerWidth - 232)),
      y: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 280)),
    });
  }, []);

  const activeSavedLayout = deviceLayouts[layoutType] ?? null;

  const resolvedLayout = useMemo(
    () =>
      resolveBoardLayout({
        layoutType,
        notes,
        groups,
        savedLayout: activeSavedLayout,
        viewportWidth: boardViewportWidth,
        noteHeights,
      }),
    [layoutType, notes, groups, activeSavedLayout, boardViewportWidth, noteHeights]
  );

  useLayoutEffect(() => {
    resolvedLayoutRef.current = resolvedLayout;
  }, [resolvedLayout]);

  const activeGroupBounds = resolvedLayout.groupBounds;

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) || null,
    [notes, selectedNoteId]
  );

  return (
    <div
      id="sticky-notes-app-container"
      data-sticky-tablet={isTablet ? 'true' : undefined}
      data-sticky-layout={layoutType}
      className={`flex flex-col ${isTouchLayout ? 'h-[100dvh]' : 'h-screen'} w-screen min-h-0 min-w-0 overflow-hidden bg-[#f7f4ed] dark:bg-[#050505] font-sans-ui`}
    >
      <AppHeader
        activeSection="sticky-notes"
        userId={userId}
        userEmail={userEmail}
        onBeforeNavigate={flushPendingPatches}
        tabletActions={isTablet ? <StickyNotesToolbar
          layoutMode="tablet-primary"
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
          highlightMode={highlightMode}
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
            highlightMode={highlightMode}
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
          onRequestDeleteGroup={(groupId) => {
            setGroupDeletionError(null);
            setDeleteGroupConfirmationId(groupId);
          }}
        />
      )}

      {deleteGroupConfirmationId && (() => {
        const targetGroup = groups.find((group) => group.id === deleteGroupConfirmationId);
        if (!targetGroup) return null;
        const stickCount = notes.filter((note) => note.group_id === targetGroup.id).length;
        return (
          <div
            className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-[2px]"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget && !isDeletingGroup) {
                setDeleteGroupConfirmationId(null);
                setGroupDeletionError(null);
              }
            }}
          >
            <section
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="sticky-delete-group-title"
              aria-describedby="sticky-delete-group-description"
              className="w-full max-w-md rounded-2xl border border-[#e5d9cc] bg-[#fffdf9] p-5 shadow-[0_18px_55px_rgba(25,18,12,.28)] dark:border-[#494038] dark:bg-[#211e1b]"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#faeae5] text-[#a24e42] dark:bg-[#3d2521] dark:text-[#f0b5a7]">
                  <AlertCircle className="h-5 w-5" />
                </span>
                <h2 id="sticky-delete-group-title" className="text-base font-semibold text-[#514235] dark:text-[#f1e7dc]">
                  Excluir campo?
                </h2>
              </div>
              <p id="sticky-delete-group-description" className="mb-4 text-sm leading-relaxed text-[#75695f] dark:text-[#c5b8aa]">
                Você está prestes a excluir <strong className="font-semibold text-[#514235] dark:text-[#f1e7dc]">{targetGroup.title || 'Campo sem título'}</strong>, que contém {stickCount} {stickCount === 1 ? 'Stick' : 'Sticks'}. Como deseja prosseguir?
              </p>

              {groupDeletionError && (
                <p role="alert" className="mb-3 rounded-lg border border-[#efc9c9] bg-[#fff3f1] px-3 py-2 text-xs leading-relaxed text-[#9b3128] dark:border-[#65342d] dark:bg-[#321d1a] dark:text-[#ffc4ba]">
                  {groupDeletionError}
                </p>
              )}

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={isDeletingGroup}
                  onClick={() => void handleDeleteGroup(targetGroup.id, false)}
                  className="flex min-h-11 w-full items-center justify-center rounded-xl border border-[#d8cfc4] bg-[#f7f2eb] px-3 py-2.5 text-sm font-medium text-[#514235] transition-colors hover:bg-[#eee5d9] disabled:cursor-wait disabled:opacity-60 dark:border-[#494038] dark:bg-[#302922] dark:text-[#eadccd] dark:hover:bg-[#3a3028]"
                >
                  {isDeletingGroup ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Excluir somente o campo e manter os Sticks
                </button>
                <button
                  type="button"
                  disabled={isDeletingGroup}
                  onClick={() => void handleDeleteGroup(targetGroup.id, true)}
                  className="flex min-h-11 w-full items-center justify-center rounded-xl bg-[#a24e42] px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#8d3f35] disabled:cursor-wait disabled:opacity-60 dark:bg-[#873c33] dark:hover:bg-[#9a493e]"
                >
                  {isDeletingGroup ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Excluir campo e todos os {stickCount} Sticks
                </button>
                <button
                  type="button"
                  disabled={isDeletingGroup}
                  onClick={() => {
                    setDeleteGroupConfirmationId(null);
                    setGroupDeletionError(null);
                  }}
                  className="mt-1 min-h-10 w-full rounded-xl px-3 py-2 text-sm font-medium text-[#75695f] transition-colors hover:bg-[#f1ece5] disabled:cursor-wait disabled:opacity-60 dark:text-[#c5b8aa] dark:hover:bg-[#302922]"
                >
                  Cancelar
                </button>
              </div>
            </section>
          </div>
        );
      })()}

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
          if (isTouchLayout && event.pointerType !== 'mouse' && isBackground && !isPinchingRef.current) {
            startTabletBoardPan(event.pointerId, event.clientX, event.clientY, { deselectOnTap: true });
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
        className="flex-1 min-h-0 min-w-0 overflow-hidden relative isolate z-0 bg-[#f7f4ed] dark:bg-[#050505] sticky-board-viewport"
        style={{
          backgroundSize: `${24 * canvasZoom}px ${24 * canvasZoom}px`,
          backgroundPosition: `${canvasPan.x}px ${canvasPan.y}px`,
          cursor: isPanning ? 'grabbing' : isSpacePressed ? 'grab' : undefined,
          touchAction: isTouchLayout ? 'none' : undefined,
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
          {activeGroupBounds.map(({group,left,top,width,height}) => {
            const palette = STICKY_COLORS.find(color => color.key === group.color) || STICKY_COLORS[0];
            const tint = palette.swatchLight;
            const isMovingThisGroup = isTouchLayout && touchMovingGroupId === group.id;
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
                title={isTouchLayout ? 'Segure por 1,5 segundo para mover este campo' : 'Arraste para mover o agrupamento; clique com o botão direito para opções'}
                style={{
                  position: 'absolute', left, top, width, height,
                  borderRadius: 22,
                  background: isMovingThisGroup
                    ? `color-mix(in srgb, ${tint} 48%, transparent)`
                    : `color-mix(in srgb, ${tint} 34%, transparent)`,
                  border: isMovingThisGroup
                    ? `3px solid color-mix(in srgb, ${tint} 92%, #68594d)`
                    : `2px solid color-mix(in srgb, ${tint} 78%, #9a7658)`,
                  boxShadow: isMovingThisGroup
                    ? '0 18px 42px rgba(45,30,18,.26)'
                    : '0 5px 18px rgba(65,45,28,.08)',
                  zIndex: 0,
                  cursor: isMovingThisGroup ? 'grabbing' : 'grab',
                  touchAction: 'none',
                }}
              />
              {isTouchLayout ? (
                <div
                  data-sticky-group-header={group.id}
                  onPointerDown={event => handleGroupPointerDown(group.id, event)}
                  onContextMenu={event => handleGroupContextMenu(group.id, event)}
                  style={{
                    position: 'absolute',
                    left: left + 12,
                    top: top + 6,
                    width: Math.max(140, width - 24),
                    height: 36,
                    zIndex: 2,
                    touchAction: 'none',
                  }}
                  className="flex items-center justify-between gap-2 px-1"
                >
                  <div className="w-9 shrink-0" aria-hidden="true" />
                  <div className="flex-1 min-w-0 text-center">
                    {editingGroupTitleId === group.id ? (
                      <input
                        autoFocus
                        value={group.title || ''}
                        onPointerDown={event => event.stopPropagation()}
                        onChange={event => handleGroupTitleChange(group.id, event.target.value)}
                        onBlur={() => void handleSaveGroupTitle(group.id)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                        }}
                        placeholder="Título do campo"
                        aria-label="Título do campo"
                        className={`w-full rounded-lg border border-transparent bg-transparent px-3 py-1 text-center text-base font-semibold outline-none placeholder:text-[#927f6a] focus:border-[#92704f]/40 dark:placeholder:text-[#a99681] ${titleColorClass}`}
                      />
                    ) : group.title ? (
                      <button
                        type="button"
                        onPointerDown={event => event.stopPropagation()}
                        onClick={() => setEditingGroupTitleId(group.id)}
                        className={`max-w-full truncate rounded-md bg-transparent px-3 py-0.5 text-base font-semibold ${titleColorClass}`}
                        title="Toque para editar o título"
                      >{group.title}</button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onPointerDown={event => event.stopPropagation()}
                    onClick={event => {
                      event.stopPropagation();
                      handleOpenTabletGroupMenu(group.id, event.currentTarget);
                    }}
                    aria-label="Opções do campo"
                    title="Opções do campo"
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/45 dark:bg-black/25 active:scale-95 ${titleColorClass}`}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              ) : (
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
              )}
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
            notes.map((note) => {
              const frame = resolvedLayout.noteFrames[note.id];
              return (
                <StickyNoteCard
                  key={note.id}
                  isTablet={isTablet}
                  isMobile={isMobile}
                  visualFrame={
                    frame
                      ? {
                          x: frame.x,
                          y: frame.y,
                          width: frame.width,
                          heightPx: frame.heightPx,
                        }
                      : undefined
                  }
                  onTabletPanStart={isTouchLayout ? startTabletBoardPan : undefined}
                  note={note}
                  isMovingWithGroup={movingGroupNoteIds.has(note.id)}
                  canvasZoom={canvasZoom}
                  isPinchingRef={isPinchingRef}
                  snapTargets={
                    (isDesktop || isTablet)
                      ? notes
                          .filter((other) => other.id !== note.id)
                          .map((other) => {
                            const otherFrame = resolvedLayout.noteFrames[other.id];
                            return {
                              id: other.id,
                              x: otherFrame ? otherFrame.x : other.position_x,
                              y: otherFrame ? otherFrame.y : other.position_y,
                              width: otherFrame ? otherFrame.width : other.width_px,
                              height:
                                otherFrame?.height ??
                                other.height_px ??
                                noteHeights[other.id] ??
                                280,
                            };
                          })
                      : []
                  }
                  isSelected={selectedNoteId === note.id}
                  highlightMode={highlightMode}
                  autoFocus={newlyCreatedId === note.id}
                  onSelect={handleSelectNote}
                  onChangeTitle={handleChangeTitle}
                  onChangeContent={handleChangeContent}
                  onChangeColor={handleChangeNoteColor}
                  onMoveStart={handleMoveStart}
                  onMoveLive={handleMoveLive}
                  onMoveEnd={handleMoveEnd}
                  onResizeStart={handleResizeStart}
                  onResizeLive={handleResizeLive}
                  onResizeEnd={handleResizeEnd}
                  onDelete={handleDeleteNote}
                  hasReminder={reminderNoteIds.has(note.id)}
                  onOpenReminder={(targetNote) => setReminderDialogNoteId(targetNote.id)}
                  onContextMenu={handleNoteContextMenu}
                  onOpenTabletNoteMenu={isTouchLayout ? handleOpenTabletNoteMenu : undefined}
                  registerEditorActions={registerEditorActions}
                  onOpenLinkedNote={handleOpenLinkedNote}
                  onPreviewLinkedNote={handlePreviewLinkedNote}
                />
              );
            })
          )}
        </div>

        {/* Indicador do modo ativo de movimentação de campo no tablet/mobile */}
        {isTouchLayout && touchMovingGroupId && (
          <div
            role="status"
            aria-live="assertive"
            className="fixed left-1/2 top-[112px] -translate-x-1/2 z-[10950] pointer-events-none flex items-center gap-2 rounded-full bg-[#68594d] dark:bg-[#3a3028] border border-[#53463c] dark:border-[#68594d] px-4 py-2 text-xs font-medium text-white shadow-xl"
          >
            <Move className="h-3.5 w-3.5 shrink-0" />
            <span>Movendo campo — arraste para posicionar e solte</span>
          </div>
        )}

        {contextMenu && <div
          className="fixed inset-0 z-[11100]"
          onPointerDown={() => setContextMenu(null)}
          onContextMenu={event => { event.preventDefault(); setContextMenu(null); }}
        >
          <div
            className={`fixed ${isTouchLayout ? 'min-w-[216px] p-2' : 'min-w-[176px] p-1.5'} rounded-xl border border-[#e5d9cc] bg-[#fffdf9] shadow-[0_12px_35px_rgba(40,28,18,.22)] dark:border-[#494038] dark:bg-[#211e1b]`}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={event => event.stopPropagation()}
          >
            {contextMenu.kind === 'note' ? <>
              {!notes.find(note => note.id === contextMenu.id)?.group_id && <button type="button" onClick={() => void handleCreateGroupForNote(contextMenu.id)} className={`w-full rounded-lg px-3 ${isTouchLayout ? 'min-h-[44px] py-2.5 text-[15px]' : 'py-2 text-sm'} text-left text-[#514235] hover:bg-[#f2ebe3] dark:text-[#eadccd] dark:hover:bg-[#342c25]`}>Agrupar</button>}
              <button type="button" onClick={() => { void handleDeleteNote(contextMenu.id); setContextMenu(null); }} className={`w-full rounded-lg px-3 ${isTouchLayout ? 'min-h-[44px] py-2.5 text-[15px]' : 'py-2 text-sm'} text-left text-[#a24e42] hover:bg-[#faeae5] dark:hover:bg-[#3d2521]`}>Excluir</button>
              <div className="my-1 border-t border-[#eee5dc] dark:border-[#40372f]"/>
              <p className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[#988777]">Mudar cor do Stick</p>
              <div className={`flex flex-wrap ${isTouchLayout ? 'gap-2.5 px-3 py-2.5' : 'gap-2 px-3 py-2'}`}>
                {STICKY_COLORS.map(color => <button key={color.key} type="button" title={color.label} onClick={() => { handleChangeNoteColor(contextMenu.id, color.key); setContextMenu(null); }} className={`${isTouchLayout ? 'h-8 w-8' : 'h-5 w-5'} rounded-full border border-black/10 ring-offset-1 hover:ring-2 hover:ring-[#80634f]`} style={{ backgroundColor: color.swatchLight }}/>)}
              </div>
            </> : <>
              <button type="button" onClick={() => { setEditingGroupTitleId(contextMenu.id); setContextMenu(null); }} className={`w-full rounded-lg px-3 ${isTouchLayout ? 'min-h-[44px] py-2.5 text-[15px]' : 'py-2 text-sm'} text-left text-[#514235] hover:bg-[#f2ebe3] dark:text-[#eadccd] dark:hover:bg-[#342c25]`}>{groups.find(group => group.id === contextMenu.id)?.title ? 'Editar título' : 'Adicionar título'}</button>
              <button type="button" onClick={() => void handleDeleteGroup(contextMenu.id)} className={`w-full rounded-lg px-3 ${isTouchLayout ? 'min-h-[44px] py-2.5 text-[15px]' : 'py-2 text-sm'} text-left text-[#514235] hover:bg-[#f2ebe3] dark:text-[#eadccd] dark:hover:bg-[#342c25]`}>Desagrupar</button>
              <div className="my-1 border-t border-[#eee5dc] dark:border-[#40372f]"/>
              <p className="px-3 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[#988777]">Mudar cor do campo</p>
              <div className={`flex flex-wrap ${isTouchLayout ? 'gap-2.5 px-3 py-2.5' : 'gap-2 px-3 py-2'}`}>
                {STICKY_COLORS.map(color => <button key={color.key} type="button" title={color.label} onClick={() => void handleGroupColor(contextMenu.id, color.key)} className={`${isTouchLayout ? 'h-8 w-8' : 'h-5 w-5'} rounded-full border border-black/10 ring-offset-1 hover:ring-2 hover:ring-[#80634f]`} style={{ backgroundColor: color.swatchLight }}/>)}
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
