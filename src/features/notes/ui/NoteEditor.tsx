'use client';

import React, { useEffect } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
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
      <EditorContent editor={editor} />
    </div>
  );
}
