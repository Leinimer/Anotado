'use client';

import { useState } from 'react';
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
} from 'lucide-react';

interface SidebarNavigationProps {
  activeNoteId?: string;
  onSelectNote?: (noteId: string) => void;
  onCloseMobile?: () => void;
}

export function SidebarNavigation({
  activeNoteId = 'texto-2',
  onSelectNote,
  onCloseMobile,
}: SidebarNavigationProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [pasta2Open, setPasta2Open] = useState(true);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const tags = ['#Nota', '#Estudo', '#Livro'];

  const handleNoteClick = (id: string) => {
    if (onSelectNote) onSelectNote(id);
    if (onCloseMobile) onCloseMobile();
  };

  return (
    <aside
      id="sidebar-navigation"
      aria-label="Navegação de Pastas e Notas"
      className="w-full md:w-[280px] shrink-0 bg-[#f0eee9] border-r border-[#e4e2dd] flex flex-col h-full overflow-y-auto select-none"
    >
      {/* Search Header */}
      <div className="p-4 sm:p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between md:hidden">
          <span className="font-serif-note font-semibold text-lg text-[#1b1c19]">
            Anotado!
          </span>
          {onCloseMobile && (
            <button
              id="sidebar-close-mobile-btn"
              onClick={onCloseMobile}
              className="p-1 text-[#7f756e] hover:text-[#1b1c19] rounded"
              aria-label="Fechar menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="relative w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7f756e]" />
          <input
            id="sidebar-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="BUSCAR"
            className="w-full pl-10 pr-4 py-2 bg-transparent border border-[#7f756e]/30 rounded-full text-xs font-sans-ui uppercase tracking-wider text-[#1b1c19] placeholder-[#7f756e] focus:outline-none focus:border-[#68594d] focus:ring-1 focus:ring-[#68594d] transition-all"
          />
        </div>
      </div>

      {/* Folders & Notes Hierarchy */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {/* Pasta 1 */}
        <div
          id="folder-pasta-1"
          className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#4e453f] hover:bg-[#e4e2dd]/60 rounded-lg cursor-pointer transition-colors"
        >
          <Folder className="w-4 h-4 text-[#7f756e] shrink-0 stroke-[1.5]" />
          <span className="font-sans-ui font-medium truncate">Pasta 1</span>
        </div>

        {/* Pasta 2 (Open with children) */}
        <div className="space-y-1">
          <div
            id="folder-pasta-2"
            onClick={() => setPasta2Open(!pasta2Open)}
            className="flex items-center justify-between px-3 py-2 text-sm text-[#1b1c19] bg-[#f4dfcb]/70 hover:bg-[#f4dfcb] rounded-lg cursor-pointer transition-colors border-l-4 border-[#68594d]"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <FolderOpen className="w-4 h-4 text-[#68594d] shrink-0 stroke-[1.75]" />
              <span className="font-sans-ui font-medium truncate">Pasta 2</span>
            </div>
            {pasta2Open ? (
              <ChevronDown className="w-4 h-4 text-[#7f756e] shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-[#7f756e] shrink-0" />
            )}
          </div>

          {pasta2Open && (
            <div className="pl-6 space-y-1">
              {/* Pasta 3 (Nested Folder) */}
              <div
                id="folder-pasta-3"
                className="flex items-center gap-2 px-3 py-1.5 text-xs sm:text-sm text-[#4e453f] hover:bg-[#e4e2dd]/60 rounded-md cursor-pointer transition-colors"
              >
                <Folder className="w-3.5 h-3.5 text-[#7f756e] shrink-0 stroke-[1.5]" />
                <span className="font-sans-ui truncate">Pasta 3</span>
              </div>

              {/* texto 1 (Nested Note) */}
              <div
                id="note-item-texto-1"
                onClick={() => handleNoteClick('texto-1')}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs sm:text-sm rounded-md cursor-pointer transition-colors ${
                  activeNoteId === 'texto-1'
                    ? 'bg-[#e4e2dd] text-[#1b1c19] font-medium'
                    : 'text-[#4e453f] hover:bg-[#e4e2dd]/60'
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-[#7f756e] shrink-0 stroke-[1.5]" />
                <span className="font-sans-ui truncate">texto 1</span>
              </div>

              {/* texto II (Active Note mapped from Image 3) */}
              <div
                id="note-item-texto-2"
                onClick={() => handleNoteClick('texto-2')}
                className={`flex items-center gap-2 px-3 py-2 text-xs sm:text-sm rounded-md cursor-pointer transition-all shadow-xs ${
                  activeNoteId === 'texto-2'
                    ? 'bg-[#e4e2dd] text-[#1b1c19] font-semibold'
                    : 'text-[#4e453f] hover:bg-[#e4e2dd]/60'
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-[#68594d] shrink-0 stroke-[2]" />
                <span className="font-sans-ui truncate">texto II</span>
              </div>
            </div>
          )}
        </div>

        {/* Pasta 4 */}
        <div
          id="folder-pasta-4"
          className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#4e453f] hover:bg-[#e4e2dd]/60 rounded-lg cursor-pointer transition-colors"
        >
          <Folder className="w-4 h-4 text-[#7f756e] shrink-0 stroke-[1.5]" />
          <span className="font-sans-ui font-medium truncate">Pasta 4</span>
        </div>
      </nav>

      {/* Actions & Tags Section */}
      <div className="p-4 border-t border-[#d1c4bc]/60 space-y-4">
        {/* Actions */}
        <div className="space-y-1">
          <button
            id="sidebar-new-folder-btn"
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#4e453f] hover:text-[#1b1c19] hover:bg-[#e4e2dd]/50 rounded-lg transition-colors cursor-pointer"
          >
            <FolderPlus className="w-4 h-4 text-[#7f756e] stroke-[1.5]" />
            <span className="font-sans-ui font-medium">Nova Pasta</span>
          </button>
          <button
            id="sidebar-new-note-btn"
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#4e453f] hover:text-[#1b1c19] hover:bg-[#e4e2dd]/50 rounded-lg transition-colors cursor-pointer"
          >
            <FilePlus className="w-4 h-4 text-[#7f756e] stroke-[1.5]" />
            <span className="font-sans-ui font-medium">Nova Nota</span>
          </button>
        </div>

        {/* Etiquetas / Tags */}
        <div className="space-y-2 pt-2">
          <div className="flex items-center gap-1.5 px-3">
            <Tag className="w-3.5 h-3.5 text-[#7f756e]" />
            <h3 className="font-sans-ui text-sm font-semibold text-[#4e453f]">
              Etiquetas
            </h3>
          </div>
          <div className="flex flex-wrap gap-2 px-3">
            {tags.map((tag) => (
              <button
                key={tag}
                id={`tag-badge-${tag.replace('#', '')}`}
                onClick={() =>
                  setActiveTag(activeTag === tag ? null : tag)
                }
                className={`px-3 py-1 rounded-full text-xs font-sans-ui font-medium transition-all cursor-pointer ${
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
      </div>
    </aside>
  );
}
