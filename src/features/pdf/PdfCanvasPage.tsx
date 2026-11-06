'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  PdfAnnotation,
  ToolMode,
  ShapeType,
  DrawingAnnotation,
  ShapeAnnotation,
  HighlightAnnotation,
  UnderlineAnnotation,
  StrikeAnnotation,
  TextAnnotation,
  StickyNoteAnnotation,
} from './types';
import { StickyNote, X, MessageSquare, Trash2, Move } from 'lucide-react';

function multiplyPdfTransforms(a: number[], b: number[]) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

interface PdfCanvasPageProps {
  pageIndex: number;
  pdfDoc: any;
  zoom: number;
  mode: ToolMode;
  onSetMode?: (mode: ToolMode) => void;
  penColor: string;
  penWidth: number;
  highlightColor: string;
  currentShape: ShapeType;
  annotations: PdfAnnotation[];
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onAddAnnotation: (ann: PdfAnnotation) => void;
  onUpdateAnnotation: (ann: PdfAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
  onCropComplete?: (crop: { cropId: string; pageIndex: number; image: Blob; rect: { x: number; y: number; width: number; height: number } }) => void;
  isReadOnly?: boolean;
}

export function PdfCanvasPage({
  pageIndex,
  pdfDoc,
  zoom,
  mode,
  onSetMode,
  penColor,
  penWidth,
  highlightColor,
  currentShape,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onCropComplete,
  isReadOnly = false,
}: PdfCanvasPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  const [pageDimensions, setPageDimensions] = useState<{
    width: number;
    height: number;
    unscaledWidth: number;
    unscaledHeight: number;
    pdfWidth: number;
    pdfHeight: number;
    scaleX: number;
    scaleY: number;
  } | null>(null);

  const textLayerRef = useRef<HTMLDivElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(pageIndex === 0);

  // Só renderiza páginas próximas à área visível. Isso evita criar centenas de
  // canvases de alta resolução simultaneamente em PDFs longos.
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setIsNearViewport(entry.isIntersecting);
      },
      { root: null, rootMargin: '1100px 0px', threshold: 0 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Drawing state
  const [isInteracting, setIsInteracting] = useState(false);
  const [activePoints, setActivePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentPoint, setCurrentPoint] = useState<{ x: number; y: number } | null>(null);

  // Text box drag-to-create state
  const [isDraggingTextBox, setIsDraggingTextBox] = useState(false);
  const [textDragStart, setTextDragStart] = useState<{ x: number; y: number } | null>(null);
  const [textDragCurrent, setTextDragCurrent] = useState<{ x: number; y: number } | null>(null);

  // Estado de notas adesivas: prévia ao passar o mouse, popover de edição e arraste.
  const [openStickyNoteId, setOpenStickyNoteId] = useState<string | null>(null);
  const [hoveredStickyNoteId, setHoveredStickyNoteId] = useState<string | null>(null);
  const [stickyDragPreview, setStickyDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const stickyDragRef = useRef<{
    id: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressStickyClickRef = useRef(false);

  const [annotationDragPreview, setAnnotationDragPreview] = useState<{
    id: string;
    deltaX: number;
    deltaY: number;
  } | null>(null);
  const annotationDragRef = useRef<{
    id: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    deltaX: number;
    deltaY: number;
  } | null>(null);

  // A ferramenta Mão nunca abre, seleciona ou arrasta objetos; ela navega a viewport.
  useEffect(() => {
    if (mode !== 'hand') return;
    setOpenStickyNoteId(null);
    setHoveredStickyNoteId(null);
    setStickyDragPreview(null);
    stickyDragRef.current = null;
    setAnnotationDragPreview(null);
    annotationDragRef.current = null;
  }, [mode]);

  // Renderiza somente as páginas próximas à viewport e cria uma camada de
  // texto alinhada ao canvas, permitindo selecionar/copiar texto nativo do PDF.
  useEffect(() => {
    let isCancelled = false;

    async function renderPage() {
      const canvas = canvasRef.current;
      const textLayer = textLayerRef.current;
      if (!pdfDoc || !canvas || !isNearViewport) {
        if (canvas && !isNearViewport) {
          if (renderTaskRef.current) {
            try { renderTaskRef.current.cancel(); } catch {}
            renderTaskRef.current = null;
          }
          canvas.width = 0;
          canvas.height = 0;
          if (textLayer) textLayer.replaceChildren();
        }
        return;
      }

      try {
        const page = await pdfDoc.getPage(pageIndex + 1);
        if (isCancelled) return;

        const unscaledViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: zoom });
        const pdfWidth = Math.abs(page.view[2] - page.view[0]) || unscaledViewport.width;
        const pdfHeight = Math.abs(page.view[3] - page.view[1]) || unscaledViewport.height;
        const scaleX = unscaledViewport.width / pdfWidth;
        const scaleY = unscaledViewport.height / pdfHeight;

        setPageDimensions({
          width: viewport.width,
          height: viewport.height,
          unscaledWidth: unscaledViewport.width,
          unscaledHeight: unscaledViewport.height,
          pdfWidth,
          pdfHeight,
          scaleX,
          scaleY,
        });

        const dprWanted = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const maxCanvasPixels = 16_000_000;
        const areaAtOneDpr = viewport.width * viewport.height;
        const dpr = Math.max(0.35, Math.min(dprWanted, 1.5, Math.sqrt(maxCanvasPixels / Math.max(1, areaAtOneDpr))));
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (renderTaskRef.current) {
          try { renderTaskRef.current.cancel(); } catch {}
        }
        renderTaskRef.current = page.render({
          canvasContext: ctx,
          viewport,
          transform: [dpr, 0, 0, dpr, 0, 0],
          // Mantém aparências de anotações nativas (links, formulários e
          // grifos PDF /Highlight). Grifos já persistidos recebem isNative=true
          // e não são pintados novamente pelo SVG customizado.
          annotationMode: 1,
        });
        const canvasPromise = renderTaskRef.current.promise;

        // A renderização visual do canvas não depende da extração de texto.
        // PDFs digitalizados/sem camada textual continuam visíveis se a extração falhar.
        let textItems: any[] = [];
        let textStyles: Record<string, any> = {};
        try {
          const extractedText = await page.getTextContent();
          textItems = extractedText.items as any[];
          textStyles = extractedText.styles as Record<string, any>;
        } catch (textError) {
          console.warn(
            `[PdfCanvasPage] Não foi possível extrair texto da página ${pageIndex + 1}; mantendo o canvas visual:`,
            textError
          );
        }
        if (isCancelled) return;

        if (textLayer) {
          textLayer.replaceChildren();
          textLayer.style.width = `${viewport.width}px`;
          textLayer.style.height = `${viewport.height}px`;
        }

        const measureCanvas = document.createElement('canvas');
        const measureContext = measureCanvas.getContext('2d');
        const outputScale = Math.hypot(viewport.transform[0], viewport.transform[1]) || (zoom * scaleX);

        let renderedTextItems = 0;
        for (const item of textItems) {
          if (isCancelled) return;
          if (renderedTextItems >= 50000) break;
          if (!item || typeof item.str !== 'string' || !item.str) {
            if (item?.hasEOL) textLayer?.appendChild(document.createElement('br'));
            continue;
          }

          const style = textStyles[item.fontName] || {};
          const tx = multiplyPdfTransforms(viewport.transform, item.transform);
          const angle = Math.atan2(tx[1], tx[0]) + (style.vertical ? Math.PI / 2 : 0);
          const fontHeight = Math.hypot(tx[2], tx[3]);
          const ascentRatio = typeof style.ascent === 'number'
            ? style.ascent
            : typeof style.descent === 'number'
              ? 1 + style.descent
              : 0.8;
          const pdfFontAscent = fontHeight * ascentRatio;
          const fontFamily = style.fontFamily || 'sans-serif';

          // Posiciona a caixa selecionável pela métrica real da fonte do navegador,
          // usando a linha de base do PDF como referência. Usar apenas style.ascent
          // do PDF pode deslocar a caixa DOM para baixo em relação aos glifos do canvas.
          let browserBaselineOffset = pdfFontAscent;
          if (measureContext && fontHeight > 0) {
            measureContext.font = `${fontHeight}px ${fontFamily}`;
            const metrics = measureContext.measureText(item.str || 'Hg');
            const fontBoxAscent = metrics.fontBoundingBoxAscent;
            const fontBoxDescent = metrics.fontBoundingBoxDescent;
            if (
              Number.isFinite(fontBoxAscent) &&
              Number.isFinite(fontBoxDescent) &&
              fontBoxAscent > 0 &&
              fontBoxDescent >= 0
            ) {
              const leading = Math.max(0, fontHeight - fontBoxAscent - fontBoxDescent);
              browserBaselineOffset = fontBoxAscent + leading / 2;
            }
          }

          const left = angle === 0 ? tx[4] : tx[4] + browserBaselineOffset * Math.sin(angle);
          const top = angle === 0
            ? tx[5] - browserBaselineOffset
            : tx[5] - browserBaselineOffset * Math.cos(angle);

          const span = document.createElement('span');
          span.textContent = item.str;
          span.dir = item.dir || 'ltr';
          span.setAttribute('role', 'presentation');
          span.style.left = `${(left / viewport.width) * 100}%`;
          span.style.top = `${(top / viewport.height) * 100}%`;
          span.style.fontSize = `${fontHeight}px`;
          span.style.fontFamily = fontFamily;
          span.style.lineHeight = '1';
          span.style.whiteSpace = 'pre';
          span.style.color = 'transparent';
          span.style.position = 'absolute';
          span.style.transformOrigin = '0 0';

          let transform = angle ? `rotate(${angle}rad) ` : '';
          if (measureContext && item.str.length > 1 && item.width > 0) {
            measureContext.font = `${fontHeight}px ${fontFamily}`;
            const measuredWidth = measureContext.measureText(item.str).width;
            const targetWidth = item.width * outputScale;
            if (measuredWidth > 0 && targetWidth > 0) {
              transform += `scaleX(${targetWidth / measuredWidth})`;
            }
          }
          if (transform) span.style.transform = transform;
          textLayer?.appendChild(span);
          renderedTextItems += 1;
          if (item.hasEOL) textLayer?.appendChild(document.createElement('br'));
        }

        await canvasPromise;
        if (isCancelled) return;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException' && !isCancelled) {
          console.warn(`[PdfCanvasPage] Falha ao renderizar a página ${pageIndex + 1}:`, err);
        }
      }
    }

    void renderPage();
    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, pageIndex, zoom, isNearViewport]);

  // Convert client coordinate to unscaled PDF point (scale 1.0)
  const getUnscaledCoords = useCallback(
    (e: React.MouseEvent | MouseEvent | React.TouchEvent | TouchEvent) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      let clientX = 0;
      let clientY = 0;

      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ('clientX' in e) {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      const relativeX = clientX - rect.left;
      const relativeY = clientY - rect.top;

      return {
        x: Math.max(0, relativeX / (pageDimensions?.scaleX ? pageDimensions.scaleX * zoom : zoom * 1.333333)),
        y: Math.max(0, relativeY / (pageDimensions?.scaleY ? pageDimensions.scaleY * zoom : zoom * 1.333333)),
      };
    },
    [zoom, pageDimensions]
  );

  // Selecionar permite arrastar cada objeto sem deslocar a página.
  const handleAnnotationPointerDown = (
    event: React.PointerEvent<HTMLElement | SVGElement>,
    annotation: PdfAnnotation
  ) => {
    if (isReadOnly || mode !== 'select' || event.button !== 0 || annotation.type === 'sticky_note' || annotation.type === 'crop') return;
    if (annotationDragRef.current) return;

    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    annotationDragRef.current = {
      id: annotation.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      deltaX: 0,
      deltaY: 0,
    };
    onSelectAnnotation(annotation.id);
  };

  const handleAnnotationPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = annotationDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || mode !== 'select') return;

    const scaleX = (pageDimensions?.scaleX || 1.333333) * zoom;
    const scaleY = (pageDimensions?.scaleY || 1.333333) * zoom;
    drag.deltaX = (event.clientX - drag.startClientX) / scaleX;
    drag.deltaY = (event.clientY - drag.startClientY) / scaleY;
    setAnnotationDragPreview({
      id: drag.id,
      deltaX: drag.deltaX,
      deltaY: drag.deltaY,
    });
  };

  const handleAnnotationPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = annotationDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = drag.deltaX;
    const dy = drag.deltaY;
    const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
    const annotation = pageAnnotations.find((item) => item.id === drag.id);

    if (moved && annotation) {
      let updated: PdfAnnotation = annotation;
      if (
        annotation.type === 'highlight' ||
        annotation.type === 'underline' ||
        annotation.type === 'strikethrough'
      ) {
        updated = {
          ...annotation,
          rects: annotation.rects.map((rect) => ({
            ...rect,
            x: rect.x + dx,
            y: rect.y + dy,
          })),
          updatedAt: new Date().toISOString(),
        };
      } else if (annotation.type === 'drawing') {
        updated = {
          ...annotation,
          points: annotation.points.map((point) => ({
            x: point.x + dx,
            y: point.y + dy,
          })),
          updatedAt: new Date().toISOString(),
        };
      } else if (annotation.type === 'text' || annotation.type === 'shape') {
        updated = {
          ...annotation,
          x: annotation.x + dx,
          y: annotation.y + dy,
          updatedAt: new Date().toISOString(),
        };
      }

      onUpdateAnnotation(updated);
    }

    annotationDragRef.current = null;
    setAnnotationDragPreview(null);

    const captureTarget = event.target as Element & {
      hasPointerCapture?: (pointerId: number) => boolean;
      releasePointerCapture?: (pointerId: number) => void;
    };
    if (captureTarget.hasPointerCapture?.(event.pointerId)) {
      captureTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  // Mouse handlers for annotations
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isReadOnly || mode === 'hand') return;

    const target = e.target as HTMLElement | null;

    // Se o clique veio de uma anotação existente, textarea, popover ou botão, aborte a criação
    if (
      (mode !== 'crop' && target?.closest('[data-pdf-annotation]')) ||
      target?.closest('[data-pdf-text-editor]') ||
      target?.closest('textarea, input, button')
    ) {
      return;
    }

    // Se clicou no fundo da página, desselecione anotação ativa
    if (selectedAnnotationId) {
      onSelectAnnotation(null);
    }

    if (e.button !== 0) return; // Apenas clique com botão esquerdo
    const pt = getUnscaledCoords(e);

    // Recorte: arraste uma área da página para capturar o conteúdo visível do PDF.
    if (mode === 'crop') {
      e.preventDefault();
      setIsInteracting(true);
      setStartPoint(pt);
      setCurrentPoint(pt);
      return;
    }

    // Para ferramentas de texto (seleção, marca-texto, sublinhado, tachado), a camada
    // .pdf-text-layer conduz o arraste nativo do navegador
    if (
      ['select', 'highlight', 'underline', 'strikethrough'].includes(mode) &&
      target?.closest?.('.pdf-text-layer')
    ) {
      return;
    }

    // Não inicia formas/retângulos quando uma ferramenta de texto estiver ativa
    if (mode === 'highlight' || mode === 'underline' || mode === 'strikethrough') {
      return;
    }

    setIsInteracting(true);
    setStartPoint(pt);
    setCurrentPoint(pt);

    if (mode === 'pen') {
      setActivePoints([pt]);
    } else if (mode === 'text') {
      // Inicia o arrasto para definir a largura e altura da nova caixa de texto
      setIsDraggingTextBox(true);
      setTextDragStart(pt);
      setTextDragCurrent(pt);
    } else if (mode === 'sticky_note') {
      // Posiciona nova nota adesiva, abre seu popover e retorna imediatamente para 'select'
      const id = `sticky_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const newSticky: StickyNoteAnnotation = {
        id,
        pageIndex,
        type: 'sticky_note',
        x: pt.x,
        y: pt.y,
        text: '',
        color: '#fef08a',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onAddAnnotation(newSticky);
      onSelectAnnotation(id);
      setOpenStickyNoteId(id);
      setIsInteracting(false);
      setStartPoint(null);
      setCurrentPoint(null);
      onSetMode?.('select');
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isInteracting || isReadOnly || mode === 'hand') return;
    const pt = getUnscaledCoords(e);
    setCurrentPoint(pt);

    if (mode === 'pen') {
      setActivePoints((prev) => [...prev, pt]);
    } else if (isDraggingTextBox) {
      setTextDragCurrent(pt);
    }
  };

  const handleMouseUp = () => {
    if (!isInteracting || isReadOnly) return;
    setIsInteracting(false);

    // Finalização do arrasto de criação de caixa de texto
    if (isDraggingTextBox && textDragStart && textDragCurrent) {
      setIsDraggingTextBox(false);

      const minX = Math.min(textDragStart.x, textDragCurrent.x);
      const minY = Math.min(textDragStart.y, textDragCurrent.y);
      const rawW = Math.abs(textDragCurrent.x - textDragStart.x);
      const rawH = Math.abs(textDragCurrent.y - textDragStart.y);

      // Se foi apenas um clique rápido (< 15px em ambos os eixos), utiliza dimensões padrão
      const isClick = rawW < 15 && rawH < 15;
      const width = isClick ? 160 : Math.max(rawW, 60);
      const height = isClick ? 38 : Math.max(rawH, 26);

      const id = `text_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const newText: TextAnnotation = {
        id,
        pageIndex,
        type: 'text',
        x: minX,
        y: minY,
        width,
        height,
        text: '',
        fontSize: 14,
        color: penColor,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      onAddAnnotation(newText);
      onSelectAnnotation(id);
      setTextDragStart(null);
      setTextDragCurrent(null);
      setStartPoint(null);
      setCurrentPoint(null);
      onSetMode?.('select');
      return;
    }

    if (!startPoint || !currentPoint) return;

    if (mode === 'crop') {
      const minX = Math.min(startPoint.x, currentPoint.x);
      const minY = Math.min(startPoint.y, currentPoint.y);
      const width = Math.abs(currentPoint.x - startPoint.x);
      const height = Math.abs(currentPoint.y - startPoint.y);
      const pageCanvas = canvasRef.current;
      const pageElement = containerRef.current;

      if (pageCanvas && pageElement && width > 5 && height > 5 && onCropComplete) {
        const pageBounds = pageElement.getBoundingClientRect();
        const unitScaleX = (pageDimensions?.scaleX || 1.333333) * zoom;
        const unitScaleY = (pageDimensions?.scaleY || 1.333333) * zoom;
        const pixelScaleX = pageCanvas.width / Math.max(1, pageBounds.width);
        const pixelScaleY = pageCanvas.height / Math.max(1, pageBounds.height);
        const sourceX = Math.max(0, Math.min(pageCanvas.width, Math.round(minX * unitScaleX * pixelScaleX)));
        const sourceY = Math.max(0, Math.min(pageCanvas.height, Math.round(minY * unitScaleY * pixelScaleY)));
        const sourceWidth = Math.max(1, Math.min(pageCanvas.width - sourceX, Math.round(width * unitScaleX * pixelScaleX)));
        const sourceHeight = Math.max(1, Math.min(pageCanvas.height - sourceY, Math.round(height * unitScaleY * pixelScaleY)));

        if (sourceWidth > 1 && sourceHeight > 1) {
          const croppedCanvas = document.createElement('canvas');
          croppedCanvas.width = sourceWidth;
          croppedCanvas.height = sourceHeight;
          const context = croppedCanvas.getContext('2d');
          if (context) {
            context.drawImage(pageCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
            const cropId = `crop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            croppedCanvas.toBlob((image) => {
              if (!image) return;
              const rect = { x: minX, y: minY, width, height };
              const now = new Date().toISOString();
              onAddAnnotation({
                id: cropId,
                type: 'crop',
                pageIndex,
                rect,
                createdAt: now,
                updatedAt: now,
              });
              onSelectAnnotation(cropId);
              onCropComplete({
                cropId,
                pageIndex,
                image,
                rect,
              });
              onSetMode?.('select');
            }, 'image/png');
          }
        }
      }

      setStartPoint(null);
      setCurrentPoint(null);
      return;
    }

    const minX = Math.min(startPoint.x, currentPoint.x);
    const minY = Math.min(startPoint.y, currentPoint.y);
    const width = Math.abs(currentPoint.x - startPoint.x);
    const height = Math.abs(currentPoint.y - startPoint.y);

    if (mode === 'pen' && activePoints.length > 1) {
      const id = `pen_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const drawing: DrawingAnnotation = {
        id,
        pageIndex,
        type: 'drawing',
        points: activePoints,
        color: penColor,
        strokeWidth: penWidth,
        opacity: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onAddAnnotation(drawing);
      setActivePoints([]);
    } else if (mode === 'shape' && (width > 5 || height > 5)) {
      const id = `shape_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const shape: ShapeAnnotation = {
        id,
        pageIndex,
        type: 'shape',
        shapeType: currentShape,
        x: currentShape === 'line' || currentShape === 'arrow' ? startPoint.x : minX,
        y: currentShape === 'line' || currentShape === 'arrow' ? startPoint.y : minY,
        width: currentShape === 'line' || currentShape === 'arrow' ? currentPoint.x - startPoint.x : width,
        height: currentShape === 'line' || currentShape === 'arrow' ? currentPoint.y - startPoint.y : height,
        strokeColor: penColor,
        fillColor: null,
        strokeWidth: penWidth,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onAddAnnotation(shape);
    }

    setStartPoint(null);
    setCurrentPoint(null);
  };

  const pageAnnotations = annotations.filter((a) => a.pageIndex === pageIndex);

  // A ação de excluir é contextual: só existe para a edição selecionada.
  // Notas adesivas mantêm o botão de exclusão dentro do próprio comentário.
  const selectedDeletableAnnotation = pageAnnotations.find(
    (annotation) => annotation.id === selectedAnnotationId && annotation.type !== 'sticky_note'
  );

  const selectedDeletePosition = (() => {
    const annotation = selectedDeletableAnnotation;
    if (!annotation || !pageDimensions || annotation.type === 'sticky_note') return null;

    let maxX = 0;
    let minY = 0;

    if (
      annotation.type === 'highlight' ||
      annotation.type === 'underline' ||
      annotation.type === 'strikethrough'
    ) {
      const rects = annotation.rects || [];
      if (rects.length === 0) return null;
      maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
      minY = Math.min(...rects.map((rect) => rect.y));
    } else if (annotation.type === 'drawing') {
      if (!annotation.points || annotation.points.length === 0) return null;
      maxX = Math.max(...annotation.points.map((point) => point.x));
      minY = Math.min(...annotation.points.map((point) => point.y));
    } else if (annotation.type === 'text') {
      maxX = annotation.x + (annotation.width || 160);
      minY = annotation.y;
    } else if (annotation.type === 'shape') {
      maxX = Math.max(annotation.x, annotation.x + annotation.width);
      minY = Math.min(annotation.y, annotation.y + annotation.height);
    } else if (annotation.type === 'crop') {
      maxX = annotation.rect.x + annotation.rect.width;
      minY = annotation.rect.y;
    } else {
      return null;
    }

    return {
      left: Math.max(14, Math.min(pageDimensions.width - 14, maxX * pageDimensions.scaleX * zoom)),
      top: Math.max(14, minY * pageDimensions.scaleY * zoom - 18),
    };
  })();

  return (
    <div
      ref={containerRef}
      data-pdf-page-container="true"
      data-pdf-page-index={pageIndex}
      data-pdf-scale-x={pageDimensions?.scaleX ? pageDimensions.scaleX * zoom : zoom * 1.333333}
      data-pdf-scale-y={pageDimensions?.scaleY ? pageDimensions.scaleY * zoom : zoom * 1.333333}
      className={`relative mb-6 mx-auto bg-white dark:bg-[#151515] shadow-lg rounded-sm transition-shadow border border-[#e4e2dd] dark:border-[#33312e] select-text ${mode === 'crop' ? 'cursor-crosshair' : ''}`} 
      style={{
        width: pageDimensions ? `${pageDimensions.width}px` : `${595 * 1.333333 * zoom}px`,
        height: pageDimensions ? `${pageDimensions.height}px` : `${842 * 1.333333 * zoom}px`,
        minHeight: pageDimensions ? undefined : `${842 * 1.333333 * zoom}px`,
        isolation: 'isolate',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onPointerMove={handleAnnotationPointerMove}
      onPointerUp={handleAnnotationPointerUp}
      onPointerCancel={handleAnnotationPointerUp}
    >
      {/* Canvas da página do PDF */}
      <canvas ref={canvasRef} className="absolute inset-0 block pointer-events-none" />

      {/* Camada de grifos (marca-texto) dedicada com mix-blend-mode: multiply direto sobre o canvas.
          Isso garante que o texto preto (0,0,0) permaneça 100% preto, nítido e com contraste máximo,
          enquanto o fundo branco (255,255,255) recebe a cor do grifo. */}
      {pageDimensions && (
        <svg
          className="pdf-highlights-layer absolute inset-0 w-full h-full overflow-visible pointer-events-none"
          viewBox={`0 0 ${pageDimensions.pdfWidth} ${pageDimensions.pdfHeight}`}
          style={{
            width: `${pageDimensions.width}px`,
            height: `${pageDimensions.height}px`,
            position: 'absolute',
            inset: 0,
            // No modo Selecionar, a camada de marcações fica acima da
            // camada de texto transparente para receber o clique diretamente.
            zIndex: mode === 'select' ? 4 : 1,
            pointerEvents: mode === 'select' ? 'auto' : 'none',
            mixBlendMode: 'multiply',
          }}
        >
          {pageAnnotations
            .filter((a) => a.type === 'highlight')
            .map((ann) => {
              const isSelected = ann.id === selectedAnnotationId;
              const dragOffset = annotationDragPreview?.id === ann.id ? annotationDragPreview : null;
              return (
                <g
                  key={ann.id}
                  data-pdf-annotation="true"
                  className="pointer-events-auto"
                  transform={dragOffset ? `translate(${dragOffset.deltaX} ${dragOffset.deltaY})` : undefined}
                  onPointerDown={(event) => handleAnnotationPointerDown(event, ann)}
                >
                  {ann.rects.map((r, i) => (
                    <rect
                      key={i}
                      x={r.x}
                      y={r.y}
                      width={r.width}
                      height={r.height}
                      // Todas as anotações são desenhadas uma única vez pela camada SVG.
                      // A cópia PDF.js usada na tela já remove as anotações nativas do ANOTADO.
                      fill={ann.color}
                      opacity={Math.max(ann.opacity ?? 0.58, 0.58)}
                      onClick={(e) => {
                        if (mode === 'hand') return;
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else onSelectAnnotation(ann.id);
                      }}
                      className={`${mode === 'hand' ? 'cursor-grab' : 'cursor-pointer'} ${isSelected ? 'stroke-2 stroke-blue-500' : ''}`}
                    />
                  ))}
                </g>
              );
            })}
          {isInteracting && startPoint && currentPoint && mode === 'highlight' && (
            <rect
              x={Math.min(startPoint.x, currentPoint.x)}
              y={Math.min(startPoint.y, currentPoint.y)}
              width={Math.abs(currentPoint.x - startPoint.x)}
              height={Math.abs(currentPoint.y - startPoint.y)}
              fill={highlightColor}
              opacity={0.8}
            />
          )}
          {isInteracting && startPoint && currentPoint && mode === 'crop' && (
            <rect
              x={Math.min(startPoint.x, currentPoint.x)}
              y={Math.min(startPoint.y, currentPoint.y)}
              width={Math.abs(currentPoint.x - startPoint.x)}
              height={Math.abs(currentPoint.y - startPoint.y)}
              fill="#5b8def"
              fillOpacity={0.16}
              stroke="#3975d7"
              strokeWidth={Math.max(1, 1 / zoom)}
              strokeDasharray={`${5 / zoom} ${3 / zoom}`}
            />
          )}
        </svg>
      )}

      {/* Texto transparente, mas selecionável e copiável como texto nativo do PDF. */}
      <div
        ref={textLayerRef}
        className="pdf-text-layer absolute inset-0 overflow-hidden"
        style={{
          width: pageDimensions ? `${pageDimensions.width}px` : '100%',
          height: pageDimensions ? `${pageDimensions.height}px` : '100%',
          zIndex: 2,
          pointerEvents: ['select', 'highlight', 'underline', 'strikethrough'].includes(mode) ? 'auto' : 'none',
          userSelect: ['select', 'highlight', 'underline', 'strikethrough'].includes(mode) ? 'text' : 'none',
          WebkitUserSelect: ['select', 'highlight', 'underline', 'strikethrough'].includes(mode) ? 'text' : 'none',
          cursor: ['highlight', 'underline', 'strikethrough', 'select'].includes(mode) ? 'text' : 'default',
        }}
        aria-label={`Texto da página ${pageIndex + 1}`}
      />

      {/* Camada interativa de SVG para anotações vetorizadas */}
      {pageDimensions && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
          viewBox={`0 0 ${pageDimensions.pdfWidth} ${pageDimensions.pdfHeight}`}
          style={{
            width: `${pageDimensions.width}px`,
            height: `${pageDimensions.height}px`,
            position: 'absolute',
            inset: 0,
            zIndex: mode === 'select' ? 5 : 3,
            pointerEvents: mode === 'select' || mode === 'eraser' ? 'auto' : 'none',
          }}
        >
          {/* Anotações existentes na página */}
          {pageAnnotations
            .filter((a) => a.type !== 'highlight')
            .map((ann) => {
              const isSelected = ann.id === selectedAnnotationId;
              const dragOffset = annotationDragPreview?.id === ann.id ? annotationDragPreview : null;
              const dragTransform = dragOffset
                ? `translate(${dragOffset.deltaX} ${dragOffset.deltaY})`
                : undefined;

            if (ann.type === 'crop') {
              const r = ann.rect;
              return (
                <g
                  key={ann.id}
                  data-pdf-annotation="true"
                  data-pdf-annotation-id={ann.id}
                  data-pdf-annotation-type="crop"
                  style={{ pointerEvents: mode === 'select' || mode === 'eraser' ? 'all' : 'none' }}
                  className={mode === 'select' || mode === 'eraser' ? 'cursor-pointer' : ''}
                  onPointerDown={(event) => {
                    if (mode !== 'select' && mode !== 'eraser') return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (mode === 'select') onSelectAnnotation(ann.id);
                  }}
                  onClick={(event) => {
                    if (mode !== 'select' && mode !== 'eraser') return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (mode === 'eraser') onDeleteAnnotation(ann.id);
                    else onSelectAnnotation(ann.id);
                  }}
                >
                  {/* Área de clique ampliada, invisível: facilita selecionar uma borda fina. */}
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.width}
                    height={r.height}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14 / Math.max(0.1, (pageDimensions?.scaleX || 1.333333) * zoom)}
                    pointerEvents="stroke"
                    className="cursor-pointer"
                  />
                  {/* Borda visível fina; sua aparência não muda ao ampliar a área clicável. */}
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.width}
                    height={r.height}
                    fill="none"
                    stroke={isSelected ? '#2563eb' : '#b39b86'}
                    strokeWidth={1 / Math.max(0.1, (pageDimensions?.scaleX || 1.333333) * zoom)}
                    pointerEvents="none"
                  />
                  {isSelected && (
                    <rect
                      x={r.x}
                      y={r.y}
                      width={r.width}
                      height={r.height}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth={3 / Math.max(0.1, (pageDimensions?.scaleX || 1.333333) * zoom)}
                      strokeOpacity={0.2}
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            }

            if (ann.type === 'drawing') {
              if (!ann.points || ann.points.length < 2) return null;
              const pathData = ann.points.reduce((acc, pt, i) => {
                return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
              }, '');
              return (
                <g
                  key={ann.id}
                  data-pdf-annotation="true"
                  className="pointer-events-auto"
                  transform={dragTransform}
                  onPointerDown={(event) => handleAnnotationPointerDown(event, ann)}
                >
                  <path
                    d={pathData}
                    fill="none"
                    stroke={ann.color}
                    strokeWidth={ann.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={ann.opacity}
                    onClick={(e) => {
                      if (mode === 'hand') return;
                      e.stopPropagation();
                      if (mode === 'eraser') {
                        onDeleteAnnotation(ann.id);
                      } else {
                        onSelectAnnotation(ann.id);
                      }
                    }}
                    className={`cursor-pointer ${isSelected ? 'stroke-blue-500' : ''}`}
                  />
                  {isSelected && (
                    <path
                      d={pathData}
                      fill="none"
                      stroke="#2563eb"
                      pointerEvents="none"
                      strokeWidth={ann.strokeWidth + 3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.3}
                    />
                  )}
                </g>
              );
            }

            if (ann.type === 'underline') {
              return (
                <g
                  key={ann.id}
                  data-pdf-annotation="true"
                  className="pointer-events-auto"
                  transform={dragTransform}
                  onPointerDown={(event) => handleAnnotationPointerDown(event, ann)}
                >
                  {ann.rects.map((r, i) => (
                    <line
                      key={i}
                      x1={r.x}
                      y1={r.y + r.height}
                      x2={r.x + r.width}
                      y2={r.y + r.height}
                      stroke={isSelected ? '#2563eb' : ann.color}
                      strokeWidth={isSelected ? 3 : 2}
                      onClick={(e) => {
                        if (mode === 'hand') return;
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else onSelectAnnotation(ann.id);
                      }}
                      className={mode === 'hand' ? 'cursor-grab' : 'cursor-pointer'}
                    />
                  ))}
                </g>
              );
            }

            if (ann.type === 'strikethrough') {
              return (
                <g
                  key={ann.id}
                  data-pdf-annotation="true"
                  className="pointer-events-auto"
                  transform={dragTransform}
                  onPointerDown={(event) => handleAnnotationPointerDown(event, ann)}
                >
                  {ann.rects.map((r, i) => (
                    <line
                      key={i}
                      x1={r.x}
                      y1={r.y + r.height / 2}
                      x2={r.x + r.width}
                      y2={r.y + r.height / 2}
                      stroke={isSelected ? '#2563eb' : ann.color}
                      strokeWidth={isSelected ? 3 : 2}
                      onClick={(e) => {
                        if (mode === 'hand') return;
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else onSelectAnnotation(ann.id);
                      }}
                      className="cursor-pointer"
                    />
                  ))}
                </g>
              );
            }

            if (ann.type === 'shape') {
              const isLineOrArrow = ann.shapeType === 'line' || ann.shapeType === 'arrow';
              return (
                <g
                  key={ann.id}
                  data-pdf-annotation="true"
                  className="pointer-events-auto"
                  transform={dragTransform}
                  onPointerDown={(event) => handleAnnotationPointerDown(event, ann)}
                >
                  {ann.shapeType === 'rectangle' && (
                    <rect
                      x={ann.x}
                      y={ann.y}
                      width={ann.width}
                      height={ann.height}
                      stroke={ann.strokeColor}
                      strokeWidth={ann.strokeWidth}
                      fill={ann.fillColor || 'transparent'}
                      onClick={(e) => {
                        if (mode === 'hand') return;
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else onSelectAnnotation(ann.id);
                      }}
                      className={`cursor-pointer ${isSelected ? 'stroke-blue-500' : ''}`}
                    />
                  )}
                  {ann.shapeType === 'circle' && (
                    <ellipse
                      cx={ann.x + Math.abs(ann.width) / 2}
                      cy={ann.y + Math.abs(ann.height) / 2}
                      rx={Math.abs(ann.width) / 2}
                      ry={Math.abs(ann.height) / 2}
                      stroke={ann.strokeColor}
                      strokeWidth={ann.strokeWidth}
                      fill={ann.fillColor || 'transparent'}
                      onClick={(e) => {
                        if (mode === 'hand') return;
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else onSelectAnnotation(ann.id);
                      }}
                      className={`cursor-pointer ${isSelected ? 'stroke-blue-500' : ''}`}
                    />
                  )}
                  {isLineOrArrow && (
                    <line
                      x1={ann.x}
                      y1={ann.y}
                      x2={ann.x + ann.width}
                      y2={ann.y + ann.height}
                      stroke={ann.strokeColor}
                      strokeWidth={ann.strokeWidth}
                      onClick={(e) => {
                        if (mode === 'hand') return;
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else onSelectAnnotation(ann.id);
                      }}
                      className={`cursor-pointer ${isSelected ? 'stroke-blue-500' : ''}`}
                    />
                  )}
                </g>
              );
            }

            return null;
          })}

          {/* Anotação em tempo real enquanto arrasta */}
          {isInteracting && startPoint && currentPoint && (
            <g className="pointer-events-none opacity-80">
              {mode === 'pen' && activePoints.length > 1 && (
                <path
                  d={activePoints.reduce((acc, pt, i) => (i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`), '')}
                  fill="none"
                  stroke={penColor}
                  strokeWidth={penWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {mode === 'underline' && (
                <line
                  x1={Math.min(startPoint.x, currentPoint.x)}
                  y1={startPoint.y + 14}
                  x2={Math.max(startPoint.x, currentPoint.x)}
                  y2={startPoint.y + 14}
                  stroke={penColor}
                  strokeWidth={2}
                />
              )}
              {mode === 'strikethrough' && (
                <line
                  x1={Math.min(startPoint.x, currentPoint.x)}
                  y1={startPoint.y + 7}
                  x2={Math.max(startPoint.x, currentPoint.x)}
                  y2={startPoint.y + 7}
                  stroke={penColor}
                  strokeWidth={2}
                />
              )}
              {mode === 'shape' && currentShape === 'rectangle' && (
                <rect
                  x={Math.min(startPoint.x, currentPoint.x)}
                  y={Math.min(startPoint.y, currentPoint.y)}
                  width={Math.abs(currentPoint.x - startPoint.x)}
                  height={Math.abs(currentPoint.y - startPoint.y)}
                  stroke={penColor}
                  strokeWidth={penWidth}
                  fill="transparent"
                />
              )}
              {mode === 'shape' && currentShape === 'circle' && (
                <ellipse
                  cx={Math.min(startPoint.x, currentPoint.x) + Math.abs(currentPoint.x - startPoint.x) / 2}
                  cy={Math.min(startPoint.y, currentPoint.y) + Math.abs(currentPoint.y - startPoint.y) / 2}
                  rx={Math.abs(currentPoint.x - startPoint.x) / 2}
                  ry={Math.abs(currentPoint.y - startPoint.y) / 2}
                  stroke={penColor}
                  strokeWidth={penWidth}
                  fill="transparent"
                />
              )}
              {mode === 'shape' && (currentShape === 'line' || currentShape === 'arrow') && (
                <line
                  x1={startPoint.x}
                  y1={startPoint.y}
                  x2={currentPoint.x}
                  y2={currentPoint.y}
                  stroke={penColor}
                  strokeWidth={penWidth}
                />
              )}
            </g>
          )}
        </svg>
      )}

      {/* Camada HTML para Caixas de Texto, Notas Adesivas, Drag Preview e Ações Flutuantes */}
      {pageDimensions && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ width: `${pageDimensions.width}px`, height: `${pageDimensions.height}px` }}
        >
          {/* Preview da caixa de texto durante o arrasto */}
          {isDraggingTextBox && textDragStart && textDragCurrent && (
            <div
              style={{
                position: 'absolute',
                left: `${Math.min(textDragStart.x, textDragCurrent.x) * (pageDimensions?.scaleX || 1.333333) * zoom}px`,
                top: `${Math.min(textDragStart.y, textDragCurrent.y) * (pageDimensions?.scaleY || 1.333333) * zoom}px`,
                width: `${Math.max(Math.abs(textDragCurrent.x - textDragStart.x), 24) * (pageDimensions?.scaleX || 1.333333) * zoom}px`,
                height: `${Math.max(Math.abs(textDragCurrent.y - textDragStart.y), 24) * (pageDimensions?.scaleY || 1.333333) * zoom}px`,
                borderColor: penColor,
              }}
              className="border-2 border-dashed rounded-md bg-[#68594d]/10 dark:bg-white/10 pointer-events-none flex items-center justify-center p-1.5 text-xs text-[#68594d] dark:text-[#d4c8bc] font-sans-ui select-none z-30"
            >
              <span className="opacity-75 font-medium">Texto</span>
            </div>
          )}

          {/* Lixeira contextual para qualquer edição selecionada, exceto nota adesiva. */}
          {!isReadOnly && selectedDeletableAnnotation && selectedDeletePosition && (
            <div
              key={`delete-${selectedDeletableAnnotation.id}`}
              data-pdf-annotation="true"
              data-pdf-annotation-trash="true"
              style={{
                position: 'absolute',
                left: `${selectedDeletePosition.left}px`,
                top: `${selectedDeletePosition.top}px`,
                transform: 'translate(-50%, -50%)',
                zIndex: 80,
              }}
              className="pointer-events-auto"
              onMouseDown={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteAnnotation(selectedDeletableAnnotation.id);
                  onSelectAnnotation(null);
                }}
                className="p-1.5 rounded-full bg-white dark:bg-[#252422] text-[#ba1a1a] shadow-lg border border-[#e4e2dd] dark:border-[#383633] hover:bg-[#ba1a1a] hover:text-white transition-all cursor-pointer flex items-center justify-center hover:scale-110 active:scale-95"
                title="Excluir edição"
                aria-label="Excluir edição selecionada"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Anotações HTML na página */}
          {pageAnnotations.map((ann) => {
            const isSelected = ann.id === selectedAnnotationId;
            const scaleX = pageDimensions?.scaleX || 1.333333;
            const scaleY = pageDimensions?.scaleY || 1.333333;

            if (ann.type === 'text') {
              return (
                <div
                  key={ann.id}
                  data-pdf-annotation="true"
                  data-pdf-annotation-id={ann.id}
                  data-pdf-annotation-type="text"
                  data-pdf-text-editor="true"
                  style={{
                    position: 'absolute',
                    left: `${(ann.x + (annotationDragPreview?.id === ann.id ? annotationDragPreview.deltaX : 0)) * scaleX * zoom}px`,
                    top: `${(ann.y + (annotationDragPreview?.id === ann.id ? annotationDragPreview.deltaY : 0)) * scaleY * zoom}px`,
                    width: ann.width ? `${ann.width * scaleX * zoom}px` : `${160 * scaleX * zoom}px`,
                    minHeight: ann.height ? `${ann.height * scaleY * zoom}px` : `${36 * scaleY * zoom}px`,
                    fontSize: `${(ann.fontSize || 14) * scaleX * zoom}px`,
                    color: ann.color,
                  }}
                  className={`pointer-events-auto group relative ${mode === 'hand' ? 'cursor-grab' : ''} ${
                    isSelected
                      ? 'ring-2 ring-[#2563eb] rounded-md p-1 bg-white/95 dark:bg-[#1a1918]/95 shadow-lg'
                      : 'p-1 hover:ring-1 hover:ring-black/20 dark:hover:ring-white/20 rounded-md'
                  }`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    if (mode === 'hand') return;
                    e.stopPropagation();
                    if (mode === 'eraser') onDeleteAnnotation(ann.id);
                    else onSelectAnnotation(ann.id);
                  }}
                >
                  {isSelected && !isReadOnly && (
                    <button
                      type="button"
                      data-pdf-annotation="true"
                      title="Arrastar caixa de texto"
                      aria-label="Mover caixa de texto"
                      onPointerDown={(event) => handleAnnotationPointerDown(event, ann)}
                      onClick={(event) => event.stopPropagation()}
                      className="absolute -top-3 -right-3 z-50 p-1 rounded-md bg-white dark:bg-[#252422] text-[#68594d] shadow-md border border-[#e4e2dd] dark:border-[#383633] cursor-grab active:cursor-grabbing hover:bg-[#efebe2]"
                    >
                      <Move className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <textarea
                    data-pdf-annotation="true"
                    data-pdf-annotation-type="text"
                    data-pdf-text-editor="true"
                    value={ann.text}
                    placeholder={isSelected ? 'Digite aqui...' : ''}
                    readOnly={isReadOnly || mode === 'hand' || mode === 'eraser'}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      if (mode === 'hand') return;
                      e.stopPropagation();
                      onSelectAnnotation(ann.id);
                    }}
                    onChange={(e) => {
                      onUpdateAnnotation({ ...ann, text: e.target.value, updatedAt: new Date().toISOString() });
                    }}
                    autoFocus={isSelected && !ann.text}
                    className={`w-full h-full min-h-[28px] bg-transparent resize border-none focus:outline-none font-sans-ui leading-tight p-0.5 placeholder:text-black/40 dark:placeholder:text-white/40 ${mode === 'hand' ? 'cursor-grab' : ''}`}
                    rows={ann.text ? ann.text.split('\n').length : 1}
                  />
                </div>
              );
            }

            if (ann.type === 'sticky_note') {
              const isOpen = openStickyNoteId === ann.id;
              const isHovered = hoveredStickyNoteId === ann.id;
              const displayX = stickyDragPreview?.id === ann.id ? stickyDragPreview.x : ann.x;
              const displayY = stickyDragPreview?.id === ann.id ? stickyDragPreview.y : ann.y;

              return (
                <div
                  key={ann.id}
                  data-pdf-annotation="true"
                  data-pdf-annotation-id={ann.id}
                  data-pdf-annotation-type="sticky_note"
                  style={{
                    position: 'absolute',
                    left: `${displayX * scaleX * zoom}px`,
                    top: `${displayY * scaleY * zoom}px`,
                  }}
                  className="pointer-events-auto z-30"
                  onMouseEnter={() => setHoveredStickyNoteId(ann.id)}
                  onMouseLeave={() => setHoveredStickyNoteId((current) => current === ann.id ? null : current)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => {
                      if (mode === 'hand') return;
                      e.stopPropagation();
                      if (isReadOnly || mode !== 'select' || e.button !== 0) return;

                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      stickyDragRef.current = {
                        id: ann.id,
                        pointerId: e.pointerId,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        originX: ann.x,
                        originY: ann.y,
                        moved: false,
                      };
                      suppressStickyClickRef.current = false;
                      onSelectAnnotation(ann.id);
                      setOpenStickyNoteId(null);
                    }}
                    onPointerMove={(e) => {
                      const drag = stickyDragRef.current;
                      if (!drag || drag.id !== ann.id || drag.pointerId !== e.pointerId) return;

                      const deltaX = e.clientX - drag.startClientX;
                      const deltaY = e.clientY - drag.startClientY;
                      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) drag.moved = true;
                      if (!drag.moved) return;

                      setStickyDragPreview({
                        id: ann.id,
                        x: Math.max(0, drag.originX + deltaX / (scaleX * zoom)),
                        y: Math.max(0, drag.originY + deltaY / (scaleY * zoom)),
                      });
                    }}
                    onPointerUp={(e) => {
                      const drag = stickyDragRef.current;
                      if (!drag || drag.id !== ann.id || drag.pointerId !== e.pointerId) return;

                      const deltaX = e.clientX - drag.startClientX;
                      const deltaY = e.clientY - drag.startClientY;
                      const didMove = drag.moved || Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3;

                      if (didMove) {
                        onUpdateAnnotation({
                          ...ann,
                          x: Math.max(0, drag.originX + deltaX / (scaleX * zoom)),
                          y: Math.max(0, drag.originY + deltaY / (scaleY * zoom)),
                          updatedAt: new Date().toISOString(),
                        });
                        suppressStickyClickRef.current = true;
                        window.setTimeout(() => {
                          suppressStickyClickRef.current = false;
                        }, 300);
                      }

                      stickyDragRef.current = null;
                      setStickyDragPreview(null);
                    }}
                    onPointerCancel={() => {
                      stickyDragRef.current = null;
                      setStickyDragPreview(null);
                    }}
                    onClick={(e) => {
                      if (mode === 'hand') return;
                      e.stopPropagation();
                      if (suppressStickyClickRef.current) {
                        suppressStickyClickRef.current = false;
                        return;
                      }

                      if (mode === 'eraser') {
                        onDeleteAnnotation(ann.id);
                      } else {
                        onSelectAnnotation(ann.id);
                        setOpenStickyNoteId((current) => current === ann.id ? null : ann.id);
                      }
                    }}
                    className="w-7 h-7 rounded-lg bg-[#fef08a] hover:bg-[#fde047] text-[#854d0e] flex items-center justify-center shadow-md border border-[#eab308] cursor-grab active:cursor-grabbing transition-transform hover:scale-110"
                    title={mode === 'select' ? 'Clique para editar; arraste para mover' : 'Nota adesiva'}
                    aria-label="Nota adesiva"
                  >
                    <MessageSquare className="w-4 h-4 fill-[#fef08a]" />
                  </button>

                  {isHovered && !isOpen && (
                    <div
                      data-pdf-annotation="true"
                      data-pdf-annotation-type="sticky_note_preview"
                      className="absolute left-9 top-0 w-56 max-w-[min(56vw,240px)] px-3 py-2 rounded-lg bg-[#fff4b8] text-[#3d3214] border border-[#eab308] shadow-lg z-[60] pointer-events-none whitespace-pre-wrap break-words text-xs leading-relaxed"
                    >
                      <span className="block text-[10px] uppercase tracking-wide font-bold text-[#854d0e] mb-1">
                        Comentário
                      </span>
                      {ann.text?.trim() || 'Comentário vazio'}
                    </div>
                  )}

                  {isOpen && (
                    <div
                      data-pdf-annotation="true"
                      data-pdf-annotation-type="sticky_note_popover"
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute top-full left-0 mt-1 w-64 bg-[#fef08a] text-[#1b1c19] rounded-xl p-3 shadow-xl border border-[#eab308] z-[70] animate-in fade-in zoom-in-95"
                    >
                      <div className="flex items-center justify-between mb-1.5 border-b border-[#eab308]/40 pb-1">
                        <span className="text-xs font-bold uppercase tracking-wider text-[#854d0e] font-sans-ui">
                          Comentário
                        </span>
                        <div className="flex items-center gap-1">
                          {!isReadOnly && (
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteAnnotation(ann.id);
                                setOpenStickyNoteId(null);
                                setHoveredStickyNoteId(null);
                              }}
                              className="text-[#ba1a1a] hover:bg-[#ba1a1a]/10 p-1 rounded cursor-pointer"
                              title="Excluir comentário"
                              aria-label="Excluir comentário"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenStickyNoteId(null);
                            }}
                            className="text-[#854d0e] hover:text-[#1b1c19] p-0.5 rounded cursor-pointer"
                            title="Fechar comentário"
                            aria-label="Fechar comentário"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <textarea
                        data-pdf-annotation="true"
                        value={ann.text}
                        readOnly={isReadOnly}
                        placeholder="Escreva uma nota..."
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          onUpdateAnnotation({
                            ...ann,
                            text: e.target.value,
                            updatedAt: new Date().toISOString(),
                          });
                        }}
                        className="w-full h-24 bg-transparent resize-none border-none focus:outline-none text-xs font-sans-ui placeholder-[#a16207]"
                        autoFocus
                      />
                    </div>
                  )}
                </div>
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}
