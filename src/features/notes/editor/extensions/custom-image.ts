import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { TextSelection, NodeSelection } from '@tiptap/pm/state';
import { ImageNodeView } from './ImageNodeView';

export interface CustomImageOptions {
  inline: boolean;
  allowBase64: boolean;
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customImage: {
      setImage: (options: {
        src: string;
        alt?: string;
        title?: string;
        width?: string | number;
        alignment?: 'left' | 'center' | 'right';
      }) => ReturnType;
    };
  }
}

export const CustomImage = Node.create<CustomImageOptions>({
  name: 'image',
  group: 'block',
  inline: false,
  draggable: true,
  selectable: true,
  atom: true,

  addOptions() {
    return {
      inline: false,
      allowBase64: false,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('src') || element.getAttribute('data-src'),
        renderHTML: (attributes) => ({
          src: attributes.src,
        }),
      },
      alt: {
        default: null,
        parseHTML: (element) => element.getAttribute('alt'),
        renderHTML: (attributes) => ({
          alt: attributes.alt,
        }),
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('title'),
        renderHTML: (attributes) => ({
          title: attributes.title,
        }),
      },
      alignment: {
        default: 'center',
        parseHTML: (element) =>
          element.getAttribute('data-alignment') ||
          element.getAttribute('data-align') ||
          element.getAttribute('align') ||
          'center',
        renderHTML: (attributes) => ({
          'data-alignment': attributes.alignment || 'center',
        }),
      },
      width: {
        default: '50%',
        parseHTML: (element) =>
          element.getAttribute('data-width') ||
          element.getAttribute('width') ||
          element.style?.width ||
          null,
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          const w = typeof attributes.width === 'number' ? `${attributes.width}px` : attributes.width;
          return {
            'data-width': w,
            style: `width: ${w}; max-width: 100%; height: auto;`,
          };
        },
      },
      height: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-height') ||
          element.getAttribute('height') ||
          element.style?.height ||
          null,
        renderHTML: (attributes) => {
          if (!attributes.height) return {};
          return {
            'data-height': attributes.height,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (element: HTMLElement | string) => {
          if (typeof element === 'string') return {};
          return {
            src: element.getAttribute('src') || element.getAttribute('data-src'),
            alt: element.getAttribute('alt'),
            title: element.getAttribute('title'),
            alignment:
              element.getAttribute('data-alignment') ||
              element.getAttribute('data-align') ||
              element.getAttribute('align') ||
              'center',
            width:
              element.getAttribute('data-width') ||
              element.getAttribute('width') ||
              element.style?.width ||
              null,
            height:
              element.getAttribute('data-height') ||
              element.getAttribute('height') ||
              element.style?.height ||
              null,
          };
        },
      },
      {
        tag: 'img[data-src]',
        getAttrs: (element: HTMLElement | string) => {
          if (typeof element === 'string') return {};
          return {
            src: element.getAttribute('data-src') || element.getAttribute('src'),
            alt: element.getAttribute('alt'),
            title: element.getAttribute('title'),
            alignment:
              element.getAttribute('data-alignment') ||
              element.getAttribute('data-align') ||
              element.getAttribute('align') ||
              'center',
            width:
              element.getAttribute('data-width') ||
              element.getAttribute('width') ||
              element.style?.width ||
              null,
            height:
              element.getAttribute('data-height') ||
              element.getAttribute('height') ||
              element.style?.height ||
              null,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'rounded-xl max-w-full my-4 border border-[#e4e2dd] shadow-xs',
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const attrs: string[] = [];
          if (node.attrs.src) attrs.push(`src="${node.attrs.src}"`);
          if (node.attrs.alt) attrs.push(`alt="${node.attrs.alt}"`);
          if (node.attrs.title) attrs.push(`title="${node.attrs.title}"`);
          if (node.attrs.alignment) attrs.push(`data-alignment="${node.attrs.alignment}"`);
          if (node.attrs.width) {
            const w = typeof node.attrs.width === 'number' ? `${node.attrs.width}px` : node.attrs.width;
            attrs.push(`data-width="${w}"`);
            attrs.push(`style="width: ${w}; max-width: 100%;"`);
          }
          if (node.attrs.height) {
            attrs.push(`data-height="${node.attrs.height}"`);
          }
          state.write(`<img ${attrs.join(' ')} />`);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ state, dispatch, tr }) => {
          const { schema, selection } = state;
          const type = schema.nodes[this.name];
          if (!type) return false;

          const nodeAttrs = {
            width: '50%',
            alignment: 'center',
            ...options,
          };
          const node = type.create(nodeAttrs);
          if (!node) return false;

          const paragraphType = schema.nodes.paragraph;

          if (selection instanceof NodeSelection) {
            // Se um nó de mídia já estiver selecionado, NÃO o substitui.
            // Insere o novo nó imediatamente após o selecionado.
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
            // Se o cursor estiver em um parágrafo vazio, substitui o parágrafo vazio pelo nó de mídia
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
