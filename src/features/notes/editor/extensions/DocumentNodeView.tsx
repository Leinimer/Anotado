'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import {
  FileText,
  Trash2,
  ExternalLink,
  AlignLeft,
  AlignCenter,
  AlignRight,
  GripVertical,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { moveNodeBlock } from '../utils/node-movement';

function formatBytes(bytes: number, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function DocumentNodeView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode, selected, editor, getPos } = props;
  const src = node.attrs.src || '#';
  const name = node.attrs.name || 'Documento';
  const size = Number(node.attrs.size || 0);
  const type = node.attrs.type || 'application/pdf';
  const initialWidthAttr = node.attrs.width;
  const alignment = (node.attrs.alignment as 'left' | 'center' | 'right') || 'left';

  const isPdf = name.toLowerCase().endsWith('.pdf') || type?.includes('pdf');
  const displaySize = size > 0 ? formatBytes(size) : 'Arquivo anexado';

  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

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

  // Redimensionamento horizontal uniforme
  const handleResizeStart = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      direction: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right'
    ) => {
      e.preventDefault();
      e.stopPropagation();

      if (!cardRef.current) return;

      setIsResizing(true);
      setIsLocalSelected(true);

      const startX = e.clientX;
      const startWidth = cardRef.current.offsetWidth || 400;

      const editorElement =
        containerRef.current?.closest('.ProseMirror') || containerRef.current?.parentElement;
      const maxContainerWidth = editorElement ? editorElement.clientWidth - 24 : 800;

      let latestCalculatedWidth = startWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        const deltaX = moveEvent.clientX - startX;

        let calculatedWidth = startWidth;
        if (direction === 'right' || direction === 'top-right' || direction === 'bottom-right') {
          calculatedWidth = startWidth + deltaX;
        } else {
          calculatedWidth = startWidth - deltaX;
        }

        const clampedWidth = Math.min(Math.max(calculatedWidth, 220), maxContainerWidth);
        latestCalculatedWidth = clampedWidth;
        setResizingWidth(Math.round(clampedWidth));
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        upEvent.preventDefault();
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        setIsResizing(false);
        setResizingWidth(null);

        updateAttributes({
          width: `${Math.round(latestCalculatedWidth)}px`,
        });
      };

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp, { passive: false });
    },
    [updateAttributes]
  );

  const handleOpenDocument = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (src && src !== '#') {
      window.open(src, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <NodeViewWrapper
      as="div"
      ref={containerRef}
      className={`document-attachment-wrapper my-4 relative flex ${alignClass} max-w-full select-none`}
      onClick={() => setIsLocalSelected(true)}
    >
      <div
        ref={cardRef}
        className={`relative inline-block max-w-full transition-shadow duration-150 ${
          isSelected ? 'ring-2 ring-[#68594d] ring-offset-2 ring-offset-white rounded-2xl' : ''
        }`}
        style={{
          width: currentDisplayWidth,
          maxWidth: '100%',
        }}
      >
        {/* Barra Flutuante de Ações (Aparece ao selecionar) */}
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

            <span className="font-mono text-[11px] font-medium text-[#68594d] px-1">
              {resizingWidth ? `${Math.round(resizingWidth)}px` : initialWidthAttr || 'Auto'}
            </span>

            {/* Presets de Largura */}
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
                const fullW = Math.round(maxW);
                updateAttributes({ width: `${fullW}px` });
              }}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium hover:bg-[#f0eee9] text-[#4e453f] transition-colors cursor-pointer"
              title="100% da folha"
            >
              100%
            </button>

            <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

            {/* Ação Abrir */}
            <button
              type="button"
              onClick={handleOpenDocument}
              className="p-1 text-[#68594d] hover:bg-[#f0eee9] rounded-md transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-medium"
              title="Abrir documento em nova aba"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Abrir</span>
            </button>

            <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

            {/* Excluir documento */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deleteNode();
              }}
              className="p-1 text-[#ba1a1a] hover:bg-[#fceded] rounded-md transition-colors cursor-pointer"
              title="Excluir Documento"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Card do Documento */}
        <div className="flex items-center gap-3.5 p-3.5 bg-[#f5f3ee] hover:bg-[#eae8e3] border border-[#e4e2dd] rounded-2xl transition-all w-full text-[#1b1c19]">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-xs uppercase shrink-0 shadow-2xs ${
              isPdf ? 'bg-[#ba1a1a]/10 text-[#ba1a1a]' : 'bg-[#68594d]/10 text-[#68594d]'
            }`}
          >
            {isPdf ? 'PDF' : <FileText className="w-5 h-5" />}
          </div>

          <div className="flex-1 min-w-0 pr-2">
            <p className="text-sm font-semibold truncate text-[#1b1c19] m-0 leading-tight font-sans-ui">
              {name}
            </p>
            <span className="text-xs text-[#7f756e] font-sans-ui mt-1 block">
              {displaySize}
            </span>
          </div>

          {/* Botão Abrir Independente (Abre o PDF) */}
          <button
            type="button"
            onClick={handleOpenDocument}
            className="text-xs text-[#68594d] font-sans-ui font-medium px-3 py-1.5 bg-white hover:bg-[#68594d] hover:text-white border border-[#d1c4bc] rounded-xl transition-colors shrink-0 cursor-pointer shadow-2xs"
            title="Abrir em nova aba"
          >
            Abrir
          </button>
        </div>

        {/* Handles de Redimensionamento Interativos */}
        {isSelected && (
          <>
            {/* Quina Superior Esquerda */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'top-left')}
              className="absolute -top-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize z-20 touch-none"
              title="Redimensionar largura"
            >
              <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
            </div>

            {/* Quina Superior Direita */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'top-right')}
              className="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize z-20 touch-none"
              title="Redimensionar largura"
            >
              <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
            </div>

            {/* Quina Inferior Esquerda */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'bottom-left')}
              className="absolute -bottom-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize z-20 touch-none"
              title="Redimensionar largura"
            >
              <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
            </div>

            {/* Quina Inferior Direita */}
            <div
              onPointerDown={(e) => handleResizeStart(e, 'bottom-right')}
              className="absolute -bottom-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize z-20 touch-none"
              title="Redimensionar largura"
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
