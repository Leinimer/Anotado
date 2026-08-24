'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Tag as TagIcon, X, Search, Hash } from 'lucide-react';

interface TagsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tags: string[];
  activeTag: string | null;
  onSelectTag: (tag: string) => void;
}

export function TagsModal({
  isOpen,
  onClose,
  tags,
  activeTag,
  onSelectTag,
}: TagsModalProps) {
  const [searchTerm, setSearchTerm] = useState('');

  // Fecha com ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleClose = () => {
    setSearchTerm('');
    onClose();
  };

  const filteredTags = useMemo(() => {
    if (!searchTerm.trim()) return tags;
    const term = searchTerm.toLowerCase().replace(/^#/, '');
    return tags.filter((t) => t.toLowerCase().includes(term));
  }, [tags, searchTerm]);

  if (!isOpen) return null;

  return (
    <div
      id="tags-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1b1c19]/40 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={handleClose}
    >
      <div
        id="tags-modal-container"
        className="w-full max-w-md bg-[#fbf9f4] border border-[#e4e2dd] shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tags-modal-title"
      >
        {/* Cabeçalho do Modal */}
        <div className="px-5 py-4 border-b border-[#e4e2dd] flex items-center justify-between bg-[#f5f2eb]/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#68594d]/10 flex items-center justify-center text-[#68594d]">
              <TagIcon className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="tags-modal-title"
                className="font-serif-note font-bold text-lg text-[#1b1c19] leading-tight"
              >
                Etiquetas
              </h2>
              <p className="text-xs text-[#7f756e] font-sans-ui">
                {tags.length} {tags.length === 1 ? 'etiqueta encontrada' : 'etiquetas encontradas'}
              </p>
            </div>
          </div>

          <button
            type="button"
            id="tags-modal-close-btn"
            onClick={handleClose}
            className="p-1.5 rounded-xl text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#e4e2dd] transition-colors cursor-pointer"
            aria-label="Fechar janela"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Campo de Busca Rápida de Tags */}
        {tags.length > 5 && (
          <div className="px-5 pt-3 pb-1">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#7f756e]" />
              <input
                type="text"
                id="tags-modal-search-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filtrar etiquetas..."
                className="w-full pl-8.5 pr-3 py-1.5 bg-white border border-[#e4e2dd] focus:border-[#68594d] rounded-xl text-xs text-[#1b1c19] placeholder-[#a89d95] outline-hidden font-sans-ui transition-colors"
                autoFocus
              />
            </div>
          </div>
        )}

        {/* Lista de Todas as Etiquetas */}
        <div className="p-5 overflow-y-auto max-h-[55vh] flex-1">
          {filteredTags.length === 0 ? (
            <div className="text-center py-8 text-xs text-[#7f756e]">
              Nenhuma etiqueta encontrada para &quot;{searchTerm}&quot;.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {filteredTags.map((tag) => {
                const isSelected = activeTag === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    id={`tags-modal-tag-btn-${tag}`}
                    onClick={() => {
                      onSelectTag(tag);
                      handleClose();
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium font-sans-ui transition-all cursor-pointer active:scale-95 ${
                      isSelected
                        ? 'bg-[#68594d] text-white shadow-xs'
                        : 'bg-[#f0ece5] text-[#5e4b3e] hover:bg-[#e4dcce] hover:text-[#1b1c19] border border-[#d7c3b0]/50'
                    }`}
                  >
                    <Hash className="w-3 h-3 opacity-70" />
                    <span>{tag}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Rodapé informativo */}
        <div className="px-5 py-3 border-t border-[#e4e2dd] bg-[#f5f2eb]/40 text-right">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-1.5 rounded-xl text-xs font-medium bg-[#e4e2dd] hover:bg-[#d7c3b0] text-[#1b1c19] transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
