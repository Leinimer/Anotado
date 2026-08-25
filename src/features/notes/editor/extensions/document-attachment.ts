import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { DocumentNodeView } from './DocumentNodeView';

export interface DocumentAttachmentOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    documentAttachment: {
      setDocumentAttachment: (options: {
        src: string;
        name: string;
        size?: number;
        type?: string;
        width?: string;
        alignment?: 'left' | 'center' | 'right';
      }) => ReturnType;
    };
  }
}

function formatBytes(bytes: number, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export const DocumentAttachment = Node.create<DocumentAttachmentOptions>({
  name: 'documentAttachment',
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
        parseHTML: (element) => element.getAttribute('data-src') || element.getAttribute('href'),
        renderHTML: (attributes) => ({
          'data-src': attributes.src,
        }),
      },
      name: {
        default: 'Documento',
        parseHTML: (element) => element.getAttribute('data-name') || 'Documento',
        renderHTML: (attributes) => ({
          'data-name': attributes.name,
        }),
      },
      size: {
        default: 0,
        parseHTML: (element) => Number(element.getAttribute('data-size') || 0),
        renderHTML: (attributes) => ({
          'data-size': attributes.size,
        }),
      },
      type: {
        default: 'application/pdf',
        parseHTML: (element) => element.getAttribute('data-type') || 'application/pdf',
        renderHTML: (attributes) => ({
          'data-type': attributes.type,
        }),
      },
      alignment: {
        default: 'left',
        parseHTML: (element) =>
          element.getAttribute('data-alignment') ||
          element.getAttribute('data-align') ||
          'left',
        renderHTML: (attributes) => ({
          'data-alignment': attributes.alignment || 'left',
        }),
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
            style: `width: ${typeof attributes.width === 'number' ? `${attributes.width}px` : attributes.width}; max-width: 100%;`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="documentAttachment"]',
      },
      {
        tag: 'a.tiptap-document-card',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const name = HTMLAttributes['data-name'] || 'Documento';
    const size = Number(HTMLAttributes['data-size'] || 0);
    const src = HTMLAttributes['data-src'] || '#';
    const isPdf = name.toLowerCase().endsWith('.pdf') || HTMLAttributes['data-type']?.includes('pdf');
    const displaySize = size > 0 ? formatBytes(size) : 'Arquivo anexado';

    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'documentAttachment',
        class: 'tiptap-document-card group',
      }),
      [
        'a',
        {
          href: src,
          target: '_blank',
          rel: 'noopener noreferrer',
          class:
            'flex items-center gap-3 p-3 my-3 bg-[#f5f3ee] hover:bg-[#eae8e3] border border-[#e4e2dd] rounded-xl transition-all max-w-md no-underline text-[#1b1c19]',
        },
        [
          'div',
          {
            class: `w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xs uppercase shrink-0 ${
              isPdf ? 'bg-[#ba1a1a]/10 text-[#ba1a1a]' : 'bg-[#68594d]/10 text-[#68594d]'
            }`,
          },
          isPdf ? 'PDF' : 'DOC',
        ],
        [
          'div',
          { class: 'flex-1 min-w-0' },
          [
            'p',
            { class: 'text-sm font-semibold truncate text-[#1b1c19] m-0 leading-tight font-sans-ui' },
            name,
          ],
          [
            'span',
            { class: 'text-xs text-[#7f756e] font-sans-ui mt-0.5 block' },
            displaySize,
          ],
        ],
        [
          'span',
          {
            class:
              'text-xs text-[#68594d] font-sans-ui font-medium px-2.5 py-1 bg-white border border-[#d1c4bc] rounded-lg group-hover:bg-[#68594d] group-hover:text-white transition-colors shrink-0',
          },
          'Abrir',
        ],
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocumentNodeView);
  },

  addCommands() {
    return {
      setDocumentAttachment:
        (options) =>
        ({ state, dispatch, tr }) => {
          const { schema, selection } = state;
          const type = schema.nodes[this.name];
          if (!type) return false;

          const node = type.create(options);
          if (!node) return false;

          if (selection instanceof NodeSelection) {
            // Se um nó de mídia já estiver selecionado, NÃO o substitui.
            // Insere o novo documento imediatamente após o nó selecionado.
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
