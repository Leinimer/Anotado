'use client';

import React, { useEffect } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import { defaultEditorExtensions } from '../editor/editor-config';

interface NoteEditorProps {
  content: string;
  onChange: (htmlContent: string) => void;
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
    content: content || '<p></p>',
    editable,
    editorProps: {
      attributes: {
        id: 'tiptap-note-content-editable',
        class:
          'focus:outline-none min-h-[420px] text-[#1b1c19] font-serif-note text-base sm:text-lg leading-relaxed selection:bg-[#f4dfcb] selection:text-[#1b1c19]',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
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

    const currentHTML = editor.getHTML();
    const targetContent = content || '<p></p>';

    // Atualiza apenas se o conteúdo for diferente para evitar resetar o cursor durante digitação
    if (currentHTML !== targetContent && !editor.isFocused) {
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
      <EditorContent editor={editor} />
    </div>
  );
}
