'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import {
  FileText,
  ExternalLink,
} from 'lucide-react';
import {
  moveNodeBlock,
} from '../utils/node-movement';
import { perfProfiler } from '../utils/media-optimizer';
import { formatBytes, getMediaAlignmentClass } from '../utils/media-common';
import { indexedDBStorage } from '@/src/features/notes/db/indexed-db';
import { useAttachmentSource } from '../hooks/use-attachment-source';
import { useMediaResize } from '../hooks/use-media-resize';
import { MediaResizeHandles } from '../ui/MediaResizeHandles';
import { MediaFloatingToolbar } from '../ui/MediaToolbarControls';

export function DocumentNodeView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode, selected, editor, getPos } = props;
  const rawSrc = node.attrs.src || '#';
  const name = node.attrs.name || 'Documento';
  const size = Number(node.attrs.size || 0);
  const type = node.attrs.type || 'application/pdf';
  const initialWidthAttr = node.attrs.width || '50%';
  const alignment = (node.attrs.alignment as 'left' | 'center' | 'right') || 'left';

  const isPdf = name.toLowerCase().endsWith('.pdf') || type?.includes('pdf');
  const displaySize = size > 0 ? formatBytes(size) : 'Arquivo anexado';

  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [isLocalSelected, setIsLocalSelected] = useState(false);

  const currentUserId = (editor as any)?.options?.editorProps?.attributes?.['data-user-id'] || 'anonymous';

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

  // Hook unificado para resolução offline e online de anexos (isImage: false impede tentativa de preloading de imagem para documentos/PDF)
  const { resolvedSrc } = useAttachmentSource({
    rawSrc,
    currentUserId,
    isImage: false,
    onRemoteResolved,
  });

  // Hook unificado de redimensionamento
  const { isResizing, resizingWidth, handleResizeStart } = useMediaResize({
    containerRef,
    targetRef: cardRef,
    minWidth: 220,
    onPersistWidth: (finalWidth) => {
      updateAttributes({ width: finalWidth });
      console.log('[MEDIA-PERSIST]', { type: 'documentAttachment', width: finalWidth, alignment });
    },
    onSelect: () => setIsLocalSelected(true),
  });

  useEffect(() => {
    perfProfiler.mark(name, 'T6 - Documento/PDF Renderizado');
  }, [name]);

  const isSelected = isLocalSelected || isResizing;
  const alignClass = getMediaAlignmentClass(alignment);

  const currentDisplayWidth =
    resizingWidth !== null
      ? `${resizingWidth}px`
      : initialWidthAttr
      ? typeof initialWidthAttr === 'number'
        ? `${initialWidthAttr}px`
        : initialWidthAttr
      : '50%';

  const handleMove = (direction: 'up' | 'down') => {
    moveNodeBlock(editor as any, getPos as any, direction);
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

  const handleOpenDocument = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    let targetUrl = resolvedSrc || rawSrc;

    if (targetUrl.startsWith('attachment://') || targetUrl.startsWith('local-attachment://')) {
      const attachmentId = targetUrl.replace(/^(?:attachment|local-attachment):\/\//, '').trim();
      const currentUserId = (editor as any)?.options?.editorProps?.attributes?.['data-user-id'] || 'anonymous';
      let attachment = await indexedDBStorage.getAttachment(currentUserId, attachmentId);
      if (!attachment && currentUserId !== 'anonymous') {
        attachment = await indexedDBStorage.getAttachment('anonymous', attachmentId);
      }
      if (attachment?.remote_url) {
        targetUrl = attachment.remote_url;
      } else if (attachment?.blob) {
        targetUrl = URL.createObjectURL(attachment.blob);
      }
    }

    if (targetUrl && targetUrl !== '#' && !targetUrl.startsWith('attachment://') && !targetUrl.startsWith('local-attachment://')) {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
      if (targetUrl.startsWith('blob:')) {
        setTimeout(() => URL.revokeObjectURL(targetUrl), 10000);
      }
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (typeof pos === 'number' && editor?.view) {
      try {
        const { doc } = editor.view.state;
        const selection = NodeSelection.create(doc, pos);
        editor.view.dispatch(editor.view.state.tr.setSelection(selection));
      } catch (err) {
        console.warn('[MEDIA-DRAG] Could not set NodeSelection on doc drag start:', err);
      }
    }
  };

  return (
    <NodeViewWrapper
      as="div"
      ref={containerRef}
      className={`document-attachment-wrapper my-4 relative flex ${alignClass} max-w-full select-none`}
      onClick={handleClick}
      onDragStart={handleDragStart}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      draggable={editor?.isEditable ?? false}
    >
      <div
        ref={cardRef}
        className={`relative inline-block max-w-full transition-shadow duration-150 ${
          isSelected && editor?.isEditable ? 'ring-2 ring-[#68594d] ring-offset-2 ring-offset-white rounded-2xl' : ''
        }`}
        style={{
          width: currentDisplayWidth,
          maxWidth: '100%',
        }}
      >
        {/* Barra Flutuante de Ações (Aparece ao selecionar apenas se editável) */}
        {isSelected && editor?.isEditable && (
          <MediaFloatingToolbar
            onMove={handleMove}
            alignment={alignment}
            onAlign={(align) => {
              updateAttributes({ alignment: align });
              console.log('[MEDIA-PERSIST]', { type: 'documentAttachment', width: node.attrs.width, alignment: align });
            }}
            widthDisplay={resizingWidth ? `${Math.round(resizingWidth)}px` : initialWidthAttr || 'Auto'}
            presets={[
              { label: '50%', value: '50%' },
              { label: '100%', value: '100%' },
            ]}
            onSetWidth={(val) => {
              updateAttributes({ width: val });
              console.log('[MEDIA-PERSIST]', { type: 'documentAttachment', width: val, alignment });
            }}
            onDelete={() => deleteNode()}
            deleteTitle="Excluir Documento"
          >
            <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />
            <button
              type="button"
              onClick={handleOpenDocument}
              className="p-1 text-[#68594d] hover:bg-[#f0eee9] rounded-md transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-medium"
              title="Abrir documento em nova aba"
              aria-label="Abrir documento em nova aba"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Abrir</span>
            </button>
          </MediaFloatingToolbar>
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
        {isSelected && editor?.isEditable && (
          <MediaResizeHandles
            onResizeStart={handleResizeStart}
            showTopHandles={true}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
}
