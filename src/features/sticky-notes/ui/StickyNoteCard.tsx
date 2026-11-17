'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GripHorizontal, List, Palette, Trash2 } from 'lucide-react';
import { useTheme } from '@/src/features/theme/theme-context';
import {
  STICKY_COLORS,
  STICKY_MAX_WIDTH,
  STICKY_MIN_WIDTH,
  StickyNote,
  StickyNoteColorKey,
  getStickyColorTheme,
} from '../types';

interface StickyNoteCardProps {
  note: StickyNote;
  isSelected: boolean;
  autoFocus?: boolean;
  onSelect: (noteId: string) => void;
  onChangeTitle: (noteId: string, title: string) => void;
  onChangeContent: (noteId: string, content: string) => void;
  onChangeColor: (noteId: string, color: StickyNoteColorKey) => void;
  onMoveLive: (noteId: string, x: number, y: number) => void;
  onMoveEnd: (noteId: string, x: number, y: number) => void;
  onResizeLive: (noteId: string, widthPx: number) => void;
  onResizeEnd: (noteId: string, widthPx: number) => void;
  onDelete: (noteId: string) => void;
  registerBulletAction?: (noteId: string, action: (() => void) | null) => void;
}

export function StickyNoteCard({
  note,
  isSelected,
  autoFocus = false,
  onSelect,
  onChangeTitle,
  onChangeContent,
  onChangeColor,
  onMoveLive,
  onMoveEnd,
  onResizeLive,
  onResizeEnd,
  onDelete,
  registerBulletAction,
}: StickyNoteCardProps) {
  const { theme: appTheme, isMounted } = useTheme();
  const isDark = isMounted && appTheme === 'dark';
  const colorTheme = getStickyColorTheme(note.color);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [showColorMenu, setShowColorMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  // Recalcula altura automática sempre que o conteúdo ou a largura mudar.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    const nextHeight = Math.max(112, el.scrollHeight);
    el.style.height = `${nextHeight}px`;
  }, [note.content, note.width_px]);

  // Foco automático em notas recém-criadas.
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  // Fecha popover de cor ao clicar fora do card.
  useEffect(() => {
    if (!showColorMenu) return;
    const handleOutside = (event: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) {
        setShowColorMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showColorMenu]);

  // Alterna marcador (• ) na(s) linha(s) selecionada(s) do conteúdo.
  const handleToggleBullet = () => {
    const el = textareaRef.current;
    const value = note.content || '';
    if (!el) {
      const next = value ? `${value}\n• ` : '• ';
      onChangeContent(note.id, next);
      return;
    }

    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const rawLineEnd = value.indexOf('\n', end);
    const lineEnd = rawLineEnd === -1 ? value.length : rawLineEnd;

    const selectedBlock = value.slice(lineStart, lineEnd);
    const lines = selectedBlock.split('\n');
    const allBulleted = lines.every((line) => /^\s*(?:•|-|\*)\s/.test(line) || line.trim() === '');

    const updatedLines = lines.map((line) => {
      if (allBulleted) {
        return line.replace(/^(\s*)(?:•|-|\*)\s+/, '$1');
      }
      if (/^\s*(?:•|-|\*)\s/.test(line)) return line;
      return `• ${line}`;
    });

    const replacement = updatedLines.join('\n');
    const nextValue = value.slice(0, lineStart) + replacement + value.slice(lineEnd);
    onChangeContent(note.id, nextValue);

    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      const cursorPos = lineStart + replacement.length;
      textareaRef.current.setSelectionRange(cursorPos, cursorPos);
    });
  };

  useEffect(() => {
    registerBulletAction?.(note.id, handleToggleBullet);
    return () => registerBulletAction?.(note.id, null);
  });

  // Suporte natural a listas com marcadores e Enter dentro do textarea.
  const handleTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    if (event.key !== 'Enter' || event.shiftKey) return;

    const value = el.value;
    const selStart = el.selectionStart ?? value.length;
    const selEnd = el.selectionEnd ?? value.length;
    if (selStart !== selEnd) return;

    const lineStart = value.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1;
    const currentLine = value.slice(lineStart, selStart);
    const bulletMatch = currentLine.match(/^(\s*)(•|-|\*)\s(.*)$/);
    if (!bulletMatch) return;

    event.preventDefault();
    const [, indent, marker, body] = bulletMatch;

    if (body.trim() === '') {
      // Linha de marcador vazia: encerra a lista removendo o marcador.
      const nextValue = value.slice(0, lineStart) + value.slice(selStart);
      onChangeContent(note.id, nextValue);
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.setSelectionRange(lineStart, lineStart);
      });
    } else {
      const prefix = `\n${indent}${marker === '*' ? '•' : marker} `;
      const nextValue = value.slice(0, selStart) + prefix + value.slice(selStart);
      const nextCursor = selStart + prefix.length;
      onChangeContent(note.id, nextValue);
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.setSelectionRange(nextCursor, nextCursor);
      });
    }
  };

  const handleTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    let nextValue = event.target.value;
    const cursor = event.target.selectionStart ?? nextValue.length;

    // Converte "- " no início da linha para "• " automaticamente para visual limpo.
    const beforeCursor = nextValue.slice(0, cursor);
    if (/(^|\n)- $/.test(beforeCursor)) {
      nextValue = beforeCursor.replace(/(^|\n)- $/, '$1• ') + nextValue.slice(cursor);
      onChangeContent(note.id, nextValue);
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.setSelectionRange(cursor, cursor);
      });
      return;
    }

    onChangeContent(note.id, nextValue);
  };

  // Arrastar e soltar pelo cabeçalho (mouse e toque).
  const handleHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();
    onSelect(note.id);

    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startPosX = note.position_x;
    const startPosY = note.position_y;
    let latestX = startPosX;
    let latestY = startPosY;
    let moved = false;

    setIsDragging(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startClientX;
      const dy = moveEvent.clientY - startClientY;
      if (!moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        moved = true;
      }
      latestX = Math.max(12, Math.round(startPosX + dx));
      latestY = Math.max(12, Math.round(startPosY + dy));
      onMoveLive(note.id, latestX, latestY);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      setIsDragging(false);
      if (moved) {
        onMoveEnd(note.id, latestX, latestY);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  // Redimensionamento horizontal manual na borda direita.
  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(note.id);

    const startClientX = event.clientX;
    const startWidth = note.width_px;
    let latestWidth = startWidth;
    let changed = false;

    setIsResizing(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startClientX;
      const clamped = Math.max(
        STICKY_MIN_WIDTH,
        Math.min(STICKY_MAX_WIDTH, Math.round(startWidth + dx))
      );
      if (clamped !== latestWidth) {
        changed = true;
        latestWidth = clamped;
        onResizeLive(note.id, clamped);
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      setIsResizing(false);
      if (changed) {
        onResizeEnd(note.id, latestWidth);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  return (
    <div
      ref={cardRef}
      data-sticky-note-id={note.id}
      onPointerDown={() => onSelect(note.id)}
      style={{
        position: 'absolute',
        left: `${note.position_x}px`,
        top: `${note.position_y}px`,
        width: `${note.width_px}px`,
        zIndex: note.z_index,
      }}
      className={`group rounded-xl border transition-shadow duration-150 ${colorTheme.cardClass} ${
        isDragging || isResizing
          ? 'shadow-2xl ring-2 ring-[#68594d]/45 dark:ring-[#d7c3b0]/45'
          : isSelected
          ? 'shadow-lg ring-2 ring-[#68594d]/35 dark:ring-[#d7c3b0]/35'
          : 'shadow-[0_6px_18px_-6px_rgba(40,30,20,0.16)] dark:shadow-[0_8px_22px_-6px_rgba(0,0,0,0.65)] hover:shadow-md'
      }`}
    >
      {/* Cabeçalho pequeno: área principal de arraste + título opcional + ações discretas */}
      <div
        onPointerDown={handleHeaderPointerDown}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 border-b rounded-t-xl cursor-grab active:cursor-grabbing touch-none select-none ${colorTheme.headerClass}`}
      >
        <GripHorizontal
          className={`w-3.5 h-3.5 shrink-0 opacity-45 ${colorTheme.textClass}`}
          aria-hidden="true"
        />

        <input
          type="text"
          value={note.title}
          onPointerDown={(e) => {
            e.stopPropagation();
            onSelect(note.id);
          }}
          onChange={(e) => onChangeTitle(note.id, e.target.value)}
          placeholder="Título..."
          aria-label="Título da nota adesiva"
          className={`flex-1 min-w-0 bg-transparent text-[13px] font-semibold font-sans-ui focus:outline-none placeholder:opacity-50 ${colorTheme.textClass}`}
        />

        {/* Controles rápidos da nota */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
            isSelected || showColorMenu
              ? 'opacity-100'
              : 'opacity-80 sm:opacity-0 sm:group-hover:opacity-100'
          }`}
        >
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowColorMenu((prev) => !prev)}
              className={`p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer ${colorTheme.mutedTextClass}`}
              title="Alterar cor"
              aria-label="Alterar cor da nota"
            >
              <Palette className="w-3.5 h-3.5" />
            </button>

            {showColorMenu && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute right-0 top-full mt-1.5 p-1.5 rounded-xl bg-white dark:bg-[#1a1816] border border-[#e4e2dd] dark:border-[#38332e] shadow-xl flex items-center gap-1.5 z-50"
              >
                {STICKY_COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      onChangeColor(note.id, c.key);
                      setShowColorMenu(false);
                    }}
                    style={{
                      backgroundColor: isDark ? c.swatchDark : c.swatchLight,
                    }}
                    className={`w-5 h-5 rounded-full border transition-transform hover:scale-110 cursor-pointer ${
                      note.color === c.key
                        ? 'ring-2 ring-[#68594d] dark:ring-[#f4dfcb] border-transparent scale-105'
                        : 'border-black/15 dark:border-white/20'
                    }`}
                    title={c.label}
                    aria-label={c.label}
                  />
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleToggleBullet}
            className={`p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer ${colorTheme.mutedTextClass}`}
            title="Lista com marcadores"
            aria-label="Inserir marcador de lista"
          >
            <List className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onDelete(note.id)}
            className={`p-1 rounded-md hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-300 transition-colors cursor-pointer ${colorTheme.mutedTextClass}`}
            title="Excluir nota adesiva"
            aria-label="Excluir nota adesiva"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Área de conteúdo com altura 100% automática */}
      <div className="px-3 py-2.5">
        <textarea
          ref={textareaRef}
          value={note.content}
          onFocus={() => onSelect(note.id)}
          onChange={handleTextareaChange}
          onKeyDown={handleTextareaKeyDown}
          placeholder="Escreva aqui..."
          aria-label="Conteúdo da nota adesiva"
          rows={4}
          className={`w-full bg-transparent resize-none overflow-hidden text-[13.5px] leading-[1.55] font-sans-ui focus:outline-none placeholder:opacity-45 ${colorTheme.textClass}`}
        />
      </div>

      {/* Alça lateral direita: apenas redimensionamento horizontal manual */}
      <div
        onPointerDown={handleResizePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Ajustar largura da nota adesiva"
        title="Arraste para ajustar a largura"
        className="absolute top-2 bottom-2 -right-1.5 w-3 cursor-ew-resize touch-none flex items-center justify-center group/resize z-10"
      >
        <span
          className={`w-1 h-8 rounded-full transition-opacity ${
            isResizing
              ? 'opacity-100 bg-[#68594d] dark:bg-[#f4dfcb]'
              : 'opacity-0 group-hover:opacity-60 group-hover/resize:opacity-100 bg-black/25 dark:bg-white/30'
          }`}
        />
      </div>
    </div>
  );
}
