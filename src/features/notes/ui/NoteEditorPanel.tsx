'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Calendar, Link2 } from 'lucide-react';
import { Note as NoteType } from '../types';
import { NoteEditor } from './NoteEditor';
import { NoteTagsBar } from './NoteTagsBar';
import { formatDateReadable } from '../utils/diary-date';
import { Editor } from '@tiptap/react';
import { KnowledgeGraphNode } from '../utils/knowledge-graph';

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
  notePathLabel?: string;
  shouldShowReturnButton?: boolean;
  returnButtonLabel?: string;
  onReturnToSource?: () => void;
  backlinks?: KnowledgeGraphNode[];
  onOpenBacklink?: (noteId: string, workspace: 'notes' | 'diary') => void;
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
  notePathLabel = '',
  shouldShowReturnButton = false,
  returnButtonLabel = 'Voltar',
  onReturnToSource,
  backlinks = [],
  onOpenBacklink,
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

      {backlinks.length > 0 && (
        <div
          id={`note-backlinks-section-${note.id}`}
          className="w-full shrink-0 px-4 sm:px-6 pb-1.5 bg-[#fbf9f4] dark:bg-[#000000]"
        >
          <div className="max-w-[850px] mx-auto rounded-xl border border-[#eae8e3] dark:border-[#1d1d1d] bg-white/55 dark:bg-[#080808] px-3 py-2 flex items-center gap-2 min-w-0">
            <Link2 className="w-3.5 h-3.5 shrink-0 text-[#8c7e72]" />
            <span className="text-[10px] font-semibold text-[#7f756e] shrink-0">
              Referenciada por
            </span>
            <div className="flex items-center gap-1.5 overflow-hidden">
              {backlinks.slice(0, 5).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenBacklink?.(item.id, item.workspace)}
                  className="max-w-[180px] truncate px-2 py-1 rounded-lg text-[10px] font-medium text-[#68594d] dark:text-[#d7c3b0] hover:bg-[#f0eee9] dark:hover:bg-[#151515] transition-colors"
                  title={item.label}
                >
                  {item.label}
                </button>
              ))}
              {backlinks.length > 5 && (
                <span className="text-[10px] text-[#8c7e72] shrink-0">
                  +{backlinks.length - 5}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Área da Folha e Editor TipTap com Rolagem Independente */}
      <div
        id={`note-scroll-container-${note.id}`}
        className={`flex-1 overflow-y-auto py-3 sm:py-5 flex justify-center items-start relative ${
          isSplit ? 'px-2 sm:px-4 md:px-6' : 'px-3 sm:px-6 md:px-12'
        }`}
      >
        {(notePathLabel || shouldShowReturnButton) && (
          <div
            id={`note-path-controls-${note.id}`}
            className="absolute top-2.5 right-3 sm:right-5 z-20 flex items-center gap-2 pointer-events-none max-w-[min(78%,520px)]"
          >
            {notePathLabel && (
              <div className="pointer-events-auto max-w-[55%] truncate px-2.5 py-1 rounded-lg bg-[#ffffff]/82 dark:bg-[#080808]/82 border border-[#e4e2dd] dark:border-[#222] backdrop-blur text-[10px] font-sans-ui text-[#7f756e] dark:text-[#a1a1aa] shadow-xs">
                {notePathLabel}
              </div>
            )}

            {shouldShowReturnButton && (
              <button
                id={`return-to-source-note-btn-${note.id}`}
                type="button"
                onClick={onReturnToSource}
                className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#68594d] hover:bg-[#53463c] dark:bg-[#2e2620] dark:border dark:border-[#4a3b2c] dark:hover:bg-[#3d3229] text-white font-sans-ui text-[10px] font-semibold transition-all cursor-pointer shadow-xs active:scale-95"
                title={returnButtonLabel}
              >
                <ArrowLeft className="w-3 h-3" />
                <span>{returnButtonLabel}</span>
              </button>
            )}
          </div>
        )}
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
