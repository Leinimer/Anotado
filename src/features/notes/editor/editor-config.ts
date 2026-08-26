import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { Extension, InputRule } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, NodeSelection } from '@tiptap/pm/state';

import { FontSize } from './extensions/font-size';
import { CustomImage } from './extensions/custom-image';
import { Details, DetailsSummary, DetailsContent } from './extensions/toggle-details';
import { CustomYoutube } from './extensions/custom-youtube';
import { DocumentAttachment } from './extensions/document-attachment';
import { MediaGroup } from './extensions/media-group';
import { DoubleDashBulletList } from './extensions/double-dash-bullet-list';
import { SmartMediaDragDrop } from './extensions/smart-media-drag-drop';

export const CustomLink = Link.extend({
  inclusive: false,
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      new Plugin({
        key: new PluginKey('linkNonPropagation'),
        props: {
          handleKeyDown(view, event) {
            if (event.key === ' ' || event.key === 'Spacebar') {
              const { state } = view;
              const { $from, empty } = state.selection;
              const linkType = state.schema.marks.link;
              if (linkType && empty) {
                const marks = state.storedMarks || $from.marks();
                const hasLink = marks.some((m) => m.type === linkType);
                if (hasLink) {
                  const nodeBefore = $from.nodeBefore;
                  if (nodeBefore && nodeBefore.marks.some((m) => m.type === linkType)) {
                    const tr = state.tr.insertText(' ', $from.pos);
                    tr.removeStoredMark(linkType);
                    view.dispatch(tr);
                    return true;
                  }
                }
              }
            }
            return false;
          },
          handleTextInput(view, from, to, text) {
            if (text === ' ' || text === '\n' || text === '\t') {
              const { state } = view;
              const linkType = state.schema.marks.link;
              if (linkType) {
                const tr = state.tr.insertText(text, from, to);
                tr.removeStoredMark(linkType);
                view.dispatch(tr);
                return true;
              }
            }
            return false;
          },
        },
        appendTransaction(transactions, oldState, newState) {
          const linkType = newState.schema.marks.link;
          if (!linkType) return null;

          const { selection } = newState;
          if (selection.empty) {
            const { $from } = selection;
            const hasStoredLink = (newState.storedMarks || []).some((m) => m.type === linkType);
            const prevChar = $from.nodeBefore?.text?.slice(-1);

            if (prevChar === ' ' || prevChar === '\n' || prevChar === '\t') {
              if (hasStoredLink || $from.marks().some((m) => m.type === linkType)) {
                const tr = newState.tr;
                tr.removeStoredMark(linkType);
                return tr;
              }
            }
          }
          return null;
        },
      }),
    ];
  },
}).configure({
  openOnClick: false,
  autolink: true,
  defaultProtocol: 'https',
  protocols: ['http', 'https', 'mailto', 'tel'],
  HTMLAttributes: {
    class: 'editor-link text-[#68594d] underline underline-offset-2 decoration-[#68594d]/40 hover:decoration-[#68594d] cursor-pointer font-medium transition-colors',
    target: '_blank',
    rel: 'noopener noreferrer',
  },
});

/**
 * Regra de input que transforma a sequência "->" em "→" automaticamente.
 */
export const ArrowTransformExtension = Extension.create({
  name: 'arrowTransform',
  addInputRules() {
    return [
      new InputRule({
        find: /->$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.replaceWith(range.from, range.to, state.schema.text('→'));
        },
      }),
    ];
  },
});

export const CustomHorizontalRule = HorizontalRule.extend({
  addInputRules() {
    return [
      new InputRule({
        find: /^(?:---|—-)$/,
        handler: ({ state, range, match }) => {
          const { tr } = state;
          const start = range.from;
          const end = range.to;

          // Cria o nó horizontalRule
          const hrNode = this.type.create(this.options.HTMLAttributes);

          // Substitui o parágrafo / texto '---' pela linha horizontal
          const $start = state.doc.resolve(start);
          const isEntireBlock = $start.parent.textContent.trim() === match[0].trim();

          if (isEntireBlock) {
            // Substitui o bloco inteiro (parágrafo) pelo hrNode
            const blockStart = $start.before();
            const blockEnd = $start.after();
            tr.replaceWith(blockStart, blockEnd, hrNode);

            // Posicionamento inteligente do cursor em um novo parágrafo após a linha
            const posAfterHr = blockStart + hrNode.nodeSize;
            const $after = tr.doc.resolve(Math.min(posAfterHr, tr.doc.content.size));

            if (posAfterHr >= tr.doc.content.size || !$after.nodeAfter || !$after.nodeAfter.isTextblock) {
              const paragraphType = state.schema.nodes.paragraph;
              if (paragraphType) {
                const emptyParagraph = paragraphType.create();
                tr.insert(posAfterHr, emptyParagraph);
                tr.setSelection(TextSelection.create(tr.doc, posAfterHr + 1));
              }
            } else {
              // Posiciona o cursor no início do próximo parágrafo existente
              tr.setSelection(TextSelection.create(tr.doc, posAfterHr + 1));
            }
          } else {
            tr.replaceWith(start, end, hrNode);
          }

          tr.scrollIntoView();
        },
      }),
    ];
  },
}).configure({
  HTMLAttributes: {
    class: 'editorial-hr',
  },
});

export const defaultEditorExtensions = [
  StarterKit.configure({
    horizontalRule: false,
    heading: {
      levels: [1, 2, 3],
    },
    bulletList: {
      keepMarks: true,
      keepAttributes: false,
    },
    orderedList: {
      keepMarks: true,
      keepAttributes: false,
    },
    dropcursor: {
      color: '#68594d',
      width: 2,
    },
  }),
  CustomHorizontalRule,
  ArrowTransformExtension,
  Underline,
  Highlight.configure({
    multicolor: true,
  }),
  TextStyle,
  Color,
  FontSize,
  TextAlign.configure({
    types: ['heading', 'paragraph', 'blockquote'],
  }),
  TaskList,
  TaskItem.configure({
    nested: true,
  }),
  CustomLink,
  CustomImage.configure({
    inline: false,
    allowBase64: true,
    HTMLAttributes: {
      class: 'rounded-xl max-w-full my-4 border border-[#e4e2dd] shadow-xs',
    },
  }),
  CustomYoutube,
  DocumentAttachment,
  MediaGroup,
  SmartMediaDragDrop,
  DoubleDashBulletList,
  Details,
  DetailsSummary,
  DetailsContent,
  Markdown.configure({
    html: true,
    tightLists: true,
    bulletListMarker: '-',
    linkify: true,
    breaks: false,
    transformPastedText: true,
    transformCopiedText: true,
  }),
];
