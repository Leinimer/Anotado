'use client';

import React from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  ArrowDown,
  ArrowUp,
  Unlink,
  FileSymlink,
} from 'lucide-react';
import { TextLevelDropdown } from './TextLevelDropdown';

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

  return (
    <BubbleMenu
      editor={editor}
      appendTo={() => (typeof document !== 'undefined' ? document.body : (null as unknown as HTMLElement))}
      updateDelay={50}
      options={{
        strategy: 'fixed',
        placement: 'top',
        offset: 8,
        flip: {
          fallbackPlacements: ['bottom', 'top-start', 'bottom-start', 'top-end', 'bottom-end'],
          padding: 8,
        },
        shift: {
          padding: 8,
        },
      }}
      shouldShow={({ editor, from, to, state }) => {
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
        className="bg-[#ffffff]/98 backdrop-blur-md border border-[#e4e2dd] shadow-2xl rounded-2xl p-1 sm:p-1.5 flex items-center gap-0.5 sm:gap-1 text-[#4e453f] select-none pointer-events-auto"
        style={{ zIndex: 99999 }}
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

        {/* 4. Tachado [S] */}
        <button
          type="button"
          id="bubble-btn-strike"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleStrike().run();
          }}
          className={`min-w-[32px] min-h-[32px] sm:min-w-[34px] sm:min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
            editor.isActive('strike')
              ? 'bg-[#68594d] text-white shadow-2xs'
              : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
          }`}
          title="Tachado"
          aria-label="Tachado"
        >
          <Strikethrough className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.25]" />
        </button>

        {/* Separador Visual */}
        <div className="h-4 w-[1px] bg-[#e4e2dd] mx-0.5" />

        {/* 5. Ferramenta Nível de Texto (Título, Subtítulo, Parágrafo, Corpo) */}
        <TextLevelDropdown
          editor={editor}
          variant="bubble"
          id="bubble-btn-style-menu"
        />

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

        {/* Separador Visual */}
        <div className="h-4 w-[1px] bg-[#e4e2dd] mx-0.5" />

        {/* 11. Referenciar Nota Interna */}
        {editor.isActive('internalNoteLink') ? (
          <button
            type="button"
            id="bubble-btn-unset-internal-note-link"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().unsetInternalNoteLink().run();
            }}
            className="min-h-[30px] sm:min-h-[32px] px-2 py-1 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer bg-[#ba1a1a]/10 hover:bg-[#ba1a1a]/20 text-[#ba1a1a] font-sans-ui text-xs font-medium active:scale-95 shadow-2xs"
            title="Remover referência interna deste trecho"
            aria-label="Remover referência"
          >
            <Unlink className="w-3.5 h-3.5 stroke-[2]" />
            <span>Remover ref</span>
          </button>
        ) : (
          <button
            type="button"
            id="bubble-btn-reference-note"
            onMouseDown={(e) => {
              e.preventDefault();
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('anotado:open-reference-modal'));
              }
            }}
            className="min-h-[30px] sm:min-h-[32px] px-2 py-1 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19] active:scale-95"
            title="Referenciar outra nota existente no ANOTADO"
            aria-label="Referenciar nota"
          >
            <FileSymlink className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.25] text-[#68594d]" />
            <span className="font-sans-ui text-xs font-medium">Referenciar</span>
          </button>
        )}

        {/* 12. Remover Link Externo (visível somente quando a seleção contiver hyperlink) */}
        {editor.isActive('link') && (
          <>
            <div className="h-4 w-[1px] bg-[#e4e2dd] mx-0.5" />
            <button
              type="button"
              id="bubble-btn-unset-link"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().unsetLink().run();
              }}
              className="min-h-[30px] sm:min-h-[32px] px-2 py-1 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer bg-[#ba1a1a]/10 hover:bg-[#ba1a1a]/20 text-[#ba1a1a] font-sans-ui text-xs font-medium active:scale-95 shadow-2xs"
              title="Remover hiperlink do trecho selecionado"
              aria-label="Remover link"
            >
              <Unlink className="w-3.5 h-3.5 stroke-[2]" />
              <span>Remover link</span>
            </button>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
