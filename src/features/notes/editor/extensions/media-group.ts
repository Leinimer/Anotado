import { Node, mergeAttributes } from '@tiptap/core';

export interface MediaGroupOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mediaGroup: {
      setMediaGroup: () => ReturnType;
    };
  }
}

export const MediaGroup = Node.create<MediaGroupOptions>({
  name: 'mediaGroup',
  group: 'block',
  content: '(image | youtube | documentAttachment)+',
  draggable: true,
  selectable: true,
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      layout: {
        default: 'row',
        parseHTML: (element) => element.getAttribute('data-layout') || 'row',
        renderHTML: (attributes) => ({
          'data-layout': attributes.layout || 'row',
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-media-group]',
      },
      {
        tag: 'div.media-group-container',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-media-group': '',
        class: 'media-group-container my-4 flex flex-wrap gap-3 items-start w-full transition-all',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setMediaGroup:
        () =>
        ({ commands }) => {
          return commands.wrapIn(this.name);
        },
    };
  },
});
