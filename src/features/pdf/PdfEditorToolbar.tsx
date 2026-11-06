'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  MousePointer,
  Hand,
  Highlighter,
  Crop,
  Underline,
  Strikethrough,
  Pencil,
  Eraser,
  Type,
  Square,
  Circle,
  Minus,
  ArrowRight,
  StickyNote,
  Undo,
  Redo,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import { ToolMode, ShapeType, PDF_DEFAULT_ZOOM } from './types';

interface PdfEditorToolbarProps {
  currentMode: ToolMode;
  onSetMode: (mode: ToolMode) => void;
  // Pen styling
  penColor: string;
  onSetPenColor: (color: string) => void;
  penWidth: number;
  onSetPenWidth: (w: number) => void;
  // Highlight styling
  highlightColor: string;
  onSetHighlightColor: (color: string) => void;
  // Shape styling
  currentShape: ShapeType;
  onSetShape: (shape: ShapeType) => void;
  // Zoom
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  // History
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  // Selection
  hasSelection: boolean;
  onDeleteSelected: () => void;
  isTextMarkSelected?: boolean;
  hasSummary?: boolean;
  onCreateSummary?: () => void;
  isReadOnly?: boolean;
}

const HIGHLIGHT_COLORS = [
  { label: 'Amarelo vivo', hex: '#ffe600' },
  { label: 'Verde', hex: '#55d66b' },
  { label: 'Rosa', hex: '#ff6b91' },
  { label: 'Azul', hex: '#55a9ff' },
  { label: 'Lilás', hex: '#b58af7' },
  { label: 'Laranja', hex: '#ff9b38' },
];

const PEN_COLORS = [
  { label: 'Sépia', hex: '#68594d' },
  { label: 'Preto', hex: '#1b1c19' },
  { label: 'Vermelho', hex: '#ba1a1a' },
  { label: 'Azul', hex: '#1e3a8a' },
  { label: 'Verde', hex: '#14532d' },
  { label: 'Laranja', hex: '#ea580c' },
];

const PEN_WIDTHS = [1, 2, 4, 8];

export function PdfEditorToolbar({
  currentMode,
  onSetMode,
  penColor,
  onSetPenColor,
  penWidth,
  onSetPenWidth,
  highlightColor,
  onSetHighlightColor,
  currentShape,
  onSetShape,
  zoom,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onFitPage,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasSelection,
  onDeleteSelected,
  isTextMarkSelected = false,
  hasSummary = false,
  onCreateSummary,
  isReadOnly = false,
}: PdfEditorToolbarProps) {
  const [showPenMenu, setShowPenMenu] = useState(false);
  const [showHighlightMenu, setShowHighlightMenu] = useState(false);
  const [showShapeMenu, setShowShapeMenu] = useState(false);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const highlightButtonRef = useRef<HTMLButtonElement>(null);
  const highlightPopoverRef = useRef<HTMLDivElement>(null);
  const [highlightPopoverCoords, setHighlightPopoverCoords] = useState<{ bottom: number; left: number } | null>(null);

  const penButtonRef = useRef<HTMLButtonElement>(null);
  const penPopoverRef = useRef<HTMLDivElement>(null);
  const [penPopoverCoords, setPenPopoverCoords] = useState<{ bottom: number; left: number } | null>(null);

  const shapeButtonRef = useRef<HTMLButtonElement>(null);
  const shapePopoverRef = useRef<HTMLDivElement>(null);
  const [shapePopoverCoords, setShapePopoverCoords] = useState<{ bottom: number; left: number } | null>(null);

  const zoomButtonRef = useRef<HTMLButtonElement>(null);
  const zoomPopoverRef = useRef<HTMLDivElement>(null);
  const [zoomPopoverCoords, setZoomPopoverCoords] = useState<{ bottom: number; left: number } | null>(null);

  const closeAllMenus = () => {
    setShowPenMenu(false);
    setShowHighlightMenu(false);
    setShowShapeMenu(false);
    setShowZoomMenu(false);
  };

  // Mantém o seletor de cores fora da barra, ancorado visualmente ao botão.
  const toggleHighlightMenu = () => {
    if (showHighlightMenu) {
      setShowHighlightMenu(false);
      return;
    }

    const button = highlightButtonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    setHighlightPopoverCoords({
      bottom: window.innerHeight - rect.top + 8,
      left: rect.left + rect.width / 2,
    });
    closeAllMenus();
    onSetMode('highlight');
    setShowHighlightMenu(true);
  };

  useEffect(() => {
    const hasOpenMenu = showHighlightMenu || showPenMenu || showShapeMenu || showZoomMenu;
    if (!hasOpenMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedInsidePopupOrTrigger =
        (showHighlightMenu && (highlightPopoverRef.current?.contains(target) || highlightButtonRef.current?.contains(target))) ||
        (showPenMenu && (penPopoverRef.current?.contains(target) || penButtonRef.current?.contains(target))) ||
        (showShapeMenu && (shapePopoverRef.current?.contains(target) || shapeButtonRef.current?.contains(target))) ||
        (showZoomMenu && (zoomPopoverRef.current?.contains(target) || zoomButtonRef.current?.contains(target)));

      if (!clickedInsidePopupOrTrigger) closeAllMenus();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAllMenus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showHighlightMenu, showPenMenu, showShapeMenu, showZoomMenu]);

  const getShapeIcon = (shape: ShapeType) => {
    switch (shape) {
      case 'circle':
        return <Circle className="w-4 h-4" />;
      case 'line':
        return <Minus className="w-4 h-4" />;
      case 'arrow':
        return <ArrowRight className="w-4 h-4" />;
      case 'rectangle':
      default:
        return <Square className="w-4 h-4" />;
    }
  };

  // O portal renderiza diretamente no body para impedir que a barra ou
  // qualquer contêiner com overflow/transform recorte ou esconda o seletor.
  const highlightMenuPortal =
    showHighlightMenu && highlightPopoverCoords && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={highlightPopoverRef}
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              position: 'fixed',
              bottom: highlightPopoverCoords.bottom,
              left: highlightPopoverCoords.left,
              transform: 'translateX(-50%)',
              zIndex: 99999,
            }}
            className="bg-[#fbf9f4] dark:bg-[#22211f] border border-[#e4e2dd] dark:border-[#383633] rounded-xl p-2 shadow-xl flex items-center gap-1.5 whitespace-nowrap"
            role="dialog"
            aria-label="Cores do marca-texto"
          >
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.hex}
                type="button"
                onClick={() => {
                  onSetHighlightColor(color.hex);
                  setShowHighlightMenu(false);
                }}
                className={`w-6 h-6 rounded-full border transition-transform cursor-pointer hover:scale-110 ${
                  highlightColor === color.hex
                    ? 'ring-2 ring-[#68594d] border-transparent scale-105'
                    : 'border-black/15'
                }`}
                style={{ backgroundColor: color.hex }}
                title={color.label}
                aria-label={color.label}
                aria-pressed={highlightColor === color.hex}
              />
            ))}
          </div>,
          document.body
        )
      : null;

  const penMenuPortal =
    showPenMenu && penPopoverCoords && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={penPopoverRef}
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              position: 'fixed',
              bottom: penPopoverCoords.bottom,
              left: penPopoverCoords.left,
              transform: 'translateX(-50%)',
              zIndex: 99999,
            }}
            className="bg-[#fbf9f4] dark:bg-[#22211f] border border-[#e4e2dd] dark:border-[#383633] rounded-xl p-2.5 shadow-xl space-y-2 min-w-[170px]"
            role="dialog"
            aria-label="Configurações da caneta"
          >
            <div>
              <span className="text-[10px] uppercase font-bold text-[#7f756e] dark:text-[#a89f97] block mb-1">Cores</span>
              <div className="flex items-center gap-1.5">
                {PEN_COLORS.map((color) => (
                  <button
                    key={color.hex}
                    type="button"
                    onClick={() => onSetPenColor(color.hex)}
                    className={`w-5 h-5 rounded-full border transition-transform cursor-pointer ${
                      penColor === color.hex
                        ? 'ring-2 ring-[#68594d] border-transparent scale-110'
                        : 'border-black/20'
                    }`}
                    style={{ backgroundColor: color.hex }}
                    title={color.label}
                    aria-label={`Cor ${color.label}`}
                    aria-pressed={penColor === color.hex}
                  />
                ))}
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#7f756e] dark:text-[#a89f97] block mb-1">Espessura</span>
              <div className="flex items-center gap-1">
                {PEN_WIDTHS.map((width) => (
                  <button
                    key={width}
                    type="button"
                    onClick={() => {
                      onSetPenWidth(width);
                      setShowPenMenu(false);
                    }}
                    className={`px-2 py-0.5 text-xs rounded-md transition-colors cursor-pointer ${
                      penWidth === width
                        ? 'bg-[#68594d] text-white'
                        : 'bg-[#eae7e0] dark:bg-[#2c2a28] text-[#1b1c19] dark:text-[#ededed]'
                    }`}
                    aria-pressed={penWidth === width}
                  >
                    {width}px
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const shapeMenuPortal =
    showShapeMenu && shapePopoverCoords && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={shapePopoverRef}
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              position: 'fixed',
              bottom: shapePopoverCoords.bottom,
              left: shapePopoverCoords.left,
              transform: 'translateX(-50%)',
              zIndex: 99999,
            }}
            className="bg-[#fbf9f4] dark:bg-[#22211f] border border-[#e4e2dd] dark:border-[#383633] rounded-xl p-2.5 shadow-xl min-w-[240px] space-y-2"
            role="dialog"
            aria-label="Configurações das formas"
          >
            <div>
              <span className="text-[10px] uppercase font-bold text-[#7f756e] dark:text-[#a89f97] block mb-1">Tipo de forma</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSetShape('rectangle')}
                  className={`p-1.5 rounded-lg hover:bg-[#eae7e0] dark:hover:bg-[#2c2a28] cursor-pointer ${currentShape === 'rectangle' ? 'bg-[#e8e4db] dark:bg-[#383633]' : ''}`}
                  title="Retângulo"
                  aria-pressed={currentShape === 'rectangle'}
                >
                  <Square className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onSetShape('circle')}
                  className={`p-1.5 rounded-lg hover:bg-[#eae7e0] dark:hover:bg-[#2c2a28] cursor-pointer ${currentShape === 'circle' ? 'bg-[#e8e4db] dark:bg-[#383633]' : ''}`}
                  title="Círculo / Elipse"
                  aria-pressed={currentShape === 'circle'}
                >
                  <Circle className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onSetShape('line')}
                  className={`p-1.5 rounded-lg hover:bg-[#eae7e0] dark:hover:bg-[#2c2a28] cursor-pointer ${currentShape === 'line' ? 'bg-[#e8e4db] dark:bg-[#383633]' : ''}`}
                  title="Linha reta"
                  aria-pressed={currentShape === 'line'}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onSetShape('arrow')}
                  className={`p-1.5 rounded-lg hover:bg-[#eae7e0] dark:hover:bg-[#2c2a28] cursor-pointer ${currentShape === 'arrow' ? 'bg-[#e8e4db] dark:bg-[#383633]' : ''}`}
                  title="Seta"
                  aria-pressed={currentShape === 'arrow'}
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="border-t border-[#e4e2dd] dark:border-[#383633] pt-2">
              <span className="text-[10px] uppercase font-bold text-[#7f756e] dark:text-[#a89f97] block mb-1">Cor do contorno</span>
              <div className="flex items-center gap-1.5">
                {PEN_COLORS.map((color) => (
                  <button
                    key={color.hex}
                    type="button"
                    onClick={() => onSetPenColor(color.hex)}
                    className={`w-5 h-5 rounded-full border transition-transform cursor-pointer hover:scale-110 ${
                      penColor === color.hex
                        ? 'ring-2 ring-[#68594d] dark:ring-[#d4c8bc] border-transparent scale-110'
                        : 'border-black/20'
                    }`}
                    style={{ backgroundColor: color.hex }}
                    title={color.label}
                    aria-label={`Cor ${color.label}`}
                    aria-pressed={penColor === color.hex}
                  />
                ))}
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-[#7f756e] dark:text-[#a89f97] block mb-1">Espessura</span>
              <div className="flex items-center gap-1">
                {PEN_WIDTHS.map((width) => (
                  <button
                    key={width}
                    type="button"
                    onClick={() => onSetPenWidth(width)}
                    className={`px-2 py-0.5 text-xs rounded-md transition-colors cursor-pointer ${
                      penWidth === width
                        ? 'bg-[#68594d] text-white'
                        : 'bg-[#eae7e0] dark:bg-[#2c2a28] text-[#1b1c19] dark:text-[#ededed]'
                    }`}
                    aria-pressed={penWidth === width}
                  >
                    {width}px
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const zoomMenuPortal =
    showZoomMenu && zoomPopoverCoords && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={zoomPopoverRef}
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              position: 'fixed',
              bottom: zoomPopoverCoords.bottom,
              left: zoomPopoverCoords.left,
              transform: 'translateX(-50%)',
              zIndex: 99999,
            }}
            className="bg-[#fbf9f4] dark:bg-[#22211f] border border-[#e4e2dd] dark:border-[#383633] rounded-xl p-1.5 shadow-xl flex flex-col gap-1 min-w-[120px] text-xs font-sans-ui"
            role="dialog"
            aria-label="Ajustar zoom"
          >
            <button
              type="button"
              onClick={() => {
                onFitWidth();
                setShowZoomMenu(false);
              }}
              className="px-2.5 py-1.5 rounded-lg text-left hover:bg-[#eae7e0] dark:hover:bg-[#2c2a28] cursor-pointer"
            >
              Ajustar à largura
            </button>
            <button
              type="button"
              onClick={() => {
                onFitPage();
                setShowZoomMenu(false);
              }}
              className="px-2.5 py-1.5 rounded-lg text-left hover:bg-[#eae7e0] dark:hover:bg-[#2c2a28] cursor-pointer"
            >
              Página inteira
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <>
    {highlightMenuPortal}
    {penMenuPortal}
    {shapeMenuPortal}
    {zoomMenuPortal}
    <footer data-pdf-editor-toolbar="true" className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 w-max max-w-[96vw]">
      <div className="bg-[#fbf9f4]/95 dark:bg-[#252422]/95 border border-[#e4e2dd] dark:border-[#383633] backdrop-blur-md rounded-2xl shadow-xl px-2.5 py-1.5 flex flex-nowrap items-center justify-center gap-1 overflow-x-auto max-w-full whitespace-nowrap text-[#1b1c19] dark:text-[#ededed] select-none">
        {/* Ferramenta Selecionar */}
        <button
          type="button"
          onClick={() => {
            closeAllMenus();
            onSetMode('select');
          }}
          className={`p-1.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center ${
            currentMode === 'select'
              ? 'bg-[#e8e4db] dark:bg-[#383633] text-[#68594d] dark:text-white font-medium shadow-2xs'
              : 'text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28]'
          }`}
          title="Selecionar, mover e excluir objetos (V)"
          aria-label="Selecionar objetos"
        >
          <MousePointer className="w-4 h-4" />
        </button>

        {/* Ferramenta Navegar / Mão */}
        <button
          type="button"
          onClick={() => {
            closeAllMenus();
            onSetMode('hand');
          }}
          className={`p-1.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center ${
            currentMode === 'hand'
              ? 'bg-[#e8e4db] dark:bg-[#383633] text-[#68594d] dark:text-white font-medium shadow-2xs'
              : 'text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28]'
          }`}
          title="Navegar pela página: clique e arraste para mover a folha (H)"
          aria-label="Navegar pela página"
        >
          <Hand className="w-4 h-4" />
        </button>

        {!isReadOnly && (
          <>
            <div className="h-4 w-[1px] bg-[#e4e2dd] dark:bg-[#383633] mx-0.5" />

            {/* Marca-texto (com dropdown de cores) */}
            <div>
              <button
                ref={highlightButtonRef}
                type="button"
                onClick={toggleHighlightMenu}
                className={`p-1.5 rounded-xl transition-colors cursor-pointer flex items-center gap-0.5 ${
                  currentMode === 'highlight'
                    ? 'bg-[#e8e4db] dark:bg-[#383633] text-[#68594d] dark:text-white font-medium shadow-2xs'
                    : 'text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28]'
                }`}
                title="Destacar texto"
                aria-label="Destacar texto"
              >
                <Highlighter className="w-4 h-4" />
                <span
                  className="w-2 h-2 rounded-full border border-black/20"
                  style={{ backgroundColor: highlightColor }}
                />
                <ChevronDown className="w-2.5 h-2.5 opacity-60" />
              </button>


            </div>

            {/* Sublinhado */}
            <button
              type="button"
              onClick={() => {
                closeAllMenus();
                onSetMode('underline');
              }}
              className={`p-1.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center ${
                currentMode === 'underline'
                  ? 'bg-[#e8e4db] dark:bg-[#383633] text-[#68594d] dark:text-white font-medium shadow-2xs'
                  : 'text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28]'
              }`}
              title="Sublinhar texto"
              aria-label="Sublinhar texto"
            >
              <Underline className="w-4 h-4" />
            </button>

            {/* Tachado */}
            <button
              type="button"
              onClick={() => {
                closeAllMenus();
                onSetMode('strikethrough');
              }}
              className={`p-1.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center ${
                currentMode === 'strikethrough'
                  ? 'bg-[#e8e4db] dark:bg-[#383633] text-[#68594d] dark:text-white font-medium shadow-2xs'
                  : 'text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28]'
              }`}
              title="Tachar texto"
              aria-label="Tachar texto"
            >
              <Strikethrough className="w-4 h-4" />
            </button>

            <div className="h-4 w-[1px] bg-[#e4e2dd] dark:bg-[#383633] mx-0.5" />

            {/* Recortar área do PDF para inserir na nota-resumo */}
            <button
              type="button"
              onClick={() => {
                closeAllMenus();
                onSetMode('crop');
              }}
              className={`p-1.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center ${
                currentMode === 'crop'
                  ? 'bg-[#e8e4db] dark:bg-[#383633] text-[#68594d] dark:text-white font-medium shadow-2xs'
                  : 'text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28]'
              }`}
              title="Recortar área do PDF e enviar ao Resumo"
              aria-label="Recortar área do PDF"
            >
              <Crop className="w-4 h-4" />
            </button>

            {/* Caneta Desenho Livre (com menu de espessura e cores) */}
            <div className="relative">
              <button
                type="button"
                ref={penButtonRef}
                onClick={() => {
                  const shouldOpen = !showPenMenu;
                  closeAllMenus();
                  onSetMode('pen');
                  if (shouldOpen && penButtonRef.current) {
                    const rect = penButtonRef.current.getBoundingClientRect();
                    setPenPopoverCoords({ bottom: window.innerHeight - rect.top + 8, left: rect.left + rect.width / 2 });
                    setShowPenMenu(true);
                  }
                }}
                className={`p-1.5 rounded-xl transition-colors cursor-pointer flex items-center gap-0.5 ${
                  currentMode === 'pen'
                    ? 'bg-[#e8e4db] dark:bg-[#383633] text-[#68594d] dark:text-white font-medium shadow-2xs'
                    : 'text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28]'
                }`}
                title="Caneta / Desenho livre (P)"
                aria-label="Caneta / Desenho livre"
              >
                <Pencil className="w-4 h-4" />
                <span
                  className="w-2 h-2 rounded-full border border-black/20"
                  style={{ backgroundColor: penColor }}
                />
                <ChevronDown className="w-2.5 h-2.5 opacity-60" />
              </button>

            </div>

            {/* Borracha */}
            </div>

            {/* Borracha */}
            <button
              type="button"
              onClick={() => {
                closeAllMenus();
                onSetMode('eraser');
              }}
              className={`p-1.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center ${
                currentMode === 'eraser'
                  ? 'bg-[#e8e4db] dark:bg-[#383633] text-[#ba1a1a] font-medium shadow-2xs'
                  : 'text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28]'
              }`}
              title="Borracha (E)"
              aria-label="Borracha"
            >
              <Eraser className="w-4 h-4" />
            </button>

            {/* Caixa de Texto */}
            <button
              type="button"
              onClick={() => {
                closeAllMenus();
                onSetMode('text');
              }}
              className={`p-1.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center ${
                currentMode === 'text'
                  ? 'bg-[#e8e4db] dark:bg-[#383633] text-[#68594d] dark:text-white font-medium shadow-2xs'
                  : 'text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28]'
              }`}
              title="Adicionar texto (T)"
              aria-label="Adicionar texto"
            >
              <Type className="w-4 h-4" />
            </button>

            {/* Formas Geométricas */}
            <div className="relative">
              <button
                type="button"
                ref={shapeButtonRef}
                onClick={() => {
                  const shouldOpen = !showShapeMenu;
                  closeAllMenus();
                  onSetMode('shape');
                  if (shouldOpen && shapeButtonRef.current) {
                    const rect = shapeButtonRef.current.getBoundingClientRect();
                    setShapePopoverCoords({ bottom: window.innerHeight - rect.top + 8, left: rect.left + rect.width / 2 });
                    setShowShapeMenu(true);
                  }
                }}
                className={`p-1.5 rounded-xl transition-colors cursor-pointer flex items-center gap-0.5 ${
                  currentMode === 'shape'
                    ? 'bg-[#e8e4db] dark:bg-[#383633] text-[#68594d] dark:text-white font-medium shadow-2xs'
                    : 'text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28]'
                }`}
                title="Formas geométricas"
                aria-label="Formas geométricas"
              >
                {getShapeIcon(currentShape)}
                <ChevronDown className="w-2.5 h-2.5 opacity-60" />
              </button>

            </div>

            {/* Nota Adesiva / Comentário */}
            </div>

            {/* Nota Adesiva / Comentário */}
            <button
              type="button"
              onClick={() => {
                closeAllMenus();
                onSetMode('sticky_note');
              }}
              className={`p-1.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center ${
                currentMode === 'sticky_note'
                  ? 'bg-[#e8e4db] dark:bg-[#383633] text-[#68594d] dark:text-white font-medium shadow-2xs'
                  : 'text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28]'
              }`}
              title="Nota adesiva / Comentário (N)"
              aria-label="Nota adesiva / Comentário"
            >
              <StickyNote className="w-4 h-4" />
            </button>
          </>
        )}

        <div className="h-4 w-[1px] bg-[#e4e2dd] dark:bg-[#383633] mx-0.5" />

        {/* Desfazer & Refazer */}
        {!isReadOnly && (
          <>
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className={`p-1.5 rounded-xl transition-colors ${
                canUndo
                  ? 'text-[#68594d] dark:text-[#d4c8bc] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28] cursor-pointer'
                  : 'text-[#b8b0a7] dark:text-[#55524e] opacity-40 cursor-not-allowed'
              }`}
              title="Desfazer (Ctrl+Z)"
              aria-label="Desfazer"
            >
              <Undo className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className={`p-1.5 rounded-xl transition-colors ${
                canRedo
                  ? 'text-[#68594d] dark:text-[#d4c8bc] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28] cursor-pointer'
                  : 'text-[#b8b0a7] dark:text-[#55524e] opacity-40 cursor-not-allowed'
              }`}
              title="Refazer (Ctrl+Y)"
              aria-label="Refazer"
            >
              <Redo className="w-4 h-4" />
            </button>
          </>
        )}

        {/* Excluir Anotação Selecionada */}
        {!isReadOnly && hasSelection && !isTextMarkSelected && (
          <button
            type="button"
            onClick={onDeleteSelected}
            className="p-1.5 rounded-xl text-[#ba1a1a] hover:bg-[#ba1a1a]/10 transition-colors cursor-pointer flex items-center justify-center animate-in fade-in"
            title="Excluir anotação selecionada (Del)"
            aria-label="Excluir anotação selecionada"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        <div className="h-4 w-[1px] bg-[#e4e2dd] dark:bg-[#383633] mx-0.5" />

        {/* Controles de Zoom */}
        <button
          type="button"
          onClick={onZoomOut}
          className="p-1.5 rounded-xl text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28] transition-colors cursor-pointer"
          title="Diminuir zoom (-)"
          aria-label="Diminuir zoom"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <div className="relative">
          <button
            ref={zoomButtonRef}
            type="button"
            onClick={() => {
              const shouldOpen = !showZoomMenu;
              closeAllMenus();
              if (shouldOpen && zoomButtonRef.current) {
                const rect = zoomButtonRef.current.getBoundingClientRect();
                setZoomPopoverCoords({ bottom: window.innerHeight - rect.top + 8, left: rect.left + rect.width / 2 });
                setShowZoomMenu(true);
              }
            }}
            className="text-xs font-mono font-medium px-2 py-1 rounded-lg hover:bg-[#efebe2] dark:hover:bg-[#2c2a28] text-[#68594d] dark:text-[#d4c8bc] cursor-pointer flex items-center gap-1"
            title="Ajustar zoom"
          >
            <span>{Math.round((zoom / PDF_DEFAULT_ZOOM) * 100)}%</span>
            <ChevronDown className="w-2.5 h-2.5 opacity-60" />
          </button>

        </div>

        <button
          type="button"
          onClick={onZoomIn}
        </div>

        <button
          type="button"
          onClick={onZoomIn}
          className="p-1.5 rounded-xl text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28] transition-colors cursor-pointer"
          title="Aumentar zoom (+)"
          aria-label="Aumentar zoom"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        {/* Resumo do PDF: cria uma única nota ou abre a já existente. */}
        {!isReadOnly && (
          <button
            type="button"
            onClick={() => {
              closeAllMenus();
              onCreateSummary?.();
            }}
            className={`px-2 py-1.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5 text-xs font-semibold ${
              hasSummary
                ? 'bg-[#fee2e2] dark:bg-[#451a1a] text-[#ba1a1a] dark:text-[#f28b82] shadow-2xs'
                : 'text-[#ba1a1a] dark:text-[#f28b82] hover:bg-[#fee2e2] dark:hover:bg-[#451a1a]'
            }`}
            title={hasSummary ? 'Abrir nota de resumo em nova aba' : 'Criar nota de resumo com as citações grifadas'}
            aria-label={hasSummary ? 'Abrir resumo' : 'Criar resumo'}
            aria-pressed={hasSummary}
          >
            <StickyNote className="w-4 h-4 text-[#ba1a1a] dark:text-[#f28b82]" />
            <span>Resumo</span>
          </button>
        )}
      </div>
    </footer>
    </>
  );
}
