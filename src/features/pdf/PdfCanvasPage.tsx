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
import { StickyNote, X, MessageSquare } from 'lucide-react';

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

  // Active sticky note popover state
  const [openStickyNoteId, setOpenStickyNoteId] = useState<string | null>(null);

  // Dragging selected annotation
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);

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
        });
        const canvasPromise = renderTaskRef.current.promise;

        // A renderização visual do canvas não depende da extração de texto.
        // PDFs digitalizados/sem camada textual continuam visíveis caso getTextContent falhe.
        let textContent: any = null;
        try {
          textContent = await page.getTextContent();
        } catch (textError) {
          console.warn(`[PdfCanvasPage] Não foi possível extrair texto da página ${pageIndex + 1}; mantendo o canvas visual:`, textError);
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
        for (const item of (textContent?.items || []) as any[]) {
          if (isCancelled) return;
          if (renderedTextItems >= 50000) break;
          if (!item || typeof item.str !== 'string' || !item.str) {
            if (item?.hasEOL) textLayer.appendChild(document.createElement('br'));
            continue;
          }

          const style = textContent.styles?.[item.fontName] || {};
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
    if (mode === 'select' && (e.target as HTMLElement)?.closest?.('.pdf-text-layer')) return;
    if (e.button !== 0) return; // Only left click

    const pt = getUnscaledCoords(e);
    setIsInteracting(true);
    setStartPoint(pt);
    setCurrentPoint(pt);

    if (mode === 'pen') {
      setActivePoints([pt]);
    } else if (mode === 'text') {
      // Place new text box
      const id = `text_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const newText: TextAnnotation = {
        id,
        pageIndex,
        type: 'text',
        x: pt.x,
        y: pt.y,
        width: 180,
        height: 40,
        text: 'Novo texto',
        fontSize: 14,
        color: penColor,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onAddAnnotation(newText);
      onSelectAnnotation(id);
      setIsInteracting(false);
    } else if (mode === 'sticky_note') {
      // Place new sticky note
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
      setOpenStickyNoteId(id);
      setIsInteracting(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isInteracting || isReadOnly || mode === 'hand') return;
    const pt = getUnscaledCoords(e);
    setCurrentPoint(pt);

    if (mode === 'pen') {
      setActivePoints((prev) => [...prev, pt]);
    }
  };

  const handleMouseUp = () => {
    if (!isInteracting || isReadOnly) return;
    setIsInteracting(false);

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
    } else if (mode === 'highlight' && width > 4 && height > 4) {
      const id = `hl_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const hl: HighlightAnnotation = {
        id,
        pageIndex,
        type: 'highlight',
        rects: [{ x: minX, y: minY, width, height }],
        color: highlightColor,
        opacity: 0.35,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onAddAnnotation(hl);
    } else if (mode === 'underline' && width > 4) {
      const id = `ul_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const ul: UnderlineAnnotation = {
        id,
        pageIndex,
        type: 'underline',
        rects: [{ x: minX, y: minY, width, height: Math.max(height, 12) }],
        color: penColor,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onAddAnnotation(ul);
    } else if (mode === 'strikethrough' && width > 4) {
      const id = `st_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const st: StrikeAnnotation = {
        id,
        pageIndex,
        type: 'strikethrough',
        rects: [{ x: minX, y: minY, width, height: Math.max(height, 12) }],
        color: penColor,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      onAddAnnotation(st);
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
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Canvas da página do PDF */}
      <canvas ref={canvasRef} className="absolute inset-0 block pointer-events-none" />

      {/* Texto transparente, mas selecionável e copiável como texto nativo do PDF. */}
      <div
        ref={textLayerRef}
        className="pdf-text-layer absolute inset-0 overflow-hidden"
        style={{
          width: pageDimensions ? `${pageDimensions.width}px` : '100%',
          height: pageDimensions ? `${pageDimensions.height}px` : '100%',
          zIndex: 2,
          pointerEvents: mode === 'select' ? 'auto' : 'none',
          userSelect: mode === 'select' ? 'text' : 'none',
          WebkitUserSelect: mode === 'select' ? 'text' : 'none',
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
          {pageAnnotations.map((ann) => {
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

            if (ann.type === 'highlight') {
              return (
                <g key={ann.id} className="pointer-events-auto">
                  {ann.rects.map((r, i) => (
                    <rect
                      key={i}
                      x={r.x}
                      y={r.y}
                      width={r.width}
                      height={r.height}
                      fill={ann.color}
                      opacity={ann.opacity}
                      style={{ mixBlendMode: 'multiply' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else if (mode === 'select') onSelectAnnotation(ann.id);
                      }}
                      className={`cursor-pointer ${isSelected ? 'stroke-2 stroke-blue-500' : ''}`}
                    />
                  ))}
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
                      stroke={ann.color}
                      strokeWidth={2}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else if (mode === 'select') onSelectAnnotation(ann.id);
                      }}
                      className={`cursor-pointer ${isSelected ? 'stroke-blue-500' : ''}`}
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
                      stroke={ann.color}
                      strokeWidth={2}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (mode === 'eraser') onDeleteAnnotation(ann.id);
                        else if (mode === 'select') onSelectAnnotation(ann.id);
                      }}
                      className={`cursor-pointer ${isSelected ? 'stroke-blue-500' : ''}`}
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
              {mode === 'highlight' && (
                <rect
                  x={Math.min(startPoint.x, currentPoint.x)}
                  y={Math.min(startPoint.y, currentPoint.y)}
                  width={Math.abs(currentPoint.x - startPoint.x)}
                  height={Math.abs(currentPoint.y - startPoint.y)}
                  fill={highlightColor}
                  opacity={0.35}
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

      {/* Camada HTML para Caixas de Texto e Notas Adesivas */}
      {pageDimensions && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ width: `${pageDimensions.width}px`, height: `${pageDimensions.height}px` }}
        >
          {pageAnnotations.map((ann) => {
            const isSelected = ann.id === selectedAnnotationId;

            if (ann.type === 'text') {
              return (
                <div
                  key={ann.id}
                  style={{
                    position: 'absolute',
                    left: `${ann.x * (pageDimensions?.scaleX || 1.333333) * zoom}px`,
                    top: `${ann.y * (pageDimensions?.scaleY || 1.333333) * zoom}px`,
                    minWidth: `${(ann.width || 120) * (pageDimensions?.scaleX || 1.333333) * zoom}px`,
                    fontSize: `${(ann.fontSize || 14) * (pageDimensions?.scaleX || 1.333333) * zoom}px`,
                    color: ann.color,
                  }}
                  className={`pointer-events-auto group ${
                    isSelected ? 'ring-2 ring-[#2563eb] rounded-md p-1 bg-white/90 dark:bg-black/90' : 'p-1'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (mode === 'eraser') onDeleteAnnotation(ann.id);
                    else onSelectAnnotation(ann.id);
                  }}
                >
                  <textarea
                    value={ann.text}
                    readOnly={isReadOnly || mode !== 'select'}
                    onChange={(e) => {
                      onUpdateAnnotation({ ...ann, text: e.target.value, updatedAt: new Date().toISOString() });
                    }}
                    className="w-full bg-transparent resize border-none focus:outline-none font-sans-ui leading-tight p-0"
                    rows={ann.text.split('\n').length || 1}
                  />
                </div>
              );
            }

            if (ann.type === 'sticky_note') {
              const isOpen = openStickyNoteId === ann.id;
              return (
                <div
                  key={ann.id}
                  style={{
                    position: 'absolute',
                    left: `${ann.x * (pageDimensions?.scaleX || 1.333333) * zoom}px`,
                    top: `${ann.y * (pageDimensions?.scaleY || 1.333333) * zoom}px`,
                  }}
                  className="pointer-events-auto z-30"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (mode === 'eraser') {
                        onDeleteAnnotation(ann.id);
                      } else {
                        setOpenStickyNoteId(isOpen ? null : ann.id);
                        onSelectAnnotation(ann.id);
                      }
                    }}
                    className="w-7 h-7 rounded-lg bg-[#fef08a] hover:bg-[#fde047] text-[#854d0e] flex items-center justify-center shadow-md border border-[#eab308] cursor-pointer transition-transform hover:scale-110"
                    title="Nota adesiva"
                  >
                    <MessageSquare className="w-4 h-4 fill-[#fef08a]" />
                  </button>

                  {isOpen && (
                    <div className="absolute top-full left-0 mt-1 w-64 bg-[#fef08a] text-[#1b1c19] rounded-xl p-3 shadow-xl border border-[#eab308] z-50">
                      <div className="flex items-center justify-between mb-1.5 border-b border-[#eab308]/40 pb-1">
                        <span className="text-xs font-bold uppercase tracking-wider text-[#854d0e] font-sans-ui">
                          Comentário
                        </span>
                        <button
                          type="button"
                          onClick={() => setOpenStickyNoteId(null)}
                          className="text-[#854d0e] hover:text-[#1b1c19] p-0.5 rounded cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <textarea
                        value={ann.text}
                        readOnly={isReadOnly}
                        placeholder="Escreva uma nota..."
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
