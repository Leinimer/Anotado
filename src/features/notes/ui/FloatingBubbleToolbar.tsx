'use client';

import React, { useState, useEffect, useRef } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Subscript as SubscriptIcon,
  ChevronDown,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';

interface FloatingBubbleToolbarProps {
  editor: Editor;
}

const FONT_SIZES = [
  '10px',
  '11px',
  '12px',
  '13px',
  '14px',
  '15px',
  '16px',
  '18px',
  '20px',
  '22px',
  '24px',
  '28px',
  '32px',
  '36px',
  '40px',
  '48px',
  '56px',
  '64px',
  '72px',
] as const;

export function FloatingBubbleToolbar({ editor }: FloatingBubbleToolbarProps) {
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const styleBtnRef = useRef<HTMLButtonElement>(null);
  const styleMenuRef = useRef<HTMLDivElement>(null);

  // Fecha o menu de estilo ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        styleMenuRef.current &&
        !styleMenuRef.current.contains(target) &&
        styleBtnRef.current &&
        !styleBtnRef.current.contains(target)
      ) {
        setShowStyleMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Escala de fontes
  const handleIncreaseFontSize = () => {
    const currentSize = editor.getAttributes('textStyle').fontSize || '16px';
    const currentIndex = FONT_SIZES.indexOf(currentSize as (typeof FONT_SIZES)[number]);
    const nextIndex =
      currentIndex === -1 ? 7 : Math.min(currentIndex + 1, FONT_SIZES.length - 1);
    editor.chain().focus().setMark('textStyle', { fontSize: FONT_SIZES[nextIndex] }).run();
  };

  const handleDecreaseFontSize = () => {
    const currentSize = editor.getAttributes('textStyle').fontSize || '16px';
    const currentIndex = FONT_SIZES.indexOf(currentSize as (typeof FONT_SIZES)[number]);
    const prevIndex = currentIndex === -1 ? 5 : Math.max(0, currentIndex - 1);
    editor.chain().focus().setMark('textStyle', { fontSize: FONT_SIZES[prevIndex] }).run();
  };

  // Paleta de Estilos de Texto Estruturados (reutilizando a lógica existente do app)
  const textStyles = [
    {
      id: 'title',
      label: 'Título',
      previewClass: 'font-serif-note font-bold text-lg text-[#1b1c19] tracking-tight leading-tight',
      isActive: () => editor.isActive('heading', { level: 1 }),
      action: () => editor.chain().focus().setHeading({ level: 1 }).run(),
    },
    {
      id: 'heading',
      label: 'Cabeçalho',
      previewClass: 'font-serif-note font-bold text-base text-[#1b1c19] leading-snug',
      isActive: () => editor.isActive('heading', { level: 2 }),
      action: () => editor.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
      id: 'subtitle',
      label: 'Subtítulo',
      previewClass: 'font-serif-note font-semibold text-sm text-[#4e453f] leading-snug',
      isActive: () => editor.isActive('heading', { level: 3 }),
      action: () => editor.chain().focus().setHeading({ level: 3 }).run(),
    },
    {
      id: 'body',
      label: 'Corpo',
      previewClass: 'font-serif-note font-normal text-xs text-[#1b1c19] leading-normal',
      isActive: () => editor.isActive('paragraph') && !editor.isActive('heading'),
      action: () => editor.chain().focus().setParagraph().run(),
    },
  ];

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor, from, to, state }) => {
        // Exibe somente se houver texto selecionado (seleção não colapsada)
        if (!editor.isEditable) return false;
        const { empty } = state.selection;
        if (empty || from === to) return false;
        // Não exibe caso um node view especial como imagem/youtube/documento esteja selecionado
        if (
          editor.isActive('image') ||
          editor.isActive('youtube') ||
          editor.isActive('documentAttachment')
        ) {
          return false;
        }
        return true;
      }}
    >
      <div
        id="editor-floating-bubble-menu"
        className="bg-[#ffffff]/95 backdrop-blur-md border border-[#e4e2dd] shadow-xl rounded-2xl p-1 sm:p-1.5 flex items-center gap-0.5 sm:gap-1 z-50 text-[#4e453f] animate-in fade-in zoom-in-95 select-none"
      >
        {/* 1. Negrito [B] */}
        <button
          type="button"
          id="bubble-btn-bold"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleBold().run();
          }}
          className={`min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
            editor.isActive('bold')
              ? 'bg-[#68594d] text-white shadow-2xs'
              : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
          }`}
          title="Negrito (Ctrl+B)"
          aria-label="Negrito"
        >
          <Bold className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.25]" />
        </button>

        {/* 2. Itálico [I] */}
        <button
          type="button"
          id="bubble-btn-italic"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleItalic().run();
          }}
          className={`min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
            editor.isActive('italic')
              ? 'bg-[#68594d] text-white shadow-2xs'
              : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
          }`}
          title="Itálico (Ctrl+I)"
          aria-label="Itálico"
        >
          <Italic className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.25]" />
        </button>

        {/* 3. Sublinhado [U] */}
        <button
          type="button"
          id="bubble-btn-underline"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleUnderline().run();
          }}
          className={`min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
            editor.isActive('underline')
              ? 'bg-[#68594d] text-white shadow-2xs'
              : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
          }`}
          title="Sublinhado (Ctrl+U)"
          aria-label="Sublinhado"
        >
          <UnderlineIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.25]" />
        </button>

        {/* 4. Subscrito [Subscript / X₂] */}
        <button
          type="button"
          id="bubble-btn-subscript"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleSubscript().run();
          }}
          className={`min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
            editor.isActive('subscript')
              ? 'bg-[#68594d] text-white shadow-2xs'
              : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
          }`}
          title="Subscrito"
          aria-label="Subscrito"
        >
          <SubscriptIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.25]" />
        </button>

        {/* Separador Visual */}
        <div className="h-4 w-[1px] bg-[#e4e2dd] mx-0.5" />

        {/* 5. Menu de Estilo [A v] */}
        <div className="relative">
          <button
            ref={styleBtnRef}
            type="button"
            id="bubble-btn-style-menu"
            onMouseDown={(e) => {
              e.preventDefault();
              setShowStyleMenu((prev) => !prev);
            }}
            className={`min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[34px] px-1.5 py-1 rounded-xl flex items-center gap-0.5 transition-all cursor-pointer active:scale-95 ${
              showStyleMenu
                ? 'bg-[#68594d] text-white'
                : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
            }`}
            title="Estilos de Texto (Título, Cabeçalho, Corpo)"
            aria-label="Estilos de Texto"
          >
            <span className="font-serif-note font-bold text-xs sm:text-sm">A</span>
            <ChevronDown className="w-2.5 h-2.5 opacity-70" />
          </button>

          {showStyleMenu && (
            <div
              ref={styleMenuRef}
              id="bubble-style-dropdown"
              className="absolute bottom-full left-0 mb-2 w-40 bg-white/95 backdrop-blur-md border border-[#e4e2dd] rounded-2xl shadow-xl p-1.5 flex flex-col gap-1 z-60 animate-in fade-in zoom-in-95 duration-100"
            >
              {textStyles.map((st) => {
                const active = st.isActive();
                return (
                  <button
                    key={st.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      st.action();
                      setShowStyleMenu(false);
                    }}
                    className={`w-full px-2.5 py-1.5 rounded-xl flex items-center justify-between text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#f0eee9] text-[#1b1c19] font-medium'
                        : 'hover:bg-[#f0eee9] text-[#4e453f]'
                    }`}
                  >
                    <span className={st.previewClass}>{st.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 6. Diminuir Tamanho de Fonte [A↓] */}
        <button
          type="button"
          id="bubble-btn-decrease-font"
          onMouseDown={(e) => {
            e.preventDefault();
            handleDecreaseFontSize();
          }}
          className="min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19] active:scale-95"
          title="Diminuir tamanho da fonte"
          aria-label="Diminuir tamanho da fonte"
        >
          <div className="flex items-center">
            <span className="font-serif-note font-bold text-xs">A</span>
            <ArrowDown className="w-2.5 h-2.5 -ml-0.5 stroke-[2.5]" />
          </div>
        </button>

        {/* 7. Aumentar Tamanho de Fonte [A↑] */}
        <button
          type="button"
          id="bubble-btn-increase-font"
          onMouseDown={(e) => {
            e.preventDefault();
            handleIncreaseFontSize();
          }}
          className="min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19] active:scale-95"
          title="Aumentar tamanho da fonte"
          aria-label="Aumentar tamanho da fonte"
        >
          <div className="flex items-center">
            <span className="font-serif-note font-bold text-sm">A</span>
            <ArrowUp className="w-2.5 h-2.5 -ml-0.5 stroke-[2.5]" />
          </div>
        </button>

        {/* Separador Visual */}
        <div className="h-4 w-[1px] bg-[#e4e2dd] mx-0.5" />

        {/* 8. Bolinha 1: Marca-texto Amarelo [🟡] */}
        <button
          type="button"
          id="bubble-btn-highlight-yellow"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run();
          }}
          className={`min-w-[28px] min-h-[28px] sm:min-w-[30px] sm:min-h-[30px] p-1 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] active:scale-90 ${
            editor.isActive('highlight', { color: '#fef08a' })
              ? 'ring-2 ring-[#68594d] ring-offset-1 bg-[#f0eee9]'
              : ''
          }`}
          title="Marca-texto Amarelo"
          aria-label="Marca-texto Amarelo"
        >
          <span
            className="w-3.5 h-3.5 rounded-full border border-[#ca8a04]/40 shadow-2xs block"
            style={{ backgroundColor: '#fef08a' }}
          />
        </button>

        {/* 9. Bolinha 2: Marca-texto Verde Menta [🟢] */}
        <button
          type="button"
          id="bubble-btn-highlight-green"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleHighlight({ color: '#bbf7d0' }).run();
          }}
          className={`min-w-[28px] min-h-[28px] sm:min-w-[30px] sm:min-h-[30px] p-1 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] active:scale-90 ${
            editor.isActive('highlight', { color: '#bbf7d0' })
              ? 'ring-2 ring-[#68594d] ring-offset-1 bg-[#f0eee9]'
              : ''
          }`}
          title="Marca-texto Verde Menta"
          aria-label="Marca-texto Verde Menta"
        >
          <span
            className="w-3.5 h-3.5 rounded-full border border-[#16a34a]/40 shadow-2xs block"
            style={{ backgroundColor: '#bbf7d0' }}
          />
        </button>

        {/* 10. Bolinha 3: Marca-texto Rosa Pergaminho [🩷] */}
        <button
          type="button"
          id="bubble-btn-highlight-pink"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleHighlight({ color: '#fecdd3' }).run();
          }}
          className={`min-w-[28px] min-h-[28px] sm:min-w-[30px] sm:min-h-[30px] p-1 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] active:scale-90 ${
            editor.isActive('highlight', { color: '#fecdd3' })
              ? 'ring-2 ring-[#68594d] ring-offset-1 bg-[#f0eee9]'
              : ''
          }`}
          title="Marca-texto Rosa Pergaminho"
          aria-label="Marca-texto Rosa Pergaminho"
        >
          <span
            className="w-3.5 h-3.5 rounded-full border border-[#e11d48]/40 shadow-2xs block"
            style={{ backgroundColor: '#fecdd3' }}
          />
        </button>
      </div>
    </BubbleMenu>
  );
}
