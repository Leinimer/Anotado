'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import { Youtube, Video, Link as LinkIcon, X } from 'lucide-react';
import { defaultEditorExtensions } from '../editor/editor-config';
import { FloatingBubbleToolbar } from './FloatingBubbleToolbar';
import { isYouTubeUrl, getYouTubeEmbedUrl, normalizeUrl } from '../editor/utils/url-helper';

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
  const [youtubePasteData, setYoutubePasteData] = useState<{ url: string } | null>(null);

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
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain')?.trim();
        // Se for um link do YouTube, intercepta para dar a escolha ao usuário
        if (text && isYouTubeUrl(text)) {
          event.preventDefault();
          setYoutubePasteData({ url: text });
          return true;
        }
        // Para qualquer outra URL ou texto, deixa o comportamento padrão acontecer (autolink etc.)
        return false;
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

  // Fecha o diálogo de paste do YouTube ao pressionar ESC
  useEffect(() => {
    if (!youtubePasteData) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setYoutubePasteData(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [youtubePasteData]);

  if (!editor) {
    return (
      <div className="min-h-[420px] flex items-center justify-center text-[#7f756e] font-sans-ui text-sm">
        Carregando editor...
      </div>
    );
  }

  return (
    <div id="note-rich-editor-wrapper" className="w-full relative">
      {/* Barra Flutuante Contextual de Seleção de Texto (Bubble Menu) */}
      <FloatingBubbleToolbar editor={editor} />

      <EditorContent editor={editor} />

      {/* Pop-up Interceptador de Colagem de Link do YouTube */}
      {youtubePasteData && (
        <div
          id="youtube-paste-dialog-overlay"
          className="fixed inset-0 z-[10000] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100"
          onClick={() => setYoutubePasteData(null)}
        >
          <div
            id="youtube-paste-dialog"
            className="bg-[#ffffff] border border-[#e4e2dd] rounded-3xl shadow-2xl p-5 max-w-sm w-full space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#ba1a1a]/10 text-[#ba1a1a] flex items-center justify-center">
                  <Youtube className="w-4 h-4" />
                </div>
                <h3 className="font-serif-note font-bold text-sm text-[#1b1c19]">
                  Você colou um link do YouTube
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setYoutubePasteData(null)}
                className="p-1.5 text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#f0eee9] rounded-xl transition-colors cursor-pointer"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p
              className="font-mono text-xs text-[#4e453f] bg-[#fbfaf8] p-2.5 rounded-xl border border-[#e4e2dd] truncate select-all"
              title={youtubePasteData.url}
            >
              {youtubePasteData.url}
            </p>

            <div className="flex flex-col gap-2 pt-1 font-sans-ui text-xs">
              <button
                type="button"
                id="youtube-paste-add-video-btn"
                onClick={() => {
                  const embedUrl = getYouTubeEmbedUrl(youtubePasteData.url);
                  editor
                    .chain()
                    .focus()
                    .setYoutubeVideo({ src: embedUrl, width: '100%', alignment: 'center' })
                    .run();
                  setYoutubePasteData(null);
                }}
                className="w-full py-2.5 px-3 bg-[#68594d] hover:bg-[#4a3728] text-white font-medium rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-2xs"
              >
                <Video className="w-3.5 h-3.5" />
                Adicionar como vídeo
              </button>

              <button
                type="button"
                id="youtube-paste-add-link-btn"
                onClick={() => {
                  const normalized = normalizeUrl(youtubePasteData.url);
                  editor
                    .chain()
                    .focus()
                    .insertContent({
                      type: 'text',
                      text: youtubePasteData.url,
                      marks: [{ type: 'link', attrs: { href: normalized } }],
                    })
                    .run();
                  setYoutubePasteData(null);
                }}
                className="w-full py-2 px-3 bg-[#f0eee9] hover:bg-[#e4e2dd] text-[#1b1c19] font-medium rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                Adicionar como link
              </button>

              <button
                type="button"
                id="youtube-paste-cancel-btn"
                onClick={() => setYoutubePasteData(null)}
                className="w-full py-1.5 px-3 text-[#7f756e] hover:text-[#ba1a1a] transition-colors cursor-pointer text-center"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
