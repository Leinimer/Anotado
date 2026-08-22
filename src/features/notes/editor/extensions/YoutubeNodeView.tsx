'use client';

import React, { useState } from 'react';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { GripVertical, Trash2, Maximize2, Minimize2 } from 'lucide-react';

export function YoutubeNodeView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode, selected } = props;
  const src = node.attrs.src;
  const currentWidth = node.attrs.width || '100%';
  const [isResizing, setIsResizing] = useState(false);

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

  const setWidth = (width: string) => {
    updateAttributes({ width });
  };

  return (
    <NodeViewWrapper
      as="div"
      className={`youtube-block-wrapper my-6 relative transition-all flex flex-col items-center select-none group ${
        selected ? 'ring-2 ring-[#68594d] rounded-2xl' : ''
      }`}
      data-drag-handle
    >
      {/* Controles Flutuantes do Vídeo (Redimensionamento e Exclusão) */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-9 right-2 bg-white/95 border border-[#e4e2dd] shadow-md rounded-xl px-2 py-1 flex items-center gap-1.5 z-20 text-xs font-sans-ui text-[#4e453f]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWidth('50%')}
            className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
              currentWidth === '50%'
                ? 'bg-[#68594d] text-white'
                : 'hover:bg-[#f0eee9] text-[#4e453f]'
            }`}
            title="Largura Pequena (50%)"
          >
            50%
          </button>
          <button
            type="button"
            onClick={() => setWidth('75%')}
            className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
              currentWidth === '75%'
                ? 'bg-[#68594d] text-white'
                : 'hover:bg-[#f0eee9] text-[#4e453f]'
            }`}
            title="Largura Média (75%)"
          >
            75%
          </button>
          <button
            type="button"
            onClick={() => setWidth('100%')}
            className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
              currentWidth === '100%'
                ? 'bg-[#68594d] text-white'
                : 'hover:bg-[#f0eee9] text-[#4e453f]'
            }`}
            title="Largura Total (100%)"
          >
            100%
          </button>
        </div>

        <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

        <button
          type="button"
          onClick={deleteNode}
          className="p-1 text-[#ba1a1a] hover:bg-[#fceded] rounded-md transition-colors cursor-pointer"
          title="Excluir Vídeo"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Container do Iframe com Proporção 16:9 e Largura Dinâmica */}
      <div
        className="w-full relative rounded-2xl overflow-hidden shadow-xs border border-[#e4e2dd] bg-black/5"
        style={{
          width: currentWidth,
          maxWidth: '100%',
        }}
      >
        <div className="relative pb-[56.25%] h-0 w-full">
          <iframe
            src={embedUrl}
            title="YouTube video player"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute top-0 left-0 w-full h-full rounded-2xl"
          />
        </div>
      </div>
    </NodeViewWrapper>
  );
}
