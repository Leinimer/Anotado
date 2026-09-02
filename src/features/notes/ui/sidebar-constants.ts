import {
  Sparkles,
  Type,
  AlignLeft,
  Hash,
  Folder,
  Archive,
} from 'lucide-react';
import { SearchMode } from '../types';

export const FOLDER_PRESET_COLORS = [
  { id: 'default', label: 'Padrão / Neutro', color: null, hex: '#7f756e' },
  { id: 'yellow', label: 'Amarelo', color: '#eab308', hex: '#eab308' },
  { id: 'green', label: 'Verde', color: '#16a34a', hex: '#16a34a' },
  { id: 'mint', label: 'Menta', color: '#0d9488', hex: '#0d9488' },
  { id: 'blue', label: 'Azul', color: '#2563eb', hex: '#2563eb' },
  { id: 'pink', label: 'Rosa', color: '#db2777', hex: '#db2777' },
  { id: 'red', label: 'Vermelho', color: '#dc2626', hex: '#dc2626' },
  { id: 'purple', label: 'Roxo', color: '#9333ea', hex: '#9333ea' },
];

export const SEARCH_MODES = [
  { id: 'all' as SearchMode, label: 'Tudo', desc: 'Títulos, conteúdo, tags e pastas', icon: Sparkles },
  { id: 'title' as SearchMode, label: 'Títulos', desc: 'Somente títulos de notas', icon: Type },
  { id: 'content' as SearchMode, label: 'Conteúdo', desc: 'Texto interno das notas', icon: AlignLeft },
  { id: 'tags' as SearchMode, label: 'Tags', desc: 'Etiquetas e #hashtags', icon: Hash },
  { id: 'folders' as SearchMode, label: 'Pastas', desc: 'Somente nomes de pastas', icon: Folder },
  { id: 'archived' as SearchMode, label: 'Arquivadas', desc: 'Somente notas arquivadas', icon: Archive },
];

export interface DropTargetInfo {
  targetId: string;
  targetType: 'folder' | 'note';
  dropPosition: 'before' | 'after' | 'inside';
  targetParentId: string | null;
  targetPosition: number;
}
