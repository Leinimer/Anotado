'use client';

import TaskItem from '@tiptap/extension-task-item';
import { wrappingInputRule, getRenderedAttributes } from '@tiptap/core';

const visuallyHiddenStyle =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';

/**
 * Extensão aprimorada de TaskItem para o ANOTADO!.
 *
 * Garante:
 * 1. Pressionar Enter em um item com texto cria um novo TaskItem (com checked: false).
 * 2. Pressionar Enter em um TaskItem vazio sai da checklist criando um parágrafo normal
 *    (ou sobe um nível se for aninhado), SEM NUNCA criar bulletList ou inserir '[ ]'.
 * 3. Suporta input rules nativas para '[ ] ', '[x] ', '- [ ] ', '- [x] ', '* [ ] ', '* [x] '.
 * 4. Ao tocar/clicar no checkbox (especialmente no mobile/touch):
 *    - Marca/desmarca instantaneamente sem disparar focus() no editor.
 *    - NÃO coloca o cursor no texto.
 *    - NÃO cria uma seleção de texto.
 *    - NÃO foca o editor.
 *    - NÃO abre o teclado virtual no celular.
 *    - NÃO altera a posição da tela nem move o scroll.
 *    - Preserva perfeitamente o salvamento automático e a sincronização.
 */
export const CustomTaskItem = TaskItem.extend({
  name: 'taskItem',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        const { $from, empty } = selection;

        // Identifica se estamos dentro de um taskItem
        let taskItemDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'taskItem') {
            taskItemDepth = d;
            break;
          }
        }

        if (taskItemDepth === -1) {
          return false;
        }

        const taskItemNode = $from.node(taskItemDepth);
        const parentNode = $from.node(taskItemDepth - 1);
        const isBulletList = editor.isActive('bulletList');
        const isItemEmpty = taskItemNode.textContent.trim().length === 0;

        // CASO 2: O item atual está vazio e o usuário pressiona Enter novamente
        // Comportamento padrão esperado: sair da checklist e criar um parágrafo normal abaixo.
        if (isItemEmpty) {
          const lifted = editor.commands.liftListItem('taskItem');
          if (lifted) {
            return true;
          }

          // Fallback seguro: se lift falhar, desfaz o taskList para parágrafo normal
          return editor.chain().focus().toggleTaskList().run();
        }

        // CASO 1: O item possui texto.
        // Divide o item atual criando um novo TaskItem desmarcado (checked: false).
        return editor.commands.splitListItem('taskItem', { checked: false });
      },

      'Shift-Tab': () => this.editor.commands.liftListItem(this.name),

      Tab: () => {
        if (!this.options.nested) return false;
        return this.editor.commands.sinkListItem(this.name);
      },
    };
  },

  addNodeView() {
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const listItem = document.createElement('li');
      const checkboxWrapper = document.createElement('label');
      const checkboxStyler = document.createElement('span');
      const checkbox = document.createElement('input');
      const content = document.createElement('div');

      checkboxStyler.style.cssText = visuallyHiddenStyle;

      const updateA11Y = (currentNode: { textContent?: string }) => {
        const label = currentNode.textContent ? `Task item: ${currentNode.textContent}` : 'Empty task item';
        checkbox.setAttribute('aria-label', label);
        checkboxStyler.textContent = label;
      };

      updateA11Y(node);

      checkboxWrapper.contentEditable = 'false';
      checkbox.contentEditable = 'false';
      checkbox.type = 'checkbox';
      checkbox.tabIndex = -1;

      let lastToggleTimestamp = 0;

      const performToggle = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();

        const now = Date.now();
        if (now - lastToggleTimestamp < 250) {
          return;
        }
        lastToggleTimestamp = now;

        // Se algum elemento estiver com foco no momento (ex: teclado do celular aberto), remove o foco para evitar salto de tela
        if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
          document.activeElement.blur();
        }

        // Garante que nenhuma seleção acidental de texto ocorra
        if (typeof window !== 'undefined' && window.getSelection) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
            sel.removeAllRanges();
          }
        }

        if (typeof getPos !== 'function') return;
        const position = getPos();
        if (typeof position !== 'number') return;

        const { state, view } = editor;
        const currentNode = state.doc.nodeAt(position);
        if (!currentNode) return;

        const nextChecked = !currentNode.attrs.checked;

        if (!editor.isEditable && !this.options.onReadOnlyChecked) {
          checkbox.checked = !nextChecked;
          return;
        }

        if (editor.isEditable) {
          checkbox.checked = nextChecked;
          listItem.dataset.checked = String(nextChecked);

          const tr = state.tr.setNodeMarkup(position, undefined, {
            ...currentNode.attrs,
            checked: nextChecked,
          });

          // Não focar nem alterar a seleção, preservando a posição do scroll e evitando o teclado virtual
          tr.setMeta('addToHistory', true);
          view.dispatch(tr);
        } else if (this.options.onReadOnlyChecked) {
          if (!this.options.onReadOnlyChecked(currentNode, nextChecked)) {
            checkbox.checked = !nextChecked;
            listItem.dataset.checked = String(!nextChecked);
          }
        }
      };

      const stopAndPrevent = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
      };

      // Interceptadores para evitar que o clique/toque no checkbox passe para o ProseMirror
      // e force foco ou seleção de texto (evitando abrir o teclado virtual no mobile)
      checkboxWrapper.addEventListener('mousedown', stopAndPrevent);
      checkboxWrapper.addEventListener('touchstart', stopAndPrevent, { passive: false });
      checkboxWrapper.addEventListener('pointerdown', stopAndPrevent);
      checkboxWrapper.addEventListener('touchend', performToggle);
      checkboxWrapper.addEventListener('click', performToggle);

      checkbox.addEventListener('mousedown', stopAndPrevent);
      checkbox.addEventListener('touchstart', stopAndPrevent, { passive: false });
      checkbox.addEventListener('pointerdown', stopAndPrevent);
      checkbox.addEventListener('touchend', performToggle);
      checkbox.addEventListener('click', performToggle);
      checkbox.addEventListener('change', performToggle);

      Object.entries(this.options.HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, value as string);
      });

      listItem.dataset.checked = String(node.attrs.checked);
      checkbox.checked = !!node.attrs.checked;

      checkboxWrapper.append(checkbox, checkboxStyler);
      listItem.append(checkboxWrapper, content);

      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, value as string);
      });

      let prevRenderedAttributeKeys = new Set(Object.keys(HTMLAttributes));

      return {
        dom: listItem,
        contentDOM: content,
        update: (updatedNode) => {
          if (updatedNode.type !== this.type) {
            return false;
          }

          listItem.dataset.checked = String(updatedNode.attrs.checked);
          checkbox.checked = !!updatedNode.attrs.checked;
          updateA11Y(updatedNode);

          const extensionAttributes = editor.extensionManager.attributes;
          const newHTMLAttributes = getRenderedAttributes(updatedNode, extensionAttributes);
          const newKeys = new Set(Object.keys(newHTMLAttributes));
          const staticAttrs = this.options.HTMLAttributes;

          prevRenderedAttributeKeys.forEach((key) => {
            if (!newKeys.has(key)) {
              if (key in staticAttrs) {
                listItem.setAttribute(key, staticAttrs[key] as string);
              } else {
                listItem.removeAttribute(key);
              }
            }
          });

          Object.entries(newHTMLAttributes).forEach(([key, value]) => {
            if (value === null || value === undefined) {
              if (key in staticAttrs) {
                listItem.setAttribute(key, staticAttrs[key] as string);
              } else {
                listItem.removeAttribute(key);
              }
            } else {
              listItem.setAttribute(key, value as string);
            }
          });

          prevRenderedAttributeKeys = newKeys;
          return true;
        },
      };
    };
  },

  addInputRules() {
    return [
      // Regra 1: [ ] ou [x] ou [X] no início da linha
      wrappingInputRule({
        find: /^\s*(\[([ |x|X])?\])\s$/,
        type: this.type,
        getAttributes: (match) => ({
          checked: match[2]?.toLowerCase() === 'x',
        }),
      }),
      // Regra 2: - [ ] ou - [x] ou * [ ] ou * [x] no início da linha
      wrappingInputRule({
        find: /^\s*([-*]\s*\[([ |x|X])?\])\s$/,
        type: this.type,
        getAttributes: (match) => ({
          checked: match[2]?.toLowerCase() === 'x',
        }),
      }),
    ];
  },
});
