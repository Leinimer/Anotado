'use client';

import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './theme-context';

interface ThemeToggleProps {
  className?: string;
  variant?: 'icon' | 'segmented';
}

export function ThemeToggle({ className = '', variant = 'icon' }: ThemeToggleProps) {
  const { theme, toggleTheme, setTheme, isMounted } = useTheme();

  // If not mounted yet (during SSR or initial client hydration render),
  // render the Light mode default state so server HTML exactly matches client hydration.
  const isDark = isMounted ? theme === 'dark' : false;

  if (variant === 'segmented') {
    return (
      <div
        className={`flex items-center p-1 rounded-xl bg-[#f0eee9] dark:bg-[#18181b] border border-[#ded9cf] dark:border-[#27272a] ${className}`}
      >
        <button
          type="button"
          onClick={() => setTheme('light')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            !isDark
              ? 'bg-white text-[#1b1c19] shadow-xs'
              : 'text-[#7f756e] dark:text-[#a1a1aa] hover:text-[#1b1c19] dark:hover:text-white'
          }`}
        >
          <Sun className="w-3.5 h-3.5 stroke-[2]" />
          <span>Claro</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme('dark')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            isDark
              ? 'bg-[#27272a] text-white shadow-xs'
              : 'text-[#7f756e] dark:text-[#a1a1aa] hover:text-[#1b1c19] dark:hover:text-white'
          }`}
        >
          <Moon className="w-3.5 h-3.5 stroke-[2]" />
          <span>Dark</span>
        </button>
      </div>
    );
  }

  return (
    <button
      id="sidebar-theme-toggle-btn"
      type="button"
      onClick={toggleTheme}
      className={`w-7 h-7 rounded-full flex items-center justify-center border border-[#ded9cf] bg-[#f0eee9] hover:bg-[#e5e1d8] text-[#5e534b] hover:text-[#1b1c19] dark:bg-[#111111] dark:hover:bg-[#1a1a1a] dark:border-[#222222] dark:text-[#a1a1aa] dark:hover:text-[#ffffff] transition-all cursor-pointer shrink-0 select-none shadow-2xs ${className}`}
      title={isDark ? 'Modo claro' : 'Modo escuro'}
      aria-label={isDark ? 'Alternar para Modo Claro' : 'Alternar para Modo Escuro'}
    >
      {isDark ? (
        <Sun className="w-3.5 h-3.5 stroke-[2.2]" />
      ) : (
        <Moon className="w-3.5 h-3.5 stroke-[2.2]" />
      )}
    </button>
  );
}
