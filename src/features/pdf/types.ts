// Escala física usada como referência: 100% na interface equivale ao antigo zoom de 175%.
export const PDF_DEFAULT_ZOOM = 1.75;

export type ToolMode =
  | 'select'
  | 'hand'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'pen'
  | 'eraser'
  | 'text'
  | 'shape'
  | 'sticky_note'
  | 'crop';

export type ShapeType = 'rectangle' | 'circle' | 'line' | 'arrow';

export type SaveStatus =
  | 'idle'
  | 'unsaved'
  | 'saving_local'
  | 'saved_local'
  | 'syncing'
  | 'synced'
  | 'error';

export interface BaseAnnotation {
  id: string;
  pageIndex: number; // 0-based
  createdAt: string;
  updatedAt: string;
  /** Indica que a anotação foi recuperada do /Annots do PDF e já é renderizada pelo PDF.js. */
  isNative?: boolean;
}

export interface DrawingAnnotation extends BaseAnnotation {
  type: 'drawing';
  points: Array<{ x: number; y: number }>;
  color: string;
  strokeWidth: number;
  opacity: number;
}

export interface HighlightAnnotation extends BaseAnnotation {
  type: 'highlight';
  rects: Array<{ x: number; y: number; width: number; height: number }>;
  color: string;
  opacity: number;
  /** Texto citado pelo grifo, preservado dentro da anotação PDF. */
  quoteText?: string;
}

export interface UnderlineAnnotation extends BaseAnnotation {
  type: 'underline';
  rects: Array<{ x: number; y: number; width: number; height: number }>;
  color: string;
}

export interface StrikeAnnotation extends BaseAnnotation {
  type: 'strikethrough';
  rects: Array<{ x: number; y: number; width: number; height: number }>;
  color: string;
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  color: string;
}

export interface ShapeAnnotation extends BaseAnnotation {
  type: 'shape';
  shapeType: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  fillColor?: string | null;
  strokeWidth: number;
}

export interface StickyNoteAnnotation extends BaseAnnotation {
  type: 'sticky_note';
  x: number;
  y: number;
  text: string;
  color: string;
  isOpen?: boolean;
}

/** Contorno não destrutivo que indica a região capturada para a nota-resumo. */
export interface CropAnnotation extends BaseAnnotation {
  type: 'crop';
  rect: { x: number; y: number; width: number; height: number };
}

export type PdfAnnotation =
  | DrawingAnnotation
  | HighlightAnnotation
  | UnderlineAnnotation
  | StrikeAnnotation
  | TextAnnotation
  | ShapeAnnotation
  | StickyNoteAnnotation
  | CropAnnotation;
