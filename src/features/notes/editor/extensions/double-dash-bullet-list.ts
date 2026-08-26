'use client';

import { Extension, wrappingInputRule } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Regra de input que converte automaticamente '-- ' (traço duplo + espaço)
 * no início de um parágrafo em uma lista com marcadores (bulletList) nativa do Tiptap.
 *
 * Utiliza wrappingInputRule oficial do ProseMirror/Tiptap com suporte completo a
 * Undo/Redo, persistência Markdown, tecla Enter para novos itens e Enter duplo para sair.
 */
export const DoubleDashBulletList = Extension.create({
  name: 'doubleDashBulletList',

  addInputRules() {
    const bulletListType = this.editor.schema.nodes.bulletList;
    if (!bulletListType) return [];

    return [
      wrappingInputRule({
        find: /^\s*(--)\s$/,
        type: bulletListType,
      }),
    ];
  },

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey('doubleDashBulletListFallback'),
        props: {
          handleTextInput(view, from, to, text) {
            if (text !== ' ') return false;

            const { state } = view;
            const { $from, empty } = state.selection;
            if (!empty) return false;

            // Aplica estritamente em parágrafos normais (não code blocks, headings, etc.)
            const parent = $from.parent;
            if (parent.type.name !== 'paragraph') return false;

            const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);

            // Verifica se o texto antes do cursor no início do parágrafo é exatamente "--" (com possíveis espaços iniciais)
            if (/^\s*--$/.test(textBefore)) {
              const startOfBlock = $from.start();
              const matchLen = textBefore.length;

              // Deleta o prefixo "--" e converte para bulletList nativa
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
