'use client';

import React, { useEffect } from 'react';
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
  const editor = useEditor({
    immediatelyRender: false,
    extensions: defaultEditorExtensions,
    content: content || '',
    editable,
    editorProps: {
      attributes: {
        id: 'tiptap-note-content-editable',
        class:
          'focus:outline-none min-h-[420px] text-[#1b1c19] font-serif-note text-base sm:text-lg leading-relaxed selection:bg-[#f4dfcb] selection:text-[#1b1c19]',
      },
    },
    onUpdate: ({ editor }) => {
      // Extrai Markdown real usando a extensão de markdown do Tiptap
      const storageRecord = editor.storage as unknown as Record<string, { getMarkdown?: () => string }>;
      const markdown = storageRecord?.markdown?.getMarkdown ? storageRecord.markdown.getMarkdown() : editor.getHTML();
      onChange(markdown);
    },
  });

  // Notifica o componente pai sobre a instância do editor
  useEffect(() => {
    if (onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Atualiza o conteúdo quando uma nota diferente é carregada
  useEffect(() => {
    if (!editor) return;

    const targetContent = content ?? '';

    // Atualiza o editor caso o conteúdo seja diferente e o usuário não esteja focado
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
            className={`min-w-[36px] min-h-[36px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive('bold')
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
            }`}
            title="Negrito (Ctrl+B)"
            aria-label="Negrito"
          >
            <Bold className="w-4 h-4 stroke-[2.25]" />
          </button>

          {/* Marca-texto (Highlight Amarelo Suave) */}
          <button
            type="button"
            id="bubble-btn-highlight"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run();
            }}
            className={`min-w-[36px] min-h-[36px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive('highlight')
                ? 'bg-[#fef08a] text-[#1b1c19] ring-1 ring-[#eab308]'
                : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
            }`}
            title="Marca-texto"
            aria-label="Marca-texto"
          >
            <Highlighter className="w-4 h-4 stroke-[2.25]" />
          </button>

          {/* Sublinhado */}
          <button
            type="button"
            id="bubble-btn-underline"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleUnderline().run();
            }}
            className={`min-w-[36px] min-h-[36px] p-1.5 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
              editor.isActive('underline')
                ? 'bg-[#68594d] text-white shadow-2xs'
                : 'hover:bg-[#f0eee9] text-[#4e453f] hover:text-[#1b1c19]'
            }`}
            title="Sublinhado (Ctrl+U)"
            aria-label="Sublinhado"
          >
            <UnderlineIcon className="w-4 h-4 stroke-[2.25]" />
          </button>
        </div>
      </BubbleMenu>

      <EditorContent editor={editor} />
    </div>
  );
}
