import React from 'react';
import { AlignLeft, AlignCenter, AlignRight, Trash2, ChevronUp, ChevronDown, GripVertical, Maximize2, Subtitles } from 'lucide-react';

interface MediaMoveButtonsProps {
  onMove: (direction: 'up' | 'down') => void;
}

export function MediaMoveButtons({ onMove }: MediaMoveButtonsProps) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => onMove('up')}
        className="p-1 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] dark:text-[#a3a3a3] dark:hover:bg-[#161616] dark:hover:text-white rounded-md transition-colors cursor-pointer"
        title="Mover bloco para cima"
        aria-label="Mover bloco para cima"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onMove('down')}
        className="p-1 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] dark:text-[#a3a3a3] dark:hover:bg-[#161616] dark:hover:text-white rounded-md transition-colors cursor-pointer"
        title="Mover bloco para baixo"
        aria-label="Mover bloco para baixo"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface MediaAlignmentButtonsProps {
  alignment?: string;
  onAlign: (alignment: 'left' | 'center' | 'right') => void;
}

export function MediaAlignmentButtons({
  alignment = 'center',
  onAlign,
}: MediaAlignmentButtonsProps) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => onAlign('left')}
        className={`p-1 rounded-md transition-colors cursor-pointer ${
          alignment === 'left'
            ? 'bg-[#68594d] text-white shadow-2xs dark:bg-[#383028]'
            : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] dark:text-[#a3a3a3] dark:hover:bg-[#161616] dark:hover:text-white'
        }`}
        title="Alinhar à esquerda"
        aria-label="Alinhar à esquerda"
      >
        <AlignLeft className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onAlign('center')}
        className={`p-1 rounded-md transition-colors cursor-pointer ${
          alignment === 'center'
            ? 'bg-[#68594d] text-white shadow-2xs dark:bg-[#383028]'
            : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] dark:text-[#a3a3a3] dark:hover:bg-[#161616] dark:hover:text-white'
        }`}
        title="Centralizar"
        aria-label="Centralizar"
      >
        <AlignCenter className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onAlign('right')}
        className={`p-1 rounded-md transition-colors cursor-pointer ${
          alignment === 'right'
            ? 'bg-[#68594d] text-white shadow-2xs dark:bg-[#383028]'
            : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] dark:text-[#a3a3a3] dark:hover:bg-[#161616] dark:hover:text-white'
        }`}
        title="Alinhar à direita"
        aria-label="Alinhar à direita"
      >
        <AlignRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface MediaWidthPresetsProps {
  presets?: { label: string; value: string }[];
  onSetWidth: (width: string) => void;
}

export function MediaWidthPresets({
  presets = [
    { label: '50%', value: '50%' },
    { label: '100%', value: '100%' },
  ],
  onSetWidth,
}: MediaWidthPresetsProps) {
  return (
    <div className="flex items-center gap-1">
      {presets.map((preset) => (
        <button
          key={preset.label}
          type="button"
          onClick={() => onSetWidth(preset.value)}
          className="px-2 py-0.5 text-xs font-sans-ui text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] dark:text-[#a3a3a3] dark:hover:bg-[#161616] dark:hover:text-white rounded-md transition-colors cursor-pointer font-medium"
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

interface MediaDeleteButtonProps {
  onDelete: () => void;
  title?: string;
  ariaLabel?: string;
}

export function MediaDeleteButton({
  onDelete,
  title = 'Excluir bloco',
  ariaLabel = 'Excluir bloco',
}: MediaDeleteButtonProps) {
  return (
    <button
      type="button"
      onClick={onDelete}
      className="p-1 text-[#ba1a1a] hover:bg-[#ffdad6] dark:hover:bg-[#3a1515] rounded-md transition-colors cursor-pointer"
      title={title}
      aria-label={ariaLabel}
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

export interface MediaFloatingToolbarProps {
  onMove: (direction: 'up' | 'down') => void;
  alignment?: 'left' | 'center' | 'right';
  onAlign: (alignment: 'left' | 'center' | 'right') => void;
  widthDisplay: string;
  presets?: { label: string; value: string }[];
  onSetWidth: (width: string) => void;
  onDelete: () => void;
  deleteTitle?: string;
  onExpand?: () => void;
  hasCaption?: boolean;
  onAddCaption?: () => void;
  children?: React.ReactNode;
}

export function MediaFloatingToolbar({
  onMove,
  alignment = 'center',
  onAlign,
  widthDisplay,
  presets,
  onSetWidth,
  onDelete,
  deleteTitle,
  onExpand,
  hasCaption,
  onAddCaption,
  children,
}: MediaFloatingToolbarProps) {
  return (
    <div
      className="absolute -top-11 left-1/2 -translate-x-1/2 bg-[#ffffff]/98 dark:bg-[#0a0a0a]/98 backdrop-blur-xs border border-[#e4e2dd] dark:border-[#1a1a1a] shadow-lg rounded-xl px-2 py-1 flex items-center gap-1.5 z-30 text-xs font-sans-ui text-[#4e453f] dark:text-[#d1c4bc] animate-in fade-in zoom-in-95 pointer-events-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        data-drag-handle
        className="p-1 hover:bg-[#f0eee9] dark:hover:bg-[#161616] rounded-md text-[#68594d] dark:text-[#a89a8e] cursor-grab active:cursor-grabbing flex items-center justify-center"
        title="Segure e arraste para reposicionar no documento"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      <MediaMoveButtons onMove={onMove} />

      <div className="h-3.5 w-[1px] bg-[#e4e2dd] dark:bg-[#1a1a1a]" />

      <MediaAlignmentButtons alignment={alignment} onAlign={onAlign} />

      <div className="h-3.5 w-[1px] bg-[#e4e2dd] dark:bg-[#1a1a1a]" />

      <span className="font-mono text-[11px] font-medium text-[#68594d] dark:text-[#a89a8e] px-1">
        {widthDisplay}
      </span>

      <MediaWidthPresets presets={presets} onSetWidth={onSetWidth} />

      {/* Botão de Legenda (Adicionar ou Editar) */}
      {onAddCaption && (
        <>
          <div className="h-3.5 w-[1px] bg-[#e4e2dd] dark:bg-[#1a1a1a]" />
          <button
            type="button"
            onClick={onAddCaption}
            className={`px-1.5 py-0.5 flex items-center gap-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
              hasCaption
                ? 'text-[#68594d] dark:text-[#d7c3b0] bg-[#f0eee9] dark:bg-[#161616]'
                : 'text-[#4e453f] dark:text-[#a3a3a3] hover:bg-[#f0eee9] dark:hover:bg-[#161616]'
            }`}
            title={hasCaption ? 'Editar legenda' : 'Adicionar legenda'}
          >
            <Subtitles className="w-3.5 h-3.5" />
            <span>{hasCaption ? 'Editar Legenda' : 'Legenda'}</span>
          </button>
        </>
      )}

      {/* Botão de Visualização em Tela Cheia / Ampliar */}
      {onExpand && (
        <>
          <div className="h-3.5 w-[1px] bg-[#e4e2dd] dark:bg-[#1a1a1a]" />
          <button
            type="button"
            onClick={onExpand}
            className="p-1 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] dark:text-[#a3a3a3] dark:hover:bg-[#161616] dark:hover:text-white rounded-md transition-colors cursor-pointer"
            title="Ampliar imagem (tela cheia)"
            aria-label="Ampliar imagem"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </>
      )}

      {children}

      <div className="h-3.5 w-[1px] bg-[#e4e2dd] dark:bg-[#1a1a1a]" />

      <MediaDeleteButton
        onDelete={onDelete}
        title={deleteTitle}
        ariaLabel={deleteTitle}
      />
    </div>
  );
}

