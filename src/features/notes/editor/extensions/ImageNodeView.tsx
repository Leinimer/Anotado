'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import {
  Image as ImageIcon,
  X,
  Captions,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
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
  const caption = (node.attrs.caption as string) || '';

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

  // Estado da Legenda
  const [isEditingCaption, setIsEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(caption);
  const [prevCaption, setPrevCaption] = useState(caption);
  const captionInputRef = useRef<HTMLInputElement>(null);

  if (caption !== prevCaption) {
    setPrevCaption(caption);
    setCaptionDraft(caption);
  }

  useEffect(() => {
    if (isEditingCaption && captionInputRef.current) {
      captionInputRef.current.focus();
      captionInputRef.current.select();
    }
  }, [isEditingCaption]);

  const handleSaveCaption = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      updateAttributes({ caption: trimmed.length > 0 ? trimmed : null });
      setIsEditingCaption(false);
    },
    [updateAttributes]
  );

  const handleRemoveCaption = useCallback(() => {
    setCaptionDraft('');
    updateAttributes({ caption: null });
    setIsEditingCaption(false);
  }, [updateAttributes]);

  // Estado de Zoom e Pan no Visualizador / Lightbox
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const didDragRef = useRef(false);

  // Abertura e fechamento com reset limpo e atômico do zoom e pan
  const openLightbox = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
    didDragRef.current = false;
    setIsLightboxOpen(true);
  }, []);

  const closeLightbox = useCallback(() => {
    setIsLightboxOpen(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
    didDragRef.current = false;
  }, []);

  // Touch tracking para Mobile
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef<number>(1);

  // Limites do Pan para impedir que a imagem saia da tela
  const clampPan = useCallback((targetX: number, targetY: number, currentZoom: number) => {
    if (currentZoom <= 1.0) return { x: 0, y: 0 };
    const vpW = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const vpH = typeof window !== 'undefined' ? window.innerHeight : 768;

    const maxPanX = (vpW * (currentZoom - 0.7)) / 2 + 60;
    const maxPanY = (vpH * (currentZoom - 0.7)) / 2 + 60;

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, targetX)),
      y: Math.max(-maxPanY, Math.min(maxPanY, targetY)),
    };
  }, []);

  // Zoom suave com scroll do mouse no Lightbox (50% a 500%)
  const handleWheelLightbox = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const delta = -e.deltaY;
      const factor = delta > 0 ? 1.15 : 0.87;

      setZoom((prevZoom) => {
        let nextZoom = Math.min(5.0, Math.max(0.5, Number((prevZoom * factor).toFixed(3))));
        if (nextZoom <= 1.0) {
          setPan({ x: 0, y: 0 });
        } else {
          setPan((prevPan) => clampPan(prevPan.x, prevPan.y, nextZoom));
        }
        return nextZoom;
      });
    },
    [clampPan]
  );

  // Início do arraste / Pan com o mouse (somente se zoom > 100%)
  const handleMouseDownLightbox = useCallback(
    (e: React.MouseEvent) => {
      if (zoom <= 1.0) return;
      e.preventDefault();
      e.stopPropagation();

      setIsPanning(true);
      didDragRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      panStartRef.current = { ...pan };
    },
    [zoom, pan]
  );

  // Efeito global de arraste com o mouse
  useEffect(() => {
    if (!isPanning) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.hypot(dx, dy) > 4) {
        didDragRef.current = true;
      }
      const nextX = panStartRef.current.x + dx;
      const nextY = panStartRef.current.y + dy;
      setPan(clampPan(nextX, nextY, zoom));
    };

    const handleGlobalMouseUp = () => {
      setIsPanning(false);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isPanning, zoom, clampPan]);

  // Touch handlers para Mobile (Pinch-to-zoom e Pan quando zoom > 1.0)
  const handleTouchStartLightbox = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        touchStartDistRef.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        touchStartZoomRef.current = zoom;
      } else if (e.touches.length === 1 && zoom > 1.0) {
        const touch = e.touches[0];
        setIsPanning(true);
        didDragRef.current = false;
        dragStartRef.current = { x: touch.clientX, y: touch.clientY };
        panStartRef.current = { ...pan };
      }
    },
    [zoom, pan]
  );

  const handleTouchMoveLightbox = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2 && touchStartDistRef.current) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const curDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const scale = curDist / touchStartDistRef.current;
        let nextZoom = Math.min(5.0, Math.max(0.5, touchStartZoomRef.current * scale));
        setZoom(nextZoom);
        if (nextZoom <= 1.0) {
          setPan({ x: 0, y: 0 });
        }
      } else if (e.touches.length === 1 && isPanning && zoom > 1.0) {
        e.preventDefault();
        const touch = e.touches[0];
        const dx = touch.clientX - dragStartRef.current.x;
        const dy = touch.clientY - dragStartRef.current.y;
        if (Math.hypot(dx, dy) > 4) {
          didDragRef.current = true;
        }
        const nextX = panStartRef.current.x + dx;
        const nextY = panStartRef.current.y + dy;
        setPan(clampPan(nextX, nextY, zoom));
      }
    },
    [isPanning, zoom, clampPan]
  );

  const handleTouchEndLightbox = useCallback(() => {
    touchStartDistRef.current = null;
    setIsPanning(false);
  }, []);

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

  const { isResizing, resizingWidth, handleResizeStart, wasJustResized } = useMediaResize({
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
        closeLightbox();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLightboxOpen, closeLightbox]);

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
    // Se o editor não for editável (ex: visualização), o clique simples abre o lightbox
    if (!editor?.isEditable) {
      e.stopPropagation();
      openLightbox();
      return;
    }

    // Se acabou de redimensionar ou está redimensionando, não abre nem processa clique
    if (wasJustResized()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Clique simples na imagem: seleciona a imagem e mostra as alças de redimensionamento
    e.stopPropagation();
    setIsLocalSelected(true);

    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (typeof pos === 'number' && editor?.view) {
      try {
        const { doc } = editor.view.state;
        const selection = NodeSelection.create(doc, pos);
        editor.view.dispatch(editor.view.state.tr.setSelection(selection));
      } catch (err) {
        // ignora
      }
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Se acabou de redimensionar, ignora para não abrir inadvertidamente
    if (wasJustResized()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // DOIS CLIQUES na imagem: aí sim abre o visualizador/zoom da imagem
    e.preventDefault();
    e.stopPropagation();
    openLightbox();
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
          >
            <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

            {/* Botão Adicionar / Editar Legenda */}
            <button
              type="button"
              onClick={() => setIsEditingCaption(true)}
              className="flex items-center gap-1 px-2 py-0.5 text-xs font-sans-ui text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] rounded-md transition-colors cursor-pointer font-medium"
              title={caption ? 'Editar legenda' : 'Adicionar legenda'}
              aria-label={caption ? 'Editar legenda' : 'Adicionar legenda'}
            >
              <Captions className="w-3.5 h-3.5 text-[#68594d]" />
              <span>{caption ? 'Editar legenda' : 'Adicionar legenda'}</span>
            </button>

            {/* Botão Remover Legenda (somente a legenda desaparece, imagem permanece) */}
            {caption && (
              <button
                type="button"
                onClick={handleRemoveCaption}
                className="p-1 text-[#7f756e] hover:text-[#ba1a1a] hover:bg-[#ffdad6] rounded-md transition-colors cursor-pointer"
                title="Remover legenda"
                aria-label="Remover legenda"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

            {/* Botão para abrir visualizador ampliado */}
            <button
              type="button"
              onClick={() => openLightbox()}
              className="p-1 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] rounded-md transition-colors cursor-pointer"
              title="Abrir visualizador"
              aria-label="Abrir visualizador"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </MediaFloatingToolbar>
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

        {/* Legenda abaixo da Imagem */}
        {isEditingCaption ? (
          <div
            className="mt-1.5 w-full flex items-center gap-1.5 px-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={captionInputRef}
              type="text"
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveCaption(captionDraft);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setIsEditingCaption(false);
                  setCaptionDraft(caption);
                }
              }}
              onBlur={() => handleSaveCaption(captionDraft)}
              placeholder="Adicionar legenda..."
              className={`w-full bg-transparent border-b border-[#c4bebb] focus:border-[#68594d] focus:outline-none py-0.5 px-1 text-xs text-[#5e534b] font-sans-ui placeholder:text-[#a89f91] ${
                alignment === 'left' ? 'text-left' : alignment === 'right' ? 'text-right' : 'text-center'
              }`}
            />
            <button
              type="button"
              onClick={handleRemoveCaption}
              className="p-1 text-[#ba1a1a] hover:bg-[#ffdad6] rounded-md transition-colors cursor-pointer shrink-0"
              title="Remover legenda"
              aria-label="Remover legenda"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : caption ? (
          <figcaption
            className={`mt-1.5 text-xs text-[#7f756e] font-sans-ui leading-relaxed break-words px-1 select-text ${
              alignment === 'left' ? 'text-left' : alignment === 'right' ? 'text-right' : 'text-center'
            } ${editor?.isEditable ? 'cursor-pointer hover:text-[#5e534b]' : ''}`}
            onClick={(e) => {
              if (editor?.isEditable) {
                e.stopPropagation();
                setIsEditingCaption(true);
              }
            }}
            title={editor?.isEditable ? 'Clique para editar a legenda' : undefined}
          >
            {caption}
          </figcaption>
        ) : null}
      </div>

      {/* Modal / Lightbox em Tela Cheia com Zoom por Scroll e Pan por Arraste */}
      {isLightboxOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id="image-lightbox-modal"
            className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 select-none cursor-default animate-in fade-in duration-200"
            onClick={(e) => {
              if (!didDragRef.current) {
                e.stopPropagation();
                closeLightbox();
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Visualização ampliada da imagem"
          >
            {/* Header com Controles de Zoom e Botão Fechar */}
            <div
              className="absolute top-4 left-4 right-4 sm:top-6 sm:left-6 sm:right-6 flex items-center justify-between z-30 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Controles de Zoom Suave */}
              <div className="flex items-center gap-1 bg-black/60 backdrop-blur-md border border-white/10 px-2 py-1 rounded-full text-white text-xs font-sans-ui shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setZoom((prev) => {
                      const next = Math.max(0.5, Number((prev * 0.85).toFixed(3)));
                      if (next <= 1.0) setPan({ x: 0, y: 0 });
                      return next;
                    });
                  }}
                  className="p-1 hover:bg-white/20 rounded-full transition-colors cursor-pointer text-white/80 hover:text-white"
                  title="Diminuir zoom (scroll para baixo)"
                  aria-label="Diminuir zoom"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono text-[11px] font-medium px-1.5 min-w-[44px] text-center select-none text-white/90">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setZoom((prev) => Math.min(5.0, Number((prev * 1.15).toFixed(3))));
                  }}
                  className="p-1 hover:bg-white/20 rounded-full transition-colors cursor-pointer text-white/80 hover:text-white"
                  title="Aumentar zoom (scroll para cima)"
                  aria-label="Aumentar zoom"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    className="p-1 hover:bg-white/20 rounded-full transition-colors cursor-pointer text-white/70 hover:text-white ml-0.5"
                    title="Restaurar zoom (100%)"
                    aria-label="Restaurar zoom"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Botão Fechar */}
              <button
                id="image-lightbox-close-btn"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeLightbox();
                }}
                className="p-2 sm:p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/50"
                title="Fechar (Esc)"
                aria-label="Fechar visualização"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Container Interativo de Imagem com Zoom via Wheel e Pan via Mouse Drag */}
            <div
              className="relative w-full h-full flex items-center justify-center overflow-hidden pointer-events-auto"
              onWheel={handleWheelLightbox}
              onMouseDown={handleMouseDownLightbox}
              onTouchStart={handleTouchStartLightbox}
              onTouchMove={handleTouchMoveLightbox}
              onTouchEnd={handleTouchEndLightbox}
              style={{
                cursor: zoom > 1.0 ? (isPanning ? 'grabbing' : 'grab') : 'default',
              }}
              onClick={(e) => {
                if (didDragRef.current) {
                  e.stopPropagation();
                }
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayedSrc || currentSrc || rawSrc}
                alt={alt || caption || 'Visualização ampliada da imagem'}
                draggable={false}
                style={{
                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                  transition: isPanning ? 'none' : 'transform 120ms ease-out',
                  willChange: 'transform',
                  maxHeight: '85vh',
                  maxWidth: '88vw',
                }}
                className="object-contain rounded-lg shadow-2xl select-none pointer-events-none"
              />
            </div>

            {/* Legenda Discreta no Visualizador se Existente */}
            {caption && (
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 max-w-[85vw] px-4 py-1.5 rounded-full bg-black/60 backdrop-blur-md text-white/90 text-xs sm:text-sm font-sans-ui text-center pointer-events-none z-20 shadow-md border border-white/10">
                {caption}
              </div>
            )}
          </div>,
          document.body
        )}
    </NodeViewWrapper>
  );
}
