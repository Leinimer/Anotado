/**
 * RemoteOperationGuard
 * 
 * Gerenciador centralizado de promessas remotas em andamento.
 * Garante deduplicação estrita de chamadas ao PostgREST por userId e tipo de operação:
 * - fetch:notes:userId
 * - fetch:folders:userId
 * - fetch:attachments:userId
 * - fetch:foldersAndNotes:userId:workspace
 * - pull:userId
 * 
 * Se múltiplas partes da aplicação solicitarem os mesmos dados simultaneamente,
 * elas compartilham a mesma Promise em andamento.
 */

class RemoteOperationGuard {
  private inFlightMap = new Map<string, Promise<any>>();

  /**
   * Executa uma operação remota de forma deduplicada.
   * Se já houver uma Promise em andamento para a mesma chave, reutiliza-a.
   */
  public async execute<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.inFlightMap.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = (async (): Promise<T> => {
      try {
        return await operation();
      } finally {
        this.inFlightMap.delete(key);
      }
    })();

    this.inFlightMap.set(key, promise);
    return promise;
  }

  /**
   * Verifica se há alguma operação em andamento com esta chave.
   */
  public isInFlight(key: string): boolean {
    return this.inFlightMap.has(key);
  }

  /**
   * Obtém a Promise em andamento, se houver.
   */
  public getInFlight<T>(key: string): Promise<T> | undefined {
    return this.inFlightMap.get(key) as Promise<T> | undefined;
  }

  /**
   * Verifica se há qualquer operação de fetch ou pull em andamento para o usuário.
   */
  public isUserBusy(userId: string): boolean {
    for (const key of this.inFlightMap.keys()) {
      if (key.includes(`:${userId}`) || key.endsWith(`:${userId}`)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Aguarda qualquer operação de fetch inicial ou pull em andamento para o usuário.
   */
  public async waitForUserOperations(userId: string): Promise<void> {
    const promises: Promise<any>[] = [];
    for (const [key, promise] of this.inFlightMap.entries()) {
      if (key.includes(`:${userId}`) || key.endsWith(`:${userId}`)) {
        promises.push(promise);
      }
    }
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  /**
   * Limpa todas as operações (para testes ou logout).
   */
  public clear(): void {
    this.inFlightMap.clear();
  }
}

export const remoteOperationGuard = new RemoteOperationGuard();
