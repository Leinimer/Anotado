import { arrayMove } from '@dnd-kit/sortable';
import {
  STICKY_MAX_HEIGHT,
  STICKY_MAX_WIDTH,
  STICKY_MIN_HEIGHT,
  STICKY_MIN_WIDTH,
  StickyNoteGroup,
} from '../types';

export type StickyResizeAxis = 'x' | 'y' | 'xy';

export interface StickyResizePatch {
  width_px: number;
  height_px?: number | null;
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

  let nextWidth = clampStickyWidth(startWidth);
  if (axis === 'x' || axis === 'xy') {
    const rawWidth = clampStickyWidth(startWidth + deltaX / safeZoom);
    let snappedWidth = rawWidth;
    let bestDistance = snapTolerance + 1;

    for (const target of snapTargets) {
      const guides = [
        target.x - positionX - 12,
        target.x + target.width - positionX,
      ];
      for (const guide of guides) {
        const roundedGuide = Math.round(guide);
        const distance = Math.abs(roundedGuide - rawWidth);
        if (
          roundedGuide >= STICKY_MIN_WIDTH &&
          roundedGuide <= STICKY_MAX_WIDTH &&
          distance <= snapTolerance &&
          distance < bestDistance
        ) {
          snappedWidth = roundedGuide;
          bestDistance = distance;
        }
      }
    }
    nextWidth = snappedWidth;
  }

  let nextHeight: number | null | undefined = initialHeightPx;
  if (axis === 'y' || axis === 'xy') {
    const rawHeight = clampStickyHeight(startHeight + deltaY / safeZoom);
    let snappedHeight = rawHeight;
    let bestDistance = snapTolerance + 1;

    for (const target of snapTargets) {
      const guides = [
        target.y - positionY - 12,
        target.y + target.height - positionY,
      ];
      for (const guide of guides) {
        const roundedGuide = Math.round(guide);
        const distance = Math.abs(roundedGuide - rawHeight);
        if (
          roundedGuide >= STICKY_MIN_HEIGHT &&
          roundedGuide <= STICKY_MAX_HEIGHT &&
          distance <= snapTolerance &&
          distance < bestDistance
        ) {
          snappedHeight = roundedGuide;
          bestDistance = distance;
        }
      }
    }
    nextHeight = snappedHeight;
  }

  return axis === 'x'
    ? { width_px: nextWidth, height_px: initialHeightPx }
    : { width_px: nextWidth, height_px: nextHeight };
}
