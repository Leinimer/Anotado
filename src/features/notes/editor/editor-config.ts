import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { CustomHighlight } from './extensions/custom-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { Extension, InputRule } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

import { FontSize } from './extensions/font-size';
import { CustomImage } from './extensions/custom-image';
import { Details, DetailsSummary, DetailsContent } from './extensions/toggle-details';
import { CustomYoutube } from './extensions/custom-youtube';
import { DocumentAttachment } from './extensions/document-attachment';
import { MediaGroup } from './extensions/media-group';
import { DoubleDashBulletList } from './extensions/double-dash-bullet-list';
import { SmartMediaDragDrop } from './extensions/smart-media-drag-drop';
import { PdfDragDrop } from './extensions/pdf-drag-drop';
import { CustomTaskItem } from './extensions/custom-task-item';
import { InternalNoteLink } from './extensions/internal-note-link';

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
 * Tab no corpo do texto: insere uma indentação visual persistente no ponto do cursor,
 * em vez de mover o foco para o próximo elemento da página.
 */
export const ParagraphTabIndentExtension = Extension.create({
  name: 'paragraphTabIndent',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('paragraphTabIndent'),
        props: {
          handleKeyDown(view, event) {
            if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
              return false;
            }

            const { state } = view;
            const { selection } = state;

            // A ação é destinada ao corpo do texto (parágrafos), não a headings/listas.
            if (!selection.empty || selection.$from.parent.type.name !== 'paragraph') {
              return false;
            }

            event.preventDefault();
            event.stopPropagation();

            // Espaços não separáveis são usados para que a indentação seja preservada
            // pelo HTML/ProseMirror e continue visível após salvar/recarregar a nota.
            const indentation = '\u00A0\u00A0\u00A0\u00A0';
            const tr = state.tr.insertText(indentation, selection.from, selection.to);
            tr.setSelection(TextSelection.create(tr.doc, selection.from + indentation.length));
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
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
        find: /(?:---|—-|———)$/,
        handler: ({ state, range, match }) => {
          const { tr } = state;
          const $from = state.doc.resolve(range.from);
          const parentBlock = $from.parent;
          const paragraphType = state.schema.nodes.paragraph;

          if (!paragraphType) return null;

          const hrNode = this.type.create(this.options.HTMLAttributes);

          const textBefore = parentBlock.textBetween(0, $from.parentOffset).trimEnd();

          if (textBefore.length > 0) {
            const cutFrom = $from.start() + textBefore.length;
            const cutTo = range.to;
            tr.delete(cutFrom, cutTo);

            const currentBlockEnd = tr.mapping.map($from.after());
            tr.insert(currentBlockEnd, hrNode);

            const posAfterHr = currentBlockEnd + hrNode.nodeSize;
            const $afterHr = tr.doc.resolve(posAfterHr);
            const nextNode = $afterHr.nodeAfter;

            if (nextNode && nextNode.type === paragraphType && nextNode.content.size === 0) {
              tr.setSelection(TextSelection.create(tr.doc, posAfterHr + 1));
            } else {
              const emptyParagraph = paragraphType.create();
              tr.insert(posAfterHr, emptyParagraph);
              tr.setSelection(TextSelection.create(tr.doc, posAfterHr + 1));
            }
          } else {
            const blockStart = $from.before();
            const blockEnd = $from.after();

            let effectiveStart = blockStart;
            const $beforeBlock = state.doc.resolve(blockStart);
            const prevNode = $beforeBlock.nodeBefore;
            if (prevNode && prevNode.type === paragraphType && prevNode.content.size === 0) {
              effectiveStart = blockStart - prevNode.nodeSize;
            }

            tr.replaceWith(effectiveStart, blockEnd, hrNode);

            const posAfterHr = effectiveStart + hrNode.nodeSize;
            const $afterHr = tr.doc.resolve(posAfterHr);
            const nextNode = $afterHr.nodeAfter;

            if (nextNode && nextNode.type === paragraphType && nextNode.content.size === 0) {
              tr.setSelection(TextSelection.create(tr.doc, posAfterHr + 1));
            } else {
              const emptyParagraph = paragraphType.create();
              tr.insert(posAfterHr, emptyParagraph);
              tr.setSelection(TextSelection.create(tr.doc, posAfterHr + 1));
            }
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
  ParagraphTabIndentExtension,
  ArrowTransformExtension,
  Underline,
  CustomHighlight.configure({
    multicolor: true,
  }),
  TextStyle,
  Color,
  FontSize,
  TextAlign.configure({
    types: ['heading', 'paragraph', 'blockquote'],
  }),
  TaskList,
  CustomTaskItem.configure({
    nested: true,
  }),
  InternalNoteLink,
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
  PdfDragDrop,
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
