import {
  STICKY_DEFAULT_WIDTH,
  STICKY_MAX_WIDTH,
  STICKY_MIN_WIDTH,
  StickyBoardLayoutData,
  StickyLayoutType,
  StickyNote,
  StickyNoteGroup,
  StickyNoteLayoutEntry,
} from '../types';
import {
  estimateStickyCardHeight,
  findNonOverlappingStickPosition,
  rectsOverlapWithGap,
  StickyRect,
} from './note-to-stick';
import { computeTabletBoardLayout, computeTabletCardWidth } from './tablet-layout';
import type { StickyResizePatch } from './sticky-interactions';

export interface ResolvedNoteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  heightPx: number | null;
  manual: boolean;
}

export interface ResolvedGroupBound {
  group: StickyNoteGroup;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ResolvedBoardLayout {
  layoutType: StickyLayoutType;
  cardWidth: number;
  noteFrames: Record<string, ResolvedNoteFrame>;
  groupBounds: ResolvedGroupBound[];
  contentWidth: number;
  contentHeight: number;
}

export interface ResolveBoardLayoutInput {
  layoutType: StickyLayoutType;
  notes: ReadonlyArray<StickyNote>;
  groups: ReadonlyArray<StickyNoteGroup>;
  savedLayout: StickyBoardLayoutData | null;
  viewportWidth: number;
  noteHeights: Record<string, number>;
}

const DESKTOP_GROUP_PAD_X = 22;
const DESKTOP_GROUP_PAD_TOP = 42;
const DESKTOP_GROUP_PAD_BOTTOM = 24;

const TABLET_GROUP_PAD_X = 18;
const TABLET_GROUP_PAD_TOP = 46;
const TABLET_GROUP_PAD_BOTTOM = 20;
const TABLET_COL_GAP = 16;
const TABLET_ROW_GAP = 18;
const TABLET_OUTER_X = 20;
const TABLET_OUTER_TOP = 24;

const MOBILE_OUTER_X = 16;
const MOBILE_OUTER_TOP = 20;
const MOBILE_GROUP_PAD_X = 14;
const MOBILE_GROUP_PAD_TOP = 44;
const MOBILE_GROUP_PAD_BOTTOM = 18;
const MOBILE_ROW_GAP = 16;
const MOBILE_SECTION_GAP = 24;

export function computeMobileCardWidth(viewportWidth: number): number {
  const safeViewport = Math.max(300, Math.round(viewportWidth || 390));
  const inner = safeViewport - MOBILE_OUTER_X * 2 - MOBILE_GROUP_PAD_X * 2;
  return Math.max(240, Math.min(420, inner));
}

function clampWidth(value: number): number {
  return Math.max(STICKY_MIN_WIDTH, Math.min(STICKY_MAX_WIDTH, Math.round(value)));
}

function sortNotesReadingOrder(list: ReadonlyArray<StickyNote>): StickyNote[] {
  if (list.length <= 1) return [...list];
  const minY = Math.min(...list.map((n) => Number(n.position_y) || 0));
  return [...list].sort((a, b) => {
    const rowA = Math.round(((Number(a.position_y) || 0) - minY) / 90);
    const rowB = Math.round(((Number(b.position_y) || 0) - minY) / 90);
    if (rowA !== rowB) return rowA - rowB;
    const xDiff = (Number(a.position_x) || 0) - (Number(b.position_x) || 0);
    if (Math.abs(xDiff) > 4) return xDiff;
    return (a.created_at || '').localeCompare(b.created_at || '');
  });
}

function resolveHeight(
  note: StickyNote,
  width: number,
  heightPx: number | null,
  noteHeights: Record<string, number>
): number {
  if (heightPx != null && heightPx > 0) return Math.round(heightPx);
  const measured = noteHeights[note.id];
  if (measured && measured > 0) return Math.round(measured);
  return estimateStickyCardHeight(note.title, note.content, width || STICKY_DEFAULT_WIDTH);
}

function hasMatchingSavedEntry(
  entry: StickyNoteLayoutEntry | undefined,
  note: StickyNote
): entry is StickyNoteLayoutEntry {
  if (!entry) return false;
  if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y)) return false;
  // Se o Stick mudou de campo em outro dispositivo, reposiciona-o de forma limpa
  // dentro do novo campo sem perturbar os demais Sticks salvos neste dispositivo.
  if (entry.group_id !== undefined && entry.group_id !== (note.group_id ?? null)) {
    return false;
  }
  return true;
}

function buildGroupBounds(
  groups: ReadonlyArray<StickyNoteGroup>,
  notes: ReadonlyArray<StickyNote>,
  noteFrames: Record<string, ResolvedNoteFrame>,
  padX: number,
  padTop: number,
  padBottom: number
): ResolvedGroupBound[] {
  const result: ResolvedGroupBound[] = [];
  for (const group of groups) {
    const members = notes.filter((note) => note.group_id === group.id);
    if (!members.length) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const member of members) {
      const frame = noteFrames[member.id];
      if (!frame) continue;
      minX = Math.min(minX, frame.x);
      minY = Math.min(minY, frame.y);
      maxX = Math.max(maxX, frame.x + frame.width);
      maxY = Math.max(maxY, frame.y + frame.height);
    }
    if (!Number.isFinite(minX)) continue;
    result.push({
      group,
      left: Math.round(minX - padX),
      top: Math.round(minY - padTop),
      width: Math.round(maxX - minX + padX * 2),
      height: Math.round(maxY - minY + padTop + padBottom),
    });
  }
  return result;
}

function computeContentExtents(
  noteFrames: Record<string, ResolvedNoteFrame>,
  groupBounds: ReadonlyArray<ResolvedGroupBound>,
  minWidth: number
): { contentWidth: number; contentHeight: number } {
  let maxRight = minWidth;
  let maxBottom = 400;
  for (const frame of Object.values(noteFrames)) {
    maxRight = Math.max(maxRight, frame.x + frame.width + 40);
    maxBottom = Math.max(maxBottom, frame.y + frame.height + 40);
  }
  for (const bound of groupBounds) {
    maxRight = Math.max(maxRight, bound.left + bound.width + 40);
    maxBottom = Math.max(maxBottom, bound.top + bound.height + 40);
  }
  return {
    contentWidth: Math.round(maxRight),
    contentHeight: Math.round(maxBottom),
  };
}

function findNonOverlappingSlotInTwoColumns(
  placedRects: ReadonlyArray<StickyRect>,
  col1X: number,
  col2X: number,
  startY: number,
  width: number,
  height: number,
  rowGap: number
): { x: number; y: number } {
  let y = Math.max(12, Math.round(startY));
  for (let step = 0; step < 80; step += 1) {
    for (const x of [col1X, col2X]) {
      const candidate: StickyRect = { x: Math.round(x), y, width, height };
      if (!placedRects.some((rect) => rectsOverlapWithGap(candidate, rect, 12))) {
        return { x: candidate.x, y: candidate.y };
      }
    }
    y += Math.max(120, Math.round(height / 2)) + rowGap;
  }
  const maxBottom = placedRects.reduce((acc, rect) => Math.max(acc, rect.y + rect.height), startY);
  return { x: Math.round(col1X), y: Math.round(maxBottom + rowGap) };
}

function computeMobileAutoFrames(
  notes: ReadonlyArray<StickyNote>,
  groups: ReadonlyArray<StickyNoteGroup>,
  cardWidth: number,
  noteHeights: Record<string, number>
): Record<string, ResolvedNoteFrame> {
  const frames: Record<string, ResolvedNoteFrame> = {};
  const groupedIds = new Set<string>();
  let cursorY = MOBILE_OUTER_TOP;
  const cardX = MOBILE_OUTER_X + MOBILE_GROUP_PAD_X;

  for (const group of groups) {
    const members = sortNotesReadingOrder(notes.filter((note) => note.group_id === group.id));
    if (!members.length) continue;
    let innerY = cursorY + MOBILE_GROUP_PAD_TOP;
    for (const member of members) {
      const height = resolveHeight(member, cardWidth, null, noteHeights);
      frames[member.id] = {
        x: cardX,
        y: Math.round(innerY),
        width: cardWidth,
        height,
        heightPx: null,
        manual: false,
      };
      groupedIds.add(member.id);
      innerY += height + MOBILE_ROW_GAP;
    }
    cursorY = innerY - MOBILE_ROW_GAP + MOBILE_GROUP_PAD_BOTTOM + MOBILE_SECTION_GAP;
  }

  const loose = sortNotesReadingOrder(notes.filter((note) => !groupedIds.has(note.id)));
  for (const note of loose) {
    const height = resolveHeight(note, cardWidth, null, noteHeights);
    frames[note.id] = {
      x: cardX,
      y: Math.round(cursorY),
      width: cardWidth,
      height,
      heightPx: null,
      manual: false,
    };
    cursorY += height + MOBILE_ROW_GAP;
  }

  return frames;
}

/**
 * Resolve o layout completo de renderização para a modalidade ativa (desktop | tablet | mobile).
 * - Desktop: restaura posições personalizadas salvas no layout desktop, preservando 100%
 *   as coordenadas legadas de sticky_notes para compatibilidade retroativa.
 * - Tablet: inicia em organização automática de 2 colunas lado a lado, mas restaura
 *   exatamente as posições/dimensões personalizadas salvas no layout tablet sem sobrescrevê-las.
 * - Mobile: inicia em 1 coluna responsiva adaptada à largura da tela e restaura exatamente
 *   as posições/dimensões personalizadas salvas no layout mobile.
 */
export function resolveBoardLayout({
  layoutType,
  notes,
  groups,
  savedLayout,
  viewportWidth,
  noteHeights,
}: ResolveBoardLayoutInput): ResolvedBoardLayout {
  const savedNotes = savedLayout?.notes || {};

  // 1. DESKTOP
  if (layoutType === 'desktop') {
    const noteFrames: Record<string, ResolvedNoteFrame> = {};
    for (const note of notes) {
      const entry = savedNotes[note.id];
      if (hasMatchingSavedEntry(entry, note)) {
        const width = entry.width ? clampWidth(entry.width) : note.width_px || STICKY_DEFAULT_WIDTH;
        const heightPx = entry.height !== undefined ? entry.height : (note.height_px ?? null);
        const height = resolveHeight(note, width, heightPx, noteHeights);
        noteFrames[note.id] = {
          x: Math.round(entry.x),
          y: Math.round(entry.y),
          width,
          height,
          heightPx,
          manual: Boolean(entry.manual),
        };
      } else {
        const width = note.width_px || STICKY_DEFAULT_WIDTH;
        const heightPx = note.height_px ?? null;
        const height = resolveHeight(note, width, heightPx, noteHeights);
        noteFrames[note.id] = {
          x: Math.round(note.position_x),
          y: Math.round(note.position_y),
          width,
          height,
          heightPx,
          manual: false,
        };
      }
    }
    const groupBounds = buildGroupBounds(
      groups,
      notes,
      noteFrames,
      DESKTOP_GROUP_PAD_X,
      DESKTOP_GROUP_PAD_TOP,
      DESKTOP_GROUP_PAD_BOTTOM
    );
    const { contentWidth, contentHeight } = computeContentExtents(noteFrames, groupBounds, 1200);
    return {
      layoutType: 'desktop',
      cardWidth: STICKY_DEFAULT_WIDTH,
      noteFrames,
      groupBounds,
      contentWidth,
      contentHeight,
    };
  }

  // 2. TABLET (2 colunas automáticas inicialmente; restaura posições personalizadas salvas)
  if (layoutType === 'tablet') {
    const cardWidth = computeTabletCardWidth(viewportWidth);
    const auto = computeTabletBoardLayout({
      notes,
      groups,
      viewportWidth,
      noteHeights,
    });

    const noteFrames: Record<string, ResolvedNoteFrame> = {};
    const unsavedNotes: StickyNote[] = [];
    let hasAnySaved = false;

    for (const note of notes) {
      const entry = savedNotes[note.id];
      if (hasMatchingSavedEntry(entry, note)) {
        hasAnySaved = true;
        const width = entry.width ? clampWidth(entry.width) : cardWidth;
        const heightPx = entry.height !== undefined ? entry.height : null;
        const height = resolveHeight(note, width, heightPx, noteHeights);
        noteFrames[note.id] = {
          x: Math.round(entry.x),
          y: Math.round(entry.y),
          width,
          height,
          heightPx,
          manual: Boolean(entry.manual),
        };
      } else {
        unsavedNotes.push(note);
      }
    }

    if (!hasAnySaved) {
      for (const note of notes) {
        const frame = auto.noteFrames[note.id];
        if (frame) {
          noteFrames[note.id] = {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            heightPx: null,
            manual: false,
          };
        }
      }
    } else if (unsavedNotes.length > 0) {
      const getPlacedRects = (): StickyRect[] =>
        Object.values(noteFrames).map((f) => ({
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
        }));

      for (const note of sortNotesReadingOrder(unsavedNotes)) {
        const height = resolveHeight(note, cardWidth, null, noteHeights);
        const placedRects = getPlacedRects();

        if (note.group_id) {
          const savedSiblings = notes
            .filter((other) => other.group_id === note.group_id && Boolean(noteFrames[other.id]))
            .map((other) => noteFrames[other.id]);

          if (savedSiblings.length > 0) {
            const minX = Math.min(...savedSiblings.map((s) => s.x));
            const minY = Math.min(...savedSiblings.map((s) => s.y));
            const col2X = minX + cardWidth + TABLET_COL_GAP;
            const slot = findNonOverlappingSlotInTwoColumns(
              placedRects,
              minX,
              col2X,
              minY,
              cardWidth,
              height,
              TABLET_ROW_GAP
            );
            noteFrames[note.id] = {
              x: slot.x,
              y: slot.y,
              width: cardWidth,
              height,
              heightPx: null,
              manual: false,
            };
            continue;
          }
        }

        const autoFrame = auto.noteFrames[note.id];
        const col1X = TABLET_OUTER_X + TABLET_GROUP_PAD_X;
        const col2X = col1X + cardWidth + TABLET_COL_GAP;
        const maxExistingBottom = placedRects.reduce(
          (acc, rect) => Math.max(acc, rect.y + rect.height),
          TABLET_OUTER_TOP
        );
        const startY =
          autoFrame &&
          !placedRects.some((rect) =>
            rectsOverlapWithGap(
              { x: autoFrame.x, y: autoFrame.y, width: cardWidth, height },
              rect,
              12
            )
          )
            ? autoFrame.y
            : maxExistingBottom + TABLET_ROW_GAP;
        const slot =
          autoFrame && startY === autoFrame.y
            ? { x: autoFrame.x, y: autoFrame.y }
            : findNonOverlappingSlotInTwoColumns(
                placedRects,
                col1X,
                col2X,
                startY,
                cardWidth,
                height,
                TABLET_ROW_GAP
              );
        noteFrames[note.id] = {
          x: slot.x,
          y: slot.y,
          width: cardWidth,
          height,
          heightPx: null,
          manual: false,
        };
      }
    }

    const groupBounds = buildGroupBounds(
      groups,
      notes,
      noteFrames,
      TABLET_GROUP_PAD_X,
      TABLET_GROUP_PAD_TOP,
      TABLET_GROUP_PAD_BOTTOM
    );
    const { contentWidth, contentHeight } = computeContentExtents(
      noteFrames,
      groupBounds,
      TABLET_OUTER_X * 2 + TABLET_GROUP_PAD_X * 2 + cardWidth * 2 + TABLET_COL_GAP
    );

    return {
      layoutType: 'tablet',
      cardWidth,
      noteFrames,
      groupBounds,
      contentWidth,
      contentHeight,
    };
  }

  // 3. MOBILE (1 coluna responsiva inicialmente; restaura posições personalizadas salvas)
  const mobileCardWidth = computeMobileCardWidth(viewportWidth);
  const mobileAuto = computeMobileAutoFrames(notes, groups, mobileCardWidth, noteHeights);
  const noteFrames: Record<string, ResolvedNoteFrame> = {};
  const unsavedNotes: StickyNote[] = [];
  let hasAnySaved = false;

  for (const note of notes) {
    const entry = savedNotes[note.id];
    if (hasMatchingSavedEntry(entry, note)) {
      hasAnySaved = true;
      const width = entry.width ? clampWidth(entry.width) : mobileCardWidth;
      const heightPx = entry.height !== undefined ? entry.height : null;
      const height = resolveHeight(note, width, heightPx, noteHeights);
      noteFrames[note.id] = {
        x: Math.round(entry.x),
        y: Math.round(entry.y),
        width,
        height,
        heightPx,
        manual: Boolean(entry.manual),
      };
    } else {
      unsavedNotes.push(note);
    }
  }

  if (!hasAnySaved) {
    Object.assign(noteFrames, mobileAuto);
  } else if (unsavedNotes.length > 0) {
    for (const note of sortNotesReadingOrder(unsavedNotes)) {
      const height = resolveHeight(note, mobileCardWidth, null, noteHeights);
      const placed = Object.values(noteFrames);
      const savedSiblings = note.group_id
        ? notes
            .filter((other) => other.group_id === note.group_id && Boolean(noteFrames[other.id]))
            .map((other) => noteFrames[other.id])
        : [];
      const baseX = savedSiblings.length
        ? Math.min(...savedSiblings.map((s) => s.x))
        : MOBILE_OUTER_X + MOBILE_GROUP_PAD_X;
      const maxBottom = (savedSiblings.length ? savedSiblings : placed).reduce(
        (acc, f) => Math.max(acc, f.y + f.height),
        MOBILE_OUTER_TOP
      );
      noteFrames[note.id] = {
        x: Math.round(baseX),
        y: Math.round(maxBottom + MOBILE_ROW_GAP),
        width: mobileCardWidth,
        height,
        heightPx: null,
        manual: false,
      };
    }
  }

  const groupBounds = buildGroupBounds(
    groups,
    notes,
    noteFrames,
    MOBILE_GROUP_PAD_X,
    MOBILE_GROUP_PAD_TOP,
    MOBILE_GROUP_PAD_BOTTOM
  );
  const { contentWidth, contentHeight } = computeContentExtents(
    noteFrames,
    groupBounds,
    MOBILE_OUTER_X * 2 + MOBILE_GROUP_PAD_X * 2 + mobileCardWidth
  );

  return {
    layoutType: 'mobile',
    cardWidth: mobileCardWidth,
    noteFrames,
    groupBounds,
    contentWidth,
    contentHeight,
  };
}

/**
 * Gera um snapshot consistente de todos os frames visíveis no dispositivo atual
 * para que qualquer movimentação ou redimensionamento manual congele a organização
 * do quadro daquele dispositivo sem perturbar os outros dispositivos.
 */
export function snapshotResolvedLayout(
  resolved: ResolvedBoardLayout,
  notes: ReadonlyArray<StickyNote>,
  previousLayout: StickyBoardLayoutData | null,
  viewportWidth?: number
): StickyBoardLayoutData {
  const now = new Date().toISOString();
  const nextNotes: Record<string, StickyNoteLayoutEntry> = {};

  for (const note of notes) {
    const frame = resolved.noteFrames[note.id];
    if (!frame) continue;
    const prev = previousLayout?.notes?.[note.id];
    nextNotes[note.id] = {
      x: Math.round(frame.x),
      y: Math.round(frame.y),
      width: Math.round(frame.width),
      height: frame.heightPx,
      group_id: note.group_id ?? null,
      manual: Boolean(frame.manual || prev?.manual),
      updated_at: prev?.updated_at || now,
    };
  }

  const nextGroups: StickyBoardLayoutData['groups'] = {};
  for (const bound of resolved.groupBounds) {
    const prev = previousLayout?.groups?.[bound.group.id];
    nextGroups[bound.group.id] = {
      x: Math.round(bound.left),
      y: Math.round(bound.top),
      manual: Boolean(prev?.manual),
      updated_at: prev?.updated_at || now,
    };
  }

  return {
    version: 1,
    layout_type: resolved.layoutType,
    notes: nextNotes,
    groups: nextGroups,
    viewport_width: viewportWidth ? Math.round(viewportWidth) : previousLayout?.viewport_width,
    updated_at: now,
  };
}

export function commitStickMoveToLayout(params: {
  resolved: ResolvedBoardLayout;
  notes: ReadonlyArray<StickyNote>;
  previousLayout: StickyBoardLayoutData | null;
  noteId: string;
  x: number;
  y: number;
  groupId?: string | null;
  viewportWidth?: number;
}): StickyBoardLayoutData {
  const { resolved, notes, previousLayout, noteId, x, y, groupId, viewportWidth } = params;
  const base = snapshotResolvedLayout(resolved, notes, previousLayout, viewportWidth);
  const targetNote = notes.find((n) => n.id === noteId);
  const existing = base.notes[noteId];
  const now = new Date().toISOString();

  base.notes[noteId] = {
    x: Math.max(12, Math.round(x)),
    y: Math.max(12, Math.round(y)),
    width: existing?.width ?? resolved.cardWidth,
    height: existing?.height ?? null,
    group_id: groupId !== undefined ? groupId : (targetNote?.group_id ?? null),
    manual: true,
    updated_at: now,
  };
  base.updated_at = now;
  return base;
}

export function commitGroupMoveToLayout(params: {
  resolved: ResolvedBoardLayout;
  notes: ReadonlyArray<StickyNote>;
  previousLayout: StickyBoardLayoutData | null;
  groupId: string;
  dx: number;
  dy: number;
  viewportWidth?: number;
}): StickyBoardLayoutData {
  const { resolved, notes, previousLayout, groupId, dx, dy, viewportWidth } = params;
  const base = snapshotResolvedLayout(resolved, notes, previousLayout, viewportWidth);
  const now = new Date().toISOString();

  const members = notes.filter((n) => n.group_id === groupId);
  if (!members.length) return base;

  // Garante que nenhum Stick do campo ultrapasse a borda mínima (12px),
  // preservando rigorosamente as posições relativas entre todos os membros.
  let minMemberX = Infinity;
  let minMemberY = Infinity;
  for (const member of members) {
    const entry = base.notes[member.id];
    if (!entry) continue;
    minMemberX = Math.min(minMemberX, entry.x);
    minMemberY = Math.min(minMemberY, entry.y);
  }
  const safeDx = Number.isFinite(minMemberX) ? Math.max(12 - minMemberX, Math.round(dx)) : Math.round(dx);
  const safeDy = Number.isFinite(minMemberY) ? Math.max(12 - minMemberY, Math.round(dy)) : Math.round(dy);

  for (const member of members) {
    const entry = base.notes[member.id];
    if (!entry) continue;
    base.notes[member.id] = {
      ...entry,
      x: Math.round(entry.x + safeDx),
      y: Math.round(entry.y + safeDy),
      group_id: groupId,
      manual: true,
      updated_at: now,
    };
  }

  const prevBound = resolved.groupBounds.find((b) => b.group.id === groupId);
  if (prevBound) {
    base.groups[groupId] = {
      x: Math.round(prevBound.left + safeDx),
      y: Math.round(prevBound.top + safeDy),
      manual: true,
      updated_at: now,
    };
  }
  base.updated_at = now;
  return base;
}

export function commitStickResizeToLayout(params: {
  resolved: ResolvedBoardLayout;
  notes: ReadonlyArray<StickyNote>;
  previousLayout: StickyBoardLayoutData | null;
  noteId: string;
  size: StickyResizePatch;
  viewportWidth?: number;
}): StickyBoardLayoutData {
  const { resolved, notes, previousLayout, noteId, size, viewportWidth } = params;
  const base = snapshotResolvedLayout(resolved, notes, previousLayout, viewportWidth);
  const targetNote = notes.find((n) => n.id === noteId);
  const existing = base.notes[noteId];
  const now = new Date().toISOString();

  base.notes[noteId] = {
    x: size.position_x !== undefined ? Math.max(12, Math.round(size.position_x)) : (existing?.x ?? 80),
    y: size.position_y !== undefined ? Math.max(12, Math.round(size.position_y)) : (existing?.y ?? 80),
    width: clampWidth(size.width_px),
    height: size.height_px !== undefined ? size.height_px : (existing?.height ?? null),
    group_id: targetNote?.group_id ?? existing?.group_id ?? null,
    manual: true,
    updated_at: now,
  };
  base.updated_at = now;
  return base;
}

/**
 * Calcula uma posição inteligente sem sobreposição para um Stick recém-criado
 * no desktop (respeitando todas as posições manuais existentes).
 */
export function computeSmartDesktopNewStickPosition(params: {
  notes: ReadonlyArray<StickyNote>;
  resolvedDesktopFrames?: Record<string, ResolvedNoteFrame>;
  noteHeights: Record<string, number>;
  viewportRect?: { width: number; height: number } | null;
  canvasPan: { x: number; y: number };
  canvasZoom: number;
  widthPx?: number;
}): { x: number; y: number } {
  const {
    notes,
    resolvedDesktopFrames,
    noteHeights,
    viewportRect,
    canvasPan,
    canvasZoom,
    widthPx = STICKY_DEFAULT_WIDTH,
  } = params;
  const estimatedHeight = 220;
  const zoom = canvasZoom > 0 ? canvasZoom : 1;

  const existingAsNotes = notes.map((note) => {
    const frame = resolvedDesktopFrames?.[note.id];
    return {
      ...note,
      position_x: frame ? frame.x : note.position_x,
      position_y: frame ? frame.y : note.position_y,
      width_px: frame ? frame.width : note.width_px,
      height_px: frame ? frame.heightPx : note.height_px,
    };
  });

  // Se o centro visível da viewport estiver completamente livre, cria o Stick ali para feedback imediato.
  if (viewportRect && viewportRect.width > 0 && viewportRect.height > 0) {
    const centerX = Math.max(24, Math.round((viewportRect.width / 2 - canvasPan.x) / zoom - widthPx / 2));
    const centerY = Math.max(24, Math.round((viewportRect.height / 2 - canvasPan.y) / zoom - estimatedHeight / 2));
    const candidate: StickyRect = { x: centerX, y: centerY, width: widthPx, height: estimatedHeight };
    const overlapsExisting = existingAsNotes.some((item) => {
      const h = item.height_px ?? noteHeights[item.id] ?? estimateStickyCardHeight(item.title, item.content, item.width_px);
      return rectsOverlapWithGap(
        candidate,
        { x: item.position_x, y: item.position_y, width: item.width_px, height: h },
        24
      );
    });
    if (!overlapsExisting) {
      return { x: centerX, y: centerY };
    }
  }

  // Caso contrário, usa o algoritmo inteligente de posicionamento sem sobreposição.
  const smart = findNonOverlappingStickPosition(existingAsNotes, {
    widthPx,
    estimatedHeight,
    measuredHeights: noteHeights,
  });
  return { x: Math.round(smart.x), y: Math.round(smart.y) };
}
