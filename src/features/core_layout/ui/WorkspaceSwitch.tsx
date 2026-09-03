'use client';

import React from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { WorkspaceType } from '@/src/features/notes/types';

interface WorkspaceSwitchProps {
  currentWorkspace: WorkspaceType;
  onToggle: () => void;
}

export function WorkspaceSwitch({ currentWorkspace, onToggle }: WorkspaceSwitchProps) {
  const isDiary = currentWorkspace === 'diary';

  return (
    <button
      id="workspace-switch-toggle-btn"
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f0eee9] hover:bg-[#e5e1d8] border border-[#ded9cf] text-[#5e534b] hover:text-[#1b1c19] text-xs font-sans-ui font-medium transition-all shadow-2xs cursor-pointer group select-none shrink-0"
      title={isDiary ? 'Alternar para Notas' : 'Alternar para Diário'}
      aria-label={isDiary ? 'Alternar para Notas' : 'Alternar para Diário'}
    >
      <span className="text-[11px] font-semibold text-[#5a4d43] group-hover:text-[#1b1c19] transition-colors">
        {isDiary ? 'Diário' : 'Notas'}
      </span>
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#ded7cc] group-hover:bg-[#cbbfaf] text-[#4e453f] transition-colors">
        <ArrowLeftRight className="w-2.5 h-2.5 stroke-[2.2]" />
      </span>
    </button>
  );
}
