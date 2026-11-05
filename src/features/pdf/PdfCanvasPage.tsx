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
import { StickyNote, X, MessageSquare, Trash2 } from 'lucide-react';

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
          const fontAscent = fontHeight * ascentRatio;
          const left = angle === 0 ? tx[4] : tx[4] + fontAscent * Math.sin(angle);
          const top = angle === 0 ? tx[5] - fontAscent : tx[5] - fontAscent * Math.cos(angle);

          const span = document.createElement('span');
          span.textContent = item.str;
          span.dir = item.dir || 'ltr';
          span.setAttribute('role', 'presentation');
          span.style.left = `${(left / viewport.width) * 100}%`;
          span.style.top = `${(top / viewport.height) * 100}%`;
          span.style.fontSize = `${fontHeight}px`;
          span.style.fontFamily = style.fontFamily || 'sans-serif';
          span.style.lineHeight = '1';
          span.style.whiteSpace = 'pre';
          span.style.color = 'transparent';
          span.style.position = 'absolute';
          span.style.transformOrigin = '0 0';

          let transform = angle ? `rotate(${angle}rad) ` : '';
          if (measureContext && item.str.length > 1 && item.width > 0) {
            measureContext.font = `${fontHeight}px ${style.fontFamily || 'sans-serif'}`;
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

  // Mouse handlers for annotations
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isReadOnly || mode === 'hand') return;

    const target = e.target as HTMLElement | null;

    // Se o clique veio de uma anotação existente, textarea, popover ou botão, aborte a criação
    if (
      target?.closest('[data-pdf-annotation]') ||
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

    const pt = getUnscaledCoords(e);
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

  return (
    <div
      ref={containerRef}
      data-pdf-page-container="true"
      data-pdf-page-index={pageIndex}
      data-pdf-scale-x={pageDimensions?.scaleX ? pageDimensions.scaleX * zoom : zoom * 1.333333}
      data-pdf-scale-y={pageDimensions?.scaleY ? pageDimensions.scaleY * zoom : zoom * 1.333333}
      className="relative mb-6 mx-auto bg-white dark:bg-[#151515] shadow-lg rounded-sm transition-shadow border border-[#e4e2dd] dark:border-[#33312e] select-text"
      style={{
        width: pageDimensions ? `${pageDimensions.width}px` : `${595 * 1.333333 * zoom}px`,
        height: pageDimensions ? `${pageDimensions.height}px` : `${842 * 1.333333 * zoom}px`,
        minHeight: pageDimensions ? undefined : `${842 * 1.333333 * zoom}px`,
        isolation: 'isolate',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
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
            zIndex: 1,
            pointerEvents: 'none',
            mixBlendMode: 'multiply',
          }}
        >
          {pageAnnotations
            .filter((a) => a.type === 'highlight')
            .map((ann) => {
              const isSelected = ann.id === selectedAnnotationId;
              return (
                <g key={ann.id} className="pointer-events-auto">
                  {ann.rects.map((r, i) => (
                    <rect
                      key={i}
                      x={r.x}
                      y={r.y}
                      width={r.width}
                      height={r.height}
                      // O PDF.js já compõe grifos nativos /Highlight sobre
                      // o canvas. O SVG mantém somente uma área clicável para seleção.
                      fill={ann.isNative ? 'rgba(0,0,0,0.001)' : ann.color}
                      opacity={ann.isNative ? 1 : (ann.opacity ?? 0.85)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else onSelectAnnotation(ann.id);
                      }}
                      className={`cursor-pointer ${isSelected ? 'stroke-2 stroke-blue-500' : ''}`}
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
          style={{ width: `${pageDimensions.width}px`, height: `${pageDimensions.height}px`, position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none' }}
        >
          {/* Anotações existentes na página */}
          {pageAnnotations
            .filter((a) => a.type !== 'highlight')
            .map((ann) => {
              const isSelected = ann.id === selectedAnnotationId;

            if (ann.type === 'drawing') {
              if (!ann.points || ann.points.length < 2) return null;
              const pathData = ann.points.reduce((acc, pt, i) => {
                return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
              }, '');
              return (
                <g key={ann.id} className="pointer-events-auto">
                  <path
                    d={pathData}
                    fill="none"
                    stroke={ann.color}
                    strokeWidth={ann.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={ann.opacity}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (mode === 'eraser') {
                        onDeleteAnnotation(ann.id);
                      } else if (mode === 'select') {
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
                <g key={ann.id} className="pointer-events-auto">
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

            if (ann.type === 'strikethrough') {
              return (
                <g key={ann.id} className="pointer-events-auto">
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
                <g key={ann.id} className="pointer-events-auto">
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
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else if (mode === 'select') onSelectAnnotation(ann.id);
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
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else if (mode === 'select') onSelectAnnotation(ann.id);
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
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else if (mode === 'select') onSelectAnnotation(ann.id);
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

          {/* Anotações HTML na página */}
          {pageAnnotations.map((ann) => {
            const isSelected = ann.id === selectedAnnotationId;
            const scaleX = pageDimensions?.scaleX || 1.333333;
            const scaleY = pageDimensions?.scaleY || 1.333333;

            // Botão de lixeira flutuante discreto sobre a marcação de texto selecionada
            if (isSelected && (ann.type === 'highlight' || ann.type === 'underline' || ann.type === 'strikethrough')) {
              const rects = ann.rects || [];
              if (rects.length > 0) {
                const minY = Math.min(...rects.map((r) => r.y));
                const maxX = Math.max(...rects.map((r) => r.x + r.width));
                const buttonLeft = maxX * scaleX * zoom;
                const buttonTop = Math.max(14, minY * scaleY * zoom - 14);

                return (
                  <div
                    key={`trash-${ann.id}`}
                    data-pdf-annotation="true"
                    data-pdf-annotation-trash="true"
                    style={{
                      position: 'absolute',
                      left: `${buttonLeft}px`,
                      top: `${buttonTop}px`,
                      transform: 'translate(-50%, -50%)',
                      zIndex: 40,
                    }}
                    className="pointer-events-auto"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteAnnotation(ann.id);
                      }}
                      className="p-1.5 rounded-full bg-white dark:bg-[#252422] text-[#ba1a1a] shadow-lg border border-[#e4e2dd] dark:border-[#383633] hover:bg-[#ba1a1a] hover:text-white transition-all cursor-pointer flex items-center justify-center hover:scale-110 active:scale-95"
                      title="Excluir marcação (Del)"
                      aria-label="Excluir marcação"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              }
            }

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
                    left: `${ann.x * scaleX * zoom}px`,
                    top: `${ann.y * scaleY * zoom}px`,
                    width: ann.width ? `${ann.width * scaleX * zoom}px` : `${160 * scaleX * zoom}px`,
                    minHeight: ann.height ? `${ann.height * scaleY * zoom}px` : `${36 * scaleY * zoom}px`,
                    fontSize: `${(ann.fontSize || 14) * scaleX * zoom}px`,
                    color: ann.color,
                  }}
                  className={`pointer-events-auto group ${
                    isSelected
                      ? 'ring-2 ring-[#2563eb] rounded-md p-1 bg-white/95 dark:bg-[#1a1918]/95 shadow-lg'
                      : 'p-1 hover:ring-1 hover:ring-black/20 dark:hover:ring-white/20 rounded-md'
                  }`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (mode === 'eraser') onDeleteAnnotation(ann.id);
                    else onSelectAnnotation(ann.id);
                  }}
                >
                  <textarea
                    data-pdf-annotation="true"
                    data-pdf-annotation-type="text"
                    data-pdf-text-editor="true"
                    value={ann.text}
                    placeholder={isSelected ? 'Digite aqui...' : ''}
                    readOnly={isReadOnly || mode === 'hand' || mode === 'eraser'}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAnnotation(ann.id);
                    }}
                    onChange={(e) => {
                      onUpdateAnnotation({ ...ann, text: e.target.value, updatedAt: new Date().toISOString() });
                    }}
                    autoFocus={isSelected && !ann.text}
                    className="w-full h-full min-h-[28px] bg-transparent resize border-none focus:outline-none font-sans-ui leading-tight p-0.5 placeholder:text-black/40 dark:placeholder:text-white/40"
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
