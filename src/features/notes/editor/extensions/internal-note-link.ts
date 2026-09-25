import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface InternalNoteLinkOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    internalNoteLink: {
      setInternalNoteLink: (attributes: { noteId: string }) => ReturnType;
      unsetInternalNoteLink: () => ReturnType;
      toggleInternalNoteLink: (attributes: { noteId: string }) => ReturnType;
    };
  }
}

/**
 * Extensão Tiptap Mark para referências internas canônicas entre notas do ANOTADO.
 * Armazena exclusivamente o UUID imutável da nota de destino (noteId),
 * garantindo que a referência continue funcionando mesmo que a nota seja renomeada.
 */
export const InternalNoteLink = Mark.create<InternalNoteLinkOptions>({
  name: 'internalNoteLink',
  inclusive: false,
  priority: 1000,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-note-id') ||
          element.getAttribute('data-internal-note-id') ||
          (element.getAttribute('href') || '').replace(/^note:/, '').replace(/^\/\//, ''),
        renderHTML: (attributes) => {
          if (!attributes.noteId) return {};
          return {
            'data-note-id': attributes.noteId,
            'data-internal-note-id': attributes.noteId,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-internal-note-id]',
      },
      {
        tag: 'a[data-note-id]',
      },
      {
        tag: 'span[data-internal-note-id]',
      },
      {
        tag: 'span[data-note-id]',
      },
      {
        tag: 'a[href^="note:"]',
        getAttrs: (element) => {
          const el = element as HTMLElement;
          const href = el.getAttribute('href') || '';
          const noteId = href.replace(/^note:/, '').replace(/^\/\//, '');
          return { noteId };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class:
          'internal-note-link cursor-pointer font-bold underline decoration-current underline-offset-2 hover:opacity-80 transition-opacity bg-transparent select-text',
        href: '#',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setInternalNoteLink:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes);
        },
      unsetInternalNoteLink:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
      toggleInternalNoteLink:
        (attributes) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, attributes);
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('internalNoteLinkClickHandler'),
        props: {
          handleClick: (_view, _pos, event) => {
            const target = event.target as HTMLElement | null;
            const linkEl = target?.closest(
              '[data-internal-note-id], [data-note-id], .internal-note-link, a[href^="note:"]'
            );
            if (linkEl) {
              const noteId =
                linkEl.getAttribute('data-internal-note-id') ||
                linkEl.getAttribute('data-note-id') ||
                (linkEl.getAttribute('href') || '').replace(/^note:/, '').replace(/^\/\//, '');
              if (noteId && noteId !== '#') {
                event.preventDefault();
                event.stopPropagation();
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(
                    new CustomEvent('anotado:navigate-internal-note', {
                      detail: { noteId },
                    })
                  );
                }
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: any, mark: any) => `<a data-internal-note-id="${mark.attrs.noteId}">`,
          close: '</a>',
        },
      },
    };
  },
});
