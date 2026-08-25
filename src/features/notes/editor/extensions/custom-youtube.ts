import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
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

          if (selection instanceof NodeSelection) {
            // Se um nó de mídia já estiver selecionado, NÃO o substitui.
            // Insere o novo vídeo do YouTube imediatamente após o nó selecionado.
            const insertPos = selection.to;
            tr.insert(insertPos, node);
            try {
              const newSelection = NodeSelection.create(tr.doc, insertPos);
              tr.setSelection(newSelection);
            } catch {
              // fallback seguro
            }
            if (dispatch) dispatch(tr.scrollIntoView());
            return true;
          }

          // Se for cursor de texto ou seleção comum
          const from = selection.from;
          tr.replaceSelectionWith(node);
          try {
            const newSelection = NodeSelection.create(tr.doc, from);
            tr.setSelection(newSelection);
          } catch {
            // fallback seguro
          }
          if (dispatch) dispatch(tr.scrollIntoView());
          return true;
        },
    };
  },
});
