/**
 * Monitor de Conectividade e Estado de Rede para o ANOTADO!
 *
 * Realiza detecção de conexão combinando:
 * 1. Eventos do navegador (`window.addEventListener('online')` / `'offline'`)
 * 2. `navigator.onLine`
 * 3. Verificação ativa real de conectividade ao backend do Supabase (probe HTTP leve com timeout)
 * 4. Rastreamento do ciclo de vida da sincronização
 */

import { isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';

export type ConnectivityStatus =
  | 'online'
  | 'offline'
  | 'syncing'
  | 'synced'
  | 'pending_sync'
  | 'remote_change'
  | 'error';

export interface NetworkState {
  isOnline: boolean;
  isBackendReachable: boolean;
  status: ConnectivityStatus;
  pendingCount: number;
  lastCheckedAt: string;
}

type Listener = (state: NetworkState) => void;

class NetworkMonitor {
  private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private isBackendReachable: boolean = true;
  private currentStatus: ConnectivityStatus = 'synced';
  private pendingCount: number = 0;
  private listeners: Set<Listener> = new Set();
  private checkInterval: NodeJS.Timeout | null = null;
  private isCheckingProbe: boolean = false;
  private remoteChangeTimeout: NodeJS.Timeout | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.isOnline = navigator.onLine;
      window.addEventListener('online', () => this.handleNetworkEvent(true));
      window.addEventListener('offline', () => this.handleNetworkEvent(false));

      // Verificação periódica de saúde (a cada 30 segundos se online, ou a cada 10s se houver pendências)
      this.startPeriodicCheck();

      // Checagem inicial
      setTimeout(() => {
        this.checkBackendReachability();
      }, 500);
    }
  }

  private handleNetworkEvent(online: boolean) {
    this.isOnline = online;
    if (!online) {
      this.isBackendReachable = false;
      this.updateStatus(this.pendingCount > 0 ? 'pending_sync' : 'offline');
    } else {
      // Quando o navegador reportar volta de conexão, testa imediatamente o backend
      this.checkBackendReachability();
    }
  }

  /**
   * Executa uma verificação real de conectividade com o Supabase.
   * Não confia cegamente em navigator.onLine.
   */
  public async checkBackendReachability(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    if (!navigator.onLine) {
      this.isOnline = false;
      this.isBackendReachable = false;
      this.updateStatus(this.pendingCount > 0 ? 'pending_sync' : 'offline');
      return false;
    }

    if (!isSupabaseConfigured()) {
      // Se não há Supabase configurado, opera localmente em modo offline/demo
      this.isBackendReachable = false;
      this.updateStatus(this.pendingCount > 0 ? 'pending_sync' : 'offline');
      return false;
    }

    if (this.isCheckingProbe) return this.isBackendReachable;
    this.isCheckingProbe = true;

    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) {
        this.isBackendReachable = false;
        this.updateStatus('offline');
        return false;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      // Probe leve no endpoint health ou rest do Supabase
      const pingUrl = `${supabaseUrl}/rest/v1/`;
      const response = await fetch(pingUrl, {
        method: 'HEAD',
        headers: {
          apikey: anonKey,
        },
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);

      const reachable = response.status >= 200 && response.status < 500;
      this.isOnline = true;
      this.isBackendReachable = reachable;

      if (reachable) {
        if (this.currentStatus === 'offline' || this.currentStatus === 'pending_sync') {
          this.updateStatus(this.pendingCount > 0 ? 'pending_sync' : 'synced');
        }
      } else {
        this.updateStatus(this.pendingCount > 0 ? 'pending_sync' : 'offline');
      }

      return reachable;
    } catch {
      this.isBackendReachable = false;
      this.updateStatus(this.pendingCount > 0 ? 'pending_sync' : 'offline');
      return false;
    } finally {
      this.isCheckingProbe = false;
    }
  }

  public startPeriodicCheck() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.checkInterval = setInterval(() => {
      this.checkBackendReachability();
    }, 25000);
  }

  public updatePendingCount(count: number) {
    this.pendingCount = count;
    if (count > 0 && !this.isBackendReachable) {
      this.updateStatus('pending_sync');
    } else if (count === 0 && this.isBackendReachable && this.currentStatus !== 'syncing') {
      this.updateStatus('synced');
    }
    this.notify();
  }

  public setSyncing(isSyncing: boolean) {
    if (isSyncing) {
      this.updateStatus('syncing');
    } else {
      if (this.pendingCount > 0) {
        this.updateStatus('pending_sync');
      } else if (this.isBackendReachable) {
        this.updateStatus('synced');
      } else {
        this.updateStatus('offline');
      }
    }
  }

  public updateStatus(status: ConnectivityStatus) {
    this.currentStatus = status;
    this.notify();
  }

  /**
   * Notifica a chegada de uma alteração remota em tempo real.
   * Apresenta temporariamente o status 'remote_change' ("Alteração recebida") e restaura para synced/pending_sync.
   */
  public notifyRemoteChange() {
    if (this.remoteChangeTimeout) {
      clearTimeout(this.remoteChangeTimeout);
    }
    this.updateStatus('remote_change');
    this.remoteChangeTimeout = setTimeout(() => {
      if (this.currentStatus === 'remote_change') {
        if (this.pendingCount > 0) {
          this.updateStatus('pending_sync');
        } else if (this.isBackendReachable) {
          this.updateStatus('synced');
        } else {
          this.updateStatus('offline');
        }
      }
    }, 2500);
  }

  public getState(): NetworkState {
    return {
      isOnline: this.isOnline,
      isBackendReachable: this.isBackendReachable,
      status: this.currentStatus,
      pendingCount: this.pendingCount,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('[NetworkMonitor] Erro em listener:', err);
      }
    }
  }
}

export const networkMonitor = new NetworkMonitor();
