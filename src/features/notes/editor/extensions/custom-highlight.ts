import Highlight from '@tiptap/extension-highlight';

export function parseColor(input: string | null | undefined): { r: number; g: number; b: number } {
  if (!input) return { r: 254, g: 240, b: 138 };
  const c = input.trim().toLowerCase();

  const named: Record<string, { r: number; g: number; b: number }> = {
    yellow: { r: 255, g: 255, b: 0 },
    green: { r: 0, g: 128, b: 0 },
    lightgreen: { r: 144, g: 238, b: 144 },
    blue: { r: 0, g: 0, b: 255 },
    lightblue: { r: 173, g: 216, b: 230 },
    red: { r: 255, g: 0, b: 0 },
    pink: { r: 255, g: 192, b: 203 },
    lightpink: { r: 255, g: 182, b: 193 },
    orange: { r: 255, g: 165, b: 0 },
    purple: { r: 128, g: 0, b: 128 },
    violet: { r: 238, g: 130, b: 238 },
    cyan: { r: 0, g: 255, b: 255 },
    magenta: { r: 255, g: 0, b: 255 },
    white: { r: 255, g: 255, b: 255 },
    black: { r: 0, g: 0, b: 0 },
  };
  if (named[c]) return named[c];

  let r = 254;
  let g = 240;
  let b = 138;

  if (c.startsWith('#')) {
    let hex = c.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((x) => x + x)
        .join('');
    } else if (hex.length === 8) {
      hex = hex.substring(0, 6);
    }
    if (hex.length >= 6) {
      r = parseInt(hex.substring(0, 2), 16) || 0;
      g = parseInt(hex.substring(2, 4), 16) || 0;
      b = parseInt(hex.substring(4, 6), 16) || 0;
    }
  } else if (c.startsWith('rgb')) {
    const m = c.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (m) {
      r = parseInt(m[1], 10);
      g = parseInt(m[2], 10);
      b = parseInt(m[3], 10);
    }
  } else if (c.startsWith('hsl')) {
    const m = c.match(/hsla?\((\d+)[,\s]+(\d+)%?[,\s]+(\d+)%/);
    if (m) {
      const h = parseInt(m[1], 10) / 360;
      const s = parseInt(m[2], 10) / 100;
      const l = parseInt(m[3], 10) / 100;
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const hue2rgb = (pVal: number, qVal: number, tVal: number) => {
        let t = tVal;
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return pVal + (qVal - pVal) * 6 * t;
        if (t < 1 / 2) return qVal;
        if (t < 2 / 3) return pVal + (qVal - pVal) * (2 / 3 - t) * 6;
        return pVal;
      };
      r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
      g = Math.round(hue2rgb(p, q, h) * 255);
      b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
    }
  }
  return { r, g, b };
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / d + 2;
        break;
      case bNorm:
        h = (rNorm - gNorm) / d + 4;
        break;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToHex(h: number, s: number, l: number): string {
  const lNorm = l / 100;
  const a = (s * Math.min(lNorm, 1 - lNorm)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Deriva uma tonalidade escura com alto contraste a partir da MESMA cor do marca-texto.
 * Amarelo -> Amarelo escuro / mostarda escuro
 * Verde -> Verde escuro
 * Azul -> Azul escuro
 * Vermelho/Rosa -> Vermelho/vinho escuro
 * Laranja -> Laranja escuro
 * Roxo -> Roxo escuro
 * Cores escuras -> Branco para contraste legível
 */
export function getDarkToneForColor(colorStr: string | null | undefined): string {
  const { r, g, b } = parseColor(colorStr);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const { h, s, l } = rgbToHsl(r, g, b);

  // Se o próprio fundo do destaque já for muito escuro (ex: preto ou azul petróleo escuro)
  if (brightness < 90 || l < 32) {
    return '#ffffff';
  }

  // Se for cinza neutro ou branco
  if (s < 12) {
    return '#111111';
  }

  // Mantém a saturação rica e vibrante
  const darkSat = Math.min(Math.max(s, 75), 95);

  // Ajusta a luminosidade alvo de acordo com a percepção visual do tom (Hue)
  let darkLight = 19;
  if (h >= 40 && h <= 70) {
    // Amarelo -> Mostarda escuro
    darkLight = 17;
  } else if (h > 70 && h <= 165) {
    // Verde -> Verde escuro floresta
    darkLight = 18;
  } else if (h > 165 && h <= 250) {
    // Azul / Ciano -> Azul escuro marinho
    darkLight = 22;
  } else if (h > 250 && h <= 315) {
    // Roxo / Violeta -> Roxo escuro
    darkLight = 21;
  } else {
    // Laranja / Vermelho / Rosa -> Vermelho/Laranja escuro
    darkLight = 19;
  }

  return hslToHex(h, darkSat, darkLight);
}

export const CustomHighlight = Highlight.extend({
  addAttributes() {
    if (!this.options.multicolor) {
      return {};
    }

    return {
      color: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-color') ||
          (element as HTMLElement).style.backgroundColor ||
          null,
        renderHTML: (attributes) => {
          if (!attributes.color) {
            return {
              style: '--highlight-text-dark: #554b02; color: inherit;',
            };
          }
          const darkTone = getDarkToneForColor(attributes.color);
          return {
            'data-color': attributes.color,
            style: `background-color: ${attributes.color}; --highlight-text-dark: ${darkTone}; color: inherit;`,
          };
        },
      },
    };
  },
});
