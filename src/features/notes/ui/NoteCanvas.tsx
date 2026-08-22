'use client';

import { useState } from 'react';
import {
  Trash2,
  SquarePen,
  Play,
  CheckCircle2,
  Circle,
  Menu,
} from 'lucide-react';

interface NoteCanvasProps {
  noteTitle?: string;
  onDeleteNote?: () => void;
  onOpenMobileMenu?: () => void;
}

export function NoteCanvas({
  noteTitle = 'Texto II',
  onDeleteNote,
  onOpenMobileMenu,
}: NoteCanvasProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [currentTitle, setCurrentTitle] = useState(noteTitle);
  const [checkedItems, setCheckedItems] = useState<{ [key: number]: boolean }>({
    1: false,
    2: false,
  });

  const toggleCheck = (index: number) => {
    setCheckedItems((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  return (
    <main
      id="main-note-workspace"
      className="flex-1 flex flex-col h-full overflow-y-auto bg-[#fbf9f4]"
    >
      {/* Top Header Bar */}
      <header
        id="note-header-bar"
        className="w-full px-4 sm:px-8 py-4 sm:py-5 flex items-center justify-between border-b border-[#eae8e3]/80 shrink-0 select-none"
      >
        <div className="flex items-center gap-3">
          {onOpenMobileMenu && (
            <button
              id="header-mobile-menu-btn"
              onClick={onOpenMobileMenu}
              className="p-2 text-[#4e453f] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-lg md:hidden transition-colors cursor-pointer"
              aria-label="Abrir Menu Lateral"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <button
            id="header-trash-btn"
            onClick={onDeleteNote}
            className="p-2 text-[#7f756e] hover:text-[#ba1a1a] hover:bg-[#eae8e3] rounded-lg transition-colors cursor-pointer"
            title="Excluir Nota"
            aria-label="Excluir Nota"
          >
            <Trash2 className="w-5 h-5 stroke-[1.75]" />
          </button>
        </div>

        {/* Note Title */}
        <div className="flex-1 text-center px-2">
          {isEditingTitle ? (
            <input
              id="header-title-input"
              type="text"
              value={currentTitle}
              autoFocus
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setIsEditingTitle(false);
              }}
              onChange={(e) => setCurrentTitle(e.target.value)}
              className="font-serif-note font-bold text-2xl sm:text-3xl md:text-4xl text-[#1b1c19] bg-transparent text-center border-b border-[#68594d] focus:outline-none"
            />
          ) : (
            <h1
              id="header-note-title"
              onClick={() => setIsEditingTitle(true)}
              className="font-serif-note font-bold text-2xl sm:text-3xl md:text-4xl text-[#1b1c19] cursor-pointer hover:opacity-80 transition-opacity tracking-tight inline-block"
            >
              {currentTitle}
            </h1>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            id="header-edit-title-btn"
            onClick={() => setIsEditingTitle(!isEditingTitle)}
            className="p-2 text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-lg transition-colors cursor-pointer"
            title="Editar Título"
            aria-label="Editar Título"
          >
            <SquarePen className="w-5 h-5 stroke-[1.75]" />
          </button>
        </div>
      </header>

      {/* Note Canvas Sheet */}
      <div
        id="note-scroll-container"
        className="flex-1 overflow-y-auto px-3 sm:px-6 md:px-12 py-6 sm:py-10 flex justify-center"
      >
        <article
          id="note-paper-sheet"
          className="paper-sheet rounded-2xl w-full max-w-[800px] p-6 sm:p-10 md:p-14 text-[#1b1c19] font-serif-note space-y-6 sm:space-y-8 break-words overflow-hidden"
        >
          {/* Paragraph 1 */}
          <p className="text-base sm:text-lg leading-relaxed text-[#1b1c19]">
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
            eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad
            minim veniam, quis nostrud exercitation ullamco laboris nisi ut
            aliquip ex ea commodo consequat.
          </p>

          {/* Paragraph 2 */}
          <p className="text-base sm:text-lg leading-relaxed text-[#1b1c19]">
            Duis aute irure dolor in reprehenderit in voluptate velit esse cillum
            dolore eu fugiat nulla pariatur.
          </p>

          {/* Interactive Checkbox Items */}
          <div className="space-y-3 pl-1 sm:pl-2">
            <div
              id="todo-item-1"
              onClick={() => toggleCheck(1)}
              className="flex items-start gap-3 cursor-pointer group select-none"
            >
              <button
                type="button"
                className="mt-1 text-[#7f756e] group-hover:text-[#68594d] transition-colors"
                aria-label="Marcar tarefa 1"
              >
                {checkedItems[1] ? (
                  <CheckCircle2 className="w-4 h-4 text-[#68594d] fill-[#f4dfcb]" />
                ) : (
                  <Circle className="w-4 h-4 stroke-[1.5]" />
                )}
              </button>
              <span
                className={`text-base sm:text-lg leading-relaxed transition-all ${
                  checkedItems[1] ? 'line-through text-[#7f756e]' : 'text-[#1b1c19]'
                }`}
              >
                First item to consider in this thought process.
              </span>
            </div>

            <div
              id="todo-item-2"
              onClick={() => toggleCheck(2)}
              className="flex items-start gap-3 cursor-pointer group select-none"
            >
              <button
                type="button"
                className="mt-1 text-[#7f756e] group-hover:text-[#68594d] transition-colors"
                aria-label="Marcar tarefa 2"
              >
                {checkedItems[2] ? (
                  <CheckCircle2 className="w-4 h-4 text-[#68594d] fill-[#f4dfcb]" />
                ) : (
                  <Circle className="w-4 h-4 stroke-[1.5]" />
                )}
              </button>
              <span
                className={`text-base sm:text-lg leading-relaxed transition-all ${
                  checkedItems[2] ? 'line-through text-[#7f756e]' : 'text-[#1b1c19]'
                }`}
              >
                Second item, building upon the previous idea.
              </span>
            </div>
          </div>

          {/* Numbered Hierarchical List */}
          <div className="space-y-3 text-base sm:text-lg leading-relaxed">
            <div className="flex items-start gap-2">
              <span className="font-semibold text-lg sm:text-xl text-[#4e453f] select-none">
                1.
              </span>
              <span>Main point number one.</span>
            </div>

            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <span className="font-semibold text-lg sm:text-xl text-[#4e453f] select-none">
                  2.
                </span>
                <span>Main point number two, containing sub-points:</span>
              </div>
              <div className="pl-6 sm:pl-8 space-y-1.5 text-base sm:text-lg">
                <div className="flex items-start gap-2">
                  <span className="text-[#7f756e] select-none">a.</span>
                  <span>Detail expanding on point two.</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[#7f756e] select-none">b.</span>
                  <span>Another supporting detail for context.</span>
                </div>
              </div>
            </div>
          </div>

          {/* Media / Video Embed Resilient Container */}
          <div
            id="note-media-embed-container"
            className="w-full max-w-full overflow-hidden rounded-xl bg-[#dbdad5] border border-[#d1c4bc] relative aspect-video md:aspect-[16/9] shadow-xs group cursor-pointer"
          >
            {/* Ambient Misty Background simulating quiet nature scenery */}
            <div
              className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
              style={{
                backgroundImage: `url('https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80')`,
                filter: 'brightness(0.92) sepia(0.12)',
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10" />

            {/* Play Button Indicator */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/30 backdrop-blur-xs flex items-center justify-center text-white/90 border border-white/30 group-hover:bg-black/50 group-hover:scale-110 transition-all shadow-md">
                <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-white/90 ml-0.5" />
              </div>
            </div>
          </div>

          {/* Bullet List */}
          <ul className="space-y-2 text-base sm:text-lg leading-relaxed list-disc list-inside text-[#1b1c19]">
            <li>Final thought bullet point.</li>
            <li>Conclusion remark.</li>
            <li>Closing statement.</li>
          </ul>
        </article>
      </div>
    </main>
  );
}
