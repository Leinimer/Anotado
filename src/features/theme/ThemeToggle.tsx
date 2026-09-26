'use client';

import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './theme-context';

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { theme, toggleTheme, isMounted } = useTheme();

  // If not mounted yet (during SSR or initial client hydration render),
  // render the Light mode default state so server HTML exactly matches client hydration.
  const isDark = isMounted ? theme === 'dark' : false;

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
