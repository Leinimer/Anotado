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
  | 'quota_exceeded'
  | 'error';

export interface NetworkState {
  isOnline: boolean;
  isBackendReachable: boolean;
  isQuotaExceeded: boolean;
  quotaErrorMessage?: string | null;
  status: ConnectivityStatus;
  pendingCount: number;
  lastCheckedAt: string;
}

type Listener = (state: NetworkState) => void;

class NetworkMonitor {
  private isOnline: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private isBackendReachable: boolean = true;
  private isQuotaExceeded: boolean = false;
  private quotaErrorMessage: string | null = null;
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
      if (!isSupabaseConfigured()) {
        this.isBackendReachable = true;
        return true;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) {
        this.isBackendReachable = false;
        this.updateStatus('offline');
        return false;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      // Probe leve no endpoint oficial de health do Supabase Auth (retorna 200 OK sem requerer secret key)
      const pingUrl = `${supabaseUrl}/auth/v1/health`;
      const response = await fetch(pingUrl, {
        method: 'GET',
        headers: {
          apikey: anonKey,
        },
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);

      // Tratamento específico de violação de quota de egress (HTTP 402 / exceed_egress_quota)
      if (response.status === 402) {
        let errorMsg = 'Quota de egress do projeto Supabase excedida.';
        try {
          const bodyText = await response.text();
          if (bodyText) {
            const parsed = JSON.parse(bodyText);
            if (parsed.message) errorMsg = parsed.message;
          }
        } catch {}
        this.setQuotaExceeded(true, errorMsg);
        this.isOnline = true;
        this.isBackendReachable = false;
        return false;
      }

      const reachable = response.ok;
      this.isOnline = true;
      this.isBackendReachable = reachable;

      if (reachable) {
        if (this.isQuotaExceeded) {
          this.setQuotaExceeded(false, null);
        }
        if (this.currentStatus !== 'syncing' && this.currentStatus !== 'remote_change') {
          this.updateStatus(this.pendingCount > 0 ? 'pending_sync' : 'synced');
        }
      } else {
        if (this.currentStatus !== 'syncing') {
          this.updateStatus(this.pendingCount > 0 ? 'pending_sync' : 'offline');
        }
      }

      return reachable;
    } catch {
      this.isBackendReachable = false;
      if (this.currentStatus !== 'syncing') {
        this.updateStatus(this.pendingCount > 0 ? 'pending_sync' : 'offline');
      }
      return false;
    } finally {
      this.isCheckingProbe = false;
    }
  }

  public setQuotaExceeded(exceeded: boolean, message?: string | null) {
    const changed = this.isQuotaExceeded !== exceeded;
    this.isQuotaExceeded = exceeded;
    if (exceeded) {
      this.quotaErrorMessage = message || 'Quota de egress excedida.';
      this.isBackendReachable = false;
      this.currentStatus = 'quota_exceeded';
      // Quando a cota é excedida, relaxa o probe para 5 minutos para evitar tráfego inútil
      this.startPeriodicCheck(300000);
    } else {
      this.quotaErrorMessage = null;
      if (changed) {
        this.startPeriodicCheck(60000);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('supabase-quota-restored'));
        }
      }
    }
    this.notify();
  }

  public getIsQuotaExceeded(): boolean {
    return this.isQuotaExceeded;
  }

  public startPeriodicCheck(intervalMs: number = 60000) {
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.checkInterval = setInterval(() => {
      this.checkBackendReachability();
    }, intervalMs);
  }

  public updatePendingCount(count: number) {
    this.pendingCount = count;
    if (this.isQuotaExceeded) {
      this.updateStatus('quota_exceeded');
      return;
    }
    if (this.currentStatus !== 'syncing' && this.currentStatus !== 'remote_change') {
      if (!this.isBackendReachable) {
        this.updateStatus(count > 0 ? 'pending_sync' : 'offline');
      } else if (count > 0) {
        this.updateStatus('pending_sync');
      } else {
        this.updateStatus('synced');
      }
    } else {
      this.notify();
    }
  }

  public setSyncing(isSyncing: boolean) {
    if (this.isQuotaExceeded) {
      this.updateStatus('quota_exceeded');
      return;
    }
    if (isSyncing) {
      this.updateStatus('syncing');
    } else {
      if (!this.isBackendReachable) {
        this.updateStatus(this.pendingCount > 0 ? 'pending_sync' : 'offline');
      } else if (this.pendingCount > 0) {
        this.updateStatus('pending_sync');
      } else {
        this.updateStatus('synced');
      }
    }
  }

  public updateStatus(status: ConnectivityStatus) {
    this.currentStatus = status;
    this.notify();
  }

  public setStatus(status: ConnectivityStatus) {
    this.updateStatus(status);
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
      isQuotaExceeded: this.isQuotaExceeded,
      quotaErrorMessage: this.quotaErrorMessage,
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
