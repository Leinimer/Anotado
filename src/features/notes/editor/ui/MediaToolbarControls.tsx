import React from 'react';
import { AlignLeft, AlignCenter, AlignRight, Trash2, ChevronUp, ChevronDown, GripVertical } from 'lucide-react';

interface MediaMoveButtonsProps {
  onMove: (direction: 'up' | 'down') => void;
}

export function MediaMoveButtons({ onMove }: MediaMoveButtonsProps) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => onMove('up')}
        className="p-1 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] rounded-md transition-colors cursor-pointer"
        title="Mover bloco para cima"
        aria-label="Mover bloco para cima"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onMove('down')}
        className="p-1 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] rounded-md transition-colors cursor-pointer"
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
        onClick={() => onAlign('center')}
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
        onClick={() => onAlign('right')}
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
          className="px-2 py-0.5 text-xs font-sans-ui text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] rounded-md transition-colors cursor-pointer font-medium"
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
      className="p-1 text-[#ba1a1a] hover:bg-[#ffdad6] rounded-md transition-colors cursor-pointer"
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
  children,
}: MediaFloatingToolbarProps) {
  return (
    <div
      className="absolute -top-11 left-1/2 -translate-x-1/2 bg-[#ffffff]/98 backdrop-blur-xs border border-[#e4e2dd] shadow-lg rounded-xl px-2 py-1 flex items-center gap-1.5 z-30 text-xs font-sans-ui text-[#4e453f] animate-in fade-in zoom-in-95 pointer-events-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        data-drag-handle
        className="p-1 hover:bg-[#f0eee9] rounded-md text-[#68594d] cursor-grab active:cursor-grabbing flex items-center justify-center"
        title="Segure e arraste para reposicionar no documento"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      <MediaMoveButtons onMove={onMove} />

      <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

      <MediaAlignmentButtons alignment={alignment} onAlign={onAlign} />

      <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

      <span className="font-mono text-[11px] font-medium text-[#68594d] px-1">
        {widthDisplay}
      </span>

      <MediaWidthPresets presets={presets} onSetWidth={onSetWidth} />

      {children}

      <div className="h-3.5 w-[1px] bg-[#e4e2dd]" />

      <MediaDeleteButton
        onDelete={onDelete}
        title={deleteTitle}
        ariaLabel={deleteTitle}
      />
    </div>
  );
}

