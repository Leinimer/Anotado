/**
 * EgressGuard: Mecanismo centralizado de proteção contra esgotamento de quota e consumo anormal de egress.
 * 
 * Interrompe novas operações remotas quando HTTP 402 / exceed_egress_quota for detectado,
 * protegendo o app contra loops de retry e permitindo a retomada limpa quando a quota for restaurada.
 */

import { networkMonitor } from './network-monitor';

class EgressGuardService {
  private inFlightMap = new Map<string, Promise<any>>();

  /**
   * Verifica se as operações remotas estão bloqueadas por excesso de cota de egress.
   */
  public isBlocked(): boolean {
    return networkMonitor.getIsQuotaExceeded();
  }

  /**
   * Retorna a mensagem de erro da cota, se houver.
   */
  public getErrorMessage(): string | null {
    return networkMonitor.getState().quotaErrorMessage || null;
  }

  /**
   * Avalia se um erro recebido do Supabase corresponde a 402 / exceed_egress_quota.
   * Se sim, ativa imediatamente o modo de proteção central e retorna true.
   */
  public handleError(err: any): boolean {
    if (!err) return false;

    const status = err.status || err.statusCode || err.code;
    const msg = (err.message || String(err)).toLowerCase();

    const isQuotaError =
      status === 402 ||
      status === '402' ||
      msg.includes('exceed_egress_quota') ||
      msg.includes('quota exceeded') ||
      msg.includes('egress quota') ||
      msg.includes('exceeded its egress limit');

    if (isQuotaError) {
      const friendlyMsg =
        err.message && err.message.length > 5 && !err.message.includes('object')
          ? err.message
          : 'A cota de transferência (egress) do projeto Supabase foi atingida.';

      console.warn(`[EgressGuard] Quota de egress excedida detectada. Ativando modo de segurança.`);
      networkMonitor.setQuotaExceeded(true, friendlyMsg);
      return true;
    }

    return false;
  }

  /**
   * Reseta o bloqueio de cota (ex: quando o Supabase for restaurado ou probe confirmar viabilidade).
   */
  public reset(): void {
    networkMonitor.setQuotaExceeded(false, null);
  }

  /**
   * Deduplica requisições concorrentes idênticas em andamento.
   * Se duas partes da UI chamarem a mesma query simultaneamente, compartilham a mesma Promise.
   */
  public deduplicate<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlightMap.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = task().finally(() => {
      this.inFlightMap.delete(key);
    });

    this.inFlightMap.set(key, promise);
    return promise;
  }
}

export const EgressGuard = new EgressGuardService();
