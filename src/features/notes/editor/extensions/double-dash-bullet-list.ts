import { Extension, InputRule } from '@tiptap/core';

/**
 * Regra de input nativa que converte automaticamente '-- ' (traço duplo + espaço)
 * no início de um parágrafo em uma lista com marcadores (bulletList) nativa do Tiptap.
 */
export const DoubleDashBulletList = Extension.create({
  name: 'doubleDashBulletList',

  addInputRules() {
    return [
      new InputRule({
        find: /^\s*--\s$/,
        handler: ({ state, range, chain }) => {
          const { $from } = state.selection;
          // Aplica somente em blocos de parágrafo normais
          if ($from.parent.type.name !== 'paragraph') {
            return;
          }

          // Converte o parágrafo em bulletList nativa do Tiptap de forma limpa e desfazível
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .toggleBulletList()
            .run();
        },
      }),
    ];
  },
});

