import {
  PDFDocument,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFString,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import { HighlightAnnotation, PdfAnnotation } from './types';

function parseHexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = (hex || '#68594d').replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) return { r: 0.4, g: 0.35, b: 0.3 };
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

/**
 * Remove somente as anotações pertencentes ao ANOTADO. Isso permite editar/excluir
 * um grifo ou comentário salvo e exportar repetidamente sem duplicar anotações.
 * Anotações criadas por outros leitores de PDF são preservadas.
 */
function removeExistingAnotadoAnnotations(pdfDoc: any, page: any): void {
  const annots = page.node.normalizedEntries().Annots;
  for (let index = annots.size() - 1; index >= 0; index -= 1) {
    const reference = annots.get(index);
    const dict = pdfDoc.context.lookupMaybe(reference, PDFDict);
    if (!dict) continue;

    const name = dict.lookupMaybe(PDFName.of('NM'), PDFHexString, PDFString);
    const marker = name?.decodeText?.() || '';
    if (marker.startsWith('ANOTADO:')) {
      annots.remove(index);
    }
  }
}

/**
 * Cria uma cópia apenas para visualização, removendo as anotações que pertencem
 * ao ANOTADO. O PDF original continua intacto para exportação.
 *
 * O editor redesenha essas anotações na camada SVG; se PDF.js também as desenhar
 * no canvas, apagar a camada SVG deixa a aparência nativa antiga por baixo.
 */
export async function createPdfPreviewWithoutAnotadoAnnotations(
  originalPdfBytes: ArrayBuffer | Uint8Array
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes, { ignoreEncryption: true });
  for (const page of pdfDoc.getPages()) {
    removeExistingAnotadoAnnotations(pdfDoc, page);
  }
  return pdfDoc.save();
}

function addNativeHighlightAnnotation(
  pdfDoc: any,
  page: any,
  ann: HighlightAnnotation
): void {
  const crop = page.getCropBox();
  const quadPoints: number[] = [];
  let left = Number.POSITIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;

  for (const rect of ann.rects || []) {
    if (
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) continue;

    // A seleção interna usa origem no topo da página; PDF QuadPoints usa
    // coordenadas PDF com origem inferior esquerda.
    const x1 = crop.x + rect.x;
    const x2 = x1 + rect.width;
    const yTop = crop.y + crop.height - rect.y;
    const yBottom = yTop - rect.height;

    // Ordem normalizada aceita pelo PDF.js: top-left, top-right,
    // bottom-left, bottom-right.
    quadPoints.push(x1, yTop, x2, yTop, x1, yBottom, x2, yBottom);
    left = Math.min(left, x1);
    bottom = Math.min(bottom, yBottom);
    right = Math.max(right, x2);
    top = Math.max(top, yTop);
  }

  if (quadPoints.length === 0) return;

  const { r, g, b } = parseHexToRgb(ann.color);
  const annotation = pdfDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Highlight',
    Rect: [left, bottom, right, top],
    QuadPoints: quadPoints,
    C: [r, g, b],
    CA: Math.min(1, Math.max(0.58, ann.opacity ?? 0.58)),
    BM: PDFName.of('Multiply'),
    T: PDFHexString.fromText('ANOTADO'),
    NM: PDFHexString.fromText(`ANOTADO:${ann.id}`),
    Contents: PDFHexString.fromText(ann.quoteText?.trim() || 'Marca-texto'),
    M: PDFString.fromDate(new Date()),
    F: 4,
  });

  page.node.addAnnot(pdfDoc.context.register(annotation));
}

function addNativeStickyNoteAnnotation(
  pdfDoc: any,
  page: any,
  ann: Extract<PdfAnnotation, { type: 'sticky_note' }>
): void {
  const crop = page.getCropBox();
  const iconSize = 22;
  const x = crop.x + ann.x;
  const top = crop.y + crop.height - ann.y;
  const bottom = top - iconSize;
  const { r, g, b } = parseHexToRgb(ann.color || '#fef08a');

  // /Text é uma anotação nativa de comentário. O texto fica em /Contents
  // e aparece no popup do leitor de PDF, não impresso ao lado do ícone.
  const annotation = pdfDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [x, bottom, x + iconSize, top],
    Name: 'Note',
    C: [r, g, b],
    T: PDFHexString.fromText('ANOTADO'),
    NM: PDFHexString.fromText(`ANOTADO:${ann.id}`),
    Contents: PDFHexString.fromText(ann.text || ''),
    M: PDFString.fromDate(new Date()),
    Open: false,
    F: 4,
  });

  page.node.addAnnot(pdfDoc.context.register(annotation));
}

/**
 * Aplica todas as anotações sobre o documento PDF original e retorna o Blob atualizado
 * com as anotações embutidas no formato padrão de PDF.
 */
export async function exportPdfWithAnnotations(
  originalPdfBytes: ArrayBuffer | Uint8Array,
  annotations: PdfAnnotation[]
): Promise<Blob> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes, { ignoreEncryption: true });
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pages = pdfDoc.getPages();

  // 1. Recria as marcações nativas do ANOTADO dentro de /Annots.
  // O subtipo PDF /Highlight usa QuadPoints e a aparência Multiply padrão dos
  // leitores PDF (incluindo PDF.js), mantendo a tinta dos glifos legível.
  // Ao contrário de retângulos em Contents, essas marcações são reconhecidas
  // como grifos reais e continuam vinculadas à seleção do texto.
  for (const page of pages) {
    removeExistingAnotadoAnnotations(pdfDoc, page);
  }

  for (const ann of annotations) {
    if (ann.pageIndex < 0 || ann.pageIndex >= pages.length) continue;
    const page = pages[ann.pageIndex];
    if (ann.type === 'highlight') {
      addNativeHighlightAnnotation(pdfDoc, page, ann);
    } else if (ann.type === 'sticky_note') {
      addNativeStickyNoteAnnotation(pdfDoc, page, ann);
    }
  }

  // 2. Todas as demais anotações são desenhadas depois do conteúdo original,
  // para permanecerem visíveis por cima da página.
  for (const ann of annotations) {
    if (ann.pageIndex < 0 || ann.pageIndex >= pages.length) continue;
    const page = pages[ann.pageIndex];
    const pageHeight = page.getHeight();

    switch (ann.type) {
      case 'drawing': {
        if (!ann.points || ann.points.length < 2) break;
        const { r, g, b } = parseHexToRgb(ann.color);
        for (let i = 0; i < ann.points.length - 1; i++) {
          const p1 = ann.points[i];
          const p2 = ann.points[i + 1];
          page.drawLine({
            start: { x: p1.x, y: pageHeight - p1.y },
            end: { x: p2.x, y: pageHeight - p2.y },
            thickness: ann.strokeWidth || 2,
            color: rgb(r, g, b),
            opacity: ann.opacity !== undefined ? ann.opacity : 1,
          });
        }
        break;
      }

      case 'highlight': {
        // Persistido como anotação PDF nativa /Highlight em /Annots.
        break;
      }

      case 'underline': {
        const { r, g, b } = parseHexToRgb(ann.color);
        const rects = ann.rects || [];
        for (const rct of rects) {
          page.drawLine({
            start: { x: rct.x, y: pageHeight - (rct.y + rct.height) },
            end: { x: rct.x + rct.width, y: pageHeight - (rct.y + rct.height) },
            thickness: 1.5,
            color: rgb(r, g, b),
          });
        }
        break;
      }

      case 'strikethrough': {
        const { r, g, b } = parseHexToRgb(ann.color);
        const rects = ann.rects || [];
        for (const rct of rects) {
          page.drawLine({
            start: { x: rct.x, y: pageHeight - (rct.y + rct.height / 2) },
            end: { x: rct.x + rct.width, y: pageHeight - (rct.y + rct.height / 2) },
            thickness: 1.5,
            color: rgb(r, g, b),
          });
        }
        break;
      }

      case 'text': {
        if (!ann.text || !ann.text.trim()) break;
        const { r, g, b } = parseHexToRgb(ann.color);
        const fontSize = ann.fontSize || 14;
        const lines = ann.text.split('\n');
        let currentY = pageHeight - ann.y - fontSize;

        for (const line of lines) {
          page.drawText(line, {
            x: ann.x,
            y: currentY,
            size: fontSize,
            font: helveticaFont,
            color: rgb(r, g, b),
          });
          currentY -= fontSize * 1.25;
        }
        break;
      }

      case 'shape': {
        const stroke = parseHexToRgb(ann.strokeColor || '#68594d');
        const fill = ann.fillColor ? parseHexToRgb(ann.fillColor) : undefined;
        const strokeWidth = ann.strokeWidth || 2;

        if (ann.shapeType === 'rectangle') {
          page.drawRectangle({
            x: ann.x,
            y: pageHeight - ann.y - ann.height,
            width: ann.width,
            height: ann.height,
            borderColor: rgb(stroke.r, stroke.g, stroke.b),
            borderWidth: strokeWidth,
            color: fill ? rgb(fill.r, fill.g, fill.b) : undefined,
            opacity: fill ? 0.2 : 0,
            borderOpacity: 1,
          });
        } else if (ann.shapeType === 'circle') {
          const xRadius = Math.abs(ann.width) / 2;
          const yRadius = Math.abs(ann.height) / 2;
          page.drawEllipse({
            x: ann.x + xRadius,
            y: pageHeight - (ann.y + yRadius),
            xScale: xRadius,
            yScale: yRadius,
            borderColor: rgb(stroke.r, stroke.g, stroke.b),
            borderWidth: strokeWidth,
            color: fill ? rgb(fill.r, fill.g, fill.b) : undefined,
            opacity: fill ? 0.2 : 0,
            borderOpacity: 1,
          });
        } else if (ann.shapeType === 'line' || ann.shapeType === 'arrow') {
          page.drawLine({
            start: { x: ann.x, y: pageHeight - ann.y },
            end: { x: ann.x + ann.width, y: pageHeight - (ann.y + ann.height) },
            thickness: strokeWidth,
            color: rgb(stroke.r, stroke.g, stroke.b),
          });

          if (ann.shapeType === 'arrow') {
            const endX = ann.x + ann.width;
            const endY = pageHeight - (ann.y + ann.height);
            const startX = ann.x;
            const startY = pageHeight - ann.y;
            const angle = Math.atan2(endY - startY, endX - startX);
            const arrowHeadLength = 12;

            page.drawLine({
              start: { x: endX, y: endY },
              end: {
                x: endX - arrowHeadLength * Math.cos(angle - Math.PI / 6),
                y: endY - arrowHeadLength * Math.sin(angle - Math.PI / 6),
              },
              thickness: strokeWidth,
              color: rgb(stroke.r, stroke.g, stroke.b),
            });
            page.drawLine({
              start: { x: endX, y: endY },
              end: {
                x: endX - arrowHeadLength * Math.cos(angle + Math.PI / 6),
                y: endY - arrowHeadLength * Math.sin(angle + Math.PI / 6),
              },
              thickness: strokeWidth,
              color: rgb(stroke.r, stroke.g, stroke.b),
            });
          }
        }
        break;
      }

      case 'sticky_note': {
        // Persistido como anotação PDF nativa /Text. O comentário permanece
        // em /Contents e aparece no popup, sem virar texto impresso na página.
        break;
      }
    }
  }

  const savedBytes = await pdfDoc.save();
  return new Blob([savedBytes as unknown as BlobPart], { type: 'application/pdf' });
}
