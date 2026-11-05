import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
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

  // 1. Grifa atrás do texto original.
  //
  // PDFPageLeaf.normalize() do pdf-lib (PDFDocument.load) envolve os streams
  // originais com q/Q quando há conteúdo. drawRectangle adiciona seu próprio
  // stream ao final; movemos SOMENTE esse stream para imediatamente depois do
  // q inicial (índice 1), antes dos streams originais. A ordem efetiva fica:
  // q -> grifos -> conteúdo original (texto/imagens) -> Q.
  //
  // Não usamos BlendMode.Multiply aqui: a ordem de pintura já preserva as letras
  // originais sem clareá-las, e a opacidade normal evita diferenças entre leitores.
  const highlightsByPage = new Map<number, HighlightAnnotation[]>();
  for (const ann of annotations) {
    if (ann.type !== 'highlight' || ann.pageIndex < 0 || ann.pageIndex >= pages.length) continue;
    if (!Array.isArray(ann.rects) || ann.rects.length === 0) continue;
    const group = highlightsByPage.get(ann.pageIndex) || [];
    group.push(ann);
    highlightsByPage.set(ann.pageIndex, group);
  }

  for (const [pageIndex, pageHighlights] of highlightsByPage.entries()) {
    const page = pages[pageIndex];
    const pageHeight = page.getHeight();
    const pageInternals = page as unknown as {
      contentStream?: unknown;
      contentStreamRef?: unknown;
    };

    // Normaliza a página ANTES de desenhar e registra a quantidade de streams
    // existentes. Isso evita supor que qualquer stream no índice final é original.
    const beforeContents = page.node.normalizedEntries().Contents;
    const originalStreamCount = beforeContents?.size() ?? 0;

    // Força um stream exclusivo para os destaques.
    pageInternals.contentStream = undefined;
    pageInternals.contentStreamRef = undefined;

    for (const ann of pageHighlights) {
      const { r, g, b } = parseHexToRgb(ann.color);
      for (const rect of ann.rects) {
        if (
          !Number.isFinite(rect.x) ||
          !Number.isFinite(rect.y) ||
          !Number.isFinite(rect.width) ||
          !Number.isFinite(rect.height) ||
          rect.width <= 0 ||
          rect.height <= 0
        ) {
          continue;
        }

        page.drawRectangle({
          x: rect.x,
          y: pageHeight - rect.y - rect.height,
          width: rect.width,
          height: rect.height,
          color: rgb(r, g, b),
          opacity: Math.min(1, Math.max(0.2, ann.opacity ?? 0.48)),
        });
      }
    }

    const contents = page.node.normalizedEntries().Contents;
    const afterCount = contents?.size() ?? 0;
    if (!contents || afterCount <= originalStreamCount) {
      throw new Error(`Não foi possível incorporar o grifo da página ${pageIndex + 1} ao PDF.`);
    }

    // drawRectangle cria o stream de grifos no fim. Retira-o de lá e o coloca
    // depois do q de abertura, antes do primeiro stream com conteúdo original.
    // Se a página não tinha conteúdo, o stream fica na posição 0.
    const highlightStreamIndex = afterCount - 1;
    const highlightStreamRef = contents.get(highlightStreamIndex);
    contents.remove(highlightStreamIndex);
    contents.insert(originalStreamCount > 0 ? 1 : 0, highlightStreamRef);

    // Não reutilizar o stream que acabou de ser movido: as demais anotações
    // precisam ser criadas depois do conteúdo original, em streams de foreground.
    pageInternals.contentStream = undefined;
    pageInternals.contentStreamRef = undefined;
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
        // Já foi desenhado em um stream anterior ao conteúdo original da página.
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
        const { r, g, b } = parseHexToRgb(ann.color || '#fed7aa');
        // Desenha um quadrado de nota adesiva e se houver texto, anota o conteúdo
        const iconSize = 20;
        page.drawRectangle({
          x: ann.x,
          y: pageHeight - ann.y - iconSize,
          width: iconSize,
          height: iconSize,
          color: rgb(r, g, b),
          borderColor: rgb(0.3, 0.25, 0.2),
          borderWidth: 1,
        });

        // Ícone "N" de nota
        page.drawText('?', {
          x: ann.x + 6,
          y: pageHeight - ann.y - iconSize + 4,
          size: 11,
          font: helveticaBold,
          color: rgb(0.2, 0.15, 0.1),
        });

        if (ann.text && ann.text.trim()) {
          const lines = ann.text.split('\n');
          let noteY = pageHeight - ann.y - iconSize - 12;
          for (const line of lines) {
            page.drawText(line, {
              x: ann.x + iconSize + 4,
              y: noteY,
              size: 9,
              font: helveticaFont,
              color: rgb(0.2, 0.15, 0.1),
            });
            noteY -= 11;
          }
        }
        break;
      }
    }
  }

  const savedBytes = await pdfDoc.save();
  return new Blob([savedBytes as unknown as BlobPart], { type: 'application/pdf' });
}
