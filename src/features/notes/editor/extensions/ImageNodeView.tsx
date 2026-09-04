'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import {
  Image as ImageIcon,
  X,
} from 'lucide-react';
import {
  moveNodeBlock,
} from '../utils/node-movement';
import {
  getOptimizedImageUrl,
  markMediaAsLoaded,
  isMediaInCache,
  perfProfiler,
} from '../utils/media-optimizer';
import { getMediaAlignmentClass, getCachedAttachmentUrl } from '../utils/media-common';
import { useAttachmentSource } from '../hooks/use-attachment-source';
import { useMediaResize } from '../hooks/use-media-resize';
import { MediaResizeHandles } from '../ui/MediaResizeHandles';
import { MediaFloatingToolbar } from '../ui/MediaToolbarControls';

export function ImageNodeView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode, selected, editor, getPos } = props;
  const rawSrc = node.attrs.src || '';
  const alt = node.attrs.alt || '';
  const title = node.attrs.title || '';
  const initialWidthAttr = node.attrs.width || '50%';
  const alignment = (node.attrs.alignment as 'left' | 'center' | 'right') || 'center';

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const localBlobUrlRef = useRef<string | null>(null);

  const [isLocalSelected, setIsLocalSelected] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>(() => {
    // Se tiver dimensões no atributo
    if (node.attrs.height && node.attrs.width && Number(node.attrs.height) > 0) {
      return Number(node.attrs.width) / Number(node.attrs.height);
    }
    return 16 / 10;
  });

  // Estado de visibilidade via IntersectionObserver
  const cachedAttachment = useMemo(() => getCachedAttachmentUrl(rawSrc), [rawSrc]);
  const initialInCache = useMemo(
    () => isMediaInCache(rawSrc) || (cachedAttachment ? isMediaInCache(cachedAttachment) : false),
    [rawSrc, cachedAttachment]
  );
  const [isVisibleInViewport, setIsVisibleInViewport] = useState(initialInCache || Boolean(cachedAttachment));
  const [isImageLoaded, setIsImageLoaded] = useState(initialInCache || Boolean(cachedAttachment));

  const currentUserId = (editor as any)?.options?.editorProps?.attributes?.['data-user-id'] || 'anonymous';

  const transformInitialUrl = useCallback((url: string) => getOptimizedImageUrl(url, 850), []);
  const onRemoteResolved = useCallback(
    (remoteUrl: string) => {
      if (
        rawSrc !== remoteUrl &&
        (rawSrc.startsWith('attachment://') || rawSrc.startsWith('local-attachment://'))
      ) {
        updateAttributes({ src: remoteUrl });
      }
    },
    [rawSrc, updateAttributes]
  );

  const {
    resolvedSrc: currentSrc,
    setResolvedSrc: setCurrentSrc,
    hasError: imageError,
    setHasError: setImageError,
  } = useAttachmentSource({
    rawSrc,
    currentUserId,
    isImage: true,
    transformInitialUrl,
    onRemoteResolved,
  });

  // Fonte visual ativa contínua e buffer estável para transição 100% livre de flicker
  const [displayedSrc, setDisplayedSrc] = useState<string>(() => currentSrc || cachedAttachment || rawSrc);
  const [previousSrc, setPreviousSrc] = useState<string | null>(null);
  const [prevCurrentSrc, setPrevCurrentSrc] = useState(currentSrc);

  if (currentSrc && currentSrc !== prevCurrentSrc) {
    setPrevCurrentSrc(currentSrc);
    if (displayedSrc && displayedSrc !== currentSrc) {
      setPreviousSrc(displayedSrc);
    }
    setDisplayedSrc(currentSrc);
  }

  const { isResizing, resizingWidth, handleResizeStart } = useMediaResize({
    containerRef,
    targetRef: imgRef,
    aspectRatio,
    minWidth: 70,
    onPersistWidth: (finalWidth) => {
      updateAttributes({ width: finalWidth });
      console.log('[MEDIA-PERSIST]', { type: 'image', width: finalWidth, alignment });
    },
    onSelect: () => setIsLocalSelected(true),
  });

  const isSelected = isLocalSelected || isResizing;
  const alignClass = getMediaAlignmentClass(alignment);

  // Largura exibida: durante o arraste usa a largura em tempo real, caso contrário usa o atributo persistido
  const currentDisplayWidth =
    resizingWidth !== null
      ? `${resizingWidth}px`
      : initialWidthAttr
      ? typeof initialWidthAttr === 'number'
        ? `${initialWidthAttr}px`
        : initialWidthAttr
      : '50%';

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
    setPreviousSrc(null);
    markMediaAsLoaded(rawSrc);
    if (displayedSrc) markMediaAsLoaded(displayedSrc);
    if (currentSrc) markMediaAsLoaded(currentSrc);
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
      setPreviousSrc(null);
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

  // Fecha o Lightbox ao pressionar Escape e bloqueia scroll de fundo
  useEffect(() => {
    if (!isLightboxOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLightboxOpen(false);
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLightboxOpen]);

  // Handler de Long Press para Mobile / Tablet e Clique para Desktop
  const touchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // Limpa touchTimer ao desmontar
  useEffect(() => {
    return () => {
      if (touchTimerRef.current) {
        clearTimeout(touchTimerRef.current);
      }
    };
  }, []);

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
    // No Desktop (dispositivos com ponteiro fino), o clique simples seleciona a imagem
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches) {
      setIsLocalSelected(true);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Duplo clique abre o lightbox modal em tela cheia
    e.preventDefault();
    e.stopPropagation();
    setIsLightboxOpen(true);
  };

  const handleDragStart = (e: React.DragEvent) => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (typeof pos === 'number' && editor?.view) {
      try {
        const { doc } = editor.view.state;
        const selection = NodeSelection.create(doc, pos);
        editor.view.dispatch(editor.view.state.tr.setSelection(selection));
      } catch (err) {
        console.warn('[MEDIA-DRAG] Could not set NodeSelection on drag start:', err);
      }
    }
  };

  const handleMove = (direction: 'up' | 'down') => {
    moveNodeBlock(editor as any, getPos as any, direction);
  };

  return (
    <NodeViewWrapper
      as="div"
      ref={containerRef}
      className={`image-node-view-wrapper my-5 relative flex ${alignClass} max-w-full select-none cursor-pointer`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onDragStart={handleDragStart}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      draggable={editor?.isEditable ?? false}
    >
      <div
        className={`relative inline-block max-w-full transition-shadow duration-150 ${
          isSelected && editor?.isEditable ? 'ring-2 ring-[#68594d] ring-offset-2 ring-offset-white rounded-xl' : ''
        }`}
        style={{
          width: currentDisplayWidth,
          maxWidth: '100%',
        }}
      >
        {/* Barra Flutuante de Informação e Ações Rápidas (Aparece ao selecionar apenas se editável) */}
        {isSelected && editor?.isEditable && (
          <MediaFloatingToolbar
            onMove={handleMove}
            alignment={alignment}
            onAlign={(align) => {
              updateAttributes({ alignment: align });
              console.log('[MEDIA-PERSIST]', { type: 'image', width: node.attrs.width, alignment: align });
            }}
            widthDisplay={resizingWidth ? `${Math.round(resizingWidth)}px` : initialWidthAttr || 'Auto'}
            presets={[
              { label: '50%', value: '50%' },
              { label: '100%', value: '100%' },
            ]}
            onSetWidth={(val) => {
              updateAttributes({ width: val });
              console.log('[MEDIA-PERSIST]', { type: 'image', width: val, alignment });
            }}
            onDelete={() => deleteNode()}
            deleteTitle="Excluir Imagem"
          />
        )}

        {/* Skeleton Placeholder durante o carregamento inicial (Zero Layout Shift) */}
        {(!isImageLoaded || !isVisibleInViewport) && !imageError && !previousSrc && !displayedSrc && (
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

        {/* Imagem anterior estável mantida por baixo para eliminar qualquer piscada durante a transição */}
        {previousSrc && previousSrc !== displayedSrc && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={previousSrc}
            alt={alt}
            draggable={false}
            className="rounded-xl block w-full h-auto object-contain border border-[#e4e2dd] shadow-xs pointer-events-none absolute top-0 left-0 z-0"
          />
        )}

        {/* Imagem Real com decoding assíncrono */}
        {isVisibleInViewport && !imageError && displayedSrc && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            ref={imgRef}
            src={displayedSrc}
            alt={alt}
            title={title}
            decoding="async"
            onLoad={handleImageLoad}
            onError={handleImageError}
            draggable={false}
            className={`rounded-xl block w-full h-auto object-contain border border-[#e4e2dd] shadow-xs pointer-events-auto relative z-1 transition-opacity duration-150 ${
              isImageLoaded ? 'opacity-100' : previousSrc ? 'opacity-0' : 'opacity-0 absolute top-0 left-0 pointer-events-none'
            }`}
          />
        )}

        {/* Handles de Redimensionamento Interativos (Visíveis ao Selecionar apenas se editável) */}
        {isSelected && editor?.isEditable && (
          <MediaResizeHandles
            onResizeStart={handleResizeStart}
            showTopHandles={true}
          />
        )}
      </div>

      {/* Modal / Lightbox em Tela Cheia no Duplo Clique */}
      {isLightboxOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id="image-lightbox-modal"
            className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200 select-none cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              setIsLightboxOpen(false);
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Visualização ampliada da imagem"
          >
            {/* Botão Fechar X */}
            <button
              id="image-lightbox-close-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsLightboxOpen(false);
              }}
              className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/50 z-10"
              title="Fechar (Esc)"
              aria-label="Fechar visualização"
            >
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>

            {/* Imagem Ampliada */}
            <div
              className="relative max-w-full max-h-full flex items-center justify-center pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayedSrc || currentSrc || rawSrc}
                alt={alt || 'Visualização ampliada da imagem'}
                className="max-w-[90vw] max-h-[88vh] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-200"
              />
            </div>
          </div>,
          document.body
        )}
    </NodeViewWrapper>
  );
}
