'use client';

import { useState, useEffect, useRef } from 'react';
import {
  CloudOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { networkMonitor, NetworkState } from '../api/network-monitor';
import { syncEngine } from '../api/sync-engine';
import { SyncPendingModal } from './SyncPendingModal';
import { Folder as FolderType, Note as NoteType } from '../types';

interface SyncStatusIndicatorProps {
  userId?: string;
  className?: string;
  onSelectNote?: (noteId: string) => void;
  onSelectFolder?: (folderId: string | null) => void;
  folders?: FolderType[];
  notes?: NoteType[];
  readOnly?: boolean;
}

export function SyncStatusIndicator({
  userId,
  className = '',
  onSelectNote,
  onSelectFolder,
  folders = [],
  notes = [],
  readOnly = false,
}: SyncStatusIndicatorProps) {
  const [networkState, setNetworkState] = useState<NetworkState>(networkMonitor.getState());
  const [isHovered, setIsHovered] = useState(false);
  const [isPendingModalOpen, setIsPendingModalOpen] = useState(false);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const unsubscribe = networkMonitor.subscribe((state) => {
      setNetworkState(state);
    });
    return () => unsubscribe();
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (readOnly) return;

    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      // Duplo clique: abre modal de pendências
      setIsPendingModalOpen(true);
      return;
    }

    clickTimeoutRef.current = setTimeout(() => {
      clickTimeoutRef.current = null;
      // Clique simples: força sincronização imediata
      if (userId) {
        syncEngine.processQueue(userId);
      }
    }, 250);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (readOnly) return;

    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    setIsPendingModalOpen(true);
  };

  // Definição visual conforme o estado
  const getStatusConfig = () => {
    if (readOnly) {
      if (!networkState.isOnline || !networkState.isBackendReachable) {
        return {
          icon: CloudOff,
          iconClass: 'text-[#ba1a1a]',
          dotClass: 'bg-[#ba1a1a]',
          label: 'Offline (Leitura)',
          tooltip: 'Você está offline. Novas entradas do proprietário serão carregadas quando a conexão for restaurada.',
        };
      }
      return {
        icon: CheckCircle2,
        iconClass: 'text-[#68594d]',
        dotClass: 'bg-[#68594d]',
        label: 'Em tempo real (Leitura)',
        tooltip: 'Conectado em tempo real via Supabase • Modo somente leitura',
      };
    }
    if (networkState.status === 'remote_change') {
      return {
        icon: Sparkles,
        iconClass: 'text-[#0284c7] animate-pulse',
        dotClass: 'bg-[#0284c7] animate-ping',
        label: 'Alteração recebida',
        tooltip: 'Alteração sincronizada em tempo real via Supabase Realtime (2 cliques para ver detalhes)',
      };
    }

    if (networkState.status === 'syncing') {
      return {
        icon: RefreshCw,
        iconClass: 'animate-spin text-[#0284c7]',
        dotClass: 'bg-[#0284c7]',
        label: 'Sincronizando...',
        tooltip: 'Enviando alterações para o Supabase (2 cliques para ver detalhes)',
      };
    }

    if (!networkState.isBackendReachable || networkState.status === 'offline') {
      return {
        icon: CloudOff,
        iconClass: 'text-[#92400e]',
        dotClass: 'bg-[#d97706]',
        label: 'Modo Offline',
        tooltip: networkState.pendingCount > 0
          ? `${networkState.pendingCount} alteração(ões) salva(s) localmente (2 cliques para ver detalhes)`
          : 'Operando localmente no IndexedDB (2 cliques para ver detalhes)',
      };
    }

    if (networkState.pendingCount > 0 || networkState.status === 'pending_sync') {
      return {
        icon: AlertCircle,
        iconClass: 'text-[#d97706]',
        dotClass: 'bg-[#d97706]',
        label: `${networkState.pendingCount} pendente${networkState.pendingCount > 1 ? 's' : ''}`,
        tooltip: `${networkState.pendingCount} alterações salvas no dispositivo (1 clique sincroniza, 2 cliques abre detalhes)`,
      };
    }

    return {
      icon: CheckCircle2,
      iconClass: 'text-[#16a34a]',
      dotClass: 'bg-[#16a34a]',
      label: 'Sincronizado',
      tooltip: 'Todas as notas estão salvas no Supabase e no IndexedDB (2 cliques para ver detalhes)',
    };
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <>
      <div
        className={`relative inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium tracking-tight select-none transition-colors duration-150 cursor-pointer ${
          networkState.status === 'remote_change'
            ? 'bg-[#e0f2fe] text-[#0369a1]'
            : networkState.status === 'syncing'
            ? 'bg-[#f0f9ff] text-[#0369a1]'
            : !networkState.isBackendReachable
            ? 'bg-[#fffbeb] text-[#92400e]'
            : networkState.pendingCount > 0
            ? 'bg-[#fef3c7] text-[#92400e]'
            : 'bg-[#f4f3ef] text-[#54483e] hover:bg-[#eae8e3]'
        } ${className}`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title={config.tooltip}
        id="sync-status-indicator"
        role="button"
        aria-label="Status de Sincronização"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
        <Icon className={`w-3.5 h-3.5 ${config.iconClass}`} />
        <span>{config.label}</span>

        {/* Tooltip elegante */}
        {isHovered && (
          <div className="absolute bottom-full left-0 mb-1.5 z-50 px-2.5 py-1 text-[11px] font-normal text-[#fbf9f4] bg-[#2d2823] rounded shadow-md whitespace-nowrap pointer-events-none transition-opacity duration-150">
            <p>{config.tooltip}</p>
            <p className="text-[9px] text-[#baa89b] mt-0.5">1 clique: sincronizar • 2 cliques: pendências</p>
          </div>
        )}
      </div>

      <SyncPendingModal
        isOpen={isPendingModalOpen}
        onClose={() => setIsPendingModalOpen(false)}
        userId={userId}
        onSelectNote={onSelectNote}
        onSelectFolder={onSelectFolder}
        folders={folders}
        notes={notes}
      />
    </>
  );
}
