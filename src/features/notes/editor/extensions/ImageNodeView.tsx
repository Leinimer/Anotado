'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import {
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
} from 'lucide-react';
import {
  moveNodeBlock,
  isInsideMediaGroup,
} from '../utils/node-movement';
import {
  getOptimizedImageUrl,
  markMediaAsLoaded,
  isMediaInCache,
  perfProfiler,
} from '../utils/media-optimizer';
import { indexedDBStorage } from '@/src/features/notes/db/indexed-db';

export function ImageNodeView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode, selected, editor, getPos } = props;
  const rawSrc = node.attrs.src || '';
  const alt = node.attrs.alt || '';
  const title = node.attrs.title || '';
  const initialWidthAttr = node.attrs.width;
  const alignment = (node.attrs.alignment as 'left' | 'center' | 'right') || 'center';

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const localBlobUrlRef = useRef<string | null>(null);

  const [isLocalSelected, setIsLocalSelected] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizingWidth, setResizingWidth] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number>(() => {
    // Se tiver dimensões no atributo
    if (node.attrs.height && node.attrs.width && Number(node.attrs.height) > 0) {
      return Number(node.attrs.width) / Number(node.attrs.height);
    }
    return 16 / 10;
  });

  // Estado de visibilidade via IntersectionObserver
  const initialInCache = useMemo(() => isMediaInCache(rawSrc), [rawSrc]);
  const [isVisibleInViewport, setIsVisibleInViewport] = useState(initialInCache);
  const [isImageLoaded, setIsImageLoaded] = useState(initialInCache);
  const [imageError, setImageError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(() => {
    if (rawSrc.startsWith('attachment://')) {
      return ''; // Será resolvido assincronamente a partir do IndexedDB
    }
    return getOptimizedImageUrl(rawSrc, 850);
  });

  // Resolve anexos locais offline via protocolo attachment://[id] ou local-attachment://[id]
  useEffect(() => {
    let isCancelled = false;

    async function resolveLocalAttachment() {
      if (rawSrc.startsWith('attachment://') || rawSrc.startsWith('local-attachment://')) {
        const attachmentId = rawSrc.replace(/^(?:attachment|local-attachment):\/\//, '').trim();
        try {
          // Busca o anexo pelo ID no IndexedDB
          const currentUserId = (editor as any)?.options?.editorProps?.attributes?.['data-user-id'] || 'anonymous';
          let attachment = await indexedDBStorage.getAttachment(currentUserId, attachmentId);
          if (!attachment && currentUserId !== 'anonymous') {
            attachment = await indexedDBStorage.getAttachment('anonymous', attachmentId);
          }

          if (attachment) {
            if (attachment.remote_url) {
              // Se já foi sincronizado e tem URL remota, atualiza o src do nó no Tiptap
              if (!isCancelled) {
                const optUrl = getOptimizedImageUrl(attachment.remote_url, 850);
                setCurrentSrc(optUrl);
                updateAttributes({ src: attachment.remote_url });
                setImageError(false);
              }
              return;
            }

            if (attachment.blob && !isCancelled) {
              // Cria Blob URL temporária apenas em memória
              if (localBlobUrlRef.current) {
                URL.revokeObjectURL(localBlobUrlRef.current);
              }
              const blobUrl = URL.createObjectURL(attachment.blob);
              localBlobUrlRef.current = blobUrl;
              setCurrentSrc(blobUrl);
              setIsVisibleInViewport(true);
              setImageError(false);
              return;
            }
          }

          // Se não encontrou anexo no IndexedDB local
          if (!isCancelled) {
            console.warn(`[ImageNodeView] Anexo local não encontrado no IndexedDB: ${attachmentId}`);
            setImageError(true);
          }
        } catch (err) {
          console.warn('[ImageNodeView] Falha ao resolver anexo local:', err);
          if (!isCancelled) {
            setImageError(true);
          }
        }
      } else {
        setCurrentSrc(getOptimizedImageUrl(rawSrc, 850));
        setImageError(false);
      }
    }

    resolveLocalAttachment();

    return () => {
      isCancelled = true;
      if (localBlobUrlRef.current) {
        URL.revokeObjectURL(localBlobUrlRef.current);
        localBlobUrlRef.current = null;
      }
    };
  }, [rawSrc, editor, updateAttributes]);

  const isSelected = isLocalSelected || isResizing;

  const alignClass =
    alignment === 'left'
      ? 'justify-start'
      : alignment === 'right'
      ? 'justify-end'
      : 'justify-center';

  // Largura exibida: durante o arraste usa a largura em tempo real, caso contrário usa o atributo persistido
  const currentDisplayWidth =
    resizingWidth !== null
      ? `${resizingWidth}px`
      : initialWidthAttr || '100%';

  // IntersectionObserver para Lazy Loading progressivo e não-bloqueante
  useEffect(() => {
    if (isVisibleInViewport || initialInCache) return;

    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsVisibleInViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisibleInViewport(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '400px 0px', // Carrega com 400px de folga antes do scroll atingir
        threshold: 0.01,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isVisibleInViewport, initialInCache]);

  // Calcula e memoriza a proporção original da imagem ao carregar
  const handleImageLoad = () => {
    setIsImageLoaded(true);
    markMediaAsLoaded(rawSrc);
    if (imgRef.current) {
      const naturalW = imgRef.current.naturalWidth;
      const naturalH = imgRef.current.naturalHeight;
      if (naturalW && naturalH) {
        setAspectRatio(naturalW / naturalH);
      }
    }
    perfProfiler.mark(rawSrc, 'T6 - Imagem Renderizada', { width: initialWidthAttr });
  };

  // Fallback se a imagem otimizada falhar
  const handleImageError = () => {
    if (currentSrc !== rawSrc) {
      setCurrentSrc(rawSrc);
    } else {
      setImageError(true);
      setIsImageLoaded(true);
    }
  };

  // Fecha a seleção ao clicar ou tocar fora
  useEffect(() => {
    const handleDocumentInteraction = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsLocalSelected(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentInteraction);
    document.addEventListener('touchstart', handleDocumentInteraction, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleDocumentInteraction);
      document.removeEventListener('touchstart', handleDocumentInteraction);
    };
  }, []);

  // Handler de Long Press para Mobile / Tablet e Clique para Desktop
  const touchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

    if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    touchTimerRef.current = setTimeout(() => {
      setIsLocalSelected(true);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(40);
        } catch {
          // ignore
        }
      }
    }, 450); // 450ms long press threshold
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current || !touchTimerRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
    // Se o usuário estiver rolando a página, cancela o long press
    if (dx > 10 || dy > 10) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // No Desktop (dispositivos com ponteiro fino), o clique seleciona imediatamente
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches) {
      setIsLocalSelected(true);
    }
  };

  const handleMove = (direction: 'up' | 'down') => {
    moveNodeBlock(editor as any, getPos as any, direction);
  };

  // Inicia o redimensionamento por arraste (Pointer / Touch / Mouse unificado)
  const handleResizeStart = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      direction: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right'
    ) => {
      e.preventDefault();
      e.stopPropagation();

      if (!containerRef.current) return;

      setIsResizing(true);
      setIsLocalSelected(true);

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = imgRef.current?.offsetWidth || containerRef.current.offsetWidth || 300;
      const startHeight = imgRef.current?.offsetHeight || (startWidth / (aspectRatio || 1));
      const currentRatio = aspectRatio || (startWidth / startHeight) || 1;

      // Obtém a largura máxima disponível da folha (note container)
      const editorElement = containerRef.current?.closest('.ProseMirror') || containerRef.current?.parentElement;
      const maxContainerWidth = editorElement ? editorElement.clientWidth - 24 : 800;

      let latestCalculatedWidth = startWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        let calculatedWidth = startWidth;

        switch (direction) {
          case 'right':
            calculatedWidth = startWidth + deltaX;
            break;
          case 'left':
            calculatedWidth = startWidth - deltaX;
            break;
          case 'bottom-right': {
            const widthFromX = startWidth + deltaX;
            const widthFromY = startWidth + (deltaY * currentRatio);
            calculatedWidth = Math.abs(deltaX) > Math.abs(deltaY) ? widthFromX : widthFromY;
            break;
          }
          case 'bottom-left': {
            const widthFromX = startWidth - deltaX;
            const widthFromY = startWidth + (deltaY * currentRatio);
            calculatedWidth = Math.abs(deltaX) > Math.abs(deltaY) ? widthFromX : widthFromY;
            break;
          }
          case 'top-right': {
            const widthFromX = startWidth + deltaX;
            const widthFromY = startWidth - (deltaY * currentRatio);
            calculatedWidth = Math.abs(deltaX) > Math.abs(deltaY) ? widthFromX : widthFromY;
            break;
          }
          case 'top-left': {
            const widthFromX = startWidth - deltaX;
            const widthFromY = startWidth - (deltaY * currentRatio);
            calculatedWidth = Math.abs(deltaX) > Math.abs(deltaY) ? widthFromX : widthFromY;
            break;
          }
        }

        // Limites de tamanho: mínimo 70px, máximo a largura total da folha
        const clampedWidth = Math.min(Math.max(calculatedWidth, 70), maxContainerWidth);
        latestCalculatedWidth = clampedWidth;
        setResizingWidth(Math.round(clampedWidth));
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        upEvent.preventDefault();
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        setIsResizing(false);
        setResizingWidth(null);

        // Persiste as dimensões no documento da nota
        updateAttributes({
          width: `${Math.round(latestCalculatedWidth)}px`,
        });
      };

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp, { passive: false });
    },
    [aspectRatio, updateAttributes]
  );

  return (
    <NodeViewWrapper
      as="div"
      ref={containerRef}
      className={`image-node-view-wrapper my-5 relative flex ${alignClass} max-w-full select-none`}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div
        className={`relative inline-block max-w-full transition-shadow duration-150 ${
          isSelected ? 'ring-2 ring-[#68594d] ring-offset-2 ring-offset-white rounded-xl' : ''
        }`}
        style={{
          width: currentDisplayWidth,
          maxWidth: '100%',
        }}
      >
        {/* Barra Flutuante de Informação e Ações Rápidas (Aparece ao selecionar) */}
        {isSelected && (
          <div
            className="absolute -top-11 left-1/2 -translate-x-1/2 bg-[#ffffff]/98 backdrop-blur-xs border border-[#e4e2dd] shadow-lg rounded-xl px-2 py-1 flex items-center gap-1.5 z-30 text-xs font-sans-ui text-[#4e453f] animate-in fade-in zoom-in-95 pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle de Arraste (Drag & Drop nativo do ProseMirror) */}
            <div
              data-drag-handle
              className="p-1 hover:bg-[#f0eee9] rounded-md text-[#68594d] cursor-grab active:cursor-grabbing flex items-center justify-center"
              title="Segure e arraste para reposicionar no documento"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </div>

            {/* Mover para Cima e para Baixo */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => handleMove('up')}
                className="p-1 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] rounded-md transition-colors cursor-pointer"
                title="Mover bloco para cima"
                aria-label="Mover bloco para cima"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleMove('down')}
                className="p-1 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] rounded-md transition-colors cursor-pointer"
                title="Mover bloco para baixo"
                aria-label="Mover bloco para baixo"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

            {/* Controles de Alinhamento Horizontal */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => updateAttributes({ alignment: 'left' })}
                className={`p-1 rounded-md transition-colors cursor-pointer ${
                  alignment === 'left'
                    ? 'bg-[#68594d] text-white shadow-2xs'
                    : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
                }`}
                title="Alinhar à esquerda"
                aria-label="Alinhar à esquerda"
              >
                <AlignLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => updateAttributes({ alignment: 'center' })}
                className={`p-1 rounded-md transition-colors cursor-pointer ${
                  alignment === 'center'
                    ? 'bg-[#68594d] text-white shadow-2xs'
                    : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
                }`}
                title="Centralizar"
                aria-label="Centralizar"
              >
                <AlignCenter className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => updateAttributes({ alignment: 'right' })}
                className={`p-1 rounded-md transition-colors cursor-pointer ${
                  alignment === 'right'
                    ? 'bg-[#68594d] text-white shadow-2xs'
                    : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
                }`}
                title="Alinhar à direita"
                aria-label="Alinhar à direita"
              >
                <AlignRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

            {/* Indicador numérico de largura em tempo real */}
            <span className="font-mono text-[11px] font-medium text-[#68594d] px-1">
              {resizingWidth ? `${Math.round(resizingWidth)}px` : initialWidthAttr || 'Auto'}
            </span>

            {/* Presets rápidos */}
            <button
              type="button"
              onClick={() => {
                const parent =
                  containerRef.current?.closest('.ProseMirror') ||
                  containerRef.current?.parentElement;
                const maxW = parent ? parent.clientWidth - 24 : 700;
                const halfW = Math.round(maxW * 0.5);
                updateAttributes({ width: `${halfW}px` });
              }}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium hover:bg-[#f0eee9] text-[#4e453f] transition-colors cursor-pointer"
              title="50% da folha"
              aria-label="Redimensionar para 50% da folha"
            >
              50%
            </button>
            <button
              type="button"
              onClick={() => {
                const parent =
                  containerRef.current?.closest('.ProseMirror') ||
                  containerRef.current?.parentElement;
                const maxW = parent ? parent.clientWidth - 24 : 700;
                const fullW = Math.round(maxW);
                updateAttributes({ width: `${fullW}px` });
              }}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium hover:bg-[#f0eee9] text-[#4e453f] transition-colors cursor-pointer"
              title="100% da folha"
              aria-label="Redimensionar para 100% da folha"
            >
              100%
            </button>

            <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

            {/* Excluir imagem */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deleteNode();
              }}
              className="p-1 text-[#ba1a1a] hover:bg-[#fceded] rounded-md transition-colors cursor-pointer"
              title="Excluir Imagem"
              aria-label="Excluir Imagem"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Skeleton Placeholder durante o carregamento / fora da viewport (Zero Layout Shift) */}
        {(!isImageLoaded || !isVisibleInViewport) && !imageError && (
          <div
            className="w-full rounded-xl bg-[#f5f3ee] border border-[#e4e2dd] flex items-center justify-center animate-pulse min-h-[160px] py-12 transition-opacity duration-300"
            style={{
              aspectRatio: aspectRatio || '16/10',
            }}
          >
            <div className="flex flex-col items-center gap-2 text-[#a89f91]">
              <ImageIcon className="w-7 h-7 opacity-60" />
              <span className="text-[11px] font-sans-ui font-medium tracking-wide">
                Carregando imagem...
              </span>
            </div>
          </div>
        )}

        {/* Mensagem de Erro se a Imagem não puder ser baixada */}
        {imageError && (
          <div className="w-full rounded-xl bg-[#fcedec] border border-[#f5c6c2] p-4 text-center text-xs font-sans-ui text-[#ba1a1a]">
            Não foi possível carregar esta imagem.
          </div>
        )}

        {/* Imagem Real com Lazy Loading nativo + decoding assíncrono */}
        {isVisibleInViewport && !imageError && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            ref={imgRef}
            src={currentSrc}
            alt={alt}
            title={title}
            loading="lazy"
            decoding="async"
            onLoad={handleImageLoad}
            onError={handleImageError}
            draggable={false}
            className={`rounded-xl block w-full h-auto object-contain border border-[#e4e2dd] shadow-xs pointer-events-auto transition-opacity duration-200 ${
              isImageLoaded ? 'opacity-100' : 'opacity-0 absolute top-0 left-0 pointer-events-none'
            }`}
          />
        )}

        {/* Handles de Redimensionamento Interativos (Visíveis ao Selecionar) */}
        {isSelected && (
          <>
            {/* Quina Superior Esquerda */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'top-left')}
              className="absolute -top-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize z-20 touch-none"
              title="Redimensionar proporção"
            >
              <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
            </div>

            {/* Quina Superior Direita */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'top-right')}
              className="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize z-20 touch-none"
              title="Redimensionar proporção"
            >
              <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
            </div>

            {/* Quina Inferior Esquerda */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'bottom-left')}
              className="absolute -bottom-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize z-20 touch-none"
              title="Redimensionar proporção"
            >
              <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
            </div>

            {/* Quina Inferior Direita */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'bottom-right')}
              className="absolute -bottom-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize z-20 touch-none"
              title="Redimensionar proporção"
            >
              <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
            </div>

            {/* Lateral Esquerda */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'left')}
              className="absolute top-1/2 -left-3 -translate-y-1/2 w-7 h-7 flex items-center justify-center cursor-ew-resize z-20 touch-none"
              title="Redimensionar largura"
            >
              <div className="w-2.5 h-5 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
            </div>

            {/* Lateral Direita */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'right')}
              className="absolute top-1/2 -right-3 -translate-y-1/2 w-7 h-7 flex items-center justify-center cursor-ew-resize z-20 touch-none"
              title="Redimensionar largura"
            >
              <div className="w-2.5 h-5 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
            </div>
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}
