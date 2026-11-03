'use client';

import React, { useState, useRef } from 'react';
import {
  MousePointer,
  Hand,
  Highlighter,
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
import { ToolMode, ShapeType } from './types';

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
  isReadOnly?: boolean;
}

const HIGHLIGHT_COLORS = [
  { label: 'Amarelo', hex: '#fef08a' },
  { label: 'Verde', hex: '#bbf7d0' },
  { label: 'Rosa', hex: '#fecdd3' },
  { label: 'Azul', hex: '#bfdbfe' },
  { label: 'Lilás', hex: '#e9d5ff' },
  { label: 'Laranja', hex: '#fed7aa' },
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
  isReadOnly = false,
}: PdfEditorToolbarProps) {
  const [showPenMenu, setShowPenMenu] = useState(false);
  const [showHighlightMenu, setShowHighlightMenu] = useState(false);
  const [showShapeMenu, setShowShapeMenu] = useState(false);
  const [showZoomMenu, setShowZoomMenu] = useState(false);

  const closeAllMenus = () => {
    setShowPenMenu(false);
    setShowHighlightMenu(false);
    setShowShapeMenu(false);
    setShowZoomMenu(false);
  };

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

  return (
    <footer data-pdf-editor-toolbar="true" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[96vw]">
      <div className="bg-[#fbf9f4]/95 dark:bg-[#252422]/95 border border-[#e4e2dd] dark:border-[#383633] backdrop-blur-md rounded-2xl shadow-xl px-2.5 py-1.5 flex items-center gap-1 overflow-x-auto text-[#1b1c19] dark:text-[#ededed] select-none">
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
          title="Selecionar / Mover anotação (V)"
          aria-label="Selecionar / Mover anotação"
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
          title="Mão / Navegar página (H)"
          aria-label="Mão / Navegar página"
        >
          <Hand className="w-4 h-4" />
        </button>

        {!isReadOnly && (
          <>
            <div className="h-4 w-[1px] bg-[#e4e2dd] dark:bg-[#383633] mx-0.5" />

            {/* Marca-texto (com dropdown de cores) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  if (currentMode === 'highlight') {
                    setShowHighlightMenu(!showHighlightMenu);
                  } else {
                    closeAllMenus();
                    onSetMode('highlight');
                  }
                }}
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

              {showHighlightMenu && (
                <div className="absolute bottom-full mb-2 left-0 bg-[#fbf9f4] dark:bg-[#22211f] border border-[#e4e2dd] dark:border-[#383633] rounded-xl p-2 shadow-xl flex items-center gap-1.5 z-50">
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => {
                        onSetHighlightColor(c.hex);
                        setShowHighlightMenu(false);
                      }}
                      className={`w-6 h-6 rounded-full border transition-transform cursor-pointer hover:scale-110 ${
                        highlightColor === c.hex
                          ? 'ring-2 ring-[#68594d] border-transparent scale-105'
                          : 'border-black/15'
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={c.label}
                    />
                  ))}
                </div>
              )}
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

            {/* Caneta Desenho Livre (com menu de espessura e cores) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  if (currentMode === 'pen') {
                    setShowPenMenu(!showPenMenu);
                  } else {
                    closeAllMenus();
                    onSetMode('pen');
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

              {showPenMenu && (
                <div className="absolute bottom-full mb-2 left-0 bg-[#fbf9f4] dark:bg-[#22211f] border border-[#e4e2dd] dark:border-[#383633] rounded-xl p-2.5 shadow-xl space-y-2 z-50 min-w-[170px]">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#7f756e] dark:text-[#a89f97] block mb-1">
                      Cores
                    </span>
                    <div className="flex items-center gap-1.5">
                      {PEN_COLORS.map((c) => (
                        <button
                          key={c.hex}
                          type="button"
                          onClick={() => onSetPenColor(c.hex)}
                          className={`w-5 h-5 rounded-full border transition-transform cursor-pointer ${
                            penColor === c.hex
                              ? 'ring-2 ring-[#68594d] border-transparent scale-110'
                              : 'border-black/20'
                          }`}
                          style={{ backgroundColor: c.hex }}
                          title={c.label}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#7f756e] dark:text-[#a89f97] block mb-1">
                      Espessura
                    </span>
                    <div className="flex items-center gap-1">
                      {PEN_WIDTHS.map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => {
                            onSetPenWidth(w);
                            setShowPenMenu(false);
                          }}
                          className={`px-2 py-0.5 text-xs rounded-md transition-colors cursor-pointer ${
                            penWidth === w
                              ? 'bg-[#68594d] text-white'
                              : 'bg-[#eae7e0] dark:bg-[#2c2a28] text-[#1b1c19] dark:text-[#ededed]'
                          }`}
                        >
                          {w}px
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
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
                onClick={() => {
                  if (currentMode === 'shape') {
                    setShowShapeMenu(!showShapeMenu);
                  } else {
                    closeAllMenus();
                    onSetMode('shape');
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

              {showShapeMenu && (
                <div className="absolute bottom-full mb-2 left-0 bg-[#fbf9f4] dark:bg-[#22211f] border border-[#e4e2dd] dark:border-[#383633] rounded-xl p-1.5 shadow-xl flex items-center gap-1 z-50">
                  <button
                    type="button"
                    onClick={() => {
                      onSetShape('rectangle');
                      setShowShapeMenu(false);
                    }}
                    className={`p-1.5 rounded-lg hover:bg-[#eae7e0] dark:hover:bg-[#2c2a28] cursor-pointer ${
                      currentShape === 'rectangle' ? 'bg-[#e8e4db] dark:bg-[#383633]' : ''
                    }`}
                    title="Retângulo"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSetShape('circle');
                      setShowShapeMenu(false);
                    }}
                    className={`p-1.5 rounded-lg hover:bg-[#eae7e0] dark:hover:bg-[#2c2a28] cursor-pointer ${
                      currentShape === 'circle' ? 'bg-[#e8e4db] dark:bg-[#383633]' : ''
                    }`}
                    title="Círculo / Elipse"
                  >
                    <Circle className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSetShape('line');
                      setShowShapeMenu(false);
                    }}
                    className={`p-1.5 rounded-lg hover:bg-[#eae7e0] dark:hover:bg-[#2c2a28] cursor-pointer ${
                      currentShape === 'line' ? 'bg-[#e8e4db] dark:bg-[#383633]' : ''
                    }`}
                    title="Linha reta"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSetShape('arrow');
                      setShowShapeMenu(false);
                    }}
                    className={`p-1.5 rounded-lg hover:bg-[#eae7e0] dark:hover:bg-[#2c2a28] cursor-pointer ${
                      currentShape === 'arrow' ? 'bg-[#e8e4db] dark:bg-[#383633]' : ''
                    }`}
                    title="Seta"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}
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
        {!isReadOnly && hasSelection && (
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
            type="button"
            onClick={() => setShowZoomMenu(!showZoomMenu)}
            className="text-xs font-mono font-medium px-2 py-1 rounded-lg hover:bg-[#efebe2] dark:hover:bg-[#2c2a28] text-[#68594d] dark:text-[#d4c8bc] cursor-pointer flex items-center gap-1"
            title="Ajustar zoom"
          >
            <span>{Math.round(zoom * 100)}%</span>
            <ChevronDown className="w-2.5 h-2.5 opacity-60" />
          </button>

          {showZoomMenu && (
            <div className="absolute bottom-full mb-2 right-0 bg-[#fbf9f4] dark:bg-[#22211f] border border-[#e4e2dd] dark:border-[#383633] rounded-xl p-1.5 shadow-xl flex flex-col gap-1 z-50 min-w-[120px] text-xs font-sans-ui">
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
            </div>
          )}
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
      </div>
    </footer>
  );
}
