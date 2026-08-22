'use client';

import React, { useState, useRef, useEffect } from 'react';
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
  User,
  MoreHorizontal,
  Edit2,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { createClient } from '@/src/features/auth/api/supabase-client';
import { Folder as FolderType, Note as NoteType, TreeFolderNode, TreeNodeItem } from '../types';
import { extractAllUniqueTags } from '../utils/hashtag-extractor';
import { buildFolderTree, filterTree, wouldCreateCycle } from '../utils/tree-builder';

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
  onMoveItem,
  onCloseMobile,
}: SidebarNavigationProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [openFolderIds, setOpenFolderIds] = useState<Set<string>>(new Set(['pasta-2']));

  // Estado para menu horizontal de opções (...)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [menuItemType, setMenuItemType] = useState<'folder' | 'note' | null>(null);

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

  // Drag & Drop State
  const [draggingItem, setDraggingItem] = useState<{
    type: 'folder' | 'note';
    id: string;
  } | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.email) {
        setUserEmail(data.user.email);
      }
    });
  }, []);

  // Foco no input de edição ao iniciar renomeação
  useEffect(() => {
    if (editingItemId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingItemId]);

  // Fecha menu de contexto ao clicar fora
  useEffect(() => {
    const handleClickOutside = () => {
      setMenuOpenId(null);
      setMenuPosition(null);
    };
    if (menuOpenId) {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [menuOpenId]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    if (typeof window !== 'undefined') {
      window.location.replace('/login');
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

  // Inicia edição de nome
  const startRenaming = (id: string, type: 'folder' | 'note', initialName: string) => {
    setEditingItemId(id);
    setEditingItemType(type);
    setEditingValue(initialName);
    setMenuOpenId(null);
  };

  const handleSaveRename = () => {
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

  // Abre menu horizontal de opções ...
  const handleOpenMenu = (
    e: React.MouseEvent,
    id: string,
    type: 'folder' | 'note'
  ) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 4,
      left: Math.max(12, Math.min(rect.left - 60, window.innerWidth - 180)),
    });
    setMenuOpenId(id);
    setMenuItemType(type);
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

  // Drag & Drop Handlers
  const handleDragStart = (e: React.DragEvent, type: 'folder' | 'note', id: string) => {
    e.stopPropagation();
    setDraggingItem({ type, id });
    e.dataTransfer.setData('text/plain', JSON.stringify({ type, id }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverFolder = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingItem) return;

    // Proteção contra ciclos para pastas
    if (draggingItem.type === 'folder') {
      if (wouldCreateCycle(draggingItem.id, folderId, folders)) {
        return;
      }
    }

    setDragOverFolderId(folderId);
  };

  const handleDragLeaveFolder = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);
  };

  const handleDropOnFolder = (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);

    if (!draggingItem) return;

    if (draggingItem.type === 'folder') {
      if (wouldCreateCycle(draggingItem.id, targetFolderId, folders)) {
        setDraggingItem(null);
        return;
      }
      onMoveItem('folder', draggingItem.id, targetFolderId, 0);
    } else {
      onMoveItem('note', draggingItem.id, targetFolderId, 0);
    }

    setDraggingItem(null);
  };

  // Constrói e filtra a árvore
  const { folders: rawTreeFolders, rootNotes: rawRootNotes } = buildFolderTree(folders, notes);
  const isFiltering = searchQuery.trim().length > 0 || activeTag !== null;
  const { filteredFolders, filteredNotes, hasResults } = filterTree(
    rawTreeFolders,
    rawRootNotes,
    searchQuery,
    activeTag
  );

  // Extrai tags dinâmicas de todas as notas
  const uniqueTags = extractAllUniqueTags(notes);

  // Renderização Recursiva de Pasta (SEM seleção visual de fundo)
  const renderFolderNode = (folder: TreeFolderNode) => {
    const isOpen = isFiltering || openFolderIds.has(folder.id);
    const isEditing = editingItemId === folder.id && editingItemType === 'folder';
    const isDragOver = dragOverFolderId === folder.id;

    return (
      <div key={folder.id} className="space-y-0.5 select-none">
        <div
          id={`folder-item-${folder.id}`}
          draggable={!isEditing}
          onDragStart={(e) => handleDragStart(e, 'folder', folder.id)}
          onDragOver={(e) => handleDragOverFolder(e, folder.id)}
          onDragLeave={handleDragLeaveFolder}
          onDrop={(e) => handleDropOnFolder(e, folder.id)}
          onClick={(e) => toggleFolder(folder.id, e)}
          style={{ paddingLeft: `${folder.depth * 16 + 12}px` }}
          className={`group flex items-center justify-between pr-2 py-1.5 text-sm rounded-lg cursor-pointer transition-colors relative ${
            isDragOver
              ? 'bg-[#d7c3b0]/70 border-2 border-dashed border-[#68594d]'
              : 'text-[#4e453f] hover:bg-[#e4e2dd]/70'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isOpen ? (
              <FolderOpen className="w-4 h-4 text-[#68594d] shrink-0 stroke-[1.75]" />
            ) : (
              <Folder className="w-4 h-4 text-[#7f756e] shrink-0 stroke-[1.5]" />
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
                  if (e.key === 'Escape') setEditingItemId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-white px-1.5 py-0.5 text-xs font-sans-ui rounded border border-[#68594d] focus:outline-none"
              />
            ) : (
              <span className="font-sans-ui font-medium truncate text-xs sm:text-sm text-[#3b332d]">
                {folder.name}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Menu Horizontal ... */}
            <button
              id={`folder-menu-btn-${folder.id}`}
              onClick={(e) => handleOpenMenu(e, folder.id, 'folder')}
              className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1 hover:bg-[#d1c4bc]/50 text-[#7f756e] hover:text-[#1b1c19] rounded transition-opacity"
              title="Opções da Pasta"
              aria-label="Opções da Pasta"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {/* Seta indicador */}
            {isOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#7f756e]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#7f756e]" />
            )}
          </div>
        </div>

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

  // Renderização de Item de Nota (Mantém seleção visual ativa na nota selecionada)
  const renderNoteNode = (note: TreeNodeItem) => {
    const isActive = activeNoteId === note.id;
    const isEditing = editingItemId === note.id && editingItemType === 'note';

    return (
      <div
        key={note.id}
        id={`note-item-${note.id}`}
        draggable={!isEditing}
        onDragStart={(e) => handleDragStart(e, 'note', note.id)}
        onClick={() => {
          onSelectNote(note.id);
          if (onCloseMobile) onCloseMobile();
        }}
        style={{ paddingLeft: `${note.depth * 16 + 12}px` }}
        className={`group flex items-center justify-between pr-2 py-1.5 text-sm rounded-lg cursor-pointer transition-colors relative ${
          isActive
            ? 'bg-[#f4dfcb] text-[#1b1c19] font-medium shadow-2xs'
            : 'text-[#4e453f] hover:bg-[#e4e2dd]/60'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText
            className={`w-4 h-4 shrink-0 ${
              isActive ? 'text-[#68594d] stroke-[2]' : 'text-[#7f756e] stroke-[1.5]'
            }`}
          />

          {isEditing ? (
            <input
              ref={editInputRef}
              type="text"
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={handleSaveRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRename();
                if (e.key === 'Escape') setEditingItemId(null);
              }}
              onClick={(e) => e.stopPropagation()}
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
          onClick={(e) => handleOpenMenu(e, note.id, 'note')}
          className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1 hover:bg-[#d1c4bc]/50 text-[#7f756e] hover:text-[#1b1c19] rounded transition-opacity"
          title="Opções da Nota"
          aria-label="Opções da Nota"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    );
  };

  return (
    <aside
      id="sidebar-navigation-container"
      className="w-full md:w-64 lg:w-72 h-full bg-[#fbf9f4] border-r border-[#eae8e3] flex flex-col justify-between p-3 sm:p-4 select-none shrink-0"
    >
      {/* Top Header: Brand & Close Button (Mobile) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#68594d] text-white flex items-center justify-center font-serif-note font-bold text-sm shadow-xs">
              A
            </div>
            <span className="font-serif-note font-bold text-base text-[#1b1c19] tracking-tight">
              Anotado!
            </span>
          </div>

          {onCloseMobile && (
            <button
              id="sidebar-close-mobile-btn"
              onClick={onCloseMobile}
              className="p-1.5 text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-lg md:hidden"
              aria-label="Fechar Menu Lateral"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-[#7f756e] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id="sidebar-search-input"
            type="text"
            placeholder="Buscar notas ou tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#f0eee9] text-xs font-sans-ui text-[#1b1c19] placeholder-[#7f756e] rounded-xl pl-9 pr-8 py-2 border border-transparent focus:border-[#68594d] focus:bg-white focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7f756e] hover:text-[#1b1c19]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Árvore de Pastas e Notas */}
      <div
        id="sidebar-folder-tree-area"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => handleDropOnFolder(e, null)}
        className="flex-1 overflow-y-auto my-3 space-y-1 py-1 pr-1"
      >
        {isFiltering && (
          <div className="px-2 py-1 flex items-center justify-between text-[11px] font-sans-ui text-[#7f756e]">
            <span>
              {activeTag ? `Filtro: ${activeTag}` : `Buscando "${searchQuery}"`}
            </span>
            <button
              onClick={() => {
                setSearchQuery('');
                setActiveTag(null);
              }}
              className="text-[#68594d] font-medium hover:underline"
            >
              Limpar
            </button>
          </div>
        )}

        {!hasResults ? (
          <div className="text-center py-8 text-xs font-sans-ui text-[#7f756e]">
            Nenhum item encontrado
          </div>
        ) : (
          <>
            {filteredFolders.map((folder) => renderFolderNode(folder))}
            {filteredNotes.map((note) => renderNoteNode(note))}
          </>
        )}
      </div>

      {/* Bottom Section: Ações de Criação, Tags e Usuário */}
      <div className="space-y-3 pt-2 border-t border-[#eae8e3]">
        {/* Botões de Ação de Criação */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            id="sidebar-new-folder-btn"
            onClick={handleTriggerCreateFolder}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs text-[#4e453f] hover:text-[#1b1c19] hover:bg-[#e4e2dd]/70 rounded-xl transition-colors cursor-pointer border border-[#e4e2dd]/60 font-sans-ui font-medium"
            title="Nova Pasta (cria dentro da pasta atual)"
          >
            <FolderPlus className="w-3.5 h-3.5 text-[#68594d] stroke-[1.75]" />
            <span>Nova Pasta</span>
          </button>
          <button
            id="sidebar-new-note-btn"
            onClick={handleTriggerCreateNote}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs text-[#4e453f] hover:text-[#1b1c19] hover:bg-[#e4e2dd]/70 rounded-xl transition-colors cursor-pointer border border-[#e4e2dd]/60 font-sans-ui font-medium"
            title="Nova Nota (cria dentro da pasta atual)"
          >
            <FilePlus className="w-3.5 h-3.5 text-[#68594d] stroke-[1.75]" />
            <span>Nova Nota</span>
          </button>
        </div>

        {/* Seção Dinâmica de Etiquetas */}
        {uniqueTags.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <Tag className="w-3 h-3 text-[#7f756e]" />
                <h3 className="font-sans-ui text-xs font-semibold text-[#4e453f]">
                  Etiquetas
                </h3>
              </div>
              {activeTag && (
                <button
                  onClick={() => setActiveTag(null)}
                  className="text-[10px] font-sans-ui text-[#7f756e] hover:text-[#1b1c19] underline cursor-pointer"
                >
                  Limpar
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto px-1">
              {uniqueTags.map((tag) => (
                <button
                  key={tag}
                  id={`tag-badge-${tag.replace('#', '')}`}
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-sans-ui font-medium transition-all cursor-pointer ${
                    activeTag === tag
                      ? 'bg-[#68594d] text-white'
                      : 'bg-[#eae8e3] text-[#4e453f] hover:bg-[#d7c3b0]'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* User Session & Logout */}
        <div className="pt-2 border-t border-[#d1c4bc]/40 flex items-center justify-between px-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-full bg-[#e4e2dd] text-[#68594d] flex items-center justify-center shrink-0">
              <User className="w-3.5 h-3.5" />
            </div>
            <span
              className="font-sans-ui text-xs text-[#4e453f] truncate max-w-[120px]"
              title={userEmail || 'Usuário'}
            >
              {userEmail || 'Anotado!'}
            </span>
          </div>

          <button
            id="sidebar-logout-btn"
            onClick={handleLogout}
            className="p-1.5 text-[#7f756e] hover:text-[#ba1a1a] hover:bg-[#e4e2dd]/60 rounded-lg transition-colors cursor-pointer"
            title="Encerrar Sessão (Sair)"
            aria-label="Encerrar Sessão"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Menu Horizontal Flutuante de Opções (...) */}
      {menuOpenId && menuPosition && menuItemType && (
        <div
          id="context-action-menu"
          style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 bg-white border border-[#e4e2dd] rounded-xl shadow-lg p-1 flex items-center gap-1 text-xs font-sans-ui animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            id="context-menu-rename-btn"
            onClick={() => {
              const currentName =
                menuItemType === 'folder'
                  ? folders.find((f) => f.id === menuOpenId)?.name || ''
                  : notes.find((n) => n.id === menuOpenId)?.title || '';
              startRenaming(menuOpenId, menuItemType, currentName);
            }}
            className="px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 text-[#4e453f] hover:bg-[#f0eee9] hover:text-[#1b1c19] transition-colors cursor-pointer"
            title="Renomear"
          >
            <Edit2 className="w-3.5 h-3.5 text-[#7f756e]" />
            <span>Renomear</span>
          </button>
          <div className="h-4 w-[1px] bg-[#e4e2dd]" />
          <button
            id="context-menu-delete-btn"
            onClick={() => promptDelete(menuOpenId, menuItemType)}
            className="px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 text-[#ba1a1a] hover:bg-[#fceded] transition-colors cursor-pointer"
            title="Excluir"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Excluir</span>
          </button>
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
    </aside>
  );
}
