'use client';

import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Bold, Highlighter, Underline as UnderlineIcon } from 'lucide-react';
import { defaultEditorExtensions } from '../editor/editor-config';

interface NoteEditorProps {
  content: string;
  onChange: (markdownContent: string) => void;
  onEditorReady?: (editor: Editor | null) => void;
  editable?: boolean;
}

export function NoteEditor({
  content,
  onChange,
  onEditorReady,
  editable = true,
}: NoteEditorProps) {
  const lastEmittedContentRef = useRef<string>(content ?? '');

  const editor = useEditor({
    immediatelyRender: false,
    extensions: defaultEditorExtensions,
    content: content || '',
    editable,
    editorProps: {
      attributes: {
        id: 'tiptap-note-content-editable',
        class:
          'focus:outline-none min-h-[420px] text-[#1b1c19] font-serif-note text-base sm:text-lg leading-normal selection:bg-[#f4dfcb] selection:text-[#1b1c19]',
      },
    },
    onUpdate: ({ editor }) => {
      // Extrai Markdown real usando a extensão de markdown do Tiptap
      const storageRecord = editor.storage as unknown as Record<string, { getMarkdown?: () => string }>;
      const markdown = storageRecord?.markdown?.getMarkdown ? storageRecord.markdown.getMarkdown() : editor.getHTML();
      lastEmittedContentRef.current = markdown;
      onChange(markdown);
    },
  });

  // Notifica o componente pai sobre a instância do editor
  useEffect(() => {
    if (onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Atualiza o conteúdo apenas quando for genuinamente diferente (ex: troca de nota externa)
  useEffect(() => {
    if (!editor) return;

    const targetContent = content ?? '';

    // Se o conteúdo recebido é o mesmo que o editor acabou de emitir pelo autosave, não recria o documento
    if (targetContent === lastEmittedContentRef.current) {
      return;
    }

    lastEmittedContentRef.current = targetContent;
    if (!editor.isFocused) {
      editor.commands.setContent(targetContent, { emitUpdate: false });
    }
  }, [content, editor]);

  if (!editor) {
    return (
      <div className="min-h-[420px] flex items-center justify-center text-[#7f756e] font-sans-ui text-sm">
        Carregando editor...
      </div>
    );
  }

  return (
    <div id="note-rich-editor-wrapper" className="w-full relative">
      {/* Bubble Menu Contextual de Seleção de Texto */}
      <BubbleMenu
        editor={editor}
        shouldShow={({ editor, from, to, state }) => {
          // Exibe somente se houver texto selecionado (seleção não colapsada)
          if (!editor.isEditable) return false;
          const { empty } = state.selection;
          if (empty || from === to) return false;
          // Não exibe caso um node view especial como imagem/youtube/documento esteja selecionado como node
          if (editor.isActive('image') || editor.isActive('youtube') || editor.isActive('documentAttachment')) {
            return false;
          }
          return true;
        }}
      >
        <div
          id="editor-floating-bubble-menu"
          className="bg-[#ffffff]/95 backdrop-blur-md border border-[#e4e2dd] shadow-lg rounded-2xl p-1 flex items-center gap-1 z-50 text-[#4e453f] animate-in fade-in zoom-in-95"
        >
          {/* Negrito */}
          <button
            type="button"
            id="bubble-btn-bold"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleBold().run();
            }}
            className={`min-w-[34px] min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive('bold')
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
            }`}
            title="Negrito (Ctrl+B)"
            aria-label="Negrito"
          >
            <Bold className="w-4 h-4 stroke-[2.25]" />
          </button>

          {/* Sublinhado */}
          <button
            type="button"
            id="bubble-btn-underline"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleUnderline().run();
            }}
            className={`min-w-[34px] min-h-[34px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive('underline')
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
            }`}
            title="Sublinhado (Ctrl+U)"
            aria-label="Sublinhado"
          >
            <UnderlineIcon className="w-4 h-4 stroke-[2.25]" />
          </button>

          {/* Separador Visual */}
          <div className="h-4 w-[1px] bg-[#e4e2dd] mx-0.5" />

          {/* Bolinha 1: Marca-texto Amarelo */}
          <button
            type="button"
            id="bubble-btn-highlight-yellow"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run();
            }}
            className={`min-w-[30px] min-h-[30px] p-1 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] active:scale-90 ${
              editor.isActive('highlight', { color: '#fef08a' })
                ? 'ring-2 ring-[#68594d] ring-offset-1 bg-[#f0eee9]'
                : ''
            }`}
            title="Marca-texto Amarelo"
            aria-label="Marca-texto Amarelo"
          >
            <span
              className="w-3.5 h-3.5 rounded-full border border-[#ca8a04]/30 shadow-2xs block"
              style={{ backgroundColor: '#fef08a' }}
            />
          </button>

          {/* Bolinha 2: Marca-texto Verde / Menta */}
          <button
            type="button"
            id="bubble-btn-highlight-green"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleHighlight({ color: '#bbf7d0' }).run();
            }}
            className={`min-w-[30px] min-h-[30px] p-1 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] active:scale-90 ${
              editor.isActive('highlight', { color: '#bbf7d0' })
                ? 'ring-2 ring-[#68594d] ring-offset-1 bg-[#f0eee9]'
                : ''
            }`}
            title="Marca-texto Verde Menta"
            aria-label="Marca-texto Verde Menta"
          >
            <span
              className="w-3.5 h-3.5 rounded-full border border-[#16a34a]/30 shadow-2xs block"
              style={{ backgroundColor: '#bbf7d0' }}
            />
          </button>

          {/* Bolinha 3: Marca-texto Rosa / Pergaminho */}
          <button
            type="button"
            id="bubble-btn-highlight-pink"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleHighlight({ color: '#fecdd3' }).run();
            }}
            className={`min-w-[30px] min-h-[30px] p-1 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:bg-[#f0eee9] active:scale-90 ${
              editor.isActive('highlight', { color: '#fecdd3' })
                ? 'ring-2 ring-[#68594d] ring-offset-1 bg-[#f0eee9]'
                : ''
            }`}
            title="Marca-texto Rosa Pergaminho"
            aria-label="Marca-texto Rosa Pergaminho"
          >
            <span
              className="w-3.5 h-3.5 rounded-full border border-[#e11d48]/30 shadow-2xs block"
              style={{ backgroundColor: '#fecdd3' }}
            />
          </button>
        </div>
      </BubbleMenu>

      <EditorContent editor={editor} />
    </div>
  );
}
