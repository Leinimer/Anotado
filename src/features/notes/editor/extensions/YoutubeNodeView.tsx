'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import {
  Play,
  Youtube,
} from 'lucide-react';
import {
  moveNodeBlock,
} from '../utils/node-movement';
import {
  getYouTubeThumbnailUrl,
  extractYouTubeVideoId,
  markMediaAsLoaded,
  isMediaInCache,
  perfProfiler,
} from '../utils/media-optimizer';
import { getMediaAlignmentClass } from '../utils/media-common';
import { useMediaResize } from '../hooks/use-media-resize';
import { MediaResizeHandles } from '../ui/MediaResizeHandles';
import { MediaFloatingToolbar } from '../ui/MediaToolbarControls';

export function YoutubeNodeView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode, selected, editor, getPos } = props;
  const src = node.attrs.src || '';
  const initialWidthAttr = node.attrs.width || '50%';
  const alignment = (node.attrs.alignment as 'left' | 'center' | 'right') || 'center';

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeWrapperRef = useRef<HTMLDivElement>(null);

  const [isLocalSelected, setIsLocalSelected] = useState(false);

  // Estado de carregamento inteligente do Player do YouTube
  const initialInCache = useMemo(() => isMediaInCache(src), [src]);
  const [isVisibleInViewport, setIsVisibleInViewport] = useState(initialInCache);
  const [isPlaying, setIsPlaying] = useState(false);
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);

  const videoId = useMemo(() => extractYouTubeVideoId(src), [src]);
  const thumbnailUrl = useMemo(() => getYouTubeThumbnailUrl(src), [src]);

  const { isResizing, resizingWidth, handleResizeStart } = useMediaResize({
    containerRef,
    targetRef: iframeWrapperRef,
    aspectRatio: 16 / 9,
    minWidth: 200,
    onPersistWidth: (finalWidth) => {
      updateAttributes({ width: finalWidth });
      console.log('[MEDIA-PERSIST]', { type: 'youtube', width: finalWidth, alignment });
    },
    onSelect: () => setIsLocalSelected(true),
  });

  const isSelected = isLocalSelected || isResizing;
  const alignClass = getMediaAlignmentClass(alignment);

  const currentDisplayWidth =
    resizingWidth !== null
      ? `${resizingWidth}px`
      : initialWidthAttr
      ? typeof initialWidthAttr === 'number'
        ? `${initialWidthAttr}px`
        : initialWidthAttr
      : '100%';

  const handleMove = (direction: 'up' | 'down') => {
    moveNodeBlock(editor as any, getPos as any, direction);
  };

  // Normaliza o embed URL
  const getEmbedUrl = (url: string, autoPlay: boolean = false) => {
    if (!url) return '';
    let finalEmbed = url;
    if (!url.includes('embed/')) {
      const id = extractYouTubeVideoId(url);
      if (id) {
        finalEmbed = `https://www.youtube-nocookie.com/embed/${id}`;
      }
    }
    if (autoPlay) {
      finalEmbed += finalEmbed.includes('?') ? '&autoplay=1' : '?autoplay=1';
    }
    return finalEmbed;
  };

  const embedUrl = useMemo(() => getEmbedUrl(src, isPlaying), [src, isPlaying]);

  // IntersectionObserver para detectar proximidade antes de permitir carregar recursos
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
        rootMargin: '300px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isVisibleInViewport, initialInCache]);

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
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches) {
      setIsLocalSelected(true);
    }
  };

  const handleStartPlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPlaying(true);
    markMediaAsLoaded(src);
    perfProfiler.mark(src, 'T6 - YouTube Player Iniciado');
  };

  const handleDragStart = (e: React.DragEvent) => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (typeof pos === 'number' && editor?.view) {
      try {
        const { doc } = editor.view.state;
        const selection = NodeSelection.create(doc, pos);
        editor.view.dispatch(editor.view.state.tr.setSelection(selection));
      } catch (err) {
        console.warn('[MEDIA-DRAG] Could not set NodeSelection on youtube drag start:', err);
      }
    }
  };

  return (
    <NodeViewWrapper
      as="div"
      ref={containerRef}
      className={`youtube-node-view-wrapper youtube-block-wrapper my-6 relative flex ${alignClass} max-w-full select-none`}
      onClick={handleClick}
      onDragStart={handleDragStart}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      draggable={true}
    >
      <div
        ref={iframeWrapperRef}
        className={`relative inline-block max-w-full transition-shadow duration-150 ${
          isSelected ? 'ring-2 ring-[#68594d] ring-offset-2 ring-offset-white rounded-2xl' : ''
        }`}
        style={{
          width: currentDisplayWidth,
          maxWidth: '100%',
        }}
      >
        {/* Barra Flutuante de Ações Rápidas (Aparece ao selecionar) */}
        {isSelected && (
          <MediaFloatingToolbar
            onMove={handleMove}
            alignment={alignment}
            onAlign={(align) => {
              updateAttributes({ alignment: align });
              console.log('[MEDIA-PERSIST]', { type: 'youtube', width: node.attrs.width, alignment: align });
            }}
            widthDisplay={resizingWidth ? `${Math.round(resizingWidth)}px` : initialWidthAttr || '100%'}
            presets={[
              { label: '50%', value: '50%' },
              { label: '75%', value: '75%' },
              { label: '100%', value: '100%' },
            ]}
            onSetWidth={(val) => {
              updateAttributes({ width: val });
              console.log('[MEDIA-PERSIST]', { type: 'youtube', width: val, alignment });
            }}
            onDelete={() => deleteNode()}
            deleteTitle="Excluir Vídeo"
          />
        )}

        {/* Container do Iframe com Proporção 16:9 Estrita e Facade Leve */}
        <div className="w-full relative rounded-2xl overflow-hidden shadow-xs border border-[#e4e2dd] bg-[#1a1715]">
          <div className="relative pb-[56.25%] h-0 w-full">
            {/* Modo 1: Facade leve de Thumbnail (Zero JS pesado até interação/scroll) */}
            {!isPlaying && (
              <div
                onClick={handleStartPlay}
                className="absolute inset-0 w-full h-full cursor-pointer group flex items-center justify-center overflow-hidden bg-[#241e1a]"
                title="Clique para reproduzir o vídeo"
              >
                {/* Imagem de Thumbnail de alta definição */}
                {isVisibleInViewport && videoId && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={thumbnailUrl}
                    alt="YouTube Video Thumbnail"
                    loading="lazy"
                    decoding="async"
                    onLoad={() => setThumbnailLoaded(true)}
                    className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 group-hover:scale-105 ${
                      thumbnailLoaded ? 'opacity-85' : 'opacity-0'
                    }`}
                  />
                )}

                {/* Gradiente sutil para legibilidade */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />

                {/* Selo do YouTube no topo esquerdo */}
                <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-xs text-white text-[11px] font-sans-ui font-medium">
                  <Youtube className="w-4 h-4 text-[#ff0000]" />
                  <span>YouTube</span>
                </div>

                {/* Botão de Play circular elegante (Papyrus & Ink / YouTube) */}
                <div className="relative z-10 w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#68594d]/90 hover:bg-[#ba1a1a] text-white flex items-center justify-center shadow-lg transition-all duration-200 group-hover:scale-110">
                  <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-current ml-1" />
                </div>
              </div>
            )}

            {/* Modo 2: Iframe Real do YouTube (Instanciado on-demand sem travar a thread) */}
            {isPlaying && (
              <iframe
                src={embedUrl}
                title="YouTube video player"
                frameBorder="0"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="absolute top-0 left-0 w-full h-full rounded-2xl"
              />
            )}

            {/* Overlay transparente durante o redimensionamento */}
            {isResizing && <div className="absolute inset-0 z-10 bg-transparent" />}
          </div>
        </div>

        {/* Handles de Redimensionamento Interativos */}
        {isSelected && (
          <MediaResizeHandles
            onResizeStart={handleResizeStart}
            showTopHandles={true}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}
