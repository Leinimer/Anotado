'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import {
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  GripVertical,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { moveNodeBlock } from '../utils/node-movement';

export function YoutubeNodeView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode, selected, editor, getPos } = props;
  const src = node.attrs.src;
  const initialWidthAttr = node.attrs.width || '100%';
  const alignment = (node.attrs.alignment as 'left' | 'center' | 'right') || 'center';

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeWrapperRef = useRef<HTMLDivElement>(null);

  const [isLocalSelected, setIsLocalSelected] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizingWidth, setResizingWidth] = useState<number | null>(null);

  const isSelected = selected || isLocalSelected || isResizing;

  const alignClass =
    alignment === 'left'
      ? 'justify-start'
      : alignment === 'right'
      ? 'justify-end'
      : 'justify-center';

  const currentDisplayWidth =
    resizingWidth !== null
      ? `${resizingWidth}px`
      : initialWidthAttr || '100%';

  const handleMove = (direction: 'up' | 'down') => {
    moveNodeBlock(editor as any, getPos as any, direction);
  };

  // Normaliza o embed URL
  const getEmbedUrl = (url: string) => {
    if (!url) return '';
    if (url.includes('embed/')) return url;

    // Suporte para links youtube.com/watch?v=ID ou youtu.be/ID
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11
      ? `https://www.youtube-nocookie.com/embed/${match[2]}`
      : url;
  };

  const embedUrl = getEmbedUrl(src);

  // Fecha a seleção ao clicar fora
  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsLocalSelected(false);
      }
    };
    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, []);

  // Inicia o redimensionamento por arraste (Pointer / Touch / Mouse unificado)
  const handleResizeStart = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      direction: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right'
    ) => {
      e.preventDefault();
      e.stopPropagation();

      if (!iframeWrapperRef.current) return;

      setIsResizing(true);
      setIsLocalSelected(true);

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = iframeWrapperRef.current.offsetWidth || 500;
      const aspectRatio = 16 / 9; // Proporção padrão 16:9 de vídeos do YouTube

      // Obtém a largura máxima disponível da folha
      const editorElement =
        containerRef.current?.closest('.ProseMirror') || containerRef.current?.parentElement;
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
            const widthFromY = startWidth + deltaY * aspectRatio;
            calculatedWidth = Math.abs(deltaX) > Math.abs(deltaY) ? widthFromX : widthFromY;
            break;
          }
          case 'bottom-left': {
            const widthFromX = startWidth - deltaX;
            const widthFromY = startWidth + deltaY * aspectRatio;
            calculatedWidth = Math.abs(deltaX) > Math.abs(deltaY) ? widthFromX : widthFromY;
            break;
          }
          case 'top-right': {
            const widthFromX = startWidth + deltaX;
            const widthFromY = startWidth - deltaY * aspectRatio;
            calculatedWidth = Math.abs(deltaX) > Math.abs(deltaY) ? widthFromX : widthFromY;
            break;
          }
          case 'top-left': {
            const widthFromX = startWidth - deltaX;
            const widthFromY = startWidth - deltaY * aspectRatio;
            calculatedWidth = Math.abs(deltaX) > Math.abs(deltaY) ? widthFromX : widthFromY;
            break;
          }
        }

        // Limites de tamanho: mínimo 200px, máximo largura total da folha
        const clampedWidth = Math.min(Math.max(calculatedWidth, 200), maxContainerWidth);
        latestCalculatedWidth = clampedWidth;
        setResizingWidth(Math.round(clampedWidth));
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        upEvent.preventDefault();
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        setIsResizing(false);
        setResizingWidth(null);

        // Persiste as dimensões nos atributos do node
        updateAttributes({
          width: `${Math.round(latestCalculatedWidth)}px`,
        });
      };

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp, { passive: false });
    },
    [updateAttributes]
  );

  return (
    <NodeViewWrapper
      as="div"
      ref={containerRef}
      className={`youtube-block-wrapper my-6 relative flex ${alignClass} max-w-full select-none`}
      onClick={() => setIsLocalSelected(true)}
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
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleMove('down')}
                className="p-1 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] rounded-md transition-colors cursor-pointer"
                title="Mover bloco para baixo"
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
              >
                <AlignRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

            {/* Indicador numérico de largura */}
            <span className="font-mono text-[11px] font-medium text-[#68594d] px-1">
              {resizingWidth ? `${Math.round(resizingWidth)}px` : initialWidthAttr || '100%'}
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
                const threeQuartersW = Math.round(maxW * 0.75);
                updateAttributes({ width: `${threeQuartersW}px` });
              }}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium hover:bg-[#f0eee9] text-[#4e453f] transition-colors cursor-pointer"
              title="75% da folha"
            >
              75%
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
            >
              100%
            </button>

            <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

            {/* Excluir vídeo */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deleteNode();
              }}
              className="p-1 text-[#ba1a1a] hover:bg-[#fceded] rounded-md transition-colors cursor-pointer"
              title="Excluir Vídeo"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Container do Iframe com Proporção 16:9 Estrita */}
        <div className="w-full relative rounded-2xl overflow-hidden shadow-xs border border-[#e4e2dd] bg-black/5">
          <div className="relative pb-[56.25%] h-0 w-full">
            <iframe
              src={embedUrl}
              title="YouTube video player"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute top-0 left-0 w-full h-full rounded-2xl"
            />
            {/* Overlay transparente durante o arraste/seleção para não capturar ponteiro no iframe */}
            {isResizing && <div className="absolute inset-0 z-10 bg-transparent" />}
          </div>
        </div>

        {/* Handles de Redimensionamento Interativos */}
        {isSelected && (
          <>
            {/* Quina Superior Esquerda */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'top-left')}
              className="absolute -top-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize z-20 touch-none"
              title="Redimensionar proporção 16:9"
            >
              <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
            </div>

            {/* Quina Superior Direita */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'top-right')}
              className="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize z-20 touch-none"
              title="Redimensionar proporção 16:9"
            >
              <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
            </div>

            {/* Quina Inferior Esquerda */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'bottom-left')}
              className="absolute -bottom-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize z-20 touch-none"
              title="Redimensionar proporção 16:9"
            >
              <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
            </div>

            {/* Quina Inferior Direita */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'bottom-right')}
              className="absolute -bottom-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize z-20 touch-none"
              title="Redimensionar proporção 16:9"
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
