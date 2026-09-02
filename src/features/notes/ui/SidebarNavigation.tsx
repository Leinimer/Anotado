'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderPlus,
  FilePlus,
  Tag,
  X,
  LogOut,
  Settings,
  User,
  MoreHorizontal,
  Edit2,
  Trash2,
  AlertTriangle,
  Sparkles,
  Palette,
  Archive,
  ArchiveRestore,
  Type,
  AlignLeft,
  Hash,
  Check,
  Loader2,
  Smartphone,
  FolderInput,
  Layers,
  CheckSquare,
} from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { TagsModal } from './TagsModal';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { createClient } from '@/src/features/auth/api/supabase-client';
import { flushAllPendingSaves } from '@/src/features/notes/api/notes-api';
import { usePwa } from '@/src/features/pwa/PwaProvider';
import {
  Folder as FolderType,
  Note as NoteType,
  SearchMode,
  SYSTEM_ARCHIVE_FOLDER_ID,
  TreeFolderNode,
  TreeNodeItem,
} from '../types';
import { extractAllUniqueTags } from '../utils/hashtag-extractor';
import { buildFolderTree, filterTree, wouldCreateCycle } from '../utils/tree-builder';

const FOLDER_PRESET_COLORS = [
  { id: 'default', label: 'Padrão / Neutro', color: null, hex: '#7f756e' },
  { id: 'yellow', label: 'Amarelo', color: '#eab308', hex: '#eab308' },
  { id: 'green', label: 'Verde', color: '#16a34a', hex: '#16a34a' },
  { id: 'mint', label: 'Menta', color: '#0d9488', hex: '#0d9488' },
  { id: 'blue', label: 'Azul', color: '#2563eb', hex: '#2563eb' },
  { id: 'pink', label: 'Rosa', color: '#db2777', hex: '#db2777' },
  { id: 'red', label: 'Vermelho', color: '#dc2626', hex: '#dc2626' },
  { id: 'purple', label: 'Roxo', color: '#9333ea', hex: '#9333ea' },
];

const SEARCH_MODES = [
  { id: 'all' as SearchMode, label: 'Tudo', desc: 'Títulos, conteúdo, tags e pastas', icon: Sparkles },
  { id: 'title' as SearchMode, label: 'Títulos', desc: 'Somente títulos de notas', icon: Type },
  { id: 'content' as SearchMode, label: 'Conteúdo', desc: 'Texto interno das notas', icon: AlignLeft },
  { id: 'tags' as SearchMode, label: 'Tags', desc: 'Etiquetas e #hashtags', icon: Hash },
  { id: 'folders' as SearchMode, label: 'Pastas', desc: 'Somente nomes de pastas', icon: Folder },
  { id: 'archived' as SearchMode, label: 'Arquivadas', desc: 'Somente notas arquivadas', icon: Archive },
];

interface DropTargetInfo {
  targetId: string;
  targetType: 'folder' | 'note';
  dropPosition: 'before' | 'after' | 'inside';
  targetParentId: string | null;
  targetPosition: number;
}

interface SidebarNavigationProps {
  folders: FolderType[];
  notes: NoteType[];
  activeNoteId: string | null;
  activeFolderId: string | null;
  onSelectNote: (noteId: string) => void;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (parentId?: string | null) => Promise<string | void>;
  onCreateNote: (folderId?: string | null) => Promise<string | void>;
  onRenameFolder: (folderId: string, newName: string) => void;
  onRenameNote: (noteId: string, newTitle: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onDeleteNote: (noteId: string) => void;
  onArchiveNote?: (noteId: string) => void;
  onUnarchiveNote?: (noteId: string) => void;
  onArchiveFolderNotes?: (folderId: string) => void;
  onUpdateFolderColor?: (folderId: string, color: string | null) => void;
  onUpdateFolderSmartConfig?: (folderId: string, isSmart: boolean, smartTags: string[]) => void;
  onMoveItem: (
    itemType: 'folder' | 'note',
    itemId: string,
    targetFolderId: string | null,
    targetPosition: number
  ) => void;
  onCloseMobile?: () => void;
}

export function SidebarNavigation({
  folders,
  notes,
  activeNoteId,
  activeFolderId,
  onSelectNote,
  onSelectFolder,
  onCreateFolder,
  onCreateNote,
  onRenameFolder,
  onRenameNote,
  onDeleteFolder,
  onDeleteNote,
  onArchiveNote,
  onUnarchiveNote,
  onArchiveFolderNotes,
  onUpdateFolderColor,
  onUpdateFolderSmartConfig,
  onMoveItem,
  onCloseMobile,
}: SidebarNavigationProps) {
  const { isStandalone, openInstallModal } = usePwa();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('all');
  const [showSearchModeMenu, setShowSearchModeMenu] = useState(false);
  const searchModeMenuRef = useRef<HTMLDivElement>(null);

  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('demo-user');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [openFolderIds, setOpenFolderIds] = useState<Set<string>>(new Set(['pasta-2']));

  // Estado para menu flutuante de opções (...)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [menuItemType, setMenuItemType] = useState<'folder' | 'note' | null>(null);
  const [menuNoteIsArchived, setMenuNoteIsArchived] = useState(false);
  const [showColorSubmenu, setShowColorSubmenu] = useState(false);
  const colorSubmenuTimerRef = useRef<NodeJS.Timeout | null>(null);
  const customColorInputRef = useRef<HTMLInputElement>(null);

  // Estado para popover de configuração de Pasta Inteligente
  const [smartConfigFolderId, setSmartConfigFolderId] = useState<string | null>(null);
  const [smartConfigTags, setSmartConfigTags] = useState<string[]>([]);

  // Estado para renomeação inline
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemType, setEditingItemType] = useState<'folder' | 'note' | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Estado para diálogo de confirmação de exclusão
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    type: 'folder' | 'note';
    name: string;
    hasChildren?: boolean;
  } | null>(null);

  // Estado para modal de todas as etiquetas e limitação visual de tags
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);
  const tagsContainerRef = useRef<HTMLDivElement>(null);
  const [hasTagsOverflow, setHasTagsOverflow] = useState(false);

  // Extrai tags dinâmicas de todas as notas
  const uniqueTags = useMemo(() => extractAllUniqueTags(notes), [notes]);

  // Drag & Drop State (Diferenciação precisa de 'before', 'after' e 'inside')
  const [draggingItem, setDraggingItem] = useState<{
    type: 'folder' | 'note';
    id: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetInfo | null>(null);

  // Touch Long-Press Timer para Mobile Drag & Drop
  const touchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // Estado para Seleção Múltipla e Marquee Selection (Bloco B)
  const [selectedItems, setSelectedItems] = useState<Map<string, 'folder' | 'note'>>(new Map());
  const lastSelectedIdRef = useRef<{ id: string; type: 'folder' | 'note' } | null>(null);
  const [isMarqueeActive, setIsMarqueeActive] = useState(false);
  const [marqueeRect, setMarqueeRect] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [showBatchMoveDialog, setShowBatchMoveDialog] = useState(false);
  const [batchMoveFolderId, setBatchMoveFolderId] = useState<string | null>(null);
  const [draggingMultiItems, setDraggingMultiItems] = useState<
    { type: 'folder' | 'note'; id: string }[] | null
  >(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }: any) => {
      if (data?.user) {
        if (data.user.email) setUserEmail(data.user.email);
        if (data.user.id) setUserId(data.user.id);
      }
    });
  }, []);

  // Debounce para busca
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 200);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Foco no input de edição ao iniciar renomeação
  useEffect(() => {
    if (editingItemId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingItemId]);

  // Mede overflow de tags para limitar a 4 linhas visuais
  useEffect(() => {
    if (tagsContainerRef.current) {
      const isOverflowing =
        tagsContainerRef.current.scrollHeight > 108 || uniqueTags.length > 8;
      setHasTagsOverflow(isOverflowing);
    }
  }, [uniqueTags]);

  // Fecha menu de contexto e menu de busca ao clicar fora ou ao pressionar Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuOpenId) {
        setMenuOpenId(null);
        setMenuPosition(null);
        setShowColorSubmenu(false);
        if (colorSubmenuTimerRef.current) {
          clearTimeout(colorSubmenuTimerRef.current);
          colorSubmenuTimerRef.current = null;
        }
      }
      if (showSearchModeMenu && searchModeMenuRef.current && !searchModeMenuRef.current.contains(e.target as Node)) {
        setShowSearchModeMenu(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (menuOpenId) {
          setMenuOpenId(null);
          setMenuPosition(null);
          setShowColorSubmenu(false);
        }
        if (confirmDelete) {
          setConfirmDelete(null);
        }
        if (showBatchDeleteConfirm) {
          setShowBatchDeleteConfirm(false);
        }
        if (showBatchMoveDialog) {
          setShowBatchMoveDialog(false);
        }
        if (smartConfigFolderId) {
          setSmartConfigFolderId(null);
        }
        if (showSearchModeMenu) {
          setShowSearchModeMenu(false);
        }
        if (selectedItems.size > 0) {
          setSelectedItems(new Map());
          lastSelectedIdRef.current = null;
        }
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedItems.size > 0) {
        const activeEl = document.activeElement;
        const isInput =
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement ||
          activeEl?.getAttribute('contenteditable') === 'true';
        if (!isInput && !confirmDelete && !showBatchDeleteConfirm) {
          e.preventDefault();
          setShowBatchDeleteConfirm(true);
        }
      }
    };

    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    menuOpenId,
    showSearchModeMenu,
    confirmDelete,
    smartConfigFolderId,
    selectedItems.size,
    showBatchDeleteConfirm,
    showBatchMoveDialog,
  ]);

  // Limpeza de timer do submenu de cores no unmount
  useEffect(() => {
    return () => {
      if (colorSubmenuTimerRef.current) {
        clearTimeout(colorSubmenuTimerRef.current);
      }
    };
  }, []);

  const handleMouseEnterColorOption = () => {
    if (colorSubmenuTimerRef.current) {
      clearTimeout(colorSubmenuTimerRef.current);
      colorSubmenuTimerRef.current = null;
    }
    setShowColorSubmenu(true);
  };

  const handleMouseLeaveColorOption = () => {
    if (colorSubmenuTimerRef.current) {
      clearTimeout(colorSubmenuTimerRef.current);
    }
    colorSubmenuTimerRef.current = setTimeout(() => {
      setShowColorSubmenu(false);
    }, 250);
  };

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    try {
      setIsLoggingOut(true);
      // 1. Aguarda a conclusão e confirmação de todos os salvamentos pendentes
      await flushAllPendingSaves();

      // 2. Executa o signOut local apenas neste dispositivo (mantém sessões ativas no celular/computador/tablet)
      const supabase = createClient();
      await supabase.auth.signOut({ scope: 'local' });

      if (typeof window !== 'undefined') {
        window.location.replace('/login');
      }
    } catch (err: any) {
      console.error('[Logout] Falha ao persistir dados antes de sair:', err);
      setIsLoggingOut(false);
      alert('Não foi possível salvar todas as alterações pendentes. Por favor, tente novamente.');
    }
  };

  // Alterna expansão de pasta SEM destacar seleção visual
  const toggleFolder = (folderId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setOpenFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const isCancellingRenameRef = useRef(false);
  const lastClickRef = useRef<{ id: string; type: 'folder' | 'note'; time: number } | null>(null);

  // Inicia edição de nome
  const startRenaming = (id: string, type: 'folder' | 'note', initialName: string) => {
    isCancellingRenameRef.current = false;
    setEditingItemId(id);
    setEditingItemType(type);
    setEditingValue(initialName);
    setMenuOpenId(null);
  };

  const handleSaveRename = () => {
    if (isCancellingRenameRef.current) {
      isCancellingRenameRef.current = false;
      return;
    }
    if (!editingItemId || !editingItemType) return;
    const trimmed = editingValue.trim();
    if (trimmed) {
      if (editingItemType === 'folder') {
        onRenameFolder(editingItemId, trimmed);
      } else {
        onRenameNote(editingItemId, trimmed);
      }
    }
    setEditingItemId(null);
    setEditingItemType(null);
  };

  // Criação de Nova Pasta SEMPRE na raiz (parent_id = null)
  const handleTriggerCreateFolder = async () => {
    const createdId = await onCreateFolder(null);
    if (createdId && typeof createdId === 'string') {
      startRenaming(createdId, 'folder', 'Nova pasta');
    }
  };

  // Criação de Nova Nota SEMPRE na raiz (folder_id = null)
  const handleTriggerCreateNote = async () => {
    await onCreateNote(null);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  // Abre menu contextual ao clicar no botão ...
  const handleOpenMenu = (
    e: React.MouseEvent,
    id: string,
    type: 'folder' | 'note',
    isArchived = false
  ) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const menuWidth = 175;
    const menuHeight = type === 'folder' ? 220 : 130;
    const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1000;
    const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

    let left = Math.max(12, Math.min(rect.left - 60, windowWidth - menuWidth - 12));
    let top = rect.bottom + 4;

    if (top + menuHeight > windowHeight - 10) {
      top = Math.max(10, rect.top - menuHeight - 4);
    }

    setMenuPosition({ top, left });
    setMenuOpenId(id);
    setMenuItemType(type);
    setMenuNoteIsArchived(isArchived);
    setShowColorSubmenu(false);
    if (colorSubmenuTimerRef.current) {
      clearTimeout(colorSubmenuTimerRef.current);
      colorSubmenuTimerRef.current = null;
    }
  };

  // Abre menu contextual ao clicar com o botão direito do mouse
  const handleContextMenu = (
    e: React.MouseEvent,
    id: string,
    type: 'folder' | 'note',
    isArchived = false
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const menuWidth = 175;
    const menuHeight = type === 'folder' ? 220 : 130;
    const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1000;
    const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

    let left = e.clientX;
    let top = e.clientY;

    // Ajuste de borda direita
    if (left + menuWidth > windowWidth - 12) {
      left = Math.max(12, left - menuWidth);
    }

    // Ajuste de borda inferior
    if (top + menuHeight > windowHeight - 12) {
      top = Math.max(10, top - menuHeight);
    }

    setMenuPosition({ top, left });
    setMenuOpenId(id);
    setMenuItemType(type);
    setMenuNoteIsArchived(isArchived);
    setShowColorSubmenu(false);
    if (colorSubmenuTimerRef.current) {
      clearTimeout(colorSubmenuTimerRef.current);
      colorSubmenuTimerRef.current = null;
    }
  };

  // Inicia confirmação de exclusão
  const promptDelete = (id: string, type: 'folder' | 'note') => {
    setMenuOpenId(null);
    if (type === 'folder') {
      const targetFolder = folders.find((f) => f.id === id);
      const hasSubfolders = folders.some((f) => f.parent_id === id);
      const hasNotes = notes.some((n) => n.folder_id === id);
      const hasChildren = hasSubfolders || hasNotes;

      setConfirmDelete({
        id,
        type: 'folder',
        name: targetFolder?.name || 'esta pasta',
        hasChildren,
      });
    } else {
      const targetNote = notes.find((n) => n.id === id);
      setConfirmDelete({
        id,
        type: 'note',
        name: targetNote?.title || 'esta nota',
      });
    }
  };

  const handleConfirmDelete = () => {
    if (!confirmDelete) return;
    if (confirmDelete.type === 'folder') {
      onDeleteFolder(confirmDelete.id);
    } else {
      onDeleteNote(confirmDelete.id);
    }
    setConfirmDelete(null);
  };

  // ==========================================
  // DRAG & DROP INTELIGENTE (REORDENAR VS ENTRAR VS ARQUIVAR + MULTI-SELEÇÃO)
  // ==========================================
  const handleDragStart = (e: React.DragEvent, type: 'folder' | 'note', id: string) => {
    e.stopPropagation();
    // Bloqueia arrastar pasta de sistema "Notas arquivadas"
    if (type === 'folder' && id === SYSTEM_ARCHIVE_FOLDER_ID) {
      e.preventDefault();
      return;
    }

    // Se o item arrastado faz parte da seleção múltipla e há mais de 1 item selecionado
    if (selectedItems.has(id) && selectedItems.size > 1) {
      const multi = Array.from(selectedItems.entries()).map(([itemId, itemType]) => ({
        id: itemId,
        type: itemType,
      }));
      setDraggingMultiItems(multi);
      setDraggingItem({ type, id });
      e.dataTransfer.setData('text/plain', JSON.stringify({ type, id, multi: true }));
      e.dataTransfer.effectAllowed = 'move';
      return;
    }

    setDraggingMultiItems(null);
    setDraggingItem({ type, id });
    e.dataTransfer.setData('text/plain', JSON.stringify({ type, id }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggingItem(null);
    setDraggingMultiItems(null);
    setDropTarget(null);
  };

  // Cálculo de posição para PASTAS
  const handleDragOverFolder = (
    e: React.DragEvent,
    folder: TreeFolderNode
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingItem) return;

    // Se a pasta for "Notas arquivadas"
    if (folder.id === SYSTEM_ARCHIVE_FOLDER_ID) {
      if (draggingItem.type === 'note') {
        setDropTarget({
          targetId: folder.id,
          targetType: 'folder',
          dropPosition: 'inside',
          targetParentId: null,
          targetPosition: 0,
        });
      } else {
        setDropTarget(null);
      }
      return;
    }

    // Se estiver arrastando a própria pasta
    if (draggingItem.type === 'folder' && draggingItem.id === folder.id) {
      setDropTarget(null);
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY = (e.clientY - rect.top) / rect.height;

    // Se for pasta arrastada, previne ciclos de aninhamento
    const isCycle =
      draggingItem.type === 'folder' &&
      wouldCreateCycle(draggingItem.id, folder.id, folders);

    if (relY < 0.25) {
      // Reordenar ANTES da pasta (mesmo nível da pasta alvo)
      setDropTarget({
        targetId: folder.id,
        targetType: 'folder',
        dropPosition: 'before',
        targetParentId: folder.parentId,
        targetPosition: Math.max(0, folder.position),
      });
    } else if (relY > 0.75) {
      // Reordenar DEPOIS da pasta (mesmo nível da pasta alvo)
      setDropTarget({
        targetId: folder.id,
        targetType: 'folder',
        dropPosition: 'after',
        targetParentId: folder.parentId,
        targetPosition: folder.position + 1,
      });
    } else {
      // Se não for ciclo, permite soltar DENTRO da pasta
      if (!isCycle) {
        setDropTarget({
          targetId: folder.id,
          targetType: 'folder',
          dropPosition: 'inside',
          targetParentId: folder.id,
          targetPosition: folder.subfolders.length + folder.notes.length,
        });
      } else {
        setDropTarget({
          targetId: folder.id,
          targetType: 'folder',
          dropPosition: 'after',
          targetParentId: folder.parentId,
          targetPosition: folder.position + 1,
        });
      }
    }
  };

  // Cálculo de posição para NOTAS
  const handleDragOverNote = (
    e: React.DragEvent,
    note: TreeNodeItem
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingItem) return;

    // Se estiver arrastando a própria nota sobre si mesma
    if (draggingItem.type === 'note' && draggingItem.id === note.id) {
      setDropTarget(null);
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY = (e.clientY - rect.top) / rect.height;

    if (relY < 0.5) {
      // Reordenar ANTES da nota
      setDropTarget({
        targetId: note.id,
        targetType: 'note',
        dropPosition: 'before',
        targetParentId: note.folderId === SYSTEM_ARCHIVE_FOLDER_ID ? null : note.folderId,
        targetPosition: Math.max(0, note.position),
      });
    } else {
      // Reordenar DEPOIS da nota
      setDropTarget({
        targetId: note.id,
        targetType: 'note',
        dropPosition: 'after',
        targetParentId: note.folderId === SYSTEM_ARCHIVE_FOLDER_ID ? null : note.folderId,
        targetPosition: note.position + 1,
      });
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const related = e.relatedTarget as Node | null;
    if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
      setDropTarget(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggingItem || !dropTarget) {
      setDraggingItem(null);
      setDraggingMultiItems(null);
      setDropTarget(null);
      return;
    }

    const { targetId, targetParentId, targetPosition, dropPosition } = dropTarget;

    // Caso Especial: Multi-itens sendo arrastados juntos
    if (draggingMultiItems && draggingMultiItems.length > 0) {
      draggingMultiItems.forEach((item, index) => {
        if (item.type === 'folder' && wouldCreateCycle(item.id, targetParentId, folders)) {
          return;
        }
        if (targetId === SYSTEM_ARCHIVE_FOLDER_ID && item.type === 'note') {
          if (onArchiveNote) onArchiveNote(item.id);
          return;
        }
        const isArchived = notes.find((n) => n.id === item.id)?.is_archived;
        if (isArchived && item.type === 'note' && onUnarchiveNote) {
          onUnarchiveNote(item.id);
        }
        onMoveItem(item.type, item.id, targetParentId, targetPosition + index);
      });

      if (dropPosition === 'inside' && dropTarget.targetId) {
        setOpenFolderIds((prev) => new Set(prev).add(dropTarget.targetId));
      }
      setSelectedItems(new Map());
      setDraggingItem(null);
      setDraggingMultiItems(null);
      setDropTarget(null);
      return;
    }

    const { type, id } = draggingItem;

    // Caso Especial: Soltar nota dentro da pasta "Notas arquivadas"
    if (targetId === SYSTEM_ARCHIVE_FOLDER_ID && type === 'note') {
      if (onArchiveNote) {
        onArchiveNote(id);
      }
      setDraggingItem(null);
      setDraggingMultiItems(null);
      setDropTarget(null);
      return;
    }

    // Verificação estrita contra ciclos se for pasta
    if (type === 'folder') {
      if (wouldCreateCycle(id, targetParentId, folders)) {
        setDraggingItem(null);
        setDraggingMultiItems(null);
        setDropTarget(null);
        return;
      }
    }

    // Se estiver arrastando uma nota que estava arquivada para fora, desarquiva e move
    const isArchivedNote = notes.find((n) => n.id === id)?.is_archived;
    if (isArchivedNote && type === 'note') {
      if (onUnarchiveNote) {
        onUnarchiveNote(id);
      }
      onMoveItem(type, id, targetParentId, targetPosition);
    } else {
      // Movimentação normal
      onMoveItem(type, id, targetParentId, targetPosition);
    }

    // Se soltou dentro de uma pasta, abre a pasta para mostrar o item
    if (dropPosition === 'inside' && dropTarget.targetId) {
      setOpenFolderIds((prev) => new Set(prev).add(dropTarget.targetId));
    }

    setDraggingItem(null);
    setDraggingMultiItems(null);
    setDropTarget(null);
  };

  // Drop na raiz da sidebar
  const handleDropOnRoot = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggingItem) return;

    if (draggingMultiItems && draggingMultiItems.length > 0) {
      draggingMultiItems.forEach((item, index) => {
        const isArchived = notes.find((n) => n.id === item.id)?.is_archived;
        if (isArchived && item.type === 'note' && onUnarchiveNote) {
          onUnarchiveNote(item.id);
        }
        onMoveItem(item.type, item.id, null, folders.length + notes.length + index);
      });
      setSelectedItems(new Map());
      setDraggingItem(null);
      setDraggingMultiItems(null);
      setDropTarget(null);
      return;
    }

    const { type, id } = draggingItem;
    const isArchivedNote = notes.find((n) => n.id === id)?.is_archived;
    if (isArchivedNote && type === 'note') {
      if (onUnarchiveNote) {
        onUnarchiveNote(id);
      }
    }
    onMoveItem(type, id, null, folders.length + notes.length);

    setDraggingItem(null);
    setDraggingMultiItems(null);
    setDropTarget(null);
  };

  // Touch Drag Support para Mobile
  const handleTouchStart = (type: 'folder' | 'note', id: string, e: React.TouchEvent) => {
    if (type === 'folder' && id === SYSTEM_ARCHIVE_FOLDER_ID) return;
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

    touchTimerRef.current = setTimeout(() => {
      setDraggingItem({ type, id });
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(40);
      }
    }, 350);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);

    if (dx > 10 || dy > 10) {
      if (touchTimerRef.current) {
        clearTimeout(touchTimerRef.current);
        touchTimerRef.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  };

  // Constrói e filtra a árvore de pastas e notas
  const { folders: rawTreeFolders, rootNotes: rawRootNotes, archivedFolder: rawArchivedFolder } = buildFolderTree(
    folders,
    notes
  );

  const isFiltering = debouncedSearchQuery.trim().length > 0 || activeTag !== null || searchMode !== 'all';
  const {
    filteredFolders,
    filteredNotes,
    filteredArchivedFolder,
    hasResults,
  } = filterTree(
    rawTreeFolders,
    rawRootNotes,
    rawArchivedFolder,
    debouncedSearchQuery,
    activeTag,
    searchMode
  );

  // Placeholder dinâmico de acordo com o modo de busca
  const getSearchPlaceholder = () => {
    switch (searchMode) {
      case 'title':
        return 'Buscar por título...';
      case 'content':
        return 'Buscar por conteúdo...';
      case 'tags':
        return 'Buscar por tag (#exemplo)...';
      case 'folders':
        return 'Buscar pastas...';
      case 'archived':
        return 'Buscar em arquivadas...';
      case 'all':
      default:
        return 'Buscar tudo...';
    }
  };

  // Obtém lista ordenada de itens visíveis na árvore para suporte a Shift+Clique
  const getVisibleTreeItems = React.useCallback((): { id: string; type: 'folder' | 'note' }[] => {
    const items: { id: string; type: 'folder' | 'note' }[] = [];
    const traverseFolder = (folder: TreeFolderNode) => {
      items.push({ id: folder.id, type: 'folder' });
      if (openFolderIds.has(folder.id) || isFiltering) {
        folder.subfolders.forEach(traverseFolder);
        folder.notes.forEach((note) => items.push({ id: note.id, type: 'note' }));
      }
    };
    filteredFolders.forEach(traverseFolder);
    filteredNotes.forEach((note) => items.push({ id: note.id, type: 'note' }));
    if (filteredArchivedFolder) {
      traverseFolder(filteredArchivedFolder);
    }
    return items;
  }, [filteredFolders, filteredNotes, filteredArchivedFolder, openFolderIds, isFiltering]);

  // Exclusão em lote
  const handleBatchConfirmDelete = () => {
    if (selectedItems.size === 0) return;
    selectedItems.forEach((type, id) => {
      if (type === 'folder') {
        onDeleteFolder(id);
      } else {
        onDeleteNote(id);
      }
    });
    setSelectedItems(new Map());
    lastSelectedIdRef.current = null;
    setShowBatchDeleteConfirm(false);
  };

  // Movimentação em lote
  const handleBatchMoveSubmit = (targetParentId: string | null) => {
    if (selectedItems.size === 0) return;
    let indexOffset = 0;
    selectedItems.forEach((type, id) => {
      if (type === 'folder' && wouldCreateCycle(id, targetParentId, folders)) {
        return;
      }
      onMoveItem(type, id, targetParentId, indexOffset);
      indexOffset += 1;
    });
    if (targetParentId) {
      setOpenFolderIds((prev) => new Set(prev).add(targetParentId));
    }
    setSelectedItems(new Map());
    lastSelectedIdRef.current = null;
    setShowBatchMoveDialog(false);
  };

  // Handler para Marquee Selection na Área Vazia da Sidebar
  const handleTreeAreaPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Apenas botão principal (esquerdo)
    if (e.button !== 0) return;

    // Se o clique ocorreu sobre algum elemento interativo ou item da árvore, não inicia marquee
    const target = e.target as HTMLElement;
    const isInteractive = target.closest(
      '[data-tree-item], [id^="folder-item-"], [id^="note-item-"], button, input, a, [data-context-menu], [data-no-marquee]'
    );

    if (isInteractive) {
      return;
    }

    const isCtrl = e.ctrlKey || e.metaKey;
    if (!isCtrl) {
      setSelectedItems(new Map());
      lastSelectedIdRef.current = null;
    }

    const startX = e.clientX;
    const startY = e.clientY;
    let hasStarted = false;
    const baseSelection = new Map(isCtrl ? selectedItems : []);

    const handlePointerMove = (moveEv: PointerEvent) => {
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;

      if (!hasStarted) {
        if (Math.hypot(dx, dy) > 4) {
          hasStarted = true;
          setIsMarqueeActive(true);
          document.body.style.userSelect = 'none';
        } else {
          return;
        }
      }

      const curX = moveEv.clientX;
      const curY = moveEv.clientY;
      setMarqueeRect({ startX, startY, currentX: curX, currentY: curY });

      const minX = Math.min(startX, curX);
      const maxX = Math.max(startX, curX);
      const minY = Math.min(startY, curY);
      const maxY = Math.max(startY, curY);

      const nextSelection = new Map(baseSelection);

      // Hit-test contra todos os elementos com data-tree-item
      const itemElements = document.querySelectorAll<HTMLElement>('[data-tree-item]');
      itemElements.forEach((el) => {
        const itemId = el.getAttribute('data-item-id');
        const itemType = el.getAttribute('data-item-type') as 'folder' | 'note';
        if (!itemId || !itemType) return;
        if (itemId === SYSTEM_ARCHIVE_FOLDER_ID) return;

        const rect = el.getBoundingClientRect();
        const isOverlapping =
          rect.left < maxX &&
          rect.right > minX &&
          rect.top < maxY &&
          rect.bottom > minY;

        if (isOverlapping) {
          nextSelection.set(itemId, itemType);
        } else if (!isCtrl) {
          nextSelection.delete(itemId);
        }
      });

      setSelectedItems(nextSelection);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.style.userSelect = '';
      setIsMarqueeActive(false);
      setMarqueeRect(null);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp, { passive: false });
  };

  // Renderização Recursiva de Pasta (Com linha de inserção e destaque ao entrar)
  const renderFolderNode = (folder: TreeFolderNode) => {
    const isSystemArchive = folder.id === SYSTEM_ARCHIVE_FOLDER_ID || folder.isSystem;
    const isOpen = isFiltering || openFolderIds.has(folder.id);
    const isEditing = editingItemId === folder.id && editingItemType === 'folder';
    const isSmart = folder.isSmart || (folder.smartTags && folder.smartTags.length > 0);
    const isMenuOpenForThisFolder = menuOpenId === folder.id;
    const isSelectedInMulti = selectedItems.has(folder.id);
    const effectiveColor = folder.effectiveColor || folder.color;
    const iconColor = isSystemArchive
      ? '#8c6b4f'
      : effectiveColor || (isOpen ? '#68594d' : '#7f756e');

    const isCurrentDropTarget = dropTarget?.targetId === folder.id && dropTarget?.targetType === 'folder';
    const isDropBefore = isCurrentDropTarget && dropTarget?.dropPosition === 'before';
    const isDropAfter = isCurrentDropTarget && dropTarget?.dropPosition === 'after';
    const isDropInside = isCurrentDropTarget && dropTarget?.dropPosition === 'inside';

    const handleFolderClick = (e: React.MouseEvent) => {
      if (isEditing) return;

      // Ctrl / Cmd + Clique para selecionar/deselecionar individualmente
      if ((e.ctrlKey || e.metaKey) && !isSystemArchive) {
        e.stopPropagation();
        setSelectedItems((prev) => {
          const next = new Map(prev);
          if (next.has(folder.id)) {
            next.delete(folder.id);
          } else {
            next.set(folder.id, 'folder');
          }
          return next;
        });
        lastSelectedIdRef.current = { id: folder.id, type: 'folder' };
        return;
      }

      // Shift + Clique para seleção em intervalo (range selection)
      if (e.shiftKey && lastSelectedIdRef.current && !isSystemArchive) {
        e.stopPropagation();
        const visibleItems = getVisibleTreeItems();
        const lastIdx = visibleItems.findIndex((it) => it.id === lastSelectedIdRef.current?.id);
        const currentIdx = visibleItems.findIndex((it) => it.id === folder.id);
        if (lastIdx !== -1 && currentIdx !== -1) {
          const start = Math.min(lastIdx, currentIdx);
          const end = Math.max(lastIdx, currentIdx);
          const rangeItems = visibleItems.slice(start, end + 1);
          setSelectedItems((prev) => {
            const next = new Map(prev);
            rangeItems.forEach((it) => {
              if (it.id !== SYSTEM_ARCHIVE_FOLDER_ID) {
                next.set(it.id, it.type);
              }
            });
            return next;
          });
          return;
        }
      }

      // Clique simples: limpa multi-seleção se houver itens selecionados e este não for o único
      if (selectedItems.size > 0 && !selectedItems.has(folder.id)) {
        setSelectedItems(new Map());
      }
      lastSelectedIdRef.current = { id: folder.id, type: 'folder' };

      const now = Date.now();
      const last = lastClickRef.current;
      if (last && last.id === folder.id && last.type === 'folder' && now - last.time < 350) {
        lastClickRef.current = null;
        if (!isSystemArchive) {
          startRenaming(folder.id, 'folder', folder.name);
          return;
        }
      }
      lastClickRef.current = { id: folder.id, type: 'folder', time: now };
      toggleFolder(folder.id, e);
    };

    const handleFolderDoubleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isSystemArchive || isEditing) return;
      startRenaming(folder.id, 'folder', folder.name);
    };

    return (
      <div key={folder.id} className="space-y-0.5 select-none relative">
        {/* Linha de Inserção Horizontal ANTES da Pasta */}
        {isDropBefore && !isSystemArchive && (
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#68594d] z-30 rounded-full pointer-events-none shadow-xs" />
        )}

        <div
          id={`folder-item-${folder.id}`}
          data-tree-item="true"
          data-item-id={folder.id}
          data-item-type="folder"
          draggable={!isEditing && !isSystemArchive}
          onDragStart={(e) => handleDragStart(e, 'folder', folder.id)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOverFolder(e, folder)}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onTouchStart={(e) => handleTouchStart('folder', folder.id, e)}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={handleFolderClick}
          onDoubleClick={handleFolderDoubleClick}
          onContextMenu={(e) => {
            if (!isSystemArchive) {
              handleContextMenu(e, folder.id, 'folder');
            }
          }}
          style={{ paddingLeft: `${folder.depth * 16 + 12}px` }}
          className={`group flex items-center justify-between pr-2 py-1.5 text-sm rounded-lg cursor-pointer transition-all relative ${
            isSelectedInMulti
              ? 'bg-[#e8decb] ring-1 ring-[#68594d]/50 font-medium text-[#1b1c19] shadow-2xs'
              : isDropInside
              ? 'bg-[#d7c3b0]/70 border-2 border-dashed border-[#68594d]'
              : isMenuOpenForThisFolder
              ? 'bg-[#e4e2dd]/90 text-[#1b1c19]'
              : isSystemArchive
              ? 'text-[#5e4b3e] hover:bg-[#f0ece5]'
              : 'text-[#4e453f] hover:bg-[#e4e2dd]/70'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="relative shrink-0 flex items-center justify-center">
              {isSystemArchive ? (
                <Archive
                  className="w-4 h-4 shrink-0 stroke-[1.75]"
                  style={{ color: iconColor }}
                />
              ) : isOpen ? (
                <FolderOpen
                  className="w-4 h-4 shrink-0 stroke-[1.75]"
                  style={{ color: iconColor }}
                />
              ) : (
                <Folder
                  className="w-4 h-4 shrink-0 stroke-[1.5]"
                  style={{ color: iconColor }}
                />
              )}
              {isSmart && (
                <Sparkles className="w-2.5 h-2.5 absolute -top-1 -right-1 text-[#eab308] fill-[#eab308]" />
              )}
            </div>

            {isEditing && !isSystemArchive ? (
              <input
                ref={editInputRef}
                type="text"
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={handleSaveRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename();
                  if (e.key === 'Escape') {
                    isCancellingRenameRef.current = true;
                    setEditingItemId(null);
                    setEditingItemType(null);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                className="w-full bg-white px-1.5 py-0.5 text-xs font-sans-ui rounded border border-[#68594d] focus:outline-none"
              />
            ) : (
              <div className="flex items-center gap-1.5 truncate">
                <span className={`font-sans-ui truncate text-xs sm:text-sm ${isSystemArchive ? 'font-semibold text-[#5e4b3e]' : 'font-medium text-[#3b332d]'}`}>
                  {folder.name}
                </span>
                {isSystemArchive && folder.notes.length > 0 && (
                  <span className="text-[10px] text-[#8c6b4f] bg-[#e8ded3] px-1.5 py-0.2 rounded-full font-medium">
                    {folder.notes.length}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Menu ... (Não exibido para a pasta de sistema Notas Arquivadas) */}
            {!isSystemArchive && (
              <button
                id={`folder-menu-btn-${folder.id}`}
                onClick={(e) => handleOpenMenu(e, folder.id, 'folder')}
                className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1 hover:bg-[#d1c4bc]/50 text-[#7f756e] hover:text-[#1b1c19] rounded transition-opacity"
                title="Opções da Pasta"
                aria-label="Opções da Pasta"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            )}

            {/* Seta indicador */}
            {isOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#7f756e]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#7f756e]" />
            )}
          </div>
        </div>

        {/* Linha de Inserção Horizontal DEPOIS da Pasta */}
        {isDropAfter && !isSystemArchive && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#68594d] z-30 rounded-full pointer-events-none shadow-xs" />
        )}

        {/* Filhos da Pasta */}
        {isOpen && (
          <div className="space-y-0.5">
            {folder.subfolders.map((sub) => renderFolderNode(sub))}
            {folder.notes.map((note) => renderNoteNode(note))}
          </div>
        )}
      </div>
    );
  };

  // Renderização de Item de Nota (Com linha de inserção para reordenar)
  const renderNoteNode = (note: TreeNodeItem) => {
    const isActive = activeNoteId === note.id;
    const isEditing = editingItemId === note.id && editingItemType === 'note';
    const isArchived = Boolean(note.isArchived);
    const isMenuOpenForThisNote = menuOpenId === note.id;
    const isSelectedInMulti = selectedItems.has(note.id);

    const isCurrentDropTarget = dropTarget?.targetId === note.id && dropTarget?.targetType === 'note';
    const isDropBefore = isCurrentDropTarget && dropTarget?.dropPosition === 'before';
    const isDropAfter = isCurrentDropTarget && dropTarget?.dropPosition === 'after';

    const handleNoteClick = (e: React.MouseEvent) => {
      if (isEditing) return;

      // Ctrl / Cmd + Clique para selecionar/deselecionar individualmente
      if (e.ctrlKey || e.metaKey) {
        e.stopPropagation();
        setSelectedItems((prev) => {
          const next = new Map(prev);
          if (next.has(note.id)) {
            next.delete(note.id);
          } else {
            next.set(note.id, 'note');
          }
          return next;
        });
        lastSelectedIdRef.current = { id: note.id, type: 'note' };
        return;
      }

      // Shift + Clique para seleção em intervalo (range selection)
      if (e.shiftKey && lastSelectedIdRef.current) {
        e.stopPropagation();
        const visibleItems = getVisibleTreeItems();
        const lastIdx = visibleItems.findIndex((it) => it.id === lastSelectedIdRef.current?.id);
        const currentIdx = visibleItems.findIndex((it) => it.id === note.id);
        if (lastIdx !== -1 && currentIdx !== -1) {
          const start = Math.min(lastIdx, currentIdx);
          const end = Math.max(lastIdx, currentIdx);
          const rangeItems = visibleItems.slice(start, end + 1);
          setSelectedItems((prev) => {
            const next = new Map(prev);
            rangeItems.forEach((it) => {
              if (it.id !== SYSTEM_ARCHIVE_FOLDER_ID) {
                next.set(it.id, it.type);
              }
            });
            return next;
          });
          return;
        }
      }

      // Clique simples: limpa multi-seleção se houver itens selecionados e este não for o único
      if (selectedItems.size > 0 && !selectedItems.has(note.id)) {
        setSelectedItems(new Map());
      }
      lastSelectedIdRef.current = { id: note.id, type: 'note' };

      const now = Date.now();
      const last = lastClickRef.current;
      if (last && last.id === note.id && last.type === 'note' && now - last.time < 350) {
        lastClickRef.current = null;
        startRenaming(note.id, 'note', note.title || 'Sem título');
        return;
      }
      lastClickRef.current = { id: note.id, type: 'note', time: now };
      onSelectNote(note.id);
      if (onCloseMobile) onCloseMobile();
    };

    const handleNoteDoubleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isEditing) return;
      startRenaming(note.id, 'note', note.title || 'Sem título');
    };

    return (
      <div key={note.id} className="relative space-y-0.5 select-none">
        {/* Linha de Inserção Horizontal ANTES da Nota */}
        {isDropBefore && (
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#68594d] z-30 rounded-full pointer-events-none shadow-xs" />
        )}

        <div
          id={`note-item-${note.id}`}
          data-tree-item="true"
          data-item-id={note.id}
          data-item-type="note"
          draggable={!isEditing}
          onDragStart={(e) => handleDragStart(e, 'note', note.id)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOverNote(e, note)}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onTouchStart={(e) => handleTouchStart('note', note.id, e)}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={handleNoteClick}
          onDoubleClick={handleNoteDoubleClick}
          onContextMenu={(e) => handleContextMenu(e, note.id, 'note', isArchived)}
          style={{ paddingLeft: `${note.depth * 16 + 12}px` }}
          className={`group flex items-center justify-between pr-2 py-1.5 text-sm rounded-lg cursor-pointer transition-colors relative ${
            isSelectedInMulti
              ? 'bg-[#f4dfcb] ring-1 ring-[#68594d]/50 font-medium text-[#1b1c19] shadow-2xs'
              : isActive
              ? 'bg-[#f4dfcb] text-[#1b1c19] font-medium shadow-2xs'
              : isMenuOpenForThisNote
              ? 'bg-[#e4e2dd]/80 text-[#1b1c19]'
              : 'text-[#4e453f] hover:bg-[#e4e2dd]/60'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isArchived ? (
              <Archive
                className={`w-3.5 h-3.5 shrink-0 ${
                  isActive ? 'text-[#8c6b4f] stroke-[2]' : 'text-[#a1968e] stroke-[1.5]'
                }`}
              />
            ) : (
              <FileText
                className={`w-4 h-4 shrink-0 ${
                  isActive ? 'text-[#68594d] stroke-[2]' : 'text-[#7f756e] stroke-[1.5]'
                }`}
              />
            )}

            {isEditing ? (
              <input
                ref={editInputRef}
                type="text"
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={handleSaveRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename();
                  if (e.key === 'Escape') {
                    isCancellingRenameRef.current = true;
                    setEditingItemId(null);
                    setEditingItemType(null);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                className="w-full bg-white px-1.5 py-0.5 text-xs font-sans-ui rounded border border-[#68594d] focus:outline-none"
              />
            ) : (
              <span className="font-sans-ui truncate text-xs sm:text-sm">
                {note.title || 'Sem título'}
              </span>
            )}
          </div>

          {/* Menu Horizontal ... */}
          <button
            id={`note-menu-btn-${note.id}`}
            onClick={(e) => handleOpenMenu(e, note.id, 'note', isArchived)}
            className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1 hover:bg-[#d1c4bc]/50 text-[#7f756e] hover:text-[#1b1c19] rounded transition-opacity"
            title="Opções da Nota"
            aria-label="Opções da Nota"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>

        {/* Linha de Inserção Horizontal DEPOIS da Nota */}
        {isDropAfter && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#68594d] z-30 rounded-full pointer-events-none shadow-xs" />
        )}
      </div>
    );
  };

  return (
    <aside
      id="sidebar-navigation-container"
      className="w-full md:w-64 lg:w-72 h-full bg-[#fbf9f4] border-r border-[#eae8e3] flex flex-col justify-between p-3 sm:p-4 select-none shrink-0"
    >
      {/* Top Header: Brand Logo Centered in Sidebar & Search Bar */}
      <div className="space-y-3">
        <div className="relative flex items-center justify-center py-1 px-1">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#68594d] text-white flex items-center justify-center font-serif-note font-bold text-sm shadow-xs">
              A
            </div>
            <span className="font-serif-note font-bold text-lg text-[#1b1c19] tracking-tight">
              anotado!
            </span>
          </div>

          {onCloseMobile && (
            <button
              id="sidebar-close-mobile-btn"
              onClick={onCloseMobile}
              className="absolute right-0 top-1/2 -translate-y-1/2 p-1.5 text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-lg md:hidden cursor-pointer"
              aria-label="Fechar Menu Lateral"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Search Bar with Mode Selector */}
        <div className="relative" ref={searchModeMenuRef}>
          {/* Botão Interativo da Lupa para abrir Menu de Busca */}
          <button
            type="button"
            id="sidebar-search-mode-trigger-btn"
            onClick={(e) => {
              e.stopPropagation();
              setShowSearchModeMenu((prev) => !prev);
            }}
            className={`absolute left-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors cursor-pointer flex items-center justify-center ${
              searchMode !== 'all'
                ? 'bg-[#68594d] text-white'
                : 'text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#e4e2dd]'
            }`}
            title="Escolher tipo de busca"
            aria-label="Escolher tipo de busca"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          <input
            id="sidebar-search-input"
            type="text"
            placeholder="Buscar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full bg-[#f0eee9] text-xs font-sans-ui text-[#1b1c19] placeholder-[#7f756e] rounded-xl pl-9 pr-8 py-2 border transition-all ${
              searchMode !== 'all'
                ? 'border-[#68594d]/40 focus:border-[#68594d] bg-white'
                : 'border-transparent focus:border-[#68594d] focus:bg-white'
            } focus:outline-none`}
          />

          {searchQuery && (
            <button
              id="sidebar-clear-search-btn"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7f756e] hover:text-[#1b1c19] p-0.5 rounded cursor-pointer"
              title="Limpar busca"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Menu Dropdown de Seleção de Tipo de Busca */}
          {showSearchModeMenu && (
            <div
              id="search-mode-dropdown"
              className="absolute left-0 top-full mt-1.5 w-64 bg-white border border-[#e4e2dd] rounded-2xl shadow-xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 font-sans-ui"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2 py-1.5 text-[11px] font-semibold text-[#7f756e] uppercase tracking-wider border-b border-[#f0eee9] mb-1">
                Tipo de Busca
              </div>

              <div className="space-y-0.5">
                {SEARCH_MODES.map((mode) => {
                  const Icon = mode.icon;
                  const isSelected = searchMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      id={`search-mode-option-${mode.id}`}
                      onClick={() => {
                        setSearchMode(mode.id);
                        setShowSearchModeMenu(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[#f4dfcb] text-[#1b1c19] font-medium'
                          : 'hover:bg-[#f0eee9] text-[#4e453f]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            isSelected ? 'text-[#68594d]' : 'text-[#7f756e]'
                          }`}
                        />
                        <div className="truncate">
                          <div className="text-xs">{mode.label}</div>
                          <div className="text-[10px] text-[#7f756e] font-normal truncate">
                            {mode.desc}
                          </div>
                        </div>
                      </div>

                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-[#68594d] shrink-0 ml-1" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Barra de Ações para Multi-Seleção (Bloco B) */}
      {selectedItems.size > 0 && (
        <div
          id="sidebar-multi-select-bar"
          data-no-marquee="true"
          className="px-2.5 py-1.5 bg-[#eae5de] border border-[#d8d1c7] rounded-xl flex items-center justify-between shadow-xs mb-1 animate-in fade-in zoom-in-95 duration-100 font-sans-ui text-xs text-[#1b1c19]"
        >
          <div className="flex items-center gap-1.5 font-medium truncate">
            <CheckSquare className="w-3.5 h-3.5 text-[#68594d] shrink-0" />
            <span>{selectedItems.size} selecionado{selectedItems.size > 1 ? 's' : ''}</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              id="batch-move-btn"
              onClick={() => setShowBatchMoveDialog(true)}
              className="px-2 py-1 hover:bg-[#dcd4c8] text-[#4e453f] hover:text-[#1b1c19] rounded-md transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
              title="Mover selecionados para pasta"
            >
              <FolderInput className="w-3.5 h-3.5 text-[#68594d]" />
              <span className="hidden sm:inline">Mover</span>
            </button>

            <button
              type="button"
              id="batch-delete-btn"
              onClick={() => setShowBatchDeleteConfirm(true)}
              className="px-2 py-1 hover:bg-[#fbdad4] text-[#ba1a1a] rounded-md transition-colors cursor-pointer flex items-center gap-1 text-[11px]"
              title="Excluir selecionados (Del)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Excluir</span>
            </button>

            <button
              type="button"
              id="batch-clear-btn"
              onClick={() => {
                setSelectedItems(new Map());
                lastSelectedIdRef.current = null;
              }}
              className="p-1 hover:bg-[#dcd4c8] text-[#7f756e] hover:text-[#1b1c19] rounded-md transition-colors cursor-pointer ml-0.5"
              title="Limpar seleção (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Árvore de Pastas e Notas */}
      <div
        id="sidebar-folder-tree-area"
        onPointerDown={handleTreeAreaPointerDown}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={handleDropOnRoot}
        className="flex-1 overflow-y-auto my-1 space-y-1 py-1 pr-1 relative"
      >
        {isFiltering && (
          <div className="px-2 py-1 flex items-center justify-between text-[11px] font-sans-ui text-[#7f756e] bg-[#f0eee9]/60 rounded-lg mb-1">
            <span className="truncate">
              {activeTag
                ? `Filtro: ${activeTag}`
                : searchMode !== 'all'
                ? `Busca em ${SEARCH_MODES.find((m) => m.id === searchMode)?.label || searchMode}${searchQuery ? `: "${searchQuery}"` : ''}`
                : `Buscando "${searchQuery}"`}
            </span>
            <button
              onClick={() => {
                setSearchQuery('');
                setActiveTag(null);
                setSearchMode('all');
              }}
              className="text-[#68594d] hover:underline shrink-0 ml-1 font-medium cursor-pointer"
            >
              Limpar
            </button>
          </div>
        )}

        {/* Pastas e Subpastas Normais */}
        {filteredFolders.map((folder) => renderFolderNode(folder))}

        {/* Notas Soltas na Raiz */}
        {filteredNotes.map((note) => renderNoteNode(note))}

        {/* Pasta Especial do Sistema: "Notas arquivadas" */}
        {filteredArchivedFolder && renderFolderNode(filteredArchivedFolder)}

        {!hasResults && (
          <div className="p-4 text-center text-xs text-[#7f756e] font-sans-ui">
            Nenhuma nota ou pasta encontrada.
          </div>
        )}
      </div>

      {/* Overlay da Caixa de Seleção Marquee (Bloco B) */}
      {isMarqueeActive && marqueeRect && (
        <div
          id="sidebar-marquee-selection-box"
          className="fixed pointer-events-none z-50 bg-[#68594d]/15 border border-[#68594d]/60 rounded-xs shadow-xs"
          style={{
            left: `${Math.min(marqueeRect.startX, marqueeRect.currentX)}px`,
            top: `${Math.min(marqueeRect.startY, marqueeRect.currentY)}px`,
            width: `${Math.abs(marqueeRect.currentX - marqueeRect.startX)}px`,
            height: `${Math.abs(marqueeRect.currentY - marqueeRect.startY)}px`,
          }}
        />
      )}

      {/* Tags Globais Extraídas Dinamicamente */}
      {uniqueTags.length > 0 && !searchQuery && (
        <div className="py-2 border-t border-[#eae8e3]">
          <div className="flex items-center justify-between px-1 mb-1.5 text-xs text-[#7f756e] font-sans-ui font-medium">
            <div className="flex items-center gap-1.5">
              <Tag className="w-3 h-3 text-[#68594d]" />
              <span>Etiquetas</span>
            </div>
            {hasTagsOverflow && (
              <button
                type="button"
                id="sidebar-tags-view-all-link"
                onClick={() => setIsTagsModalOpen(true)}
                className="text-[11px] text-[#68594d] hover:text-[#1b1c19] hover:underline font-medium cursor-pointer"
              >
                Ver todas ({uniqueTags.length})
              </button>
            )}
          </div>
          <div
            ref={tagsContainerRef}
            className={`flex flex-wrap gap-1 py-0.5 transition-all ${
              hasTagsOverflow ? 'max-h-[104px] overflow-hidden' : 'max-h-36 overflow-y-auto'
            }`}
          >
            {uniqueTags.map((tag) => {
              const isSelected = activeTag?.toLowerCase() === tag.toLowerCase();
              return (
                <button
                  key={tag}
                  id={`tag-pill-${tag.replace('#', '')}`}
                  onClick={() => setActiveTag(isSelected ? null : tag)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-sans-ui font-medium transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#68594d] text-white shadow-2xs'
                      : 'bg-[#eae8e3] text-[#4e453f] hover:bg-[#dcd9d2]'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>

          {hasTagsOverflow && (
            <button
              type="button"
              id="sidebar-show-all-tags-btn"
              onClick={() => setIsTagsModalOpen(true)}
              className="w-full mt-1.5 py-1 px-2 text-[11px] font-sans-ui font-medium text-[#68594d] hover:text-[#1b1c19] hover:bg-[#eae8e3]/70 rounded-lg flex items-center justify-center gap-1 transition-colors cursor-pointer border border-dashed border-[#d7c3b0]/70"
            >
              <span>Mostrar todas ({uniqueTags.length})</span>
            </button>
          )}
        </div>
      )}

      {/* Bottom Action Footer */}
      <div className="pt-2 border-t border-[#eae8e3] space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <SyncStatusIndicator
            userId={userId || undefined}
            onSelectNote={onSelectNote}
            onSelectFolder={onSelectFolder}
            folders={folders}
            notes={notes}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* Botão Nova Pasta (Sempre na raiz) */}
          <button
            id="sidebar-create-folder-btn"
            onClick={handleTriggerCreateFolder}
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-[#eae8e3] hover:bg-[#e0ded8] text-[#4e453f] hover:text-[#1b1c19] text-xs font-sans-ui font-medium rounded-xl transition-colors cursor-pointer"
          >
            <FolderPlus className="w-4 h-4 text-[#68594d]" />
            <span>Pasta</span>
          </button>

          {/* Botão Nova Nota (Sempre na raiz) */}
          <button
            id="sidebar-create-note-btn"
            onClick={handleTriggerCreateNote}
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-[#68594d] hover:bg-[#53463c] text-white text-xs font-sans-ui font-medium rounded-xl transition-colors cursor-pointer shadow-2xs"
          >
            <FilePlus className="w-4 h-4" />
            <span>Nota</span>
          </button>
        </div>

        {/* User Info & Settings & Logout */}
        <div className="flex items-center justify-between px-1 pt-1 text-xs text-[#7f756e]">
          <div className="flex items-center gap-1.5 truncate max-w-[150px]" title={userEmail || ''}>
            <User className="w-3.5 h-3.5 shrink-0 text-[#68594d]" />
            <span className="truncate font-sans-ui">{userEmail || 'Conta'}</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              id="sidebar-settings-btn"
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="min-w-[44px] min-h-[44px] p-2 flex items-center justify-center hover:bg-[#eae8e3] hover:text-[#1b1c19] text-[#4e453f] rounded-xl transition-colors cursor-pointer"
              title="Configurações"
              aria-label="Configurações"
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              id="sidebar-logout-btn"
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="min-w-[44px] min-h-[44px] p-2 flex items-center justify-center hover:bg-[#eae8e3] hover:text-[#ba1a1a] text-[#4e453f] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              title={isLoggingOut ? 'Salvando e saindo...' : 'Sair da Conta'}
              aria-label="Sair da Conta"
            >
              {isLoggingOut ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#68594d]" />
              ) : (
                <LogOut className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Menu Contextual Flutuante (...) */}
      {menuOpenId && menuPosition && (
        <div
          id="item-context-menu"
          style={{
            position: 'fixed',
            top: `${menuPosition.top}px`,
            left: `${menuPosition.left}px`,
          }}
          className="bg-white border border-[#e4e2dd] rounded-xl shadow-xl p-1.5 flex flex-col gap-0.5 z-50 min-w-[170px] font-sans-ui text-xs animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Opção 1: Renomear */}
          <button
            id="context-menu-rename-btn"
            onClick={() => {
              const currentName =
                menuItemType === 'folder'
                  ? folders.find((f) => f.id === menuOpenId)?.name || ''
                  : notes.find((n) => n.id === menuOpenId)?.title || '';
              startRenaming(menuOpenId, menuItemType!, currentName);
            }}
            className="w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] transition-colors cursor-pointer text-left"
            title="Renomear"
          >
            <Edit2 className="w-3.5 h-3.5 text-[#7f756e] shrink-0" />
            <span>Renomear</span>
          </button>

          {/* Opções para NOTAS: Arquivar / Desarquivar */}
          {menuItemType === 'note' && (
            <>
              {menuNoteIsArchived ? (
                <button
                  id="context-menu-unarchive-note-btn"
                  onClick={() => {
                    if (onUnarchiveNote && menuOpenId) {
                      onUnarchiveNote(menuOpenId);
                    }
                    setMenuOpenId(null);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] transition-colors cursor-pointer text-left"
                  title="Desarquivar nota"
                >
                  <ArchiveRestore className="w-3.5 h-3.5 text-[#68594d] shrink-0" />
                  <span>Desarquivar</span>
                </button>
              ) : (
                <button
                  id="context-menu-archive-note-btn"
                  onClick={() => {
                    if (onArchiveNote && menuOpenId) {
                      onArchiveNote(menuOpenId);
                    }
                    setMenuOpenId(null);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] transition-colors cursor-pointer text-left"
                  title="Arquivar nota"
                >
                  <Archive className="w-3.5 h-3.5 text-[#7f756e] shrink-0" />
                  <span>Arquivar</span>
                </button>
              )}
            </>
          )}

          {/* Opções exclusivas para PASTAS */}
          {menuItemType === 'folder' && (
            <>
              {/* Opção: Cor da pasta > (com Submenu Lateral) */}
              <div
                className="relative"
                onMouseEnter={handleMouseEnterColorOption}
                onMouseLeave={handleMouseLeaveColorOption}
              >
                <button
                  id="context-menu-folder-color-btn"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (colorSubmenuTimerRef.current) {
                      clearTimeout(colorSubmenuTimerRef.current);
                      colorSubmenuTimerRef.current = null;
                    }
                    setShowColorSubmenu((prev) => !prev);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] transition-colors cursor-pointer text-left"
                  title="Cor da pasta"
                >
                  <div className="flex items-center gap-2">
                    <Palette className="w-3.5 h-3.5 text-[#7f756e] shrink-0" />
                    <span>Cor da pasta</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-[#7f756e] shrink-0" />
                </button>

                {/* Submenu Lateral de Cores com Hover Bridge Contínua e Detecção de Borda */}
                {showColorSubmenu && (
                  <div
                    id="folder-color-lateral-submenu"
                    onMouseEnter={handleMouseEnterColorOption}
                    onMouseLeave={handleMouseLeaveColorOption}
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute top-0 z-60 min-w-[140px] bg-white border border-[#e4e2dd] rounded-xl shadow-xl p-1.5 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100 ${
                      menuPosition &&
                      menuPosition.left + 175 + 145 > (typeof window !== 'undefined' ? window.innerWidth : 1000)
                        ? 'right-full mr-1.5 before:absolute before:-right-3 before:top-0 before:bottom-0 before:w-4 before:content-[""]'
                        : 'left-full ml-1.5 before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-4 before:content-[""]'
                    }`}
                  >
                    {FOLDER_PRESET_COLORS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          if (onUpdateFolderColor && menuOpenId) {
                            onUpdateFolderColor(menuOpenId, c.color);
                          }
                          setMenuOpenId(null);
                          setShowColorSubmenu(false);
                          if (colorSubmenuTimerRef.current) {
                            clearTimeout(colorSubmenuTimerRef.current);
                            colorSubmenuTimerRef.current = null;
                          }
                        }}
                        className="w-full px-2 py-1 rounded-lg flex items-center gap-2 hover:bg-[#f0eee9] text-[#4e453f] text-xs transition-colors cursor-pointer text-left"
                      >
                        <span
                          className="w-3 h-3 rounded-full border border-black/10 shrink-0 block"
                          style={{ backgroundColor: c.hex }}
                        />
                        <span>{c.label}</span>
                      </button>
                    ))}

                    {/* Opção 🌈 Seletor de Cor Personalizado */}
                    <div className="pt-1 mt-0.5 border-t border-[#e4e2dd]">
                      <button
                        type="button"
                        id="folder-custom-color-btn"
                        onClick={() => {
                          if (customColorInputRef.current) {
                            customColorInputRef.current.click();
                          }
                        }}
                        className="w-full px-2 py-1 rounded-lg flex items-center gap-2 hover:bg-[#f0eee9] text-[#4e453f] text-xs transition-colors cursor-pointer text-left"
                      >
                        <span className="text-xs">🌈</span>
                        <span>Personalizada</span>
                      </button>
                      <input
                        ref={customColorInputRef}
                        type="color"
                        className="sr-only"
                        onChange={(e) => {
                          const hexColor = e.target.value;
                          if (onUpdateFolderColor && menuOpenId) {
                            onUpdateFolderColor(menuOpenId, hexColor);
                          }
                          setMenuOpenId(null);
                          setShowColorSubmenu(false);
                          if (colorSubmenuTimerRef.current) {
                            clearTimeout(colorSubmenuTimerRef.current);
                            colorSubmenuTimerRef.current = null;
                          }
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Opção: Pasta inteligente */}
              <button
                id="context-menu-smart-folder-btn"
                onClick={() => {
                  const targetFolder = folders.find((f) => f.id === menuOpenId);
                  setSmartConfigFolderId(menuOpenId);
                  setSmartConfigTags(targetFolder?.smart_tags || []);
                  setMenuOpenId(null);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] transition-colors cursor-pointer text-left"
                title="Configurar Pasta Inteligente"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#eab308] shrink-0 fill-[#eab308]" />
                <span>Pasta inteligente</span>
              </button>

              {/* Opção Arquivar Pasta / Arquivar todas as notas da pasta */}
              <button
                id="context-menu-archive-folder-btn"
                onClick={() => {
                  if (onArchiveFolderNotes && menuOpenId) {
                    onArchiveFolderNotes(menuOpenId);
                  }
                  setMenuOpenId(null);
                }}
                className="w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] transition-colors cursor-pointer text-left"
                title="Arquivar todas as notas desta pasta"
              >
                <Archive className="w-3.5 h-3.5 text-[#7f756e] shrink-0" />
                <span>Arquivar</span>
              </button>
            </>
          )}

          <div className="h-[1px] bg-[#e4e2dd] my-1" />

          {/* Opção: Excluir */}
          <button
            id="context-menu-delete-btn"
            onClick={() => {
              if (menuOpenId && menuItemType) {
                promptDelete(menuOpenId, menuItemType);
              }
            }}
            className="w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-[#ba1a1a] hover:bg-[#fceded] transition-colors cursor-pointer text-left"
            title="Excluir"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span>Excluir</span>
          </button>
        </div>
      )}

      {/* Popover Contextual de Configuração de Pasta Inteligente */}
      {smartConfigFolderId && (
        <div
          className="fixed inset-0 z-50 bg-black/30 backdrop-blur-2xs flex items-center justify-center p-4"
          onClick={() => setSmartConfigFolderId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#eae8e3]">
              <div className="flex items-center gap-2 text-[#1b1c19]">
                <Sparkles className="w-4 h-4 text-[#68594d]" />
                <h3 className="font-serif-note font-bold text-base">Pasta inteligente</h3>
              </div>
              <button
                type="button"
                onClick={() => setSmartConfigFolderId(null)}
                className="p-1 text-[#7f756e] hover:text-[#1b1c19] rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <p className="font-sans-ui text-xs text-[#4e453f] font-medium">
                Mostrar notas com as etiquetas:
              </p>

              {uniqueTags.length === 0 ? (
                <div className="p-3 bg-[#f0eee9] rounded-xl text-center text-xs text-[#7f756e] font-sans-ui leading-relaxed">
                  Nenhuma etiqueta (<span className="font-semibold text-[#1b1c19]">#hashtag</span>) encontrada nas suas notas ainda. Adicione tags como <span className="font-medium">#tributario</span> no texto de uma nota para selecioná-la aqui.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1 p-1 bg-white/70 rounded-xl border border-[#eae8e3]">
                  {uniqueTags.map((tag) => {
                    const isChecked = smartConfigTags.some(
                      (t) => t.toLowerCase() === tag.toLowerCase()
                    );
                    return (
                      <label
                        key={tag}
                        className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-[#f0eee9] cursor-pointer text-xs font-sans-ui text-[#1b1c19] transition-colors select-none"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSmartConfigTags((prev) => [...prev, tag]);
                            } else {
                              setSmartConfigTags((prev) =>
                                prev.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                              );
                            }
                          }}
                          className="w-4 h-4 rounded border-[#68594d] text-[#68594d] focus:ring-[#68594d] accent-[#68594d] cursor-pointer"
                        />
                        <span className="font-medium text-[#3b332d]">{tag}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[#eae8e3]">
              {smartConfigTags.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (onUpdateFolderSmartConfig && smartConfigFolderId) {
                      onUpdateFolderSmartConfig(smartConfigFolderId, false, []);
                    }
                    setSmartConfigFolderId(null);
                  }}
                  className="px-3 py-1.5 text-xs text-[#ba1a1a] hover:bg-[#fceded] rounded-xl transition-colors cursor-pointer font-sans-ui font-medium"
                >
                  Desativar
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSmartConfigFolderId(null)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-sans-ui font-medium text-[#4e453f] hover:bg-[#e4e2dd] transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  id="apply-smart-folder-btn"
                  onClick={() => {
                    if (onUpdateFolderSmartConfig && smartConfigFolderId) {
                      const isSmart = smartConfigTags.length > 0;
                      onUpdateFolderSmartConfig(smartConfigFolderId, isSmart, smartConfigTags);
                    }
                    setSmartConfigFolderId(null);
                  }}
                  className="px-4 py-1.5 rounded-xl text-xs font-sans-ui font-medium bg-[#68594d] text-white hover:bg-[#53463c] transition-colors cursor-pointer shadow-xs"
                >
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo Modal de Confirmação de Exclusão */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4 animate-in fade-in zoom-in-95"
          >
            <div className="flex items-center gap-3 text-[#ba1a1a]">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="font-serif-note font-bold text-lg text-[#1b1c19]">
                Confirmar Exclusão
              </h3>
            </div>

            <p className="font-sans-ui text-sm text-[#4e453f] leading-relaxed">
              Deseja realmente excluir <strong>&quot;{confirmDelete.name}&quot;</strong>?
              {confirmDelete.hasChildren && (
                <span className="block mt-2 text-xs text-[#ba1a1a] font-medium">
                  Atenção: Esta pasta contém subpastas ou notas. A exclusão removerá todo o seu conteúdo.
                </span>
              )}
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium text-[#4e453f] hover:bg-[#e4e2dd] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                id="confirm-delete-action-btn"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium bg-[#ba1a1a] text-white hover:bg-[#961515] transition-colors cursor-pointer shadow-xs"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal de Confirmação de Exclusão em Lote (Bloco B) */}
      {showBatchDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4 animate-in fade-in zoom-in-95"
          >
            <div className="flex items-center gap-3 text-[#ba1a1a]">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="font-serif-note font-bold text-lg text-[#1b1c19]">
                Excluir {selectedItems.size} {selectedItems.size > 1 ? 'itens' : 'item'}?
              </h3>
            </div>

            <p className="font-sans-ui text-sm text-[#4e453f] leading-relaxed">
              Deseja realmente excluir os <strong>{selectedItems.size}</strong> itens selecionados?
              <span className="block mt-2 text-xs text-[#ba1a1a] font-medium">
                Esta ação removerá todas as notas e pastas selecionadas.
              </span>
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowBatchDeleteConfirm(false)}
                className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium text-[#4e453f] hover:bg-[#e4e2dd] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                id="batch-confirm-delete-action-btn"
                onClick={handleBatchConfirmDelete}
                className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium bg-[#ba1a1a] text-white hover:bg-[#961515] transition-colors cursor-pointer shadow-xs"
              >
                Excluir Selecionados
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Seleção de Pasta de Destino para Mover em Lote (Bloco B) */}
      {showBatchMoveDialog && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl p-5 max-w-sm w-full shadow-xl space-y-4 animate-in fade-in zoom-in-95 font-sans-ui"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#68594d]">
                <FolderInput className="w-5 h-5" />
                <h3 className="font-serif-note font-bold text-base text-[#1b1c19]">
                  Mover {selectedItems.size} {selectedItems.size > 1 ? 'itens' : 'item'}
                </h3>
              </div>
              <button
                onClick={() => setShowBatchMoveDialog(false)}
                className="p-1 hover:bg-[#eae8e3] text-[#7f756e] rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#7f756e]">
              Selecione o local de destino para os itens selecionados:
            </p>

            <div className="max-h-60 overflow-y-auto space-y-1 py-1 border border-[#eae8e3] bg-white rounded-xl p-1.5">
              {/* Opção Raiz */}
              <button
                type="button"
                onClick={() => setBatchMoveFolderId(null)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer text-left ${
                  batchMoveFolderId === null
                    ? 'bg-[#f4dfcb] font-semibold text-[#1b1c19]'
                    : 'hover:bg-[#f0eee9] text-[#4e453f]'
                }`}
              >
                <Layers className="w-4 h-4 text-[#68594d] shrink-0" />
                <span>Raiz da Sidebar (Sem pasta)</span>
              </button>

              {/* Pastas Disponíveis */}
              {folders
                .filter((f) => !selectedItems.has(f.id) && f.id !== SYSTEM_ARCHIVE_FOLDER_ID)
                .map((folder) => {
                  const isSelected = batchMoveFolderId === folder.id;
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => setBatchMoveFolderId(folder.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer text-left ${
                        isSelected
                          ? 'bg-[#f4dfcb] font-semibold text-[#1b1c19]'
                          : 'hover:bg-[#f0eee9] text-[#4e453f]'
                      }`}
                    >
                      <Folder className="w-4 h-4 text-[#68594d] shrink-0" />
                      <span className="truncate">{folder.name}</span>
                    </button>
                  );
                })}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowBatchMoveDialog(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-[#4e453f] hover:bg-[#e4e2dd] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                id="batch-confirm-move-btn"
                onClick={() => handleBatchMoveSubmit(batchMoveFolderId)}
                className="px-4 py-1.5 rounded-xl text-xs font-medium bg-[#68594d] text-white hover:bg-[#53463c] transition-colors cursor-pointer shadow-xs"
              >
                Mover para Cá
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Configurações da Aplicação */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        userId={userId}
        notes={notes}
        userEmail={userEmail || ''}
      />

      {/* Modal de Todas as Etiquetas */}
      <TagsModal
        isOpen={isTagsModalOpen}
        onClose={() => setIsTagsModalOpen(false)}
        tags={uniqueTags}
        activeTag={activeTag}
        onSelectTag={(tag) => setActiveTag(activeTag === tag ? null : tag)}
      />
    </aside>
  );
}
