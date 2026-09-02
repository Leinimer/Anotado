import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DocumentNodeView } from './DocumentNodeView';
import { formatBytes } from '../utils/media-common';
import { insertMediaNode } from '../utils/node-movement';

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
        parseHTML: (element) =>
          element.getAttribute('data-src') ||
          element.getAttribute('href') ||
          element.getAttribute('src'),
        renderHTML: (attributes) => ({
          'data-src': attributes.src,
        }),
      },
      name: {
        default: 'Documento',
        parseHTML: (element) => {
          let rawName = element.getAttribute('data-name') || element.textContent || 'Documento';
          try {
            if (rawName.includes('%')) rawName = decodeURIComponent(rawName);
          } catch {}
          return rawName;
        },
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
        parseHTML: (element) =>
          element.getAttribute('data-type-mime') ||
          element.getAttribute('data-type') ||
          'application/pdf',
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
            style: `width: ${w}; max-width: 100%;`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="documentAttachment"]',
        getAttrs: (element: HTMLElement | string) => {
          if (typeof element === 'string') return {};
          let rawName = element.getAttribute('data-name') || 'Documento';
          try {
            if (rawName.includes('%')) rawName = decodeURIComponent(rawName);
          } catch {}
          return {
            src: element.getAttribute('data-src') || element.getAttribute('href') || element.getAttribute('src'),
            name: rawName,
            size: Number(element.getAttribute('data-size') || 0),
            type: element.getAttribute('data-type-mime') || element.getAttribute('data-type') || 'application/pdf',
            alignment:
              element.getAttribute('data-alignment') ||
              element.getAttribute('data-align') ||
              'left',
            width:
              element.getAttribute('data-width') ||
              element.getAttribute('width') ||
              element.style?.width ||
              null,
          };
        },
      },
      {
        tag: 'a.tiptap-document-card',
        getAttrs: (element: HTMLElement | string) => {
          if (typeof element === 'string') return {};
          return {
            src: element.getAttribute('href') || element.getAttribute('data-src'),
            name: element.getAttribute('data-name') || element.textContent || 'Documento',
            size: Number(element.getAttribute('data-size') || 0),
            type: element.getAttribute('data-type') || 'application/pdf',
            alignment: element.getAttribute('data-alignment') || 'left',
            width: element.getAttribute('data-width') || null,
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
          attrs.push('data-type="documentAttachment"');
          if (node.attrs.src) attrs.push(`data-src="${node.attrs.src}"`);
          if (node.attrs.name) attrs.push(`data-name="${encodeURIComponent(node.attrs.name)}"`);
          if (node.attrs.size) attrs.push(`data-size="${node.attrs.size}"`);
          if (node.attrs.type) attrs.push(`data-type-mime="${node.attrs.type}"`);
          if (node.attrs.alignment) attrs.push(`data-alignment="${node.attrs.alignment}"`);
          if (node.attrs.width) {
            const w = typeof node.attrs.width === 'number' ? `${node.attrs.width}px` : node.attrs.width;
            attrs.push(`data-width="${w}"`);
            attrs.push(`style="width: ${w}; max-width: 100%;"`);
          }
          state.write(`<div ${attrs.join(' ')}></div>`);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
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
          const type = state.schema.nodes[this.name];
          if (!type) return false;

          const nodeAttrs = {
            width: '50%',
            alignment: 'left',
            ...options,
          };
          const node = type.create(nodeAttrs);
          if (!node) return false;

          return insertMediaNode(tr, state, node, dispatch);
        },
    };
  },
});
