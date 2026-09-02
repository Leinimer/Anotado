import { useState, useCallback, useRef, useEffect } from 'react';
import { calculateResizedWidth, ResizeDirection } from '../utils/media-common';

interface UseMediaResizeOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  targetRef: React.RefObject<HTMLElement | null>;
  aspectRatio?: number;
  minWidth?: number;
  onPersistWidth: (finalWidth: string) => void;
  onSelect?: () => void;
}

export function useMediaResize({
  containerRef,
  targetRef,
  aspectRatio,
  minWidth = 70,
  onPersistWidth,
  onSelect,
}: UseMediaResizeOptions) {
  const [isResizing, setIsResizing] = useState(false);
  const [resizingWidth, setResizingWidth] = useState<number | null>(null);

  // Mantém referência ao callback de persistência para evitar reanexar listeners
  const onPersistWidthRef = useRef(onPersistWidth);
  const cleanupListenersRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onPersistWidthRef.current = onPersistWidth;
  }, [onPersistWidth]);

  // Limpa event listeners globais caso o componente desmonte durante o resize
  useEffect(() => {
    return () => {
      if (cleanupListenersRef.current) {
        cleanupListenersRef.current();
        cleanupListenersRef.current = null;
      }
    };
  }, []);

  const handleResizeStart = useCallback(
    (direction: ResizeDirection, e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      // Limpa listeners pendentes de um eventual gesto anterior
      if (cleanupListenersRef.current) {
        cleanupListenersRef.current();
      }

      setIsResizing(true);
      if (onSelect) onSelect();

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = targetRef.current?.offsetWidth || 300;
      const startHeight = targetRef.current?.offsetHeight || (startWidth / (aspectRatio || 1));
      const currentRatio = aspectRatio || (startWidth / startHeight) || 1;

      // Obtém a largura máxima disponível da folha (note container)
      const editorElement =
        containerRef.current?.closest('.ProseMirror') || containerRef.current?.parentElement;
      const maxContainerWidth = editorElement ? editorElement.clientWidth - 24 : 800;

      let latestCalculatedWidth = startWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();

        const clampedWidth = calculateResizedWidth({
          direction,
          startX,
          startY,
          currentX: moveEvent.clientX,
          currentY: moveEvent.clientY,
          startWidth,
          aspectRatio: currentRatio,
          minWidth,
          maxContainerWidth,
        });

        latestCalculatedWidth = clampedWidth;
        setResizingWidth(Math.round(clampedWidth));
      };

      const removeListeners = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        cleanupListenersRef.current = null;
      };
      cleanupListenersRef.current = removeListeners;

      const handlePointerUp = (upEvent: PointerEvent) => {
        upEvent.preventDefault();
        removeListeners();
        setIsResizing(false);
        setResizingWidth(null);

        const finalWidth = `${Math.round(latestCalculatedWidth)}px`;
        onPersistWidthRef.current(finalWidth);
      };

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp, { passive: false });
    },
    [containerRef, targetRef, aspectRatio, minWidth, onSelect]
  );

  return {
    isResizing,
    resizingWidth,
    handleResizeStart,
  };
}
