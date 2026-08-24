'use client';

import { useState, useEffect, useRef, useCallback, RefObject } from 'react';

export interface MobileKeyboardViewportState {
  isMobile: boolean;
  isKeyboardOpen: boolean;
  viewportHeight: number;
  viewportTop: number;
  toolbarStyle: React.CSSProperties | undefined;
}

/**
 * Hook para posicionamento responsivo e preciso da EditorToolbar no iOS / Safari / Android
 * quando o teclado virtual (e a barra de edição nativa do iOS) estiverem abertos.
 *
 * Utiliza a Visual Viewport API (`window.visualViewport`) para calcular dinamicamente a
 * posição exata acima de toda a área do teclado e da barra nativa cinza do iOS.
 */
export function useMobileKeyboardViewport(
  toolbarRef?: RefObject<HTMLElement | null>
): MobileKeyboardViewportState {
  const [state, setState] = useState<MobileKeyboardViewportState>({
    isMobile: false,
    isKeyboardOpen: false,
    viewportHeight: 0,
    viewportTop: 0,
    toolbarStyle: undefined,
  });

  const baselineHeightRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);

  const calculatePosition = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Detecta se a tela atual é mobile/tablet
    const isMobileDevice =
      window.innerWidth < 1024 ||
      'ontouchstart' in window ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);

    if (!isMobileDevice) {
      setState((prev) => {
        if (!prev.isMobile && !prev.isKeyboardOpen && prev.toolbarStyle === undefined) {
          return prev;
        }
        return {
          isMobile: false,
          isKeyboardOpen: false,
          viewportHeight: window.innerHeight,
          viewportTop: 0,
          toolbarStyle: undefined,
        };
      });
      return;
    }

    const vv = window.visualViewport;
    const currentInnerHeight = window.innerHeight;

    // Inicializa ou atualiza o baseline height quando o teclado certamente não está aberto
    if (
      baselineHeightRef.current === 0 ||
      Math.abs(baselineHeightRef.current - currentInnerHeight) < 50
    ) {
      baselineHeightRef.current = Math.max(baselineHeightRef.current, currentInnerHeight);
    }

    const activeEl = document.activeElement;
    const isInputFocused =
      Boolean(activeEl) &&
      (activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        activeEl?.getAttribute('contenteditable') === 'true' ||
        Boolean(activeEl?.closest('.tiptap')) ||
        Boolean(activeEl?.closest('[contenteditable="true"]')));

    let isKeyboardOpen = false;
    let visualHeight = currentInnerHeight;
    let visualTop = 0;
    let visualLeft = 0;
    let visualWidth = window.innerWidth;

    if (vv) {
      visualHeight = vv.height;
      visualTop = vv.offsetTop;
      visualLeft = vv.offsetLeft;
      visualWidth = vv.width;

      const heightDifference = baselineHeightRef.current - vv.height;
      // Se a viewport visual encolheu mais de 80px ou se há elemento editável com foco e redução
      isKeyboardOpen = heightDifference > 80 || (isInputFocused && heightDifference > 40);
    } else {
      isKeyboardOpen = isInputFocused;
    }

    if (isKeyboardOpen && vv) {
      // Mede a altura real da barra de ferramentas
      const toolbarHeight = toolbarRef?.current?.offsetHeight || 52;
      // Margem visual de 4px de respiro acima da barra nativa do iOS / teclado
      const extraMargin = 4;

      // O ponto inferior da visual viewport em coordenadas do layout viewport é (vv.offsetTop + vv.height)
      // A barra deve ficar exatamente acima desse ponto
      const targetTop = Math.max(0, visualTop + visualHeight - toolbarHeight - extraMargin);

      const dynamicStyle: React.CSSProperties = {
        position: 'fixed',
        top: `${targetTop}px`,
        left: `${visualLeft}px`,
        width: `${visualWidth}px`,
        maxWidth: '100vw',
        zIndex: 9999,
        pointerEvents: 'auto',
        transform: 'none',
      };

      setState({
        isMobile: true,
        isKeyboardOpen: true,
        viewportHeight: visualHeight,
        viewportTop: visualTop,
        toolbarStyle: dynamicStyle,
      });
    } else {
      setState({
        isMobile: true,
        isKeyboardOpen: false,
        viewportHeight: visualHeight,
        viewportTop: 0,
        toolbarStyle: undefined,
      });
    }
  }, [toolbarRef]);

  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      calculatePosition();
      rafIdRef.current = null;
    });
  }, [calculatePosition]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Inicializa baseline e agenda primeira verificação via RAF
    baselineHeightRef.current = window.innerHeight;
    scheduleUpdate();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', scheduleUpdate, { passive: true });
      vv.addEventListener('scroll', scheduleUpdate, { passive: true });
    }

    window.addEventListener('resize', scheduleUpdate, { passive: true });
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('orientationchange', () => {
      baselineHeightRef.current = 0; // redefine baseline após rotação
      setTimeout(scheduleUpdate, 100);
      setTimeout(scheduleUpdate, 300);
    });

    // Ouvintes de foco/desfoque para transição instantânea ao tocar no editor
    document.addEventListener('focusin', scheduleUpdate, { passive: true });
    document.addEventListener('focusout', () => {
      setTimeout(scheduleUpdate, 80);
      setTimeout(scheduleUpdate, 250);
    }, { passive: true });

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (vv) {
        vv.removeEventListener('resize', scheduleUpdate);
        vv.removeEventListener('scroll', scheduleUpdate);
      }
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate);
      document.removeEventListener('focusin', scheduleUpdate);
    };
  }, [calculatePosition, scheduleUpdate]);

  return state;
}
