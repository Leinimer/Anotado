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

          // Determina a posição de inserção garantindo que nenhum nó de mídia selecionado seja substituído
          let insertPos = selection.to;
          if (!(selection instanceof NodeSelection)) {
            // Se houver uma seleção de texto não-vazia, remove o texto selecionado primeiro
            if (!selection.empty) {
              tr.deleteSelection();
              insertPos = tr.selection.from;
            } else {
              insertPos = selection.from;
            }
          }

          // 1. Insere o nó de mídia
          tr.insert(insertPos, node);
          const afterMediaPos = insertPos + node.nodeSize;

          // 2. Garante que exista um parágrafo vazio editável imediatamente após a mídia
          const paragraphType = schema.nodes.paragraph;
          if (paragraphType) {
            const nextNode = tr.doc.nodeAt(afterMediaPos);
            // Se o próximo bloco não for um parágrafo vazio, cria um novo parágrafo
            if (!nextNode || nextNode.type.name !== 'paragraph' || nextNode.content.size > 0) {
              const emptyParagraph = paragraphType.create();
              tr.insert(afterMediaPos, emptyParagraph);
            }

            // 3. Posiciona a TextSelection / cursor no parágrafo seguinte (sem selecionar a imagem)
            try {
              const textCursorPos = Math.min(afterMediaPos + 1, tr.doc.content.size);
              const nextSelection = TextSelection.create(tr.doc, textCursorPos);
              tr.setSelection(nextSelection);
            } catch {
              // fallback seguro
            }
          }

          if (dispatch) {
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },
});
