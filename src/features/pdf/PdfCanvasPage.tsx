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
  } | null>(null);

  // Drawing state
  const [isInteracting, setIsInteracting] = useState(false);
  const [activePoints, setActivePoints] = useState<Array<{ x: number; y: number }>>([]);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [currentPoint, setCurrentPoint] = useState<{ x: number; y: number } | null>(null);

  // Active sticky note popover state
  const [openStickyNoteId, setOpenStickyNoteId] = useState<string | null>(null);

  // Dragging selected annotation
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);

  // Render the PDF page to canvas
  useEffect(() => {
    let isCancelled = false;

    async function renderPage() {
      if (!pdfDoc || !canvasRef.current) return;
      try {
        const page = await pdfDoc.getPage(pageIndex + 1);
        if (isCancelled) return;

        const unscaledViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: zoom });

        setPageDimensions({
          width: viewport.width,
          height: viewport.height,
          unscaledWidth: unscaledViewport.width,
          unscaledHeight: unscaledViewport.height,
        });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
        ctx.scale(dpr, dpr);

        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        renderTaskRef.current = page.render({
          canvasContext: ctx,
          viewport: viewport,
        });

        await renderTaskRef.current.promise;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          // ignore cancelled
        }
      }
    }

    renderPage();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }
    };
  }, [pdfDoc, pageIndex, zoom]);

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
        x: Math.max(0, relativeX / zoom),
        y: Math.max(0, relativeY / zoom),
      };
    },
    [zoom]
  );

  // Mouse handlers for annotations
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isReadOnly || mode === 'hand') return;
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
      className="relative mb-6 mx-auto bg-white dark:bg-[#151515] shadow-lg rounded-sm transition-shadow border border-[#e4e2dd] dark:border-[#33312e] select-none"
      style={{
        width: pageDimensions ? `${pageDimensions.width}px` : 'auto',
        height: pageDimensions ? `${pageDimensions.height}px` : 'auto',
        minHeight: '400px',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Canvas da página do PDF */}
      <canvas ref={canvasRef} className="block pointer-events-none" />

      {/* Camada interativa de SVG para anotações vetorizadas */}
      {pageDimensions && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
          viewBox={`0 0 ${pageDimensions.unscaledWidth} ${pageDimensions.unscaledHeight}`}
          style={{ width: `${pageDimensions.width}px`, height: `${pageDimensions.height}px` }}
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
                    left: `${ann.x * zoom}px`,
                    top: `${ann.y * zoom}px`,
                    minWidth: `${(ann.width || 120) * zoom}px`,
                    fontSize: `${(ann.fontSize || 14) * zoom}px`,
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
                    left: `${ann.x * zoom}px`,
                    top: `${ann.y * zoom}px`,
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
