import {
  STICKY_DEFAULT_WIDTH,
  STICKY_MAX_WIDTH,
  STICKY_MIN_WIDTH,
  StickyNote,
  StickyNoteGroup,
} from '../types';
import { estimateStickyCardHeight } from './note-to-stick';

export interface TabletOffset {
  dx: number;
  dy: number;
}

export interface TabletNoteVisualFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TabletGroupVisualFrame {
  group: StickyNoteGroup;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TabletBoardLayout {
  cardWidth: number;
  noteFrames: Record<string, TabletNoteVisualFrame>;
  groupBounds: TabletGroupVisualFrame[];
  contentWidth: number;
  contentHeight: number;
}

export interface ComputeTabletBoardLayoutInput {
  notes: ReadonlyArray<StickyNote>;
  groups: ReadonlyArray<StickyNoteGroup>;
  viewportWidth: number;
  noteHeights: Record<string, number>;
  groupDisplacements?: Record<string, TabletOffset>;
  noteDisplacements?: Record<string, TabletOffset>;
  widthOverrides?: Record<string, number>;
}

const OUTER_PADDING_X = 20;
const OUTER_PADDING_TOP = 24;
const GROUP_PAD_X = 18;
const GROUP_PAD_TOP = 46;
const GROUP_PAD_BOTTOM = 20;
const COL_GAP = 16;
const ROW_GAP = 18;
const SECTION_GAP = 28;
const MIN_TABLET_CARD_WIDTH = 250;
const MAX_TABLET_CARD_WIDTH = 460;

/**
 * Ordena os Sticks de forma estável acompanhando sua leitura natural no desktop
 * (linha aproximada -> coluna -> data de criação), sem alterar os dados salvos.
 */
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

/**
 * Calcula a largura ideal para exibir exatamente 2 Sticks lado a lado no tablet,
 * mantendo leitura confortável e aproveitamento eficiente da tela.
 */
export function computeTabletCardWidth(viewportWidth: number): number {
  const safeViewport = Math.max(600, Math.round(viewportWidth || 768));
  const innerGroupWidth = safeViewport - OUTER_PADDING_X * 2 - GROUP_PAD_X * 2;
  const raw = Math.floor((innerGroupWidth - COL_GAP) / 2);
  return Math.max(MIN_TABLET_CARD_WIDTH, Math.min(MAX_TABLET_CARD_WIDTH, raw));
}

function resolveNoteWidth(
  note: StickyNote,
  defaultTabletWidth: number,
  widthOverrides?: Record<string, number>
): number {
  const override = widthOverrides?.[note.id];
  if (override !== undefined && Number.isFinite(override)) {
    return Math.max(STICKY_MIN_WIDTH, Math.min(STICKY_MAX_WIDTH, Math.round(override)));
  }
  return defaultTabletWidth;
}

function resolveNoteHeight(
  note: StickyNote,
  width: number,
  noteHeights: Record<string, number>
): number {
  if (note.height_px != null && note.height_px > 0) {
    return Math.round(note.height_px);
  }
  const measured = noteHeights[note.id];
  if (measured && measured > 0) {
    return Math.round(measured);
  }
  return estimateStickyCardHeight(note.title, note.content, width || STICKY_DEFAULT_WIDTH);
}

/**
 * Calcula o layout puramente visual do quadro Sticks para tablets:
 * - Exatamente 2 Sticks lado a lado por fileira (tanto dentro de campos quanto soltos).
 * - Campos ajustados estritamente ao conteúdo e aos Sticks que contêm.
 * - Nenhuma alteração nos dados persistidos do desktop.
 * - Suporta deslocamentos manuais (arraste de campo após 3s e arraste individual de Stick).
 */
export function computeTabletBoardLayout({
  notes,
  groups,
  viewportWidth,
  noteHeights,
  groupDisplacements = {},
  noteDisplacements = {},
  widthOverrides = {},
}: ComputeTabletBoardLayoutInput): TabletBoardLayout {
  const cardWidth = computeTabletCardWidth(viewportWidth);
  const noteFrames: Record<string, TabletNoteVisualFrame> = {};
  const groupBounds: TabletGroupVisualFrame[] = [];

  const groupedNoteIds = new Set<string>();
  const activeGroups = groups.filter((group) =>
    notes.some((note) => note.group_id === group.id)
  );

  let cursorY = OUTER_PADDING_TOP;
  let maxRight = OUTER_PADDING_X + cardWidth * 2 + COL_GAP + GROUP_PAD_X * 2;

  // 1. Campos/agrupamentos: cada campo organiza seus Sticks em 2 colunas por fileira
  // e ajusta suas dimensões estritamente aos cartões contidos.
  for (const group of activeGroups) {
    const members = sortNotesReadingOrder(
      notes.filter((note) => note.group_id === group.id)
    );
    if (members.length === 0) continue;

    const groupOffset = groupDisplacements[group.id] || { dx: 0, dy: 0 };
    const baseGroupLeft = OUTER_PADDING_X;
    const baseGroupTop = cursorY;

    let innerY = baseGroupTop + GROUP_PAD_TOP;
    let memberMinX = Infinity;
    let memberMinY = Infinity;
    let memberMaxX = -Infinity;
    let memberMaxY = -Infinity;

    for (let i = 0; i < members.length; i += 2) {
      const leftNote = members[i];
      const rightNote = members[i + 1];

      const leftW = resolveNoteWidth(leftNote, cardWidth, widthOverrides);
      const leftH = resolveNoteHeight(leftNote, leftW, noteHeights);
      const leftNoteOffset = noteDisplacements[leftNote.id] || { dx: 0, dy: 0 };
      const leftX = Math.round(baseGroupLeft + GROUP_PAD_X + groupOffset.dx + leftNoteOffset.dx);
      const leftY = Math.round(innerY + groupOffset.dy + leftNoteOffset.dy);

      noteFrames[leftNote.id] = { x: leftX, y: leftY, width: leftW, height: leftH };
      groupedNoteIds.add(leftNote.id);

      memberMinX = Math.min(memberMinX, leftX);
      memberMinY = Math.min(memberMinY, leftY);
      memberMaxX = Math.max(memberMaxX, leftX + leftW);
      memberMaxY = Math.max(memberMaxY, leftY + leftH);

      let rowHeight = leftH;

      if (rightNote) {
        const rightW = resolveNoteWidth(rightNote, cardWidth, widthOverrides);
        const rightH = resolveNoteHeight(rightNote, rightW, noteHeights);
        const rightNoteOffset = noteDisplacements[rightNote.id] || { dx: 0, dy: 0 };
        const rightX = Math.round(
          baseGroupLeft + GROUP_PAD_X + leftW + COL_GAP + groupOffset.dx + rightNoteOffset.dx
        );
        const rightY = Math.round(innerY + groupOffset.dy + rightNoteOffset.dy);

        noteFrames[rightNote.id] = { x: rightX, y: rightY, width: rightW, height: rightH };
        groupedNoteIds.add(rightNote.id);

        memberMinX = Math.min(memberMinX, rightX);
        memberMinY = Math.min(memberMinY, rightY);
        memberMaxX = Math.max(memberMaxX, rightX + rightW);
        memberMaxY = Math.max(memberMaxY, rightY + rightH);

        rowHeight = Math.max(rowHeight, rightH);
      }

      innerY += rowHeight + ROW_GAP;
    }

    const groupLeft = Math.round(memberMinX - GROUP_PAD_X);
    const groupTop = Math.round(memberMinY - GROUP_PAD_TOP);
    const groupWidth = Math.round(memberMaxX - memberMinX + GROUP_PAD_X * 2);
    const groupHeight = Math.round(memberMaxY - memberMinY + GROUP_PAD_TOP + GROUP_PAD_BOTTOM);

    groupBounds.push({
      group,
      left: groupLeft,
      top: groupTop,
      width: groupWidth,
      height: groupHeight,
    });

    maxRight = Math.max(maxRight, groupLeft + groupWidth + OUTER_PADDING_X);
    const baseSectionBottom = innerY - ROW_GAP + GROUP_PAD_BOTTOM;
    cursorY = Math.max(baseSectionBottom + SECTION_GAP, cursorY + 120);
  }

  // 2. Sticks soltos (sem campo): também organizados em exatamente 2 colunas lado a lado
  const looseNotes = sortNotesReadingOrder(
    notes.filter((note) => !groupedNoteIds.has(note.id))
  );

  if (looseNotes.length > 0) {
    const looseStartX = OUTER_PADDING_X + GROUP_PAD_X;
    for (let i = 0; i < looseNotes.length; i += 2) {
      const leftNote = looseNotes[i];
      const rightNote = looseNotes[i + 1];

      const leftW = resolveNoteWidth(leftNote, cardWidth, widthOverrides);
      const leftH = resolveNoteHeight(leftNote, leftW, noteHeights);
      const leftOffset = noteDisplacements[leftNote.id] || { dx: 0, dy: 0 };
      const leftX = Math.round(looseStartX + leftOffset.dx);
      const leftY = Math.round(cursorY + leftOffset.dy);

      noteFrames[leftNote.id] = { x: leftX, y: leftY, width: leftW, height: leftH };
      maxRight = Math.max(maxRight, leftX + leftW + OUTER_PADDING_X);

      let rowHeight = leftH;

      if (rightNote) {
        const rightW = resolveNoteWidth(rightNote, cardWidth, widthOverrides);
        const rightH = resolveNoteHeight(rightNote, rightW, noteHeights);
        const rightOffset = noteDisplacements[rightNote.id] || { dx: 0, dy: 0 };
        const rightX = Math.round(looseStartX + leftW + COL_GAP + rightOffset.dx);
        const rightY = Math.round(cursorY + rightOffset.dy);

        noteFrames[rightNote.id] = { x: rightX, y: rightY, width: rightW, height: rightH };
        maxRight = Math.max(maxRight, rightX + rightW + OUTER_PADDING_X);
        rowHeight = Math.max(rowHeight, rightH);
      }

      cursorY += rowHeight + ROW_GAP;
    }
  }

  let maxBottom = cursorY + OUTER_PADDING_TOP;
  for (const frame of Object.values(noteFrames)) {
    maxBottom = Math.max(maxBottom, frame.y + frame.height + 40);
  }
  for (const bound of groupBounds) {
    maxBottom = Math.max(maxBottom, bound.top + bound.height + 40);
  }

  return {
    cardWidth,
    noteFrames,
    groupBounds,
    contentWidth: Math.round(maxRight),
    contentHeight: Math.round(maxBottom),
  };
}
