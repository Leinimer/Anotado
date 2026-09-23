'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/react';
import { ChevronDown } from 'lucide-react';

export type TextLevelId = 'h1' | 'h2' | 'h3' | 'paragraph';

export interface TextLevelOption {
  id: TextLevelId;
  label: 'Título' | 'Subtítulo' | 'Parágrafo' | 'Corpo';
  previewClass: string;
  isActive: (editor: Editor) => boolean;
  action: (editor: Editor) => boolean;
}

export const TEXT_LEVEL_OPTIONS: TextLevelOption[] = [
  {
    id: 'h1',
    label: 'Título',
    previewClass: 'font-serif-note font-bold text-base sm:text-lg text-[#1b1c19] tracking-tight leading-tight',
    isActive: (editor) => editor.isActive('heading', { level: 1 }),
    action: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Subtítulo',
    previewClass: 'font-serif-note font-bold text-sm sm:text-base text-[#1b1c19] leading-snug',
    isActive: (editor) => editor.isActive('heading', { level: 2 }),
    action: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Parágrafo',
    previewClass: 'font-serif-note font-semibold text-xs sm:text-sm text-[#4e453f] leading-snug',
    isActive: (editor) => editor.isActive('heading', { level: 3 }),
    action: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: 'paragraph',
    label: 'Corpo',
    previewClass: 'font-serif-note font-normal text-xs sm:text-sm text-[#1b1c19] leading-normal',
    isActive: (editor) => !editor.isActive('heading'),
    action: (editor) => editor.chain().focus().setParagraph().run(),
  },
];

export function getActiveTextLevel(editor: Editor | null | undefined): 'Título' | 'Subtítulo' | 'Parágrafo' | 'Corpo' {
  if (!editor) return 'Corpo';
  if (editor.isActive('heading', { level: 1 })) return 'Título';
  if (editor.isActive('heading', { level: 2 })) return 'Subtítulo';
  if (editor.isActive('heading', { level: 3 })) return 'Parágrafo';
  return 'Corpo';
}

export interface TextLevelDropdownProps {
  editor: Editor;
  variant?: 'bottom' | 'bubble';
  id?: string;
  className?: string;
}

export function TextLevelDropdown({
  editor,
  variant = 'bottom',
  id,
  className,
}: TextLevelDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number } | null>(null);

  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Força re-renderização em qualquer transação ou alteração de seleção do Tiptap
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const onEditorChange = () => {
      setTick((t) => t + 1);
    };

    editor.on('transaction', onEditorChange);
    editor.on('selectionUpdate', onEditorChange);

    return () => {
      editor.off('transaction', onEditorChange);
      editor.off('selectionUpdate', onEditorChange);
    };
  }, [editor]);

  const updateCoords = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    if (variant === 'bubble') {
      if (rect.top < 180) {
        setCoords({
          top: rect.bottom + 8,
          left: Math.min(Math.max(100, rect.left + rect.width / 2), window.innerWidth - 100),
        });
      } else {
        setCoords({
          bottom: window.innerHeight - rect.top + 8,
          left: Math.min(Math.max(100, rect.left + rect.width / 2), window.innerWidth - 100),
        });
      }
    } else {
      // Barra inferior fixa: abre para cima
      setCoords({
        bottom: window.innerHeight - rect.top + 8,
        left: Math.min(Math.max(110, rect.left + rect.width / 2), window.innerWidth - 110),
      });
    }
  }, [variant]);

  // Click outside, Escape e scroll listeners
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        btnRef.current &&
        !btnRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handleScrollOrResize = () => {
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  if (!editor) return null;

  const currentLevel = getActiveTextLevel(editor);
  const isHeadingActive = editor.isActive('heading');
  const buttonId = id || (variant === 'bubble' ? 'bubble-btn-style-menu' : 'toolbar-btn-text-styles');

  const buttonClass =
    variant === 'bubble'
      ? `min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[34px] px-2 sm:px-2.5 py-1 rounded-xl flex items-center gap-1 transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
          isOpen
            ? 'bg-[#68594d] text-white'
            : isHeadingActive
            ? 'bg-[#e4e2dd] text-[#1b1c19] font-bold shadow-2xs'
            : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
        } ${className || ''}`
      : `min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
          isOpen
            ? 'bg-[#f0eee9] text-[#1b1c19]'
            : isHeadingActive
            ? 'bg-[#e4e2dd]/80 text-[#1b1c19] font-bold shadow-2xs'
            : 'text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19]'
        } ${className || ''}`;

  return (
    <>
      <button
        ref={btnRef}
        id={buttonId}
        type="button"
        onMouseDown={(e) => {
          // Previne que o clique remova o foco ou a seleção de texto do editor Tiptap
          e.preventDefault();
        }}
        onClick={() => {
          if (isOpen) {
            setIsOpen(false);
          } else {
            updateCoords();
            setIsOpen(true);
          }
        }}
        className={buttonClass}
        title={`Nível do texto: ${currentLevel} (Clique para alterar)`}
        aria-label={`Nível do texto: ${currentLevel}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span
          className={
            variant === 'bubble'
              ? 'font-sans-ui font-bold text-xs leading-none'
              : 'font-sans-ui font-bold text-xs sm:text-sm leading-none tracking-tight'
          }
        >
          {currentLevel}
        </span>
        <ChevronDown
          className={
            variant === 'bubble'
              ? 'w-2.5 h-2.5 opacity-70'
              : 'w-3 h-3 text-[#7f756e]'
          }
        />
      </button>

      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            id={`${buttonId}-popover`}
            role="menu"
            aria-orientation="vertical"
            style={{
              position: 'fixed',
              ...(coords.top !== undefined
                ? { top: `${coords.top}px` }
                : { bottom: `${coords.bottom}px` }),
              left: `${coords.left}px`,
              transform: 'translateX(-50%)',
              zIndex: 100000,
            }}
            className="bg-white/98 backdrop-blur-md border border-[#e4e2dd] p-1.5 rounded-2xl shadow-xl flex flex-col gap-1 min-w-[190px] animate-in fade-in zoom-in-95 font-sans-ui pointer-events-auto select-none"
          >
            {TEXT_LEVEL_OPTIONS.map((opt) => {
              const active = opt.isActive(editor);
              return (
                <button
                  key={opt.id}
                  id={`${buttonId}-opt-${opt.id}`}
                  role="menuitem"
                  type="button"
                  onMouseDown={(e) => {
                    // Mantém a seleção de texto intacta durante a seleção da opção
                    e.preventDefault();
                  }}
                  onClick={() => {
                    opt.action(editor);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-colors cursor-pointer text-left ${
                    active
                      ? 'bg-[#f0eee9] text-[#1b1c19] font-medium'
                      : 'hover:bg-[#fbf9f4] text-[#4e453f] hover:text-[#1b1c19]'
                  }`}
                >
                  <span className={opt.previewClass}>{opt.label}</span>
                  {active && (
                    <span className="text-[#68594d] font-bold text-xs ml-3 shrink-0">✓</span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
