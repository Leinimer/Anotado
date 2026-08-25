'use client';

import { useState, useEffect } from 'react';
import {
  Cloud,
  CloudOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { networkMonitor, NetworkState } from '../api/network-monitor';
import { syncEngine } from '../api/sync-engine';

interface SyncStatusIndicatorProps {
  userId?: string;
  className?: string;
}

export function SyncStatusIndicator({ userId, className = '' }: SyncStatusIndicatorProps) {
  const [networkState, setNetworkState] = useState<NetworkState>(networkMonitor.getState());
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const unsubscribe = networkMonitor.subscribe((state) => {
      setNetworkState(state);
    });
    return () => unsubscribe();
  }, []);

  const handleManualSync = () => {
    if (userId) {
      syncEngine.processQueue(userId);
    }
  };

  // Definição visual conforme o estado
  const getStatusConfig = () => {
    if (networkState.status === 'remote_change') {
      return {
        icon: Sparkles,
        iconClass: 'text-[#0284c7] animate-pulse',
        dotClass: 'bg-[#0284c7] animate-ping',
        label: 'Alteração recebida',
        tooltip: 'Alteração sincronizada em tempo real via Supabase Realtime',
      };
    }

    if (networkState.status === 'syncing') {
      return {
        icon: RefreshCw,
        iconClass: 'animate-spin text-[#0284c7]',
        dotClass: 'bg-[#0284c7]',
        label: 'Sincronizando...',
        tooltip: 'Enviando alterações para o Supabase',
      };
    }

    if (!networkState.isBackendReachable || networkState.status === 'offline') {
      return {
        icon: CloudOff,
        iconClass: 'text-[#92400e]',
        dotClass: 'bg-[#d97706]',
        label: 'Modo Offline',
        tooltip: networkState.pendingCount > 0
          ? `${networkState.pendingCount} alteração(ões) salva(s) localmente`
          : 'Operando localmente no IndexedDB',
      };
    }

    if (networkState.pendingCount > 0 || networkState.status === 'pending_sync') {
      return {
        icon: AlertCircle,
        iconClass: 'text-[#d97706]',
        dotClass: 'bg-[#d97706]',
        label: `${networkState.pendingCount} pendente${networkState.pendingCount > 1 ? 's' : ''}`,
        tooltip: 'Alterações salvas no dispositivo prontas para envio',
      };
    }

    return {
      icon: CheckCircle2,
      iconClass: 'text-[#16a34a]',
      dotClass: 'bg-[#16a34a]',
      label: 'Sincronizado',
      tooltip: 'Todas as notas estão salvas no Supabase e no IndexedDB',
    };
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
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
      onClick={handleManualSync}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={config.tooltip}
      id="sync-status-indicator"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
      <Icon className={`w-3.5 h-3.5 ${config.iconClass}`} />
      <span>{config.label}</span>

      {/* Tooltip elegante */}
      {isHovered && (
        <div className="absolute bottom-full left-0 mb-1.5 z-50 px-2.5 py-1 text-[11px] font-normal text-[#fbf9f4] bg-[#2d2823] rounded shadow-md whitespace-nowrap pointer-events-none transition-opacity duration-150">
          <p>{config.tooltip}</p>
          <p className="text-[9px] text-[#baa89b] mt-0.5">Clique para verificar agora</p>
        </div>
      )}
    </div>
  );
}
