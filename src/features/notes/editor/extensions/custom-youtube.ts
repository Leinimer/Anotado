import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { YoutubeNodeView } from './YoutubeNodeView';
import { insertMediaNode } from '../utils/node-movement';

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
        default: '50%',
        parseHTML: (element) => element.getAttribute('data-width') || element.style.width || '50%',
        renderHTML: (attributes) => ({
          'data-width': attributes.width || '50%',
          style: `width: ${attributes.width || '50%'}; max-width: 100%; aspect-ratio: 16/9;`,
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
          const type = state.schema.nodes[this.name];
          if (!type) return false;

          const node = type.create(options);
          if (!node) return false;

          return insertMediaNode(tr, state, node, dispatch);
        },
    };
  },
});
