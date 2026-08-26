import { Extension, wrappingInputRule } from '@tiptap/core';

/**
 * Regra de input que converte automaticamente '-- ' (traço duplo + espaço)
 * em uma lista com marcadores (bulletList) nativa do Tiptap.
 */
export const DoubleDashBulletList = Extension.create({
  name: 'doubleDashBulletList',

  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*(--)\s$/,
        type: this.editor.schema.nodes.bulletList,
      }),
    ];
  },
});
