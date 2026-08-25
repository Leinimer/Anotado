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
      allowBase64: true,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('src'),
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
        renderHTML: (attributes) => {
          return {
            'data-alignment': attributes.alignment || 'center',
          };
        },
      },
      width: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-width') ||
          element.getAttribute('width') ||
          element.style.width ||
          null,
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return {
            'data-width': attributes.width,
            style: `width: ${typeof attributes.width === 'number' ? `${attributes.width}px` : attributes.width}; max-width: 100%; height: auto;`,
          };
        },
      },
      height: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-height') ||
          element.getAttribute('height') ||
          element.style.height ||
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

          const node = type.create(options);
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
