'use client';

import React from 'react';
import { NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react';
import { ChevronRight, Trash2 } from 'lucide-react';

export function ToggleNodeView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const isOpen = node.attrs.open !== false;

  const handleToggleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updateAttributes({ open: !isOpen });
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    deleteNode();
  };

  return (
    <NodeViewWrapper
      as="div"
      className="tiptap-toggle-wrapper group/toggle relative my-1.5 pl-6 sm:pl-7 transition-all"
      data-open={isOpen ? 'true' : 'false'}
    >
      {/* Botão de Excluir Toggle (Lixeira à esquerda no hover ou acessível no mobile) */}
      <div
        contentEditable={false}
        className="absolute -left-6 sm:-left-6 top-0.5 flex items-center justify-center opacity-0 group-hover/toggle:opacity-100 max-md:opacity-60 focus-within:opacity-100 transition-opacity z-20"
      >
        <button
          type="button"
          onClick={handleDeleteClick}
          className="p-1 text-[#ba1a1a]/70 hover:text-[#ba1a1a] hover:bg-[#fceded] rounded-md transition-colors cursor-pointer"
          title="Excluir Bloco de Alternância"
          aria-label="Excluir Bloco de Alternância"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Botão Independente da Seta (Alternar aberto/fechado perfeitamente a cada clique) */}
      <div
        contentEditable={false}
        className="absolute left-0 top-0.5 flex items-center justify-center z-20"
      >
        <button
          type="button"
          onClick={handleToggleClick}
          className="p-1 -m-0.5 text-[#7f756e] hover:text-[#68594d] hover:bg-[#eae8e3] rounded-lg transition-colors cursor-pointer flex items-center justify-center"
          title={isOpen ? 'Recolher Bloco' : 'Expandir Bloco'}
          aria-label={isOpen ? 'Recolher Bloco' : 'Expandir Bloco'}
        >
          <ChevronRight
            className={`w-4 h-4 sm:w-4.5 sm:h-4.5 transition-transform duration-200 ease-out stroke-[2.25] ${
              isOpen ? 'rotate-90 text-[#68594d]' : 'text-[#7f756e]'
            }`}
          />
        </button>
      </div>

      {/* Conteúdo do Toggle (Summary e DetailsContent) */}
      <NodeViewContent className="tiptap-toggle-content-container min-w-0" />
    </NodeViewWrapper>
  );
}
