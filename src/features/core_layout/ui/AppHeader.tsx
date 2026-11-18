'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Settings } from 'lucide-react';
import { ThemeToggle } from '@/src/features/theme/ThemeToggle';
import { SettingsModal } from '@/src/features/notes/ui/SettingsModal';
import { Note } from '@/src/features/notes/types';
import { StickyReminderBell } from '@/src/features/sticky-notes/ui/StickyReminderBell';

export type AppNavSection = 'notes' | 'sticky-notes' | 'diary';
interface AppHeaderProps {
  activeSection: AppNavSection;
  userId?: string;
  userEmail?: string;
  notes?: Note[];
  onBeforeNavigate?: () => void;
  onOpenShareModal?: () => void;
  variant?: 'top' | 'sidebar' | 'footer';
  toolbar?: React.ReactNode;
}
const NAV_ITEMS = [
  { id: 'notes' as const, label: 'Notas', href: '/notes' },
  { id: 'sticky-notes' as const, label: 'Stick', href: '/sticky-notes' },
  { id: 'diary' as const, label: 'Diário', href: '/diary' },
];
export function AppHeader({
  activeSection, userId = '', userEmail = '', notes = [], onBeforeNavigate,
  onOpenShareModal, variant = 'top', toolbar,
}: AppHeaderProps) {
  const router = useRouter();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const navigate = (target: AppNavSection, href: string) => {
    if (target === activeSection) return;
    onBeforeNavigate?.();
    router.push(href);
  };
  const nav = (
    <nav aria-label="Navegação principal" className={variant === 'sidebar' ? 'flex flex-wrap items-center justify-center gap-1' : 'flex items-center gap-0.5 sm:gap-1 min-w-0 overflow-x-auto no-scrollbar'}>
      {NAV_ITEMS.map((item) => {
        const active = activeSection === item.id;
        return (
          <button key={item.id} id={`app-nav-${item.id}`} type="button"
            onClick={() => navigate(item.id, item.href)} aria-current={active ? 'page' : undefined}
            className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11.5px] sm:text-[13px] font-sans-ui whitespace-nowrap transition-colors cursor-pointer shrink-0 ${active ? 'bg-[#ebe4d8] text-[#1b1c19] font-semibold shadow-2xs dark:bg-[#231f1b] dark:text-white' : 'text-[#68594d] hover:bg-[#f0eee9] hover:text-[#1b1c19] font-medium dark:text-[#a1a1aa] dark:hover:bg-[#141414] dark:hover:text-white'}`}>
            {item.label}
          </button>
        );
      })}
    </nav>
  );
  const logo = (
    <button type="button" onClick={() => navigate('notes', '/notes')} className="flex items-center justify-center shrink-0 cursor-pointer focus:outline-none rounded-md" title="Anotado — Notas" aria-label="Ir para Notas">
      <img src="/logo-anotado-sidebar-light.png" alt="Anotado" width={290} height={189} draggable={false} className={variant === 'sidebar' ? 'w-[88px] h-auto object-contain dark:hidden' : 'w-[70px] h-auto object-contain dark:hidden'} />
      <img src="/logo-anotado-sidebar-light.png" alt="" aria-hidden="true" width={290} height={189} draggable={false} className={variant === 'sidebar' ? 'hidden w-[88px] h-auto object-contain brightness-0 invert dark:block' : 'hidden w-[70px] h-auto object-contain brightness-0 invert dark:block'} />
    </button>
  );
  const controls = (
    <div className="flex items-center gap-1.5 shrink-0">
      <ThemeToggle />
      <button id={variant === 'footer' ? 'sidebar-settings-btn' : 'header-settings-btn'} type="button" onClick={() => setIsSettingsOpen(true)}
        className="w-8 h-8 rounded-full flex items-center justify-center border border-[#ded9cf] bg-[#f0eee9] hover:bg-[#e5e1d8] text-[#5e534b] hover:text-[#1b1c19] dark:bg-[#111111] dark:hover:bg-[#1a1a1a] dark:border-[#222222] dark:text-[#a1a1aa] dark:hover:text-white transition-all cursor-pointer shrink-0 shadow-2xs"
        title="Configurações" aria-label="Configurações"><Settings className="w-4 h-4 stroke-[2]" /></button>
    </div>
  );
  return (
    <>
      {variant === 'sidebar' ? (
        <div id="app-sidebar-brand-nav" className="w-full shrink-0 flex flex-col items-center gap-2 pb-3 mb-2 border-b border-[#eae8e3] dark:border-[#1a1a1a]">
          {logo}
          <div className="flex items-center justify-center gap-1 w-full">{nav}<StickyReminderBell /></div>
        </div>
      ) : variant === 'footer' ? controls : (
        <header id="app-main-header" className="w-full h-12 shrink-0 bg-[#fbf9f4] dark:bg-[#000000] border-b border-[#eae8e3] dark:border-[#1a1a1a] px-3 sm:px-4 flex items-center gap-3 select-none z-30">
          <div className="flex items-center gap-3 shrink-0">{logo}{nav}<StickyReminderBell /></div>
          {toolbar && <><div className="h-7 w-px bg-[#e6e1d8] dark:bg-[#292929] shrink-0" /><div className="flex-1 min-w-0">{toolbar}</div></>}
          <div className="ml-auto">{controls}</div>
        </header>
      )}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} userId={userId} notes={notes} userEmail={userEmail} onOpenShareModal={onOpenShareModal} />
    </>
  );
}
