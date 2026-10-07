'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { Note as NoteType } from '../types';
import { NoteEditor } from './NoteEditor';
import { NoteTagsBar } from './NoteTagsBar';
import { formatDateReadable } from '../utils/diary-date';
import { Editor } from '@tiptap/react';

interface NoteEditorPanelProps {
  note: NoteType;
  userId?: string;
  readOnly?: boolean;
  isSplit?: boolean;
  paneSide?: 'left' | 'right';
  isActivePane?: boolean;
  onFocusPane?: () => void;
  onUnsplit?: () => void;
  onUpdateTitle: (noteId: string, newTitle: string) => void;
  onUpdateContent: (noteId: string, newContent: string) => void;
  onUpdateTags: (noteId: string, newTags: string[]) => void;
  onEditorReady?: (editor: Editor | null) => void;
  isNewNoteJustCreated?: boolean;
  zoomLevel?: number;
}

export function NoteEditorPanel({
  note,
  userId,
  readOnly = false,
  isSplit = false,
  paneSide = 'left',
  isActivePane = true,
  onFocusPane,
  onUnsplit,
  onUpdateTitle,
  onUpdateContent,
  onUpdateTags,
  onEditorReady,
  isNewNoteJustCreated = false,
  zoomLevel = 100,
}: NoteEditorPanelProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(isNewNoteJustCreated && !readOnly);
  const [titleInput, setTitleInput] = useState(note?.title || '');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleStartEditing = () => {
    if (readOnly) return;
    setTitleInput(note?.title || '');
    setIsEditingTitle(true);
  };

  const handleSaveTitle = () => {
    setIsEditingTitle(false);
    const trimmed = titleInput.trim();
    if (trimmed !== note.title) {
      onUpdateTitle(note.id, trimmed || 'Sem título');
    }
  };

  const isDiary =
    note.workspace_type === 'diary' || Boolean(note.entry_date) || Boolean(note.diary_year);

  return (
    <div
      id={isSplit ? `split-panel-${paneSide}` : 'single-note-panel'}
      onClick={onFocusPane}
      className={`flex-1 h-full flex flex-col overflow-hidden min-w-0 transition-colors duration-150 ${
        isSplit
          ? paneSide === 'right'
            ? 'bg-[#faf8f3] dark:bg-[#060606]'
            : 'bg-[#fbf9f4] dark:bg-[#000000]'
          : 'bg-[#fbf9f4] dark:bg-[#000000]'
      }`}
    >
      {/* Barra de Título do Painel */}
      <div
        id={isSplit ? `header-bar-${paneSide}` : 'note-header-bar'}
        className="w-full px-4 sm:px-6 pt-2.5 pb-2.5 relative flex flex-col items-center justify-center border-b border-[#eae8e3]/80 dark:border-[#1a1a1a] shrink-0 select-none backdrop-blur-xs z-10 transition-colors bg-[#fbf9f4]/90 dark:bg-[#000000]/90"
      >
        <div className="w-full max-w-[850px] mx-auto text-center px-4 min-w-0">
          {/* Badge de Data se for entrada de Diário */}
          {isDiary && (
            <div className="flex items-center justify-center mb-1.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-sans-ui font-medium bg-[#f4dfcb] dark:bg-[#26201a] text-[#68594d] dark:text-[#d7c3b0] border border-[#e8d2bd] dark:border-[#3d3229] capitalize shadow-2xs">
                <Calendar className="w-3.5 h-3.5 text-[#68594d] dark:text-[#d7c3b0]" />
                {note.entry_date ? formatDateReadable(note.entry_date) : 'Diário'}
              </span>
            </div>
          )}

          {/* Título Editável */}
          {!readOnly && isEditingTitle ? (
            <input
              ref={titleInputRef}
              id={`header-title-input-${note.id}`}
              type="text"
              value={titleInput}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') {
                  setTitleInput(note.title || '');
                  setIsEditingTitle(false);
                }
              }}
              onChange={(e) => setTitleInput(e.target.value)}
              className={`font-serif-note font-bold text-[#1b1c19] dark:text-[#ffffff] bg-transparent text-center border-b border-[#68594d] dark:border-[#3f3f46] focus:outline-none w-full max-w-lg mx-auto ${
                isSplit ? 'text-lg sm:text-xl' : 'text-xl sm:text-2xl md:text-3xl'
              }`}
              placeholder="Título da anotação..."
            />
          ) : (
            <h1
              id={`header-note-title-${note.id}`}
              onClick={handleStartEditing}
              className={`font-serif-note font-bold text-[#1b1c19] dark:text-[#ffffff] tracking-tight truncate inline-block max-w-full ${
                isSplit ? 'text-lg sm:text-xl' : 'text-xl sm:text-2xl md:text-3xl'
              } ${
                readOnly
                  ? 'cursor-default select-text'
                  : 'cursor-pointer hover:opacity-80 transition-opacity'
              }`}
              title={readOnly ? undefined : 'Clique para editar o título'}
            >
              {note.title || 'Sem título'}
            </h1>
          )}
        </div>
      </div>

      {/* Região de Gerenciamento de Tags */}
      <div
        id={`note-tags-section-${note.id}`}
        className="w-full shrink-0 pt-1.5 pb-1 bg-[#fbf9f4] dark:bg-[#000000]"
      >
        <NoteTagsBar
          tags={note.tags || []}
          onUpdateTags={(newTags) => {
            if (readOnly) return;
            onUpdateTags(note.id, newTags);
          }}
          disabled={readOnly}
        />
      </div>

      {/* Área da Folha e Editor TipTap com Rolagem Independente */}
      <div
        id={`note-scroll-container-${note.id}`}
        className={`flex-1 overflow-y-auto py-3 sm:py-5 flex justify-center items-start ${
          isSplit ? 'px-2 sm:px-4 md:px-6' : 'px-3 sm:px-6 md:px-12'
        }`}
      >
        <article
          id={`note-paper-sheet-${note.id}`}
          style={{
            transform: `scale(${zoomLevel / 100})`,
            transformOrigin: 'top center',
            transition: 'transform 0.15s ease-out',
          }}
          className={`paper-sheet rounded-2xl w-full max-w-[850px] text-[#1b1c19] dark:text-[#ededed] font-serif-note shadow-xs relative flex flex-col min-h-[480px] h-auto mb-16 ${
            isSplit ? 'p-4 sm:p-6 md:p-8' : 'p-6 sm:p-10 md:p-12'
          }`}
        >
          <NoteEditor
            key={note.id}
            noteId={note.id}
            userId={userId || note.user_id}
            content={note.content || ''}
            onChange={(newContent) => onUpdateContent(note.id, newContent)}
            onEditorReady={onEditorReady}
            editable={!readOnly}
          />
        </article>
      </div>
    </div>
  );
}
