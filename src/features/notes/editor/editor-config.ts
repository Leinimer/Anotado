import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';

import { FontSize } from './extensions/font-size';
import { ToggleDetails, Summary, DetailsContent } from './extensions/toggle-details';
import { CustomYoutube } from './extensions/custom-youtube';
import { DocumentAttachment } from './extensions/document-attachment';

export const defaultEditorExtensions = [
  StarterKit.configure({
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
  Image.configure({
    inline: false,
    allowBase64: true,
    HTMLAttributes: {
      class: 'rounded-xl max-w-full my-4 border border-[#e4e2dd] shadow-xs',
    },
  }),
  CustomYoutube,
  DocumentAttachment,
  ToggleDetails,
  Summary,
  DetailsContent,
];
