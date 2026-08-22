'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Trash2,
  FilePlus,
  Menu,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import { Editor } from '@tiptap/react';
import { Note as NoteType } from '../types';
import { NoteEditor } from './NoteEditor';
import { EditorToolbar } from './EditorToolbar';

interface NoteCanvasProps {
  activeNote: NoteType | null;
  onUpdateTitle: (noteId: string, newTitle: string) => void;
  onUpdateContent: (noteId: string, newContent: string) => void;
  onDeleteNote: (noteId: string) => void;
  onCreateNewNote: () => void;
  onOpenMobileMenu?: () => void;
  isNewNoteJustCreated?: boolean;
}

export function NoteCanvas({
  activeNote,
  onUpdateTitle,
  onUpdateContent,
  onDeleteNote,
  onCreateNewNote,
  onOpenMobileMenu,
  isNewNoteJustCreated = false,
}: NoteCanvasProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(isNewNoteJustCreated);
  const [localTitle, setLocalTitle] = useState(activeNote?.title || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Foco no input do título ao iniciar edição
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Salva o título ao concluir edição
  const handleSaveTitle = useCallback(() => {
    if (!activeNote) return;
    const trimmed = localTitle.trim();
    const finalTitle = trimmed || 'Sem título';
    setLocalTitle(finalTitle);
    setIsEditingTitle(false);
    if (finalTitle !== activeNote.title) {
      onUpdateTitle(activeNote.id, finalTitle);
    }
  }, [activeNote, localTitle, onUpdateTitle]);

  // Handler de alteração no editor Tiptap com debounce de 400ms
  const handleEditorChange = useCallback(
    (htmlContent: string) => {
      if (!activeNote) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        onUpdateContent(activeNote.id, htmlContent);
      }, 400);
    },
    [activeNote, onUpdateContent]
  );

  // Estado Vazio: Nenhuma nota selecionada
  if (!activeNote) {
    return (
      <main
        id="main-note-workspace"
        className="flex-1 flex flex-col h-full bg-[#fbf9f4] items-center justify-center p-6 text-center select-none"
      >
        <div className="max-w-md space-y-4">
          <div className="w-16 h-16 rounded-full bg-[#e4e2dd] text-[#68594d] mx-auto flex items-center justify-center">
            <FileText className="w-8 h-8 stroke-[1.5]" />
          </div>
          <h2 className="font-serif-note font-bold text-2xl text-[#1b1c19]">
            Nenhuma nota selecionada
          </h2>
          <p className="font-sans-ui text-sm text-[#7f756e] leading-relaxed">
            Selecione uma nota na barra lateral para começar a ler ou editar, ou crie uma nova anotação agora.
          </p>
          <div className="pt-2">
            <button
              id="empty-state-new-note-btn"
              onClick={onCreateNewNote}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#68594d] text-white rounded-xl text-xs font-sans-ui font-medium hover:bg-[#53463c] transition-colors cursor-pointer shadow-xs"
            >
              <FilePlus className="w-4 h-4" />
              <span>Criar Nova Nota</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      id="main-note-workspace"
      className="flex-1 flex flex-col h-full overflow-hidden bg-[#fbf9f4]"
    >
      {/* Top Header Bar */}
      <header
        id="note-header-bar"
        className="w-full px-4 sm:px-8 py-3.5 sm:py-4 flex items-center justify-between border-b border-[#eae8e3]/80 shrink-0 select-none bg-[#fbf9f4]/90 backdrop-blur-xs z-10"
      >
        <div className="flex items-center gap-2 sm:gap-3">
          {onOpenMobileMenu && (
            <button
              id="header-mobile-menu-btn"
              onClick={onOpenMobileMenu}
              className="p-2 text-[#4e453f] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-lg md:hidden transition-colors cursor-pointer"
              aria-label="Abrir Menu Lateral"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <button
            id="header-trash-btn"
            onClick={() => setShowDeleteConfirm(true)}
            className="p-2 text-[#7f756e] hover:text-[#ba1a1a] hover:bg-[#eae8e3] rounded-lg transition-colors cursor-pointer"
            title="Excluir Nota"
            aria-label="Excluir Nota"
          >
            <Trash2 className="w-5 h-5 stroke-[1.75]" />
          </button>
        </div>

        {/* Note Title (Clique direto para editar - sem botão de lápis) */}
        <div className="flex-1 text-center px-2 min-w-0">
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              id="header-title-input"
              type="text"
              value={localTitle}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') {
                  setLocalTitle(activeNote.title);
                  setIsEditingTitle(false);
                }
              }}
              onChange={(e) => setLocalTitle(e.target.value)}
              className="font-serif-note font-bold text-xl sm:text-2xl md:text-3xl text-[#1b1c19] bg-transparent text-center border-b border-[#68594d] focus:outline-none w-full max-w-md"
            />
          ) : (
            <h1
              id="header-note-title"
              onClick={() => setIsEditingTitle(true)}
              className="font-serif-note font-bold text-xl sm:text-2xl md:text-3xl text-[#1b1c19] cursor-pointer hover:opacity-80 transition-opacity tracking-tight truncate inline-block max-w-full"
              title="Clique diretamente no título para editar"
            >
              {localTitle || 'Sem título'}
            </h1>
          )}
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <button
            id="header-new-note-btn"
            onClick={onCreateNewNote}
            className="p-2 text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-lg transition-colors cursor-pointer"
            title="Nova Nota"
            aria-label="Nova Nota"
          >
            <FilePlus className="w-5 h-5 stroke-[1.75]" />
          </button>
        </div>
      </header>

      {/* Note Canvas Sheet Area (Papyrus & Ink) */}
      <div
        id="note-scroll-container"
        className="flex-1 overflow-y-auto px-3 sm:px-6 md:px-12 py-6 sm:py-8 flex justify-center items-start"
      >
        <article
          id="note-paper-sheet"
          className="paper-sheet rounded-2xl w-full max-w-[850px] p-6 sm:p-10 md:p-12 text-[#1b1c19] font-serif-note shadow-sm relative flex flex-col min-h-[550px] h-auto mb-8"
        >
          <NoteEditor
            key={activeNote.id}
            content={activeNote.content}
            onChange={handleEditorChange}
            onEditorReady={setEditorInstance}
          />
        </article>
      </div>

      {/* Barra de Ferramentas Rica no Rodapé */}
      <EditorToolbar editor={editorInstance} />

      {/* Diálogo de Confirmação de Exclusão da Nota */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4 animate-in fade-in zoom-in-95"
          >
            <div className="flex items-center gap-3 text-[#ba1a1a]">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="font-serif-note font-bold text-lg text-[#1b1c19]">
                Excluir Nota
              </h3>
            </div>

            <p className="font-sans-ui text-sm text-[#4e453f] leading-relaxed">
              Deseja realmente excluir a nota <strong>&quot;{activeNote.title}&quot;</strong>? Esta ação não pode ser desfeita.
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium text-[#4e453f] hover:bg-[#e4e2dd] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                id="confirm-delete-note-modal-btn"
                onClick={() => {
                  onDeleteNote(activeNote.id);
                  setShowDeleteConfirm(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium bg-[#ba1a1a] text-white hover:bg-[#961515] transition-colors cursor-pointer shadow-xs"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
