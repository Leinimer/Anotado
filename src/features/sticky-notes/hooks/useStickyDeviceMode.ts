'use client';

import { useEffect, useRef, useState } from 'react';
import type { StickyLayoutType } from '../types';

const TABLET_MIN_SHORT_SIDE = 600;
const TABLET_MIN_LONG_SIDE = 800;
const TABLET_MAX_LONG_SIDE = 1800;

export interface StickyDeviceViewportInfo {
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
 * Classificação determinística e estável da modalidade do dispositivo:
 * - 'desktop': computadores com mouse/trackpad (incluindo notebooks touchscreen cujo
 *   ponteiro primário é fino com hover). Redimensionar a janela no desktop NÃO
 *   troca a modalidade para tablet/mobile nem sobrescreve o layout desktop.
 * - 'tablet': iPadOS, tablets Android e dispositivos táteis sem hover primário com
 *   tela de porte tablet (lado menor >= 600px, preservado mesmo com teclado virtual).
 * - 'mobile': smartphones (iOS/Android Mobile ou dispositivos táteis compactos com
 *   lado menor < 600px).
 */
export function evaluateStickyLayoutType(info: StickyDeviceViewportInfo): StickyLayoutType {
  const {
    width,
    height,
    maxHeightForWidth,
    finePrimaryWithHover,
    hasTouch,
    userAgent,
    maxTouchPoints,
  } = info;

  const isIPadOS =
    /iPad/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  const isAndroidTablet =
    /Android/i.test(userAgent) && !/Mobile/i.test(userAgent);
  const isPhoneUA =
    /iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(userAgent) ||
    (/Android/i.test(userAgent) && /Mobile/i.test(userAgent));

  // Computadores sem toque ou notebooks touchscreen (ponteiro primário fino + hover)
  // permanecem SEMPRE no layout desktop, mesmo se a janela for redimensionada.
  if (!hasTouch) {
    return 'desktop';
  }
  if (finePrimaryWithHover && !isIPadOS && !isAndroidTablet && !isPhoneUA) {
    return 'desktop';
  }

  // Usa a maior altura observada para a largura atual para evitar que o teclado virtual
  // em modo paisagem derrube minSide abaixo de 600px.
  const effectiveHeight = Math.max(height, maxHeightForWidth);
  const minSide = Math.min(width, effectiveHeight);
  const maxSide = Math.max(width, effectiveHeight);

  if (isPhoneUA) {
    return 'mobile';
  }

  if (isIPadOS || isAndroidTablet) {
    if (
      width >= TABLET_MIN_SHORT_SIDE &&
      minSide >= TABLET_MIN_SHORT_SIDE &&
      maxSide >= TABLET_MIN_LONG_SIDE &&
      maxSide <= TABLET_MAX_LONG_SIDE
    ) {
      return 'tablet';
    }
    return minSide < TABLET_MIN_SHORT_SIDE ? 'mobile' : 'tablet';
  }

  // Dispositivo tátil genérico (sem ponteiro fino + hover)
  if (
    width >= TABLET_MIN_SHORT_SIDE &&
    minSide >= TABLET_MIN_SHORT_SIDE &&
    maxSide >= TABLET_MIN_LONG_SIDE &&
    maxSide <= TABLET_MAX_LONG_SIDE
  ) {
    return 'tablet';
  }

  if (minSide < TABLET_MIN_SHORT_SIDE) {
    return 'mobile';
  }

  return 'desktop';
}

export interface StickyDeviceModeResult {
  layoutType: StickyLayoutType;
  isDesktop: boolean;
  isTablet: boolean;
  isMobile: boolean;
  isResolved: boolean;
}

/**
 * Detecta de forma estável se a página Sticks está rodando em desktop, tablet ou mobile.
 * Evita mudanças acidentais de modalidade durante rotação ou abertura do teclado virtual.
 */
export function useStickyDeviceMode(): StickyDeviceModeResult {
  const [layoutType, setLayoutType] = useState<StickyLayoutType>('desktop');
  const [isResolved, setIsResolved] = useState(false);
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

      const nextType = evaluateStickyLayoutType({
        width,
        height,
        maxHeightForWidth: maxHeightForWidthRef.current,
        coarsePrimary: coarseQuery.matches,
        finePrimaryWithHover: fineQuery.matches && hoverQuery.matches,
        hasTouch,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent || '' : '',
        maxTouchPoints,
      });

      setLayoutType((previous) => (previous === nextType ? previous : nextType));
      setIsResolved(true);
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

  return {
    layoutType,
    isDesktop: layoutType === 'desktop',
    isTablet: layoutType === 'tablet',
    isMobile: layoutType === 'mobile',
    isResolved,
  };
}
