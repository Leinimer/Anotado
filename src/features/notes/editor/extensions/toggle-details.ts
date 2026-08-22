import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ToggleNodeView } from './ToggleNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggleDetails: {
      setToggleDetails: () => ReturnType;
      unsetToggleDetails: () => ReturnType;
      deleteToggleDetails: () => ReturnType;
    };
  }
}

export const ToggleDetails = Node.create({
  name: 'toggleDetails',
  group: 'block',
  content: 'summary detailsContent',
  defining: true,
  isolating: false,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-open') !== 'false' && element.hasAttribute('open'),
        renderHTML: (attributes) => ({
          'data-open': attributes.open ? 'true' : 'false',
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="toggleDetails"]',
      },
      {
        tag: 'div.tiptap-toggle-wrapper',
      },
      {
        tag: 'details.tiptap-toggle',
      },
      {
        tag: 'details',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'toggleDetails',
        class: 'tiptap-toggle-wrapper group/toggle my-3.5',
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleNodeView);
  },

  addCommands() {
    return {
      setToggleDetails:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { open: true },
            content: [
              {
                type: 'summary',
                content: [{ type: 'text', text: 'Item de alternância' }],
              },
              {
                type: 'detailsContent',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Conteúdo recolhível...' }],
                  },
                ],
              },
            ],
          });
        },
      unsetToggleDetails:
        () =>
        ({ commands }) => {
          return commands.lift(this.name);
        },
      deleteToggleDetails:
        () =>
        ({ state, dispatch }) => {
          const { selection } = state;
          let tr = state.tr;
          let found = false;

          state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
            if (node.type.name === 'toggleDetails') {
              tr = tr.delete(pos, pos + node.nodeSize);
              found = true;
              return false;
            }
          });

          if (found && dispatch) {
            dispatch(tr);
            return true;
          }
          return false;
        },
    };
  },
});

export const Summary = Node.create({
  name: 'summary',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [
      { tag: 'div.tiptap-toggle-summary' },
      { tag: 'summary' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class:
          'tiptap-toggle-summary font-serif-note font-semibold text-[#1b1c19] text-base leading-relaxed py-0.5 outline-none',
      }),
      0,
    ];
  },
});

export const DetailsContent = Node.create({
  name: 'detailsContent',
  group: 'block',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [
      { tag: 'div.tiptap-toggle-content' },
      { tag: 'div.details-content' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class:
          'tiptap-toggle-content mt-1 pl-4 sm:pl-5 border-l-2 border-[#e4e2dd] py-1 space-y-1',
      }),
      0,
    ];
  },
});
