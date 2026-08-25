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
      },
      {
        tag: 'iframe[src*="youtube.com"]',
      },
      {
        tag: 'iframe[src*="youtu.be"]',
      },
    ];
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

          // 1. Insere o nó de mídia (YouTube)
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

            // 3. Posiciona a TextSelection / cursor no parágrafo seguinte (sem selecionar o vídeo)
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
