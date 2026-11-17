export type StickyNoteColorKey =
  | 'yellow'
  | 'green'
  | 'blue'
  | 'pink'
  | 'lilac'
  | 'orange';

export interface StickyNote {
  id: string;
  user_id: string;
  title: string;
  content: string;
  color: StickyNoteColorKey | string;
  position_x: number;
  position_y: number;
  width_px: number;
  z_index: number;
  created_at: string;
  updated_at: string;
}

export const STICKY_DEFAULT_WIDTH = 260;
export const STICKY_MIN_WIDTH = 190;
export const STICKY_MAX_WIDTH = 640;

export interface StickyColorTheme {
  key: StickyNoteColorKey;
  label: string;
  swatchLight: string;
  swatchDark: string;
  cardClass: string;
  headerClass: string;
  textClass: string;
  mutedTextClass: string;
}

export const STICKY_COLORS: StickyColorTheme[] = [
  {
    key: 'yellow',
    label: 'Amarelo-claro',
    swatchLight: '#fef08a',
    swatchDark: '#856e1e',
    cardClass:
      'bg-[#fef5b7] border-[#eadb85] dark:bg-[#383014] dark:border-[#5b4d20]',
    headerClass:
      'bg-[#f9eb9b]/80 border-[#e7d77d]/80 dark:bg-[#433918]/90 dark:border-[#5b4d20]',
    textClass: 'text-[#2b2414] dark:text-[#fbf3cf]',
    mutedTextClass: 'text-[#6e6038] dark:text-[#cfc28d]',
  },
  {
    key: 'green',
    label: 'Verde-claro',
    swatchLight: '#bbf7d0',
    swatchDark: '#26613a',
    cardClass:
      'bg-[#dcf7da] border-[#b4dfb2] dark:bg-[#193221] dark:border-[#2e583b]',
    headerClass:
      'bg-[#cbeec8]/80 border-[#add9aa]/80 dark:bg-[#1f3d28]/90 dark:border-[#2e583b]',
    textClass: 'text-[#182c1b] dark:text-[#def7e3]',
    mutedTextClass: 'text-[#486c4d] dark:text-[#98c9a3]',
  },
  {
    key: 'blue',
    label: 'Azul-claro',
    swatchLight: '#bae6fd',
    swatchDark: '#264d78',
    cardClass:
      'bg-[#d8eeff] border-[#accff0] dark:bg-[#182b42] dark:border-[#2d4e76]',
    headerClass:
      'bg-[#c4e3fc]/80 border-[#a4c9ec]/80 dark:bg-[#1e3551]/90 dark:border-[#2d4e76]',
    textClass: 'text-[#162738] dark:text-[#dfeeff]',
    mutedTextClass: 'text-[#476788] dark:text-[#99bde4]',
  },
  {
    key: 'pink',
    label: 'Rosa-claro',
    swatchLight: '#fbcfe8',
    swatchDark: '#73314c',
    cardClass:
      'bg-[#fce1eb] border-[#ebb3c8] dark:bg-[#3a1c29] dark:border-[#683349]',
    headerClass:
      'bg-[#f8ccdc]/80 border-[#e7aac1]/80 dark:bg-[#472333]/90 dark:border-[#683349]',
    textClass: 'text-[#361925] dark:text-[#fce5ef]',
    mutedTextClass: 'text-[#7e4a5f] dark:text-[#d79db5]',
  },
  {
    key: 'lilac',
    label: 'Lilás',
    swatchLight: '#ddd6fe',
    swatchDark: '#4d3a7c',
    cardClass:
      'bg-[#ebe2ff] border-[#c8b6f2] dark:bg-[#2a2042] dark:border-[#4b3a73]',
    headerClass:
      'bg-[#ded1fc]/80 border-[#c1adec]/80 dark:bg-[#332750]/90 dark:border-[#4b3a73]',
    textClass: 'text-[#24193a] dark:text-[#ede6ff]',
    mutedTextClass: 'text-[#5d4b82] dark:text-[#b6a3de]',
  },
  {
    key: 'orange',
    label: 'Laranja-claro',
    swatchLight: '#fed7aa',
    swatchDark: '#7d4b24',
    cardClass:
      'bg-[#ffe4c7] border-[#edc090] dark:bg-[#3c2614] dark:border-[#6b4425]',
    headerClass:
      'bg-[#fcd6ad]/80 border-[#e7b886]/80 dark:bg-[#492f19]/90 dark:border-[#6b4425]',
    textClass: 'text-[#362010] dark:text-[#ffebd6]',
    mutedTextClass: 'text-[#7d5434] dark:text-[#d6a982]',
  },
];

export function getStickyColorTheme(color?: string | null): StickyColorTheme {
  const normalized = (color || '').trim().toLowerCase();
  const match = STICKY_COLORS.find((c) => c.key === normalized);
  return match || STICKY_COLORS[0];
}
