import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { TextSelection, NodeSelection } from '@tiptap/pm/state';
import { YoutubeNodeView } from './YoutubeNodeView';

export interface CustomYoutubeOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customYoutube: {
      setYoutubeVideo: (options: { src: string; width?: string; alignment?: 'left' | 'center' | 'right' }) => ReturnType;
    };
  }
}

export const CustomYoutube = Node.create<CustomYoutubeOptions>({
  name: 'youtube',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('src') || element.getAttribute('data-youtube-video'),
        renderHTML: (attributes) => ({
          src: attributes.src,
          'data-youtube-video': attributes.src,
        }),
      },
      alignment: {
        default: 'center',
        parseHTML: (element) =>
          element.getAttribute('data-alignment') ||
          element.getAttribute('data-align') ||
          'center',
        renderHTML: (attributes) => ({
          'data-alignment': attributes.alignment || 'center',
        }),
      },
      width: {
        default: '100%',
        parseHTML: (element) => element.getAttribute('data-width') || element.style.width || '100%',
        renderHTML: (attributes) => ({
          'data-width': attributes.width,
          style: `width: ${attributes.width}; max-width: 100%; aspect-ratio: 16/9;`,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-youtube-video]',
        getAttrs: (element: HTMLElement | string) => {
          if (typeof element === 'string') return {};
          return {
            src: element.getAttribute('data-youtube-video') || element.getAttribute('src'),
            alignment:
              element.getAttribute('data-alignment') ||
              element.getAttribute('data-align') ||
              'center',
            width:
              element.getAttribute('data-width') ||
              element.getAttribute('width') ||
              element.style?.width ||
              '100%',
          };
        },
      },
      {
        tag: 'iframe[src*="youtube.com"]',
        getAttrs: (element: HTMLElement | string) => {
          if (typeof element === 'string') return {};
          return {
            src: element.getAttribute('src'),
            alignment: 'center',
            width: element.getAttribute('width') || '100%',
          };
        },
      },
      {
        tag: 'iframe[src*="youtu.be"]',
        getAttrs: (element: HTMLElement | string) => {
          if (typeof element === 'string') return {};
          return {
            src: element.getAttribute('src'),
            alignment: 'center',
            width: element.getAttribute('width') || '100%',
          };
        },
      },
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const attrs: string[] = [];
          if (node.attrs.src) attrs.push(`data-youtube-video="${node.attrs.src}" src="${node.attrs.src}"`);
          if (node.attrs.alignment) attrs.push(`data-alignment="${node.attrs.alignment}"`);
          if (node.attrs.width) {
            const w = typeof node.attrs.width === 'number' ? `${node.attrs.width}px` : node.attrs.width;
            attrs.push(`data-width="${w}"`);
            attrs.push(`style="width: ${w}; max-width: 100%; aspect-ratio: 16/9;"`);
          }
          state.write(`<div ${attrs.join(' ')}></div>`);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-youtube-video': HTMLAttributes.src,
        class: 'tiptap-youtube-wrapper my-4 flex justify-center',
      }),
      [
        'iframe',
        {
          src: HTMLAttributes.src,
          frameborder: '0',
          allowfullscreen: 'true',
          class: 'rounded-2xl w-full shadow-xs',
        },
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(YoutubeNodeView);
  },

  addCommands() {
    return {
      setYoutubeVideo:
        (options) =>
        ({ state, dispatch, tr }) => {
          const { schema, selection } = state;
          const type = schema.nodes[this.name];
          if (!type) return false;

          const node = type.create(options);
          if (!node) return false;

          const paragraphType = schema.nodes.paragraph;

          if (selection instanceof NodeSelection) {
            // Se um nó de mídia já estiver selecionado, NÃO o substitui.
            // Insere o novo vídeo do YouTube imediatamente após o nó selecionado.
            const insertPos = selection.to;
            tr.insert(insertPos, node);
            const afterMediaPos = insertPos + node.nodeSize;
            if (paragraphType) {
              const emptyParagraph = paragraphType.create();
              tr.insert(afterMediaPos, emptyParagraph);
              try {
                const textCursorPos = Math.min(afterMediaPos + 1, tr.doc.content.size);
                tr.setSelection(TextSelection.create(tr.doc, textCursorPos));
              } catch {}
            }
            if (dispatch) dispatch(tr.scrollIntoView());
            return true;
          }

          if (selection.$from.parent.isTextblock && selection.$from.parent.content.size === 0) {
            // Se o cursor estiver em um parágrafo vazio, substitui o parágrafo vazio pelo vídeo
            const startPos = selection.$from.before();
            const endPos = selection.$from.after();
            tr.replaceWith(startPos, endPos, node);
            const afterMediaPos = startPos + node.nodeSize;
            if (paragraphType) {
              const emptyParagraph = paragraphType.create();
              tr.insert(afterMediaPos, emptyParagraph);
              try {
                const textCursorPos = Math.min(afterMediaPos + 1, tr.doc.content.size);
                tr.setSelection(TextSelection.create(tr.doc, textCursorPos));
              } catch {}
            }
            if (dispatch) dispatch(tr.scrollIntoView());
            return true;
          }

          // Se houver seleção de texto não-vazia, remove o texto selecionado primeiro
          let insertPos = selection.to;
          if (!selection.empty) {
            tr.deleteSelection();
            insertPos = tr.selection.from;
          } else {
            insertPos = selection.from;
          }

          tr.insert(insertPos, node);
          const afterMediaPos = insertPos + node.nodeSize;

          if (paragraphType) {
            const emptyParagraph = paragraphType.create();
            tr.insert(afterMediaPos, emptyParagraph);
            try {
              const textCursorPos = Math.min(afterMediaPos + 1, tr.doc.content.size);
              tr.setSelection(TextSelection.create(tr.doc, textCursorPos));
            } catch {}
          }

          if (dispatch) {
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },
});
