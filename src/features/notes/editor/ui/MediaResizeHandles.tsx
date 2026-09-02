import React from 'react';
import { ResizeDirection } from '../utils/media-common';

interface MediaResizeHandlesProps {
  onResizeStart: (direction: ResizeDirection, e: React.PointerEvent<HTMLDivElement>) => void;
  showTopHandles?: boolean;
}

/**
 * Componente unificado para os manipuladores visuais de redimensionamento de mídias (imagens, vídeos e documentos).
 * Utiliza hit-areas acessíveis com bolinhas/pílulas centrais estilizadas.
 */
export function MediaResizeHandles({
  onResizeStart,
  showTopHandles = true,
}: MediaResizeHandlesProps) {
  return (
    <>
      {showTopHandles && (
        <>
          {/* Quina Superior Esquerda */}
          <div
            onPointerDown={(e) => onResizeStart('top-left', e)}
            className="absolute -top-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize z-20 touch-none"
            title="Redimensionar proporção"
          >
            <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
          </div>

          {/* Quina Superior Direita */}
          <div
            onPointerDown={(e) => onResizeStart('top-right', e)}
            className="absolute -top-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize z-20 touch-none"
            title="Redimensionar proporção"
          >
            <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
          </div>
        </>
      )}

      {/* Quina Inferior Esquerda */}
      <div
        onPointerDown={(e) => onResizeStart('bottom-left', e)}
        className="absolute -bottom-3 -left-3 w-7 h-7 flex items-center justify-center cursor-nesw-resize z-20 touch-none"
        title="Redimensionar proporção"
      >
        <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
      </div>

      {/* Quina Inferior Direita */}
      <div
        onPointerDown={(e) => onResizeStart('bottom-right', e)}
        className="absolute -bottom-3 -right-3 w-7 h-7 flex items-center justify-center cursor-nwse-resize z-20 touch-none"
        title="Redimensionar proporção"
      >
        <div className="w-3 h-3 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
      </div>

      {/* Lateral Esquerda */}
      <div
        onPointerDown={(e) => onResizeStart('left', e)}
        className="absolute top-1/2 -left-3 -translate-y-1/2 w-7 h-7 flex items-center justify-center cursor-ew-resize z-20 touch-none"
        title="Redimensionar largura"
      >
        <div className="w-2.5 h-5 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
      </div>

      {/* Lateral Direita */}
      <div
        onPointerDown={(e) => onResizeStart('right', e)}
        className="absolute top-1/2 -right-3 -translate-y-1/2 w-7 h-7 flex items-center justify-center cursor-ew-resize z-20 touch-none"
        title="Redimensionar largura"
      >
        <div className="w-2.5 h-5 rounded-full bg-white border-2 border-[#68594d] shadow-sm hover:scale-125 transition-transform" />
      </div>
    </>
  );
}
