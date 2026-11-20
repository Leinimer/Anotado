'use client';

import { useEffect, useRef, useState } from 'react';

const TABLET_MIN_SHORT_SIDE = 600;
const TABLET_MIN_LONG_SIDE = 800;
const TABLET_MAX_LONG_SIDE = 1500;

interface TabletViewportInfo {
  width: number;
  height: number;
  maxHeightForWidth: number;
  coarsePrimary: boolean;
  finePrimaryWithHover: boolean;
  hasTouch: boolean;
  userAgent: string;
  maxTouchPoints: number;
}

/**
 * Pure predicate exposed for deterministic testing across device profiles.
 * Distinguishes tablets (portrait & landscape) from:
 * - Phones (portrait & landscape, where the shorter side is < 600px)
 * - Regular desktops (no touch / fine primary pointer with hover)
 * - Touchscreen laptops (maxTouchPoints > 0, but primary pointer is fine + hover)
 */
export function evaluateTabletMode(info: TabletViewportInfo): boolean {
  const {
    width,
    height,
    maxHeightForWidth,
    coarsePrimary,
    finePrimaryWithHover,
    hasTouch,
    userAgent,
    maxTouchPoints,
  } = info;

  if (!hasTouch) return false;

  const isIPadOS =
    /iPad/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  const isAndroidTablet =
    /Android/i.test(userAgent) && !/Mobile/i.test(userAgent);

  // Touchscreen laptops report maxTouchPoints > 0, but their primary input
  // remains (pointer: fine) and (hover: hover). Only iPadOS, Android tablets,
  // or devices whose primary pointer is coarse qualify as tablet interfaces.
  const isTabletPointerProfile =
    isIPadOS ||
    isAndroidTablet ||
    (coarsePrimary && !finePrimaryWithHover);

  if (!isTabletPointerProfile) return false;

  // Use the highest observed height for the current width so opening the
  // virtual keyboard in landscape on a tablet does not collapse minSide < 600.
  const effectiveHeight = Math.max(height, maxHeightForWidth);
  const minSide = Math.min(width, effectiveHeight);
  const maxSide = Math.max(width, effectiveHeight);

  return (
    width >= TABLET_MIN_SHORT_SIDE &&
    minSide >= TABLET_MIN_SHORT_SIDE &&
    maxSide >= TABLET_MIN_LONG_SIDE &&
    maxSide <= TABLET_MAX_LONG_SIDE
  );
}

/**
 * Detects whether the Sticky Notes (Stick) page is running on a tablet interface
 * in either portrait or landscape orientation, without affecting desktop,
 * touchscreen laptops, or smartphones.
 */
export function useStickyTabletMode(): { isTablet: boolean } {
  const [isTablet, setIsTablet] = useState(false);
  const lastWidthRef = useRef<number>(0);
  const maxHeightForWidthRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const coarseQuery = window.matchMedia('(pointer: coarse)');
    const fineQuery = window.matchMedia('(pointer: fine)');
    const hoverQuery = window.matchMedia('(hover: hover)');
    const anyCoarseQuery = window.matchMedia('(any-pointer: coarse)');

    const update = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      if (Math.abs(width - lastWidthRef.current) > 24) {
        lastWidthRef.current = width;
        maxHeightForWidthRef.current = height;
      } else {
        maxHeightForWidthRef.current = Math.max(maxHeightForWidthRef.current, height);
      }

      const maxTouchPoints =
        typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
      const hasTouch =
        maxTouchPoints > 0 ||
        'ontouchstart' in window ||
        anyCoarseQuery.matches ||
        coarseQuery.matches;

      const nextIsTablet = evaluateTabletMode({
        width,
        height,
        maxHeightForWidth: maxHeightForWidthRef.current,
        coarsePrimary: coarseQuery.matches,
        finePrimaryWithHover: fineQuery.matches && hoverQuery.matches,
        hasTouch,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent || '' : '',
        maxTouchPoints,
      });

      setIsTablet((previous) => (previous === nextIsTablet ? previous : nextIsTablet));
    };

    const handleOrientationChange = () => {
      lastWidthRef.current = 0;
      maxHeightForWidthRef.current = 0;
      update();
      window.setTimeout(update, 120);
      window.setTimeout(update, 320);
    };

    update();

    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('orientationchange', handleOrientationChange);
    coarseQuery.addEventListener?.('change', update);
    fineQuery.addEventListener?.('change', update);
    hoverQuery.addEventListener?.('change', update);
    anyCoarseQuery.addEventListener?.('change', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', handleOrientationChange);
      coarseQuery.removeEventListener?.('change', update);
      fineQuery.removeEventListener?.('change', update);
      hoverQuery.removeEventListener?.('change', update);
      anyCoarseQuery.removeEventListener?.('change', update);
    };
  }, []);

  return { isTablet };
}
