'use client';

import React from 'react';
import {
  Edit2,
  Trash2,
  Sparkles,
  Palette,
  Archive,
  ArchiveRestore,
  ChevronRight,
} from 'lucide-react';
import { Folder as FolderType, Note as NoteType } from '../types';
import { FOLDER_PRESET_COLORS } from './sidebar-constants';

interface SidebarContextMenuProps {
  menuOpenId: string | null;
  menuPosition: { top: number; left: number } | null;
  menuItemType: 'folder' | 'note' | null;
  menuNoteIsArchived: boolean;
  folders: FolderType[];
  notes: NoteType[];
  showColorSubmenu: boolean;
  onClose: () => void;
  onStartRenaming: (id: string, type: 'folder' | 'note', name: string) => void;
  onArchiveNote?: (id: string) => void;
  onUnarchiveNote?: (id: string) => void;
  onArchiveFolderNotes?: (folderId: string) => void;
  onUpdateFolderColor?: (folderId: string, color: string | null) => void;
  onOpenSmartConfig: (folderId: string, smartTags: string[]) => void;
  onPromptDelete: (id: string, type: 'folder' | 'note') => void;
  onMouseEnterColorOption: () => void;
  onMouseLeaveColorOption: () => void;
  onToggleColorSubmenu: () => void;
  colorSubmenuTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  customColorInputRef: React.RefObject<HTMLInputElement | null>;
}

export function SidebarContextMenu({
  menuOpenId,
  menuPosition,
  menuItemType,
  menuNoteIsArchived,
  folders,
  notes,
  showColorSubmenu,
  onClose,
  onStartRenaming,
  onArchiveNote,
  onUnarchiveNote,
  onArchiveFolderNotes,
  onUpdateFolderColor,
  onOpenSmartConfig,
  onPromptDelete,
  onMouseEnterColorOption,
  onMouseLeaveColorOption,
  onToggleColorSubmenu,
  colorSubmenuTimerRef,
  customColorInputRef,
}: SidebarContextMenuProps) {
  if (!menuOpenId || !menuPosition) return null;

  return (
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
          onStartRenaming(menuOpenId, menuItemType!, currentName);
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
                onClose();
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
                onClose();
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
            onMouseEnter={onMouseEnterColorOption}
            onMouseLeave={onMouseLeaveColorOption}
          >
            <button
              id="context-menu-folder-color-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleColorSubmenu();
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
                onMouseEnter={onMouseEnterColorOption}
                onMouseLeave={onMouseLeaveColorOption}
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
                      onClose();
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
                      onClose();
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
              onOpenSmartConfig(menuOpenId, targetFolder?.smart_tags || []);
              onClose();
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
              onClose();
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
            onPromptDelete(menuOpenId, menuItemType);
          }
        }}
        className="w-full px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-[#ba1a1a] hover:bg-[#fceded] transition-colors cursor-pointer text-left"
        title="Excluir"
      >
        <Trash2 className="w-3.5 h-3.5 shrink-0" />
        <span>Excluir</span>
      </button>
    </div>
  );
}
