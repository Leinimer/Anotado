'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Palette, Check, RotateCcw, Folder as FolderIcon } from 'lucide-react';

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  };
  const r = Math.round(f(5) * 255);
  const g = Math.round(f(3) * 255);
  const b = Math.round(f(1) * 255);
  const toHex = (c: number) => c.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  let clean = (hex || '').replace(/^#/, '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return { h: 30, s: 0.6, v: 0.85 };
  }
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h = Math.round(h * 60) % 360;
  }
  return { h, s, v };
}

const PRESET_SWATCHES = [
  '#EAB308', // Amarelo
  '#16A34A', // Verde
  '#0D9488', // Menta
  '#2563EB', // Azul
  '#6366F1', // Índigo
  '#9333EA', // Roxo
  '#DB2777', // Rosa
  '#DC2626', // Vermelho
  '#EA580C', // Laranja
  '#854D0E', // Âmbar
  '#68594D', // Argila / Papyrus
  '#475569', // Grafite
];

interface FolderCustomColorModalProps {
  isOpen: boolean;
  folderId: string | null;
  folderName?: string;
  initialColor: string | null;
  onClose: () => void;
  onApply: (color: string | null) => void;
}

function FolderCustomColorModalContent({
  folderName,
  initialColor,
  onClose,
  onApply,
}: {
  folderName: string;
  initialColor: string | null;
  onClose: () => void;
  onApply: (color: string | null) => void;
}) {
  const initialHsv = initialColor ? hexToHsv(initialColor) : hexToHsv('#68594D');
  const [hue, setHue] = useState(initialHsv.h);
  const [sat, setSat] = useState(initialHsv.s);
  const [val, setVal] = useState(initialHsv.v);
  const [hexInput, setHexInput] = useState(initialColor ? initialColor.toUpperCase() : '#68594D');
  const [isNeutral, setIsNeutral] = useState(!initialColor);

  const satValAreaRef = useRef<HTMLDivElement>(null);
  const hueSliderRef = useRef<HTMLDivElement>(null);

  // Fecha no ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const currentColorHex = isNeutral ? null : hsvToHex(hue, sat, val);

  // Atualização de Sat e Val a partir do ponteiro
  const updateSatVal = useCallback(
    (clientX: number, clientY: number) => {
      if (!satValAreaRef.current) return;
      const rect = satValAreaRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const newS = Math.round((x / rect.width) * 100) / 100;
      const newV = Math.round((1 - y / rect.height) * 100) / 100;

      setIsNeutral(false);
      setSat(newS);
      setVal(newV);
      const newHex = hsvToHex(hue, newS, newV);
      setHexInput(newHex);
    },
    [hue]
  );

  const handleSatValPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    updateSatVal(e.clientX, e.clientY);
  };

  const handleSatValPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return;
    e.preventDefault();
    e.stopPropagation();
    updateSatVal(e.clientX, e.clientY);
  };

  // Atualização de Hue a partir do ponteiro
  const updateHue = useCallback(
    (clientX: number) => {
      if (!hueSliderRef.current) return;
      const rect = hueSliderRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const newH = Math.round((x / rect.width) * 360) % 360;

      setIsNeutral(false);
      setHue(newH);
      const newHex = hsvToHex(newH, sat, val);
      setHexInput(newHex);
    },
    [sat, val]
  );

  const handleHuePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    updateHue(e.clientX);
  };

  const handleHuePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return;
    e.preventDefault();
    e.stopPropagation();
    updateHue(e.clientX);
  };

  // Alteração do campo Hex manual
  const handleHexInputChange = (valStr: string) => {
    let clean = valStr.trim();
    if (!clean.startsWith('#') && clean.length > 0) {
      clean = '#' + clean;
    }
    setHexInput(clean);

    const testHex = clean.replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(testHex) || /^[0-9a-fA-F]{3}$/.test(testHex)) {
      setIsNeutral(false);
      const { h, s, v } = hexToHsv(clean);
      setHue(h);
      setSat(s);
      setVal(v);
    }
  };

  const handleSelectPreset = (hex: string) => {
    setIsNeutral(false);
    const { h, s, v } = hexToHsv(hex);
    setHue(h);
    setSat(s);
    setVal(v);
    setHexInput(hex.toUpperCase());
  };

  const handleApply = () => {
    onApply(currentColorHex);
    onClose();
  };

  const pureHueColor = `hsl(${hue}, 100%, 50%)`;
  const activeDisplayColor = isNeutral ? '#7F756E' : (currentColorHex || '#7F756E');

  return (
    <div
      id="folder-custom-color-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs font-sans-ui animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        id="folder-custom-color-modal-card"
        className="w-full max-w-sm bg-white rounded-2xl border border-[#e4e2dd] shadow-2xl p-5 space-y-4 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-2.5 border-b border-[#f0eee9]">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors shadow-2xs"
              style={{ backgroundColor: `${activeDisplayColor}20`, color: activeDisplayColor }}
            >
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1b1c19]">Cor da Pasta</h3>
              <p className="text-xs text-[#7f756e] truncate max-w-[200px]" title={folderName}>
                {folderName}
              </p>
            </div>
          </div>
          <button
            type="button"
            id="folder-custom-color-close-btn"
            onClick={onClose}
            className="p-1 rounded-lg text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#f0eee9] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. Área 2D de Saturação e Brilho (Arrastável com mouse e touch) */}
        <div
          ref={satValAreaRef}
          id="folder-color-picker-saturation-area"
          onPointerDown={handleSatValPointerDown}
          onPointerMove={handleSatValPointerMove}
          style={{ backgroundColor: pureHueColor }}
          className="relative w-full h-40 rounded-xl overflow-hidden cursor-crosshair select-none touch-none shadow-inner border border-black/10"
        >
          {/* Gradiente Branco (Saturação horizontal) */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(to right, #ffffff, transparent)',
            }}
          />
          {/* Gradiente Preto (Brilho vertical) */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(to top, #000000, transparent)',
            }}
          />

          {/* Cursor Indicador Arrastável */}
          {!isNeutral && (
            <div
              className="absolute w-5 h-5 rounded-full border-2 border-white shadow-md pointer-events-none -translate-x-1/2 -translate-y-1/2 transition-transform"
              style={{
                left: `${sat * 100}%`,
                top: `${(1 - val) * 100}%`,
                backgroundColor: currentColorHex || '#fff',
              }}
            />
          )}
        </div>

        {/* 2. Slider 1D de Matiz (Hue Rainbow - Arrastável) */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-[#68594d] block uppercase tracking-wider">
            Matiz (Cor)
          </label>
          <div
            ref={hueSliderRef}
            id="folder-color-picker-hue-slider"
            onPointerDown={handleHuePointerDown}
            onPointerMove={handleHuePointerMove}
            className="relative w-full h-5 rounded-lg select-none touch-none cursor-pointer border border-black/10 shadow-inner"
            style={{
              background:
                'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
            }}
          >
            {/* Thumb Indicador */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-6 bg-white border border-black/20 rounded-md shadow-md pointer-events-none"
              style={{ left: `${(hue / 360) * 100}%` }}
            />
          </div>
        </div>

        {/* 3. Paleta de Cores Rápidas */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-[#68594d] block uppercase tracking-wider">
            Paleta Rápida
          </label>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_SWATCHES.map((swatch) => {
              const isSelected = !isNeutral && currentColorHex?.toUpperCase() === swatch.toUpperCase();
              return (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => handleSelectPreset(swatch)}
                  className={`w-6 h-6 rounded-full border border-black/15 shadow-2xs transition-transform hover:scale-115 flex items-center justify-center cursor-pointer ${
                    isSelected ? 'ring-2 ring-offset-1 ring-[#1b1c19] scale-110' : ''
                  }`}
                  style={{ backgroundColor: swatch }}
                  title={swatch}
                >
                  {isSelected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                </button>
              );
            })}

            {/* Opção Neutra / Padrão */}
            <button
              type="button"
              onClick={() => {
                setIsNeutral(true);
                setHexInput('');
              }}
              className={`px-2 h-6 rounded-full border border-[#dcd9d2] text-[10px] font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                isNeutral
                  ? 'bg-[#68594d] text-white border-transparent'
                  : 'bg-[#f4dfcb]/50 text-[#68594d] hover:bg-[#f4dfcb]'
              }`}
              title="Sem cor específica (padrão)"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              <span>Padrão</span>
            </button>
          </div>
        </div>

        {/* 4. Preview e Entrada Hex */}
        <div className="flex items-center gap-3 pt-1 border-t border-[#f0eee9]">
          <div className="flex items-center gap-2 flex-1">
            <div
              className="w-8 h-8 rounded-xl border border-black/10 shadow-xs flex items-center justify-center shrink-0"
              style={{ backgroundColor: activeDisplayColor }}
            >
              <FolderIcon className="w-4 h-4 text-white fill-white/80" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[10px] text-[#7f756e] block uppercase tracking-wider font-semibold">
                Código HEX
              </span>
              <input
                type="text"
                value={isNeutral ? 'Padrão' : hexInput}
                onChange={(e) => handleHexInputChange(e.target.value)}
                placeholder="#RRGGBB"
                maxLength={7}
                className="w-full text-xs font-mono font-medium text-[#1b1c19] px-2 py-1 bg-[#fbf9f4] border border-[#e4e2dd] rounded-lg focus:outline-none focus:border-[#68594d] focus:bg-white uppercase"
              />
            </div>
          </div>
        </div>

        {/* 5. Ações [Cancelar] e [Aplicar] com confirmação explícita */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#f0eee9]">
          <button
            type="button"
            id="folder-custom-color-cancel-btn"
            onClick={onClose}
            className="w-full py-2 px-3 text-xs font-sans-ui font-semibold text-[#4e453f] hover:text-[#1b1c19] bg-[#eae8e3] hover:bg-[#e0ded8] rounded-xl transition-colors cursor-pointer text-center"
          >
            Cancelar
          </button>
          <button
            type="button"
            id="folder-custom-color-apply-btn"
            onClick={handleApply}
            className="w-full py-2 px-3 text-xs font-sans-ui font-semibold text-white bg-[#68594d] hover:bg-[#53463c] rounded-xl transition-colors cursor-pointer text-center shadow-xs flex items-center justify-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Aplicar</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function FolderCustomColorModal({
  isOpen,
  folderId,
  folderName = 'Pasta',
  initialColor,
  onClose,
  onApply,
}: FolderCustomColorModalProps) {
  if (!isOpen || !folderId) return null;

  return (
    <FolderCustomColorModalContent
      key={`${folderId}:${initialColor || 'neutral'}`}
      folderName={folderName}
      initialColor={initialColor}
      onClose={onClose}
      onApply={onApply}
    />
  );
}
