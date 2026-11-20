import { arrayMove } from '@dnd-kit/sortable';
import {
  STICKY_MAX_HEIGHT,
  STICKY_MAX_WIDTH,
  STICKY_MIN_HEIGHT,
  STICKY_MIN_WIDTH,
  StickyNoteGroup,
} from '../types';

export type StickyResizeAxis = 'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface StickyResizePatch {
  width_px: number;
  height_px?: number | null;
  position_x?: number;
  position_y?: number;
}

export interface StickySnapTarget {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clampStickyWidth(value: number): number {
  return Math.max(STICKY_MIN_WIDTH, Math.min(STICKY_MAX_WIDTH, Math.round(value)));
}

export function clampStickyHeight(value: number): number {
  return Math.max(STICKY_MIN_HEIGHT, Math.min(STICKY_MAX_HEIGHT, Math.round(value)));
}

/**
 * Reorders StickyNoteGroup items when activeId is dropped over overId,
 * normalizing sort_order to sequential 0-based indices.
 * Returns null when the order does not change or an ID is invalid.
 */
export function reorderStickyGroups(
  groups: StickyNoteGroup[],
  activeId: string,
  overId: string
): StickyNoteGroup[] | null {
  if (!activeId || !overId || activeId === overId) return null;
  const oldIndex = groups.findIndex((group) => group.id === activeId);
  const newIndex = groups.findIndex((group) => group.id === overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null;

  return arrayMove(groups, oldIndex, newIndex).map((group, index) => ({
    ...group,
    sort_order: index,
  }));
}

export interface ComputeNextStickySizeInput {
  axis: StickyResizeAxis;
  startWidth: number;
  startHeight: number;
  initialHeightPx: number | null | undefined;
  deltaX: number;
  deltaY: number;
  zoom: number;
  positionX: number;
  positionY: number;
  snapTargets?: StickySnapTarget[];
  snapTolerance?: number;
}

/**
 * Calculates the next clamped width and/or height for a Stick during
 * right-edge ('x'), bottom-edge ('y'), or bottom-right corner ('xy') resizing.
 */
export function computeNextStickySize({
  axis,
  startWidth,
  startHeight,
  initialHeightPx,
  deltaX,
  deltaY,
  zoom,
  positionX,
  positionY,
  snapTargets = [],
  snapTolerance = 6,
}: ComputeNextStickySizeInput): StickyResizePatch {
  const safeZoom = zoom > 0 ? zoom : 1;
  const dx = deltaX / safeZoom;
  const dy = deltaY / safeZoom;
  const movesLeft = axis.includes('left');
  const movesRight = axis.includes('right');
  const movesTop = axis.includes('top');
  const movesBottom = axis.includes('bottom');

  let nextWidth = startWidth;
  let nextHeight: number | null | undefined = initialHeightPx;
  let nextX = positionX;
  let nextY = positionY;

  if (movesLeft) {
    const width = clampStickyWidth(startWidth - dx);
    nextX = positionX + (startWidth - width);
    nextWidth = width;
  } else if (movesRight) {
    nextWidth = clampStickyWidth(startWidth + dx);
  }

  if (movesTop) {
    const widthHeight = clampStickyHeight(startHeight - dy);
    nextY = positionY + (startHeight - widthHeight);
    nextHeight = widthHeight;
  } else if (movesBottom) {
    nextHeight = clampStickyHeight(startHeight + dy);
  }

  // Magnetic snapping remains gentle on the fixed/right and bottom edges.
  // Left/top resizing keeps the opposite edge anchored and prioritizes direct manipulation.
  if (movesRight) {
    let best = snapTolerance + 1;
    for (const target of snapTargets) {
      for (const guide of [target.x - positionX - 12, target.x + target.width - positionX]) {
        const candidate = Math.round(guide);
        const distance = Math.abs(candidate - nextWidth);
        if (candidate >= STICKY_MIN_WIDTH && candidate <= STICKY_MAX_WIDTH && distance <= snapTolerance && distance < best) {
          nextWidth = candidate;
          best = distance;
        }
      }
    }
  }
  if (movesBottom && nextHeight != null) {
    let best = snapTolerance + 1;
    for (const target of snapTargets) {
      for (const guide of [target.y - positionY - 12, target.y + target.height - positionY]) {
        const candidate = Math.round(guide);
        const distance = Math.abs(candidate - nextHeight);
        if (candidate >= STICKY_MIN_HEIGHT && candidate <= STICKY_MAX_HEIGHT && distance <= snapTolerance && distance < best) {
          nextHeight = candidate;
          best = distance;
        }
      }
    }
  }

  return {
    width_px: nextWidth,
    height_px: nextHeight,
    position_x: nextX,
    position_y: nextY,
  };
}
