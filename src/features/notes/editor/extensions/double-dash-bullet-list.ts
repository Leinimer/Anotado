'use client';

import { Extension, InputRule } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Regra de input que converte estritamente '-- ' (traço duplo + espaço)
 * no início de um PARÁGRAFO NORMAL no nível raiz em uma lista com marcadores (bulletList) nativa do Tiptap.
 *
 * RESTRIÇÕES ESTRITAS:
 * 1. O cursor deve estar em um parágrafo normal;
 * 2. O parágrafo NÃO deve estar dentro de taskItem, taskList, listItem, bulletList, orderedList;
 * 3. A profundidade (depth) deve ser 1 (nível raiz do documento);
 * 4. Não deve existir nenhuma lista ativa;
 * 5. O usuário deve ter digitado exatamente '-- '.
 */
export const DoubleDashBulletList = Extension.create({
  name: 'doubleDashBulletList',

  addInputRules() {
    const bulletListType = this.editor.schema.nodes.bulletList;
    if (!bulletListType) return [];

    return [
      new InputRule({
        find: /^\s*(--)\s$/,
        handler: ({ state, range }) => {
          const { $from } = state.selection;

          // 1. Deve ser estritamente parágrafo
          if ($from.parent.type.name !== 'paragraph') return null;

          // 2. Deve estar no nível raiz (depth === 1)
          if ($from.depth !== 1) return null;

          // 3. Nenhum ancestral pode ser lista
          for (let d = $from.depth; d > 0; d--) {
            const nodeName = $from.node(d).type.name;
            if (['taskItem', 'taskList', 'listItem', 'bulletList', 'orderedList'].includes(nodeName)) {
              return null;
            }
          }

          // 4. Não deve haver lista ativa no editor
          if (
            this.editor.isActive('taskList') ||
            this.editor.isActive('bulletList') ||
            this.editor.isActive('orderedList') ||
            this.editor.isActive('taskItem') ||
            this.editor.isActive('listItem')
          ) {
            return null;
          }

          // Executa a conversão limpa para bulletList
          const { tr } = state;
          tr.delete(range.from, range.to);

          // Usa o comando nativo toggleBulletList
          this.editor.commands.toggleBulletList();
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey('doubleDashBulletListStrictFallback'),
        props: {
          handleTextInput(view, from, to, text) {
            if (text !== ' ') return false;

            const { state } = view;
            const { $from, empty } = state.selection;
            if (!empty) return false;

            // 1. Estritamente parágrafo normal
            if ($from.parent.type.name !== 'paragraph') return false;

            // 2. Estritamente nível raiz (depth === 1)
            if ($from.depth !== 1) return false;

            // 3. Nenhum ancestral de lista
            for (let d = $from.depth; d > 0; d--) {
              const nodeName = $from.node(d).type.name;
              if (['taskItem', 'taskList', 'listItem', 'bulletList', 'orderedList'].includes(nodeName)) {
                return false;
              }
            }

            // 4. Nenhuma lista ativa
            if (
              editor.isActive('taskList') ||
              editor.isActive('bulletList') ||
              editor.isActive('orderedList') ||
              editor.isActive('taskItem') ||
              editor.isActive('listItem')
            ) {
              return false;
            }

            const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);

            // Verifica se o texto antes do cursor no início do parágrafo é exatamente "--"
            if (/^\s*--$/.test(textBefore)) {
              const startOfBlock = $from.start();
              const matchLen = textBefore.length;

              const tr = state.tr.delete(startOfBlock, startOfBlock + matchLen);
              view.dispatch(tr);

              editor.commands.toggleBulletList();
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
