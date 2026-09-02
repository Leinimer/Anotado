'use client';

import React, { useState } from 'react';
import { Sparkles, X } from 'lucide-react';

interface SmartFolderModalProps {
  folderId: string | null;
  initialTags: string[];
  uniqueTags: string[];
  onClose: () => void;
  onApply: (tags: string[]) => void;
  onDisable: () => void;
}

type SmartFolderDialogProps = Omit<SmartFolderModalProps, 'folderId'>;

function SmartFolderDialog({
  initialTags,
  uniqueTags,
  onClose,
  onApply,
  onDisable,
}: SmartFolderDialogProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-2xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95"
      >
        <div className="flex items-center justify-between pb-2 border-b border-[#eae8e3]">
          <div className="flex items-center gap-2 text-[#1b1c19]">
            <Sparkles className="w-4 h-4 text-[#68594d]" />
            <h3 className="font-serif-note font-bold text-base">Pasta inteligente</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#7f756e] hover:text-[#1b1c19] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          <p className="font-sans-ui text-xs text-[#4e453f] font-medium">
            Mostrar notas com as etiquetas:
          </p>

          {uniqueTags.length === 0 ? (
            <div className="p-3 bg-[#f0eee9] rounded-xl text-center text-xs text-[#7f756e] font-sans-ui leading-relaxed">
              Nenhuma etiqueta (<span className="font-semibold text-[#1b1c19]">#hashtag</span>) encontrada nas suas notas ainda. Adicione tags como <span className="font-medium">#tributario</span> no texto de uma nota para selecioná-la aqui.
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1 p-1 bg-white/70 rounded-xl border border-[#eae8e3]">
              {uniqueTags.map((tag) => {
                const isChecked = selectedTags.some(
                  (t) => t.toLowerCase() === tag.toLowerCase()
                );
                return (
                  <label
                    key={tag}
                    className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-[#f0eee9] cursor-pointer text-xs font-sans-ui text-[#1b1c19] transition-colors select-none"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTags((prev) => [...prev, tag]);
                        } else {
                          setSelectedTags((prev) =>
                            prev.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                          );
                        }
                      }}
                      className="w-4 h-4 rounded border-[#68594d] text-[#68594d] focus:ring-[#68594d] accent-[#68594d] cursor-pointer"
                    />
                    <span className="font-medium text-[#3b332d]">{tag}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-[#eae8e3]">
          {selectedTags.length > 0 ? (
            <button
              type="button"
              onClick={onDisable}
              className="px-3 py-1.5 text-xs text-[#ba1a1a] hover:bg-[#fceded] rounded-xl transition-colors cursor-pointer font-sans-ui font-medium"
            >
              Desativar
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-sans-ui font-medium text-[#4e453f] hover:bg-[#e4e2dd] transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              id="apply-smart-folder-btn"
              onClick={() => onApply(selectedTags)}
              className="px-4 py-1.5 rounded-xl text-xs font-sans-ui font-medium bg-[#68594d] text-white hover:bg-[#53463c] transition-colors cursor-pointer shadow-xs"
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SmartFolderModal({
  folderId,
  initialTags,
  uniqueTags,
  onClose,
  onApply,
  onDisable,
}: SmartFolderModalProps) {
  if (!folderId) return null;

  return (
    <SmartFolderDialog
      key={folderId}
      initialTags={initialTags}
      uniqueTags={uniqueTags}
      onClose={onClose}
      onApply={onApply}
      onDisable={onDisable}
    />
  );
}
