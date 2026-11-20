'use client';

import {
  evaluateStickyLayoutType,
  StickyDeviceViewportInfo,
  useStickyDeviceMode,
} from './useStickyDeviceMode';

/**
 * Compatibilidade retroativa: expõe o predicado booleano de detecção de tablet
 * delegando diretamente ao classificador unificado (desktop | tablet | mobile).
 */
export function evaluateTabletMode(info: StickyDeviceViewportInfo): boolean {
  return evaluateStickyLayoutType(info) === 'tablet';
}

export function useStickyTabletMode(): { isTablet: boolean } {
  const { isTablet } = useStickyDeviceMode();
  return { isTablet };
}
