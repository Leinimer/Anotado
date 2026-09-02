'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDeleteModalProps {
  confirmDelete: {
    id: string;
    type: 'folder' | 'note';
    name: string;
    hasChildren?: boolean;
  } | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteModal({
  confirmDelete,
  onClose,
  onConfirm,
}: ConfirmDeleteModalProps) {
  if (!confirmDelete) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4 animate-in fade-in zoom-in-95"
      >
        <div className="flex items-center gap-3 text-[#ba1a1a]">
          <AlertTriangle className="w-6 h-6 shrink-0" />
          <h3 className="font-serif-note font-bold text-lg text-[#1b1c19]">
            Confirmar Exclusão
          </h3>
        </div>

        <p className="font-sans-ui text-sm text-[#4e453f] leading-relaxed">
          Deseja realmente excluir <strong>&quot;{confirmDelete.name}&quot;</strong>?
          {confirmDelete.hasChildren && (
            <span className="block mt-2 text-xs text-[#ba1a1a] font-medium">
              Atenção: Esta pasta contém subpastas ou notas. A exclusão removerá todo o seu conteúdo.
            </span>
          )}
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium text-[#4e453f] hover:bg-[#e4e2dd] transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            id="confirm-delete-action-btn"
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium bg-[#ba1a1a] text-white hover:bg-[#961515] transition-colors cursor-pointer shadow-xs"
          >
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

interface BatchDeleteConfirmModalProps {
  isOpen: boolean;
  selectedCount: number;
  onClose: () => void;
  onConfirm: () => void;
}

export function BatchDeleteConfirmModal({
  isOpen,
  selectedCount,
  onClose,
  onConfirm,
}: BatchDeleteConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4 animate-in fade-in zoom-in-95"
      >
        <div className="flex items-center gap-3 text-[#ba1a1a]">
          <AlertTriangle className="w-6 h-6 shrink-0" />
          <h3 className="font-serif-note font-bold text-lg text-[#1b1c19]">
            Excluir {selectedCount} {selectedCount > 1 ? 'itens' : 'item'}?
          </h3>
        </div>

        <p className="font-sans-ui text-sm text-[#4e453f] leading-relaxed">
          Deseja realmente excluir os <strong>{selectedCount}</strong> itens selecionados?
          <span className="block mt-2 text-xs text-[#ba1a1a] font-medium">
            Esta ação removerá todas as notas e pastas selecionadas.
          </span>
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium text-[#4e453f] hover:bg-[#e4e2dd] transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            id="batch-confirm-delete-action-btn"
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium bg-[#ba1a1a] text-white hover:bg-[#961515] transition-colors cursor-pointer shadow-xs"
          >
            Excluir Selecionados
          </button>
        </div>
      </div>
    </div>
  );
}
