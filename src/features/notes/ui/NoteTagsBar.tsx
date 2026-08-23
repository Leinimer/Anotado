'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';

interface NoteTagsBarProps {
  tags: string[];
  onUpdateTags: (newTags: string[]) => void;
  disabled?: boolean;
}

export function NoteTagsBar({ tags = [], onUpdateTags, disabled = false }: NoteTagsBarProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingInput, setEditingInput] = useState('');
  const [mobileSelectedTagIndex, setMobileSelectedTagIndex] = useState<number | null>(null);

  const addInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);

  // Foca o input automaticamente ao abrir criação de tag
  useEffect(() => {
    if (isAdding && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [isAdding]);

  // Foca e seleciona o texto ao entrar em modo de edição
  useEffect(() => {
    if (editingIndex !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingIndex]);

  // Limpa o estado mobile ao clicar fora
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#note-tags-management-bar')) {
        setMobileSelectedTagIndex(null);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick);
    };
  }, []);

  const sanitizeTagName = (val: string): string => {
    return val.trim().replace(/\s+/g, '').replace(/^#+/, '');
  };

  const handleCommitNewTag = useCallback(() => {
    const clean = sanitizeTagName(newTagInput);
    if (clean) {
      const target = clean.toLowerCase();
      const isDuplicate = tags.some((t) => t.trim().toLowerCase() === target);
      if (!isDuplicate) {
        onUpdateTags([...tags, clean]);
      }
    }
    setNewTagInput('');
    setIsAdding(false);
  }, [newTagInput, tags, onUpdateTags]);

  const handleCommitEditTag = useCallback(
    (index: number) => {
      const clean = sanitizeTagName(editingInput);
      if (clean) {
        const target = clean.toLowerCase();
        const isDuplicate = tags.some((t, i) => i !== index && t.trim().toLowerCase() === target);
        if (!isDuplicate) {
          const next = [...tags];
          next[index] = clean;
          onUpdateTags(next);
        }
      }
      setEditingIndex(null);
      setEditingInput('');
    },
    [editingInput, tags, onUpdateTags]
  );

  const handleDeleteTag = useCallback(
    (indexToDelete: number, e?: React.MouseEvent | React.TouchEvent) => {
      if (e) {
        e.stopPropagation();
        e.preventDefault();
      }
      const next = tags.filter((_, i) => i !== indexToDelete);
      onUpdateTags(next);
      if (mobileSelectedTagIndex === indexToDelete) {
        setMobileSelectedTagIndex(null);
      }
    },
    [tags, onUpdateTags, mobileSelectedTagIndex]
  );

  const startEditing = (index: number, e?: React.MouseEvent | React.TouchEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (disabled) return;
    setEditingIndex(index);
    setEditingInput(tags[index]);
    setMobileSelectedTagIndex(null);
  };

  // Touch handlers para suporte robusto no mobile (toque simples seleciona para excluir, toque longo edita)
  const handleTouchStart = (index: number) => {
    isLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      startEditing(index);
    }, 450);
  };

  const handleTouchEnd = (index: number, e: React.TouchEvent) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (!isLongPressRef.current && editingIndex === null) {
      // Toggle seleção da tag no mobile para exibir botão de lixeira de forma confortável
      setMobileSelectedTagIndex((prev) => (prev === index ? null : index));
    }
  };

  return (
    <div
      id="note-tags-management-bar"
      className="w-full max-w-[850px] mx-auto px-4 sm:px-8 pt-0.5 pb-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Lista de Tags Existentes */}
      {tags.map((tag, index) => {
        const cleanTag = tag.replace(/^#+/, '');
        const isEditingThis = editingIndex === index;
        const isMobileSelected = mobileSelectedTagIndex === index;

        if (isEditingThis) {
          return (
            <div
              key={`editing-tag-${index}`}
              id={`tag-edit-wrapper-${index}`}
              className="inline-flex items-center text-xs font-sans-ui text-[#8c6b4f] border-b border-[#8c6b4f]/70 pb-0.5 animate-in fade-in"
            >
              <span className="font-semibold mr-0.5 text-[#8c6b4f]">#</span>
              <input
                ref={editInputRef}
                id={`tag-edit-input-${index}`}
                type="text"
                value={editingInput}
                onChange={(e) => setEditingInput(e.target.value)}
                onBlur={() => handleCommitEditTag(index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCommitEditTag(index);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingIndex(null);
                    setEditingInput('');
                  }
                }}
                className="bg-transparent outline-hidden w-16 sm:w-20 text-xs font-medium text-[#8c6b4f] focus:ring-0 p-0"
                placeholder="tag..."
              />
            </div>
          );
        }

        return (
          <div
            key={`tag-${index}-${cleanTag}`}
            id={`tag-item-${index}`}
            onDoubleClick={(e) => startEditing(index, e)}
            onTouchStart={() => handleTouchStart(index)}
            onTouchEnd={(e) => handleTouchEnd(index, e)}
            className="group inline-flex items-center text-[#8c6b4f] hover:text-[#6e533d] font-sans-ui text-xs font-medium transition-colors duration-150 cursor-pointer"
            title="Clique duplo para editar • Toque para opções"
          >
            {/* Ícone de Exclusão (Lixeira à ESQUERDA do #, zero espaço quando invisível) */}
            <button
              type="button"
              id={`tag-delete-btn-${index}`}
              onClick={(e) => handleDeleteTag(index, e)}
              onTouchEnd={(e) => {
                e.stopPropagation();
                handleDeleteTag(index, e);
              }}
              className={`cursor-pointer transition-all duration-150 inline-flex items-center justify-center overflow-hidden ${
                isMobileSelected
                  ? 'w-4 opacity-100 mr-1 text-[#b91c1c]'
                  : 'w-0 opacity-0 group-hover:w-4 group-hover:opacity-100 group-hover:mr-1 text-[#8c6b4f] hover:text-[#b91c1c]'
              }`}
              aria-label={`Excluir tag #${cleanTag}`}
              title="Excluir tag"
            >
              <Trash2 className="w-3.5 h-3.5 stroke-[2] shrink-0" />
            </button>

            {/* Texto da Tag */}
            <span className="font-semibold text-[#8c6b4f] group-hover:text-[#6e533d]">#</span>
            <span className="leading-tight text-[#8c6b4f] group-hover:text-[#6e533d]">{cleanTag}</span>
          </div>
        );
      })}

      {/* Input de Adição de Nova Tag */}
      {isAdding ? (
        <div
          id="tag-new-input-wrapper"
          className="inline-flex items-center text-xs font-sans-ui text-[#8c6b4f] border-b border-[#8c6b4f]/70 pb-0.5 animate-in fade-in"
        >
          <span className="font-semibold mr-0.5 text-[#8c6b4f]">#</span>
          <input
            ref={addInputRef}
            id="tag-new-input"
            type="text"
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            onBlur={handleCommitNewTag}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCommitNewTag();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setIsAdding(false);
                setNewTagInput('');
              }
            }}
            className="bg-transparent outline-hidden w-16 sm:w-24 text-xs font-medium text-[#8c6b4f] focus:ring-0 p-0"
            placeholder="nova tag..."
          />
        </div>
      ) : (
        /* Botão [+] Pequena bolinha clara com + marrom claro dentro */
        <button
          type="button"
          id="tag-add-button"
          onClick={() => {
            if (disabled) return;
            setIsAdding(true);
          }}
          className="w-4.5 h-4.5 rounded-full border border-[#d8cec4] hover:border-[#b8a898] bg-transparent text-[#8c6b4f] hover:text-[#6e533d] flex items-center justify-center cursor-pointer transition-colors duration-150 shrink-0"
          title="Adicionar tag"
          aria-label="Adicionar tag"
        >
          <Plus className="w-2.5 h-2.5 stroke-[2.5]" />
        </button>
      )}
    </div>
  );
}
