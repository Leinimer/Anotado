'use client';

import { useState } from 'react';
import { PlusCircle, Palette } from 'lucide-react';

interface EditorToolbarProps {
  onFormat?: (action: string) => void;
}

export function EditorToolbar({ onFormat }: EditorToolbarProps) {
  const [activeFormats, setActiveFormats] = useState<string[]>([]);
  const [selectedColor, setSelectedColor] = useState<string>('#1b1c19');
  const [showColorPicker, setShowColorPicker] = useState(false);

  const colors = [
    { label: 'Tinta Padrão', value: '#1b1c19' },
    { label: 'Umber Primário', value: '#68594d' },
    { label: 'Terracota', value: '#934b31' },
    { label: 'Sálvia', value: '#4f6d5b' },
    { label: 'Índigo Muted', value: '#3f5873' },
  ];

  const toggleFormat = (formatKey: string) => {
    setActiveFormats((prev) =>
      prev.includes(formatKey)
        ? prev.filter((f) => f !== formatKey)
        : [...prev, formatKey]
    );
    if (onFormat) onFormat(formatKey);
  };

  return (
    <footer
      id="editor-bottom-toolbar"
      aria-label="Barra de ferramentas de formatação"
      className="w-full bg-[#fbf9f4]/95 border-t border-[#eae8e3] py-2 px-4 flex items-center justify-center shrink-0 shadow-xs relative"
    >
      <div className="flex items-center gap-6 sm:gap-8">
        {/* Bold Button */}
        <button
          id="toolbar-btn-bold"
          type="button"
          onClick={() => toggleFormat('bold')}
          className={`flex flex-col items-center justify-center min-w-[28px] group transition-transform active:scale-95 cursor-pointer ${
            activeFormats.includes('bold') ? 'text-[#68594d]' : 'text-[#1b1c19]'
          }`}
          title="Negrito"
        >
          <span className="font-serif-note font-bold text-base sm:text-lg leading-none">
            B
          </span>
          <span className="font-sans-ui text-[10px] sm:text-xs text-[#7f756e] group-hover:text-[#1b1c19]">
            A
          </span>
        </button>

        {/* Italic Button */}
        <button
          id="toolbar-btn-italic"
          type="button"
          onClick={() => toggleFormat('italic')}
          className={`flex flex-col items-center justify-center min-w-[28px] group transition-transform active:scale-95 cursor-pointer ${
            activeFormats.includes('italic') ? 'text-[#68594d]' : 'text-[#1b1c19]'
          }`}
          title="Itálico"
        >
          <span className="font-serif-note italic font-semibold text-base sm:text-lg leading-none">
            I
          </span>
          <span className="font-sans-ui text-[10px] sm:text-xs text-[#7f756e] group-hover:text-[#1b1c19]">
            N
          </span>
        </button>

        {/* Underline Button */}
        <button
          id="toolbar-btn-underline"
          type="button"
          onClick={() => toggleFormat('underline')}
          className={`flex flex-col items-center justify-center min-w-[28px] group transition-transform active:scale-95 cursor-pointer ${
            activeFormats.includes('underline') ? 'text-[#68594d]' : 'text-[#1b1c19]'
          }`}
          title="Sublinhado"
        >
          <span className="font-serif-note underline font-semibold text-base sm:text-lg leading-none">
            U
          </span>
          <span className="font-sans-ui text-[10px] sm:text-xs text-[#7f756e] group-hover:text-[#1b1c19]">
            I
          </span>
        </button>

        {/* Vertical Divider */}
        <div className="h-6 w-[1px] bg-[#d1c4bc]" aria-hidden="true" />

        {/* Add Object / Embed Button */}
        <button
          id="toolbar-btn-insert-embed"
          type="button"
          onClick={() => toggleFormat('embed')}
          className="flex flex-col items-center justify-center min-w-[28px] group text-[#1b1c19] transition-transform active:scale-95 cursor-pointer"
          title="Inserir Mídia ou Objeto"
        >
          <PlusCircle className="w-4 h-4 sm:w-5 sm:h-5 text-[#1b1c19] group-hover:text-[#68594d] stroke-[1.75]" />
          <span className="font-sans-ui text-[10px] sm:text-xs text-[#7f756e] group-hover:text-[#1b1c19]">
            O
          </span>
        </button>

        {/* Color Palette Button */}
        <div className="relative">
          <button
            id="toolbar-btn-color"
            type="button"
            onClick={() => setShowColorPicker(!showColorPicker)}
            className="flex flex-col items-center justify-center min-w-[28px] group text-[#1b1c19] transition-transform active:scale-95 cursor-pointer"
            title="Paleta de Cores"
          >
            <Palette
              className="w-4 h-4 sm:w-5 sm:h-5 text-[#1b1c19] group-hover:text-[#68594d] stroke-[1.75]"
              style={{ color: selectedColor !== '#1b1c19' ? selectedColor : undefined }}
            />
            <span className="font-sans-ui text-[10px] sm:text-xs text-[#7f756e] group-hover:text-[#1b1c19]">
              Cor
            </span>
          </button>

          {showColorPicker && (
            <div
              id="toolbar-color-picker-dropdown"
              className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-white border border-[#e4e2dd] p-2 rounded-xl shadow-lg flex gap-1.5 z-30"
            >
              {colors.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  onClick={() => {
                    setSelectedColor(c.value);
                    setShowColorPicker(false);
                    if (onFormat) onFormat(`color:${c.value}`);
                  }}
                  className="w-5 h-5 rounded-full border border-black/10 transition-transform hover:scale-110"
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
