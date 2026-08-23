import { Node, mergeAttributes, findParentNode } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    details: {
      setDetails: () => ReturnType;
      unsetDetails: () => ReturnType;
    };
  }
}

/**
 * Extensão oficial Details (Toggle Notion-Like) para o Design System Papyrus & Ink.
 *
 * Estrutura:
 * - Details (Node container 'details' com estado 'open: true/false')
 * - DetailsSummary (Node 'detailsSummary' editável)
 * - DetailsContent (Node 'detailsContent' suportando blocos, listas, mídias e toggles aninhados)
 */

export const Details = Node.create({
  name: 'details',
  group: 'block',
  content: 'detailsSummary detailsContent',
  defining: true,
  isolating: true,
  draggable: true,
  allowGapCursor: false,

  addOptions() {
    return {
      persist: true,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => {
          const dataOpen = element.getAttribute('data-open');
          if (dataOpen === 'true') return true;
          if (dataOpen === 'false') return false;
          if (element.hasAttribute('open')) return true;
          return true;
        },
        renderHTML: (attributes) => {
          if (!attributes.open) {
            return { 'data-open': 'false' };
          }
          return { open: '', 'data-open': 'true' };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'details' },
      { tag: 'div[data-type="details"]' },
      { tag: 'div[data-type="toggleDetails"]' },
      { tag: 'div.tiptap-toggle-wrapper' },
      { tag: 'div.tiptap-details-node' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'details',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'details',
        class: 'tiptap-details-node group/details my-2.5',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setDetails:
        () =>
        ({ state, chain }) => {
          const { selection } = state;
          const { empty, $from, $to } = selection;

          // Se houver texto ou blocos selecionados
          if (!empty) {
            const range = $from.blockRange($to);
            if (range) {
              const slice = state.doc.slice(range.start, range.end);
              const sliceContent = slice.toJSON()?.content || [];

              let summaryText = 'Item de alternância';
              let bodyContent = sliceContent;

              if (sliceContent.length > 0 && sliceContent[0].type === 'paragraph') {
                const firstPara = sliceContent[0];
                const text = firstPara.content?.map((c: { text?: string }) => c.text || '').join('') || '';
                if (text.trim()) {
                  summaryText = text;
                  bodyContent = sliceContent.slice(1);
                  if (bodyContent.length === 0) {
                    bodyContent = [{ type: 'paragraph', content: [] }];
                  }
                }
              }

              return chain()
                .insertContentAt(
                  { from: range.start, to: range.end },
                  {
                    type: 'details',
                    attrs: { open: true },
                    content: [
                      {
                        type: 'detailsSummary',
                        content: [{ type: 'text', text: summaryText }],
                      },
                      {
                        type: 'detailsContent',
                        content: bodyContent.length ? bodyContent : [{ type: 'paragraph', content: [] }],
                      },
                    ],
                  }
                )
                .setTextSelection(range.start + 2)
                .focus()
                .run();
            }
          }

          // Se a seleção estiver vazia (posição normal do cursor)
          const parentIsParagraph = $from.parent.type.name === 'paragraph';
          const parentIsEmpty = parentIsParagraph && $from.parent.content.size === 0;

          const newToggleNode = {
            type: 'details',
            attrs: { open: true },
            content: [
              {
                type: 'detailsSummary',
                content: [{ type: 'text', text: 'Item de alternância' }],
              },
              {
                type: 'detailsContent',
                content: [
                  {
                    type: 'paragraph',
                    content: [],
                  },
                ],
              },
            ],
          };

          if (parentIsEmpty) {
            const from = $from.before();
            const to = $from.after();
            return chain()
              .insertContentAt({ from, to }, newToggleNode)
              .setTextSelection(from + 2)
              .focus()
              .run();
          }

          return chain()
            .insertContent(newToggleNode)
            .focus()
            .run();
        },

      unsetDetails:
        () =>
        ({ state, chain }) => {
          const { selection } = state;
          const details = findParentNode((node) => node.type.name === 'details')(selection);
          if (!details) return false;

          const detailsNode = details.node;
          const summaryNode = detailsNode.child(0);
          const contentNode = detailsNode.child(1);

          const summaryText = summaryNode.textContent;
          const paragraphs = [
            ...(summaryText ? [{ type: 'paragraph', content: [{ type: 'text', text: summaryText }] }] : []),
            ...(contentNode.toJSON()?.content || []),
          ];

          return chain()
            .insertContentAt(
              { from: details.pos, to: details.pos + detailsNode.nodeSize },
              paragraphs.length ? paragraphs : [{ type: 'paragraph', content: [] }]
            )
            .setTextSelection(details.pos + 1)
            .run();
        },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.classList.add('tiptap-details-node', 'group/details');
      dom.setAttribute('data-type', 'details');

      let isOpen = Boolean(node.attrs.open ?? true);
      dom.setAttribute('data-open', isOpen ? 'true' : 'false');
      if (isOpen) {
        dom.classList.add('is-open');
      }

      const controls = document.createElement('div');
      controls.className = 'tiptap-details-controls';
      controls.setAttribute('contenteditable', 'false');

      // Botão da Seta (Toggle + Drag Handle)
      const toggleBtn = document.createElement('button');
      toggleBtn.setAttribute('type', 'button');
      toggleBtn.setAttribute('contenteditable', 'false');
      toggleBtn.setAttribute('tabindex', '0');
      toggleBtn.setAttribute('data-drag-handle', '');
      toggleBtn.className = 'tiptap-details-toggle-btn';

      // Botão da Lixeira Contextual (Exclusão Direta via ProseMirror)
      const deleteBtn = document.createElement('button');
      deleteBtn.setAttribute('type', 'button');
      deleteBtn.setAttribute('contenteditable', 'false');
      deleteBtn.setAttribute('draggable', 'false');
      deleteBtn.setAttribute('tabindex', '0');
      deleteBtn.setAttribute('aria-label', 'Excluir bloco de alternância');
      deleteBtn.setAttribute('title', 'Excluir bloco de alternância');
      deleteBtn.className = 'tiptap-details-delete-btn';
      deleteBtn.innerHTML = `<svg class="w-3.5 h-3.5 stroke-[2] text-[#ba1a1a]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;

      const updateButtonVisuals = (openState: boolean) => {
        toggleBtn.setAttribute('aria-expanded', openState ? 'true' : 'false');
        toggleBtn.setAttribute(
          'aria-label',
          openState ? 'Recolher Bloco (ou segurar para arrastar)' : 'Expandir Bloco (ou segurar para arrastar)'
        );
        toggleBtn.setAttribute(
          'title',
          openState ? 'Recolher Bloco (ou segurar para arrastar)' : 'Expandir Bloco (ou segurar para arrastar)'
        );

        // Seta: ▾ quando aberto, > quando fechado
        if (openState) {
          toggleBtn.innerHTML = `<svg class="w-3.5 h-3.5 stroke-[2.5] text-[#68594d]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
        } else {
          toggleBtn.innerHTML = `<svg class="w-3.5 h-3.5 stroke-[2.5] text-[#7f756e]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
        }
      };

      updateButtonVisuals(isOpen);

      // Controle de clique vs arrasto (Drag-and-Drop)
      let isDragging = false;

      toggleBtn.addEventListener('mousedown', () => {
        isDragging = false;
      });

      toggleBtn.addEventListener('dragstart', () => {
        isDragging = true;
      });

      toggleBtn.addEventListener('dragend', () => {
        setTimeout(() => {
          isDragging = false;
        }, 100);
      });

      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Se ocorreu arrasto, não executa o toggle
        if (isDragging) {
          return;
        }

        if (typeof getPos === 'function') {
          const pos = getPos();
          if (typeof pos === 'number') {
            const { tr } = editor.state;
            const currentNode = tr.doc.nodeAt(pos);
            if (currentNode && currentNode.type.name === 'details') {
              const currentOpen = Boolean(currentNode.attrs.open);
              const nextOpen = !currentOpen;
              tr.setNodeMarkup(pos, undefined, {
                ...currentNode.attrs,
                open: nextOpen,
              });
              editor.view.dispatch(tr);
            }
          }
        }
      });

      // Eventos da Lixeira: Impede propagação de drag e executa exclusão do node inteiro
      deleteBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });

      deleteBtn.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (typeof getPos === 'function') {
          const pos = getPos();
          if (typeof pos === 'number') {
            const { tr } = editor.state;
            const currentNode = tr.doc.nodeAt(pos);
            if (currentNode && currentNode.type.name === 'details') {
              tr.delete(pos, pos + currentNode.nodeSize);
              editor.view.dispatch(tr);
            }
          }
        }
      });

      controls.appendChild(deleteBtn);
      controls.appendChild(toggleBtn);
      dom.appendChild(controls);

      const innerContent = document.createElement('div');
      innerContent.className = 'tiptap-details-inner';
      dom.appendChild(innerContent);

      return {
        dom,
        contentDOM: innerContent,
        ignoreMutation(mutation) {
          if (mutation.type === 'selection') return false;
          const target = mutation.target as unknown as globalThis.Node;
          return controls.contains(target) || target === controls;
        },
        update(updatedNode) {
          if (updatedNode.type.name !== 'details') return false;
          const newOpen = Boolean(updatedNode.attrs.open ?? true);
          if (newOpen !== isOpen) {
            isOpen = newOpen;
            dom.setAttribute('data-open', isOpen ? 'true' : 'false');
            if (isOpen) {
              dom.classList.add('is-open');
            } else {
              dom.classList.remove('is-open');
            }
            updateButtonVisuals(isOpen);
          }
          return true;
        },
      };
    };
  },
});

export const DetailsSummary = Node.create({
  name: 'detailsSummary',
  content: 'inline*',
  defining: true,
  isolating: true,
  selectable: false,

  parseHTML() {
    return [
      { tag: 'summary' },
      { tag: 'div.tiptap-toggle-summary' },
      { tag: 'div[data-type="detailsSummary"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'summary',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class:
          'tiptap-details-summary font-serif-note font-semibold text-[#1b1c19] text-base sm:text-lg leading-relaxed outline-none cursor-text select-text block min-h-[1.5em]',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        const { $from, empty } = selection;
        if (!empty || $from.parent.type.name !== this.name) {
          return false;
        }

        const detailsNode = $from.node(-1);
        if (!detailsNode || detailsNode.type.name !== 'details') {
          return false;
        }

        if (!detailsNode.attrs.open) {
          const parentPos = $from.before(-1);
          const tr = state.tr.setNodeMarkup(parentPos, undefined, {
            ...detailsNode.attrs,
            open: true,
          });
          view.dispatch(tr);
        }

        const afterSummary = $from.after();
        const $target = state.doc.resolve(afterSummary + 1);
        const nextSelection = Selection.near($target, 1);
        const tr = state.tr.setSelection(nextSelection);
        view.dispatch(tr);
        return true;
      },
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { empty, $anchor } = selection;
        if (!empty || $anchor.parent.type.name !== this.name) {
          return false;
        }
        if ($anchor.parentOffset === 0 && $anchor.parent.textContent.length === 0) {
          return editor.commands.unsetDetails();
        }
        return false;
      },
    };
  },
});

export const DetailsContent = Node.create({
  name: 'detailsContent',
  content: 'block+',
  defining: true,
  selectable: false,

  parseHTML() {
    return [
      { tag: 'div[data-type="detailsContent"]' },
      { tag: 'div.tiptap-toggle-content' },
      { tag: 'div.details-content' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'detailsContent',
        class:
          'tiptap-details-content mt-1 pl-4 sm:pl-5 border-l-2 border-[#e4e2dd] py-1 space-y-1',
      }),
      0,
    ];
  },
});
