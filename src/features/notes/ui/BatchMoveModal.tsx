'use client';

import React, { useState } from 'react';
import { FolderInput, X, Layers, Folder } from 'lucide-react';
import { Folder as FolderType, SYSTEM_ARCHIVE_FOLDER_ID } from '../types';

interface BatchMoveModalProps {
  isOpen: boolean;
  selectedCount: number;
  folders: FolderType[];
  selectedItemIds: Set<string>;
  onClose: () => void;
  onSubmit: (targetFolderId: string | null) => void;
}

export function BatchMoveModal({
  isOpen,
  selectedCount,
  folders,
  selectedItemIds,
  onClose,
  onSubmit,
}: BatchMoveModalProps) {
  const [batchMoveFolderId, setBatchMoveFolderId] = useState<string | null>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl p-5 max-w-sm w-full shadow-xl space-y-4 animate-in fade-in zoom-in-95 font-sans-ui"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#68594d]">
            <FolderInput className="w-5 h-5" />
            <h3 className="font-serif-note font-bold text-base text-[#1b1c19]">
              Mover {selectedCount} {selectedCount > 1 ? 'itens' : 'item'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[#eae8e3] text-[#7f756e] rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#7f756e]">
          Selecione o local de destino para os itens selecionados:
        </p>

        <div className="max-h-60 overflow-y-auto space-y-1 py-1 border border-[#eae8e3] bg-white rounded-xl p-1.5">
          {/* Opção Raiz */}
          <button
            type="button"
            onClick={() => setBatchMoveFolderId(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer text-left ${
              batchMoveFolderId === null
                ? 'bg-[#f4dfcb] font-semibold text-[#1b1c19]'
                : 'hover:bg-[#f0eee9] text-[#4e453f]'
            }`}
          >
            <Layers className="w-4 h-4 text-[#68594d] shrink-0" />
            <span>Raiz da Sidebar (Sem pasta)</span>
          </button>

          {/* Pastas Disponíveis */}
          {folders
            .filter((f) => !selectedItemIds.has(f.id) && f.id !== SYSTEM_ARCHIVE_FOLDER_ID)
            .map((folder) => {
              const isSelected = batchMoveFolderId === folder.id;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setBatchMoveFolderId(folder.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer text-left ${
                    isSelected
                      ? 'bg-[#f4dfcb] font-semibold text-[#1b1c19]'
                      : 'hover:bg-[#f0eee9] text-[#4e453f]'
                  }`}
                >
                  <Folder className="w-4 h-4 text-[#68594d] shrink-0" />
                  <span className="truncate">{folder.name}</span>
                </button>
              );
            })}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-[#4e453f] hover:bg-[#e4e2dd] transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            id="batch-confirm-move-btn"
            onClick={() => onSubmit(batchMoveFolderId)}
            className="px-4 py-1.5 rounded-xl text-xs font-medium bg-[#68594d] text-white hover:bg-[#53463c] transition-colors cursor-pointer shadow-xs"
          >
            Mover para Cá
          </button>
        </div>
      </div>
    </div>
  );
}
