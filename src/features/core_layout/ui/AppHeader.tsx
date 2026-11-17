'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Settings } from 'lucide-react';
import { ThemeToggle } from '@/src/features/theme/ThemeToggle';
import { SettingsModal } from '@/src/features/notes/ui/SettingsModal';
import { Note } from '@/src/features/notes/types';

export type AppNavSection = 'notes' | 'sticky-notes' | 'diary';

interface AppHeaderProps {
  activeSection: AppNavSection;
  userId?: string;
  userEmail?: string;
  notes?: Note[];
  onBeforeNavigate?: () => void;
  onOpenShareModal?: () => void;
}

const NAV_ITEMS: Array<{
  id: AppNavSection;
  label: string;
  href: string;
}> = [
  { id: 'notes', label: 'Notas', href: '/notes' },
  { id: 'sticky-notes', label: 'Notas adesivas', href: '/sticky-notes' },
  { id: 'diary', label: 'Diário', href: '/diary' },
];

export function AppHeader({
  activeSection,
  userId = '',
  userEmail = '',
  notes = [],
  onBeforeNavigate,
  onOpenShareModal,
}: AppHeaderProps) {
  const router = useRouter();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleNavigate = (target: AppNavSection, href: string) => {
    if (target === activeSection) return;
    onBeforeNavigate?.();
    router.push(href);
  };

  return (
    <>
      <header
        id="app-main-header"
        className="w-full h-12 shrink-0 bg-[#fbf9f4] dark:bg-[#000000] border-b border-[#eae8e3] dark:border-[#1a1a1a] px-2.5 sm:px-4 flex items-center justify-between gap-2 select-none z-30"
      >
        {/* Esquerda: Logo + 3 áreas de navegação imediatamente à direita */}
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button
            type="button"
            onClick={() => handleNavigate('notes', '/notes')}
            className="flex items-center shrink-0 cursor-pointer focus:outline-none rounded-md"
            title="Anotado — Notas"
            aria-label="Ir para Notas"
          >
            <img
              src="/logo-anotado-sidebar-light.png"
              alt="Anotado"
              width={290}
              height={189}
              draggable={false}
              className="w-[56px] sm:w-[70px] h-auto object-contain dark:hidden"
            />
            <img
              src="/logo-anotado-sidebar-light.png"
              alt=""
              aria-hidden="true"
              width={290}
              height={189}
              draggable={false}
              className="hidden w-[56px] sm:w-[70px] h-auto object-contain brightness-0 invert dark:block"
            />
          </button>

          <nav
            aria-label="Navegação principal"
            className="flex items-center gap-0.5 sm:gap-1 min-w-0 overflow-x-auto no-scrollbar"
          >
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  id={`app-nav-${item.id}`}
                  type="button"
                  onClick={() => handleNavigate(item.id, item.href)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11.5px] sm:text-[13px] font-sans-ui whitespace-nowrap transition-colors cursor-pointer shrink-0 ${
                    isActive
                      ? 'bg-[#ebe4d8] text-[#1b1c19] font-semibold shadow-2xs dark:bg-[#231f1b] dark:text-[#ffffff]'
                      : 'text-[#68594d] hover:bg-[#f0eee9] hover:text-[#1b1c19] font-medium dark:text-[#a1a1aa] dark:hover:bg-[#141414] dark:hover:text-[#ffffff]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Direita: Botão de modo escuro imediatamente à esquerda do botão de configurações */}
        <div className="flex items-center gap-1.5 shrink-0">
          <ThemeToggle />

          <button
            id="header-settings-btn"
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="w-7 h-7 rounded-full flex items-center justify-center border border-[#ded9cf] bg-[#f0eee9] hover:bg-[#e5e1d8] text-[#5e534b] hover:text-[#1b1c19] dark:bg-[#111111] dark:hover:bg-[#1a1a1a] dark:border-[#222222] dark:text-[#a1a1aa] dark:hover:text-[#ffffff] transition-all cursor-pointer shrink-0 select-none shadow-2xs"
            title="Configurações"
            aria-label="Configurações"
          >
            <Settings className="w-3.5 h-3.5 stroke-[2]" />
          </button>
        </div>
      </header>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        userId={userId}
        notes={notes}
        userEmail={userEmail}
        onOpenShareModal={onOpenShareModal}
      />
    </>
  );
}
