'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import { TextSelection, NodeSelection } from '@tiptap/pm/state';
import { Youtube, Video, Link as LinkIcon, X } from 'lucide-react';
import { defaultEditorExtensions } from '../editor/editor-config';
import { FloatingBubbleToolbar } from './FloatingBubbleToolbar';
import { isYouTubeUrl, getYouTubeEmbedUrl, normalizeUrl } from '../editor/utils/url-helper';
import { perfProfiler } from '../editor/utils/media-optimizer';
import { isSupportedNoteAttachmentFile, uploadNoteFile } from '../api/storage-api';

function normalizeEditorSelection(editor: Editor) {
  if (!editor || !editor.state) return;
  const { doc, selection, schema } = editor.state;
  if (selection instanceof NodeSelection) {
    const selectedNode = selection.node;
    const isMediaNode = ['image', 'customYoutube', 'documentAttachment'].includes(
      selectedNode?.type?.name
    );
    if (isMediaNode) {
      let firstTextblockPos: number | null = null;
      doc.descendants((node, pos) => {
        if (firstTextblockPos !== null) return false;
        if (node.isTextblock) {
          firstTextblockPos = pos + 1;
          return false;
        }
        return true;
      });

      const tr = editor.state.tr;
      if (firstTextblockPos !== null) {
        try {
          tr.setSelection(TextSelection.create(doc, firstTextblockPos));
          tr.setMeta('addToHistory', false);
          editor.view.dispatch(tr);
        } catch {}
      } else {
        const paragraphType = schema.nodes.paragraph;
        if (paragraphType) {
          const emptyParagraph = paragraphType.create();
          const insertPos = doc.content.size;
          tr.insert(insertPos, emptyParagraph);
          try {
            tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
            tr.setMeta('addToHistory', false);
            editor.view.dispatch(tr);
          } catch {}
        }
      }
    }
  }
}

/**
 * Serializa o documento para o campo notes.content.
 *
 * As tabelas precisam permanecer como HTML embutido no Markdown porque o
 * pacote "tiptap-markdown" instalado no projeto pode escolher o serializador
 * Markdown simples (pipe table), que descarta rowHeight, colwidth e cellTone.
 * Se a extensão de tabela não produzir HTML completo, usa editor.getHTML()
 * como fallback seguro em vez de enviar uma tabela sem seus atributos.
 */
function serializeNoteEditorContent(editor: Editor): string {
  const storageRecord = editor.storage as unknown as Record<
    string,
    { getMarkdown?: () => string }
  >;
  const markdown = storageRecord?.markdown?.getMarkdown
    ? storageRecord.markdown.getMarkdown()
    : editor.getHTML();

  let hasTable = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table') {
      hasTable = true;
      return false;
    }
    return !hasTable;
  });

  if (hasTable && !/<table(?:\s|>)/i.test(markdown)) {
    const html = editor.getHTML();
    if (/<table(?:\s|>)/i.test(html)) {
      console.warn(
        '[NoteEditor] O serializador Markdown não incluiu a tabela em HTML. Usando HTML completo para preservar os dados.'
      );
      return html;
    }

    console.error(
      '[NoteEditor] A nota contém uma tabela, mas nenhum serializador produziu a tag <table>. O conteúdo não deve ser considerado salvo.'
    );
  }

  return markdown;
}

interface NoteEditorProps {
  noteId?: string;
  userId?: string | null;
  content: string;
  onChange: (markdownContent: string) => void;
  onEditorReady?: (editor: Editor | null) => void;
  editable?: boolean;
}

export function NoteEditor({
  noteId,
  userId,
  content,
  onChange,
  onEditorReady,
  editable = true,
}: NoteEditorProps) {
  const lastEmittedContentRef = useRef<string>(content ?? '');
  const isApplyingRemoteAttachmentResolution = useRef(false);
  const [youtubePasteData, setYoutubePasteData] = useState<{ url: string } | null>(null);

  // Profiler T1
  const noteIdentifier = noteId || 'active-note';
  useEffect(() => {
    perfProfiler.mark(noteIdentifier, 'T1 - NoteEditor Montado');
  }, [noteIdentifier]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: defaultEditorExtensions,
    content: content || '',
    editable,
    editorProps: {
      attributes: {
        id: noteId ? `tiptap-note-content-editable-${noteId}` : 'tiptap-note-content-editable',
        'data-user-id': userId || 'anonymous',
        class:
          'tiptap-note-content-editable focus:outline-none min-h-[420px] text-[#1b1c19] dark:text-[#ededed] font-serif-note text-base sm:text-lg leading-[1.6] selection:bg-[#f4dfcb] selection:text-[#1b1c19] dark:selection:bg-[#333333] dark:selection:text-[#ffffff]',
      },
      clipboardTextSerializer: (slice) => {
        return slice.content.textBetween(0, slice.content.size, '\n\n', '\n');
      },
      handlePaste: (view, event, slice) => {
        // 1. Verifica se há arquivo de imagem ou anexo no clipboardData (files ou items)
        let file: File | null = null;
        const clipboardFiles = event.clipboardData?.files;
        if (clipboardFiles && clipboardFiles.length > 0) {
          file = clipboardFiles[0];
        } else if (event.clipboardData?.items) {
          for (let i = 0; i < event.clipboardData.items.length; i++) {
            const item = event.clipboardData.items[i];
            if (item.type.startsWith('image/')) {
              file = item.getAsFile();
              if (file) break;
            }
          }
        }

        if (file) {
          if (isSupportedNoteAttachmentFile(file)) {
            event.preventDefault();
            const effectiveUser =
              userId && userId !== 'anonymous'
                ? userId
                : typeof window !== 'undefined'
                ? localStorage.getItem('anotado_last_auth_user_id') || 'anonymous'
                : 'anonymous';
            uploadNoteFile(effectiveUser, file, noteId)
              .then((res) => {
                if (file!.type.startsWith('image/')) {
                  const { state } = view;
                  const { schema } = state;
                  const tr = state.tr;
                  const imageNode = schema.nodes.image.create({ src: res.url, alt: res.name });
                  const paragraphType = schema.nodes.paragraph;

                  // Substitui a seleção atual pela imagem
                  tr.replaceSelectionWith(imageNode);

                  // Posiciona o cursor imediatamente após a imagem
                  const afterPos = tr.selection.to;
                  const $after = tr.doc.resolve(Math.min(afterPos, tr.doc.content.size));
                  const nextNode = $after.nodeAfter;

                  // Se não houver um bloco de texto logo após ou se for o fim do documento, insere um parágrafo
                  if (afterPos >= tr.doc.content.size || !nextNode || !nextNode.isTextblock) {
                    if (paragraphType) {
                      const emptyParagraph = paragraphType.create();
                      tr.insert(afterPos, emptyParagraph);
                      const textPos = Math.min(afterPos + 1, tr.doc.content.size);
                      try {
                        tr.setSelection(TextSelection.near(tr.doc.resolve(textPos), 1));
                      } catch {}
                    }
                  } else {
                    // Já existe um parágrafo logo depois da imagem, posiciona o cursor no início dele
                    const textPos = Math.min(afterPos + 1, tr.doc.content.size);
                    try {
                      tr.setSelection(TextSelection.near(tr.doc.resolve(textPos), 1));
                    } catch {}
                  }

                  tr.scrollIntoView();
                  view.dispatch(tr);
                  setTimeout(() => {
                    view.focus();
                  }, 10);
                } else {
                  view.dispatch(
                    view.state.tr.replaceSelectionWith(
                      view.state.schema.nodes.documentAttachment.create({
                        src: res.url,
                        name: res.name,
                        size: res.size,
                        type: res.type,
                        attachmentId: res.attachmentId,
                      })
                    )
                  );
                }
              })
              .catch((err) => {
                console.error('[NoteEditor] Erro ao colar arquivo:', err);
              });
            return true;
          }
        }

        // 2. Se for um slice colado contendo imagem (ex: cópia de imagem via HTML ou Ctrl+C em nó de imagem)
        if (slice && slice.content.size > 0) {
          let containsImage = false;
          slice.content.forEach((node) => {
            if (node.type.name === 'image') containsImage = true;
          });

          if (containsImage) {
            event.preventDefault();
            const tr = view.state.tr;
            tr.replaceSelection(slice);

            const afterPos = tr.selection.to;
            const paragraphType = view.state.schema.nodes.paragraph;
            const $after = tr.doc.resolve(Math.min(afterPos, tr.doc.content.size));
            const nextNode = $after.nodeAfter;

            if (afterPos >= tr.doc.content.size || !nextNode || !nextNode.isTextblock) {
              if (paragraphType) {
                const emptyParagraph = paragraphType.create();
                tr.insert(afterPos, emptyParagraph);
                const textPos = Math.min(afterPos + 1, tr.doc.content.size);
                try {
                  tr.setSelection(TextSelection.near(tr.doc.resolve(textPos), 1));
                } catch {}
              }
            } else {
              const textPos = Math.min(afterPos + 1, tr.doc.content.size);
              try {
                tr.setSelection(TextSelection.near(tr.doc.resolve(textPos), 1));
              } catch {}
            }

            tr.scrollIntoView();
            view.dispatch(tr);
            setTimeout(() => {
              view.focus();
            }, 10);
            return true;
          }
        }

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
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files;
        if (files && files.length > 0) {
          const file = files[0];
          if (isSupportedNoteAttachmentFile(file)) {
            event.preventDefault();
            const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const dropPos = coordinates ? coordinates.pos : view.state.selection.from;
            const effectiveUser =
              userId && userId !== 'anonymous'
                ? userId
                : typeof window !== 'undefined'
                ? localStorage.getItem('anotado_last_auth_user_id')
                : null;
            if (effectiveUser && effectiveUser !== 'anonymous') {
              uploadNoteFile(effectiveUser, file, noteId)
                .then((res) => {
                  const tr = view.state.tr;
                  const node = file.type.startsWith('image/')
                    ? view.state.schema.nodes.image.create({ src: res.url, alt: res.name })
                    : view.state.schema.nodes.documentAttachment.create({
                        src: res.url,
                        name: res.name,
                        size: res.size,
                        type: res.type,
                      });
                  tr.insert(dropPos, node);
                  view.dispatch(tr);
                })
                .catch((err) => {
                  console.error('[NoteEditor] Erro ao soltar arquivo:', err);
                });
              return true;
            }
          }
        }
        return false;
      },
    },
    onCreate: ({ editor }) => {
      normalizeEditorSelection(editor);
      perfProfiler.mark(noteIdentifier, 'T2 - Tiptap Instanciado e Markdown Parseado');
    },
    onUpdate: ({ editor }) => {
      if (isApplyingRemoteAttachmentResolution.current) {
        return;
      }
      hasUserEditedRef.current = true;

      const serializedContent = serializeNoteEditorContent(editor);
      lastEmittedContentRef.current = serializedContent;
      onChange(serializedContent);
    },
  });

  // Atualiza nós do documento Tiptap quando anexos locais forem resolvidos remotamente
  useEffect(() => {
    const handleAttachmentResolved = (event: Event) => {
      const customEvent = event as CustomEvent<{ noteId: string; replacements: Record<string, string> }>;
      if (!editor || !customEvent.detail) return;
      const { noteId: targetNoteId, replacements } = customEvent.detail;
      if (noteId && targetNoteId !== noteId) return;
      if (!replacements || Object.keys(replacements).length === 0) return;

      console.log(
        `[EDITOR] ATTACHMENT REFERENCE UPDATED noteId=${targetNoteId || noteIdentifier} replacements=${JSON.stringify(replacements)}`
      );

      isApplyingRemoteAttachmentResolution.current = true;
      try {
        let hasChanges = false;
        const { tr } = editor.state;
        tr.setMeta('addToHistory', false);

        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'image' && node.attrs?.src) {
            const rawSrc = node.attrs.src;
            for (const [attId, remoteUrl] of Object.entries(replacements)) {
              if (
                (rawSrc === `attachment://${attId}` ||
                rawSrc === `local-attachment://${attId}` ||
                rawSrc === attId) &&
                rawSrc !== remoteUrl
              ) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  src: remoteUrl,
                });
                hasChanges = true;
              }
            }
          } else if (node.type.name === 'documentAttachment' && node.attrs) {
            const rawSrc = node.attrs.src || node.attrs['data-src'];
            for (const [attId, remoteUrl] of Object.entries(replacements)) {
              if (
                (rawSrc === `attachment://${attId}` ||
                rawSrc === `local-attachment://${attId}` ||
                rawSrc === attId) &&
                rawSrc !== remoteUrl
              ) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  src: remoteUrl,
                  'data-src': remoteUrl,
                });
                hasChanges = true;
              }
            }
          }
        });

        if (hasChanges) {
          editor.view.dispatch(tr);
          const serializedContent = serializeNoteEditorContent(editor);
          lastEmittedContentRef.current = serializedContent;
        }
      } catch (err) {
        console.warn('[NoteEditor] Erro ao atualizar referências remotas no Tiptap:', err);
      } finally {
        setTimeout(() => {
          isApplyingRemoteAttachmentResolution.current = false;
        }, 100);
      }
    };

    window.addEventListener('anotado:attachment-resolved', handleAttachmentResolved);
    return () => {
      window.removeEventListener('anotado:attachment-resolved', handleAttachmentResolved);
    };
  }, [editor, noteId, noteIdentifier]);

  // Mantém a posição de edição visível acima da barra fixa quando o teclado mobile abre.
  // A rolagem é aplicada somente ao painel interno da nota; o shell e a toolbar não se movem.
  useEffect(() => {
    if (!editor || !noteId || !editor.isEditable) return;

    const scrollContainer = document.getElementById(`note-scroll-container-${noteId}`);
    const spacer = document.getElementById(`note-keyboard-scroll-spacer-${noteId}`);
    if (!scrollContainer || !spacer) return;

    let keyboardOpen = false;
    let scheduledFrame: number | null = null;
    let layoutFrame: number | null = null;

    const getVisibleBounds = () => {
      const viewport = window.visualViewport;
      const toolbar = document.getElementById('editor-toolbar-footer-container');
      const toolbarRect = toolbar?.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const toolbarTop = toolbarRect?.top ?? viewportBottom;

      return {
        top: Math.max(containerRect.top, viewportTop) + 10,
        bottom: Math.min(containerRect.bottom, toolbarTop, viewportBottom) - 12,
        containerBottom: containerRect.bottom,
      };
    };

    const keepCaretVisible = () => {
      if (!keyboardOpen || !editor.isFocused) return;

      if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);

      scheduledFrame = requestAnimationFrame(() => {
        scheduledFrame = null;
        if (!keyboardOpen || !editor.isFocused) return;

        const bounds = getVisibleBounds();
        if (bounds.bottom <= bounds.top) return;

        // A folha recebe um prolongamento real no fim. Assim o scrollTop máximo
        // consegue levar a última linha para cima do topo da barra de ferramentas.
        const requiredSpacer = Math.max(
          0,
          Math.ceil(bounds.containerBottom - bounds.bottom + 28)
        );
        spacer.style.height = `${requiredSpacer}px`;

        // Espera o navegador incorporar a nova altura ao scrollHeight antes de mover.
        layoutFrame = requestAnimationFrame(() => {
          layoutFrame = null;
          if (!keyboardOpen || !editor.isFocused) return;

          try {
            const caret = editor.view.coordsAtPos(editor.state.selection.head);
            const updatedBounds = getVisibleBounds();
            if (updatedBounds.bottom <= updatedBounds.top) return;

            const lowerGap = 22;
            const upperGap = 14;

            if (caret.bottom > updatedBounds.bottom - lowerGap) {
              const delta = caret.bottom - (updatedBounds.bottom - lowerGap);
              scrollContainer.scrollTop = Math.min(
                scrollContainer.scrollTop + delta,
                scrollContainer.scrollHeight - scrollContainer.clientHeight
              );
            } else if (caret.top < updatedBounds.top + upperGap) {
              const delta = caret.top - (updatedBounds.top + upperGap);
              scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop + delta);
            }
          } catch (error) {
            // Uma seleção transitória durante colagem/alteração estrutural não deve
            // interromper a digitação; o próximo evento de seleção tenta novamente.
            console.debug('[NoteEditor] Não foi possível medir o cursor neste frame:', error);
          }
        });
      });
    };

    const handleKeyboardViewport = (event: Event) => {
      const detail = (event as CustomEvent<{ isKeyboardOpen?: boolean }>).detail;
      const nextKeyboardOpen = Boolean(detail?.isKeyboardOpen);
      const keyboardJustOpened = nextKeyboardOpen && !keyboardOpen;
      keyboardOpen = nextKeyboardOpen;

      if (!keyboardOpen) {
        spacer.style.height = '0px';
        if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
        if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
        scheduledFrame = null;
        layoutFrame = null;
        return;
      }

      // Executa o reposicionamento inicial apenas na abertura do teclado.
      // Eventos de scroll da VisualViewport também ocorrem durante gestos do usuário;
      // eles não devem puxar a nota de volta ao cursor e desfazer a rolagem manual.
      if (keyboardJustOpened) keepCaretVisible();
    };

    const handleViewportChange = () => {
      if (keyboardOpen) keepCaretVisible();
    };

    editor.on('focus', keepCaretVisible);
    editor.on('selectionUpdate', keepCaretVisible);
    editor.on('update', keepCaretVisible);
    window.addEventListener('anotado:mobile-keyboard-viewport', handleKeyboardViewport);
    // Resize é usado durante a animação de abertura/fechamento do teclado.
    // Scroll da VisualViewport não reposiciona o cursor: pode representar rolagem manual.
    window.visualViewport?.addEventListener('resize', handleViewportChange);

    return () => {
      editor.off('focus', keepCaretVisible);
      editor.off('selectionUpdate', keepCaretVisible);
      editor.off('update', keepCaretVisible);
      window.removeEventListener('anotado:mobile-keyboard-viewport', handleKeyboardViewport);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
      if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
      spacer.style.height = '0px';
    };
  }, [editor, noteId]);

  // Notifica o componente pai sobre a instância do editor (T3)
  useEffect(() => {
    if (onEditorReady) {
      onEditorReady(editor);
      if (editor) {
        perfProfiler.mark(noteIdentifier, 'T3 - Editor Pronto para Interação');
      }
    }
  }, [editor, onEditorReady, noteIdentifier]);

  // Atualiza o conteúdo apenas quando for genuinamente necessário (ex: carga tardia do Storage para editor ainda não editado)
  const hasUserEditedRef = useRef(false);
  const initialContentAppliedRef = useRef(false);

  useEffect(() => {
    hasUserEditedRef.current = false;
    initialContentAppliedRef.current = false;
  }, [noteId]);

  useEffect(() => {
    if (!editor) return;

    const targetContent = content ?? '';

    // Se o conteúdo recebido é o mesmo que o editor acabou de emitir pelo autosave, não recria o documento
    if (targetContent === lastEmittedContentRef.current) {
      return;
    }

    // Se o usuário já fez edições nesta sessão da nota ou o editor está focado, o editor é a autoridade máxima
    if (hasUserEditedRef.current || editor.isFocused) {
      return;
    }

    // Se o editor ainda estava vazio e recebemos o conteúdo inicial do Storage/IndexedDB:
    const isEditorEmpty = editor.isEmpty || editor.getText().trim() === '';
    if (!initialContentAppliedRef.current && (isEditorEmpty || !lastEmittedContentRef.current)) {
      initialContentAppliedRef.current = true;
      lastEmittedContentRef.current = targetContent;
      editor.commands.setContent(targetContent, { emitUpdate: false });
      normalizeEditorSelection(editor);
      perfProfiler.mark(noteIdentifier, 'T4 - Conteúdo Sincronizado');
    }
  }, [content, editor, noteIdentifier]);

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
