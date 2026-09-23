/**
 * Motor de Sincronização Bidirecional Offline-First (SyncEngine)
 *
 * Arquitetura de Estado:
 * - O estado de sincronização (syncRequired, syncStatus) é controlado EXCLUSIVAMENTE
 *   pelo IndexedDB local do dispositivo.
 * - O Supabase remoto é a fonte canônica oficial dos dados persistidos.
 * - A SyncQueue é a fila resiliente de execução, serialização e retry.
 * - Verificação local a cada 1 segundo (consulta ultrarrápida do IndexedDB sem sobrecarregar o Supabase).
 * - Sincronização bidirecional, Realtime seguro e tratamento não-destrutivo de conflitos.
 */

import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import {
  indexedDBStorage,
  SyncQueueItem,
  ExtendedNote,
  ExtendedFolder,
} from '../db/indexed-db';
import { saveQueue } from './save-queue';
import { networkMonitor } from './network-monitor';
import { writeNoteMarkdown, deleteNoteMarkdown, readNoteMarkdown } from './notes-storage-api';
import { normalizeTags } from '../utils/hashtag-extractor';
import { serializeMarkdownWithTags, parseMarkdownWithTags } from '../utils/markdown-tags';
import {
  prepareNoteContentForPersistence,
  validateNoteContentForRemotePersistence,
  hasUnresolvedLocalMedia,
  replaceAttachmentReferencesInEditor,
  extractAttachmentReferences,
  uploadAttachmentBinary,
  ATTACHMENTS_BUCKET_NAME,
} from './storage-api';
import { registerResolvedAttachmentUrl } from '../editor/utils/media-common';
import { remoteOperationGuard } from './remote-operation-guard';

export type DataChangePayload = {
  userId: string;
  folders: ExtendedFolder[];
  notes: ExtendedNote[];
};

type DataSubscriber = (payload: DataChangePayload) => void;

export function formatFriendlyErrorMessage(err: any): string {
  if (!err) return 'Falha na conexão ou execução da sincronização';
  const msg = typeof err === 'string' ? err : err.message || err.error_description || String(err);
  const lower = msg.toLowerCase();

  if (lower.includes('jwt') || lower.includes('session') || lower.includes('auth') || lower.includes('unauthenticated') || lower.includes('not logged in')) {
    return 'Sessão de autenticação indisponível';
  }
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('failed to fetch') || lower.includes('econnrefused')) {
    return 'Falha de conexão com o Supabase';
  }
  if (lower.includes('permission') || lower.includes('denied') || lower.includes('rls') || lower.includes('row-level security') || lower.includes('policy')) {
    return 'Permissão negada pelo Supabase';
  }
  if (lower.includes('timeout') || lower.includes('aborterror') || lower.includes('deadline')) {
    return 'Tempo de resposta esgotado (Timeout)';
  }
  if (lower.includes('storage') || lower.includes('bucket') || lower.includes('upload')) {
    return 'Upload do anexo falhou';
  }
  if (lower.includes('relation') || lower.includes('column') || lower.includes('schema') || lower.includes('syntax')) {
    return 'Falha ao gravar no banco de dados remoto';
  }
  if (lower.includes('unresolved') || lower.includes('local media') || lower.includes('attachment:')) {
    return 'Aguardando processamento de anexos locais';
  }
  if (lower.includes('config')) {
    return 'Configuração do Supabase ausente';
  }

  if (msg === 'Execução retornou falso') {
    return 'Supabase não confirmou o recebimento da operação';
  }

  if (msg.length < 80 && !msg.includes('{') && !msg.includes('stack')) {
    return msg;
  }

  return 'Falha ao sincronizar com o Supabase';
}

class SyncEngine {
  private isProcessing: boolean = false;
  private hasPendingSyncRequest: boolean = false;
  private syncTimeout: NodeJS.Timeout | null = null;
  private watchdogInterval: NodeJS.Timeout | null = null;
  private reconciliationInterval: NodeJS.Timeout | null = null;
  private isPulling: boolean = false;
  private activeUserId: string | null = null;
  private activeRealtimeUserId: string | null = null;
  private realtimeStatus: 'SUBSCRIBED' | 'DISCONNECTED' | 'CONNECTING' = 'DISCONNECTED';
  private dataSubscribers: Set<DataSubscriber> = new Set();
  private lastKnownReachable: boolean = false;
  private realtimeChannel: any = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private lastReconciliationTime: number = 0;
  private uploadingAttachments: Set<string> = new Set();
  private recentlySyncedNoteIds: Map<string, number> = new Map();
  private minNextSyncTime: number = 0;
  private inFlightReconciliation: Map<string, Promise<void>> = new Map();
  private inFlightPull: Map<string, Promise<void>> = new Map();
  private lastSuccessfulReconciliation: number = 0;
  private reconciliationCooldownMs: number = 15000;
  private initializedUserIds: Set<string> = new Set();

  public getActiveUserId(): string | null {
    return this.activeUserId;
  }

  constructor() {
    if (typeof window !== 'undefined') {
      this.lastKnownReachable = networkMonitor.getState().isBackendReachable;

      // 1. Transição de conectividade (OFFLINE -> ONLINE)
      networkMonitor.subscribe((state) => {
        const wasOffline = !this.lastKnownReachable;
        const isNowOnline = state.isBackendReachable;
        this.lastKnownReachable = isNowOnline;

        if (wasOffline && isNowOnline && this.activeUserId && !networkMonitor.getIsQuotaExceeded()) {
          console.log('[SyncEngine] Conexão restabelecida: restabelecendo Realtime e verificando pendências locais');
          this.ensureRealtimeConnected(this.activeUserId);
          this.checkWatchdog(this.activeUserId);
        }
      });

      // 2. Window focus (ao focar a janela/navegador - apenas verifica pendências locais ou reconexão Realtime)
      window.addEventListener('focus', () => {
        if (this.activeUserId && navigator.onLine && !networkMonitor.getIsQuotaExceeded()) {
          this.ensureRealtimeConnected(this.activeUserId);
          this.checkWatchdog(this.activeUserId);
          // Somente reconcilia via rede se Realtime estiver fora do ar há mais de 5 minutos
          if (this.realtimeStatus !== 'SUBSCRIBED' && Date.now() - this.lastReconciliationTime > 300000) {
            this.performSilentReconciliation(this.activeUserId);
          }
        }
      });

      // 3. Document visibility change (retorno de segundo plano)
      document.addEventListener('visibilitychange', () => {
        if (
          document.visibilityState === 'visible' &&
          this.activeUserId &&
          navigator.onLine &&
          !networkMonitor.getIsQuotaExceeded()
        ) {
          this.ensureRealtimeConnected(this.activeUserId);
          this.checkWatchdog(this.activeUserId);
          // Somente reconcilia via rede se Realtime estiver desconectado há mais de 5 minutos
          if (this.realtimeStatus !== 'SUBSCRIBED' && Date.now() - this.lastReconciliationTime > 300000) {
            this.performSilentReconciliation(this.activeUserId);
          }
        }
      });

      // 4. Evento nativo online (verifica fila local e reabre Realtime se necessário)
      window.addEventListener('online', () => {
        if (this.activeUserId && !networkMonitor.getIsQuotaExceeded()) {
          console.log('[SyncEngine] Evento online disparado: reconexão leve');
          this.ensureRealtimeConnected(this.activeUserId);
          this.checkWatchdog(this.activeUserId);
        }
      });

      // 4b. Evento de quota restaurada (retoma sincronização de forma suave)
      window.addEventListener('supabase-quota-restored', () => {
        if (this.activeUserId && navigator.onLine) {
          console.log('[SyncEngine] Quota do Supabase restaurada! Retomando sincronização...');
          this.ensureRealtimeConnected(this.activeUserId);
          this.scheduleSync(1000);
        }
      });

      // 5. Reconciliação periódica de segurança de baixa frequência (10 minutos): SOMENTE se Realtime NÃO estiver conectado
      // Se o Realtime estiver SUBSCRIBED, todas as alterações chegam instantaneamente via websocket sem tráfego de polling!
      this.reconciliationInterval = setInterval(() => {
        if (
          this.activeUserId &&
          navigator.onLine &&
          typeof document !== 'undefined' &&
          document.visibilityState === 'visible' &&
          this.realtimeStatus !== 'SUBSCRIBED' &&
          !networkMonitor.getIsQuotaExceeded()
        ) {
          this.performSilentReconciliation(this.activeUserId);
        }
      }, 600000);

      // 6. Watchdog de segurança a cada 60 segundos (O(p) - consulta apenas a SyncQueue local do IndexedDB)
      this.watchdogInterval = setInterval(() => {
        if (this.activeUserId && !this.isProcessing && navigator.onLine && !networkMonitor.getIsQuotaExceeded()) {
          this.checkWatchdog(this.activeUserId);
        }
      }, 60000);
    }
  }

  public setActiveUser(userId: string) {
    if (!userId || typeof window === 'undefined') return;

    const isSameUser = this.activeUserId === userId;
    const isAlreadyInitialized = this.initializedUserIds.has(userId);

    // Idempotência estrita: se for o mesmo usuário já ativo e inicializado, não repete reconciliação nem cria canais
    if (isSameUser && isAlreadyInitialized) {
      this.updatePendingCount(userId);
      return;
    }

    // Se houve troca de usuário real, limpa o canal e timers do usuário anterior
    if (this.activeUserId && this.activeUserId !== userId) {
      this.cleanup();
    }

    this.activeUserId = userId;
    this.initializedUserIds.add(userId);
    this.updatePendingCount(userId);

    if (!this.realtimeChannel || this.realtimeStatus !== 'SUBSCRIBED' || this.activeRealtimeUserId !== userId) {
      this.setupRealtimeSubscription(userId);
    }
    // Reconciliação silenciosa inicial (deduplicada)
    this.performSilentReconciliation(userId);
  }

  /**
   * Limpa canais de tempo real, timers e encerra ouvintes ativos (ex: logout).
   */
  public cleanup() {
    if (this.realtimeChannel) {
      try {
        const supabase = createClient();
        supabase.removeChannel(this.realtimeChannel);
      } catch (err) {
        console.warn('[Realtime] Erro ao remover canal:', err);
      }
      this.realtimeChannel = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
      this.reconciliationInterval = null;
    }
    if (this.activeUserId) {
      this.initializedUserIds.delete(this.activeUserId);
      this.inFlightReconciliation.delete(this.activeUserId);
      this.inFlightPull.delete(this.activeUserId);
    }
    this.activeUserId = null;
    this.activeRealtimeUserId = null;
    this.realtimeStatus = 'DISCONNECTED';
    this.hasPendingSyncRequest = false;
  }

  /**
   * Watchdog leve de segurança:
   * Consulta O(p) exclusivamente na SyncQueue para verificar se existem operações pendentes.
   * Se houver itens na fila e rede disponível, aciona o processamento.
   */
  public async checkWatchdog(userId: string): Promise<void> {
    if (!userId || this.isProcessing) return;

    try {
      const isOnline = networkMonitor.getState().isBackendReachable;
      if (!isOnline) return;

      const queue = await indexedDBStorage.getPendingSyncItems(userId);
      if (queue.length > 0) {
        this.scheduleSync(50);
        return;
      }

      // Safeguard: Verifica se há notas ou pastas no IndexedDB com marcação pendente que não estão na fila
      const [allNotes, allFolders] = await Promise.all([
        indexedDBStorage.getAllNotes(userId),
        indexedDBStorage.getAllFolders(userId),
      ]);
      const unsyncedNotes = allNotes.filter((n) => n.syncRequired || n.needs_sync || n.syncStatus === 'pending');
      const unsyncedFolders = allFolders.filter((f) => f.syncRequired || f.needs_sync || f.syncStatus === 'pending');

      if (unsyncedNotes.length > 0 || unsyncedFolders.length > 0) {
        for (const f of unsyncedFolders) {
          await indexedDBStorage.enqueueSyncItem(userId, {
            action: 'CREATE_FOLDER',
            entity_type: 'folder',
            entity_id: f.id,
            payload: f,
            revision: f.revision || 1,
          });
        }
        for (const n of unsyncedNotes) {
          await indexedDBStorage.enqueueSyncItem(userId, {
            action: 'CREATE_NOTE',
            entity_type: 'note',
            entity_id: n.id,
            payload: n,
            revision: n.revision || 1,
          });
        }
        this.scheduleSync(50);
      }
    } catch {
      // Falha silenciosa no watchdog leve
    }
  }

  /**
   * Verificação silenciosa no IndexedDB local (mantida para compatibilidade).
   */
  public async checkLocalPendingEntities(userId: string): Promise<void> {
    return this.checkWatchdog(userId);
  }

  /**
   * Executa a reconciliação silenciosa (PULL) e saúde do Realtime:
   * 1. Garante que o Realtime esteja conectado.
   * 2. Se houver itens pendentes na fila local elegíveis para PUSH, agenda o processamento da fila.
   * 3. Se o Realtime estiver conectado e saudável, NÃO faz PULL de rotina.
   * 4. Executa PULL incremental apenas quando Realtime estiver desconectado ou em primeira sincronização.
   */
  public async performSilentReconciliation(userId: string): Promise<void> {
    if (!userId || typeof window === 'undefined') return;
    if (!navigator.onLine || !networkMonitor.getState().isBackendReachable || networkMonitor.getIsQuotaExceeded()) return;

    // Mutex / Deduplicação: se já existe reconciliação em andamento para este usuário, reutiliza a Promise
    if (this.inFlightReconciliation.has(userId)) {
      return this.inFlightReconciliation.get(userId)!;
    }

    // Cooldown para evitar rajadas por eventos simultâneos (focus, visibilitychange, online, etc.)
    const now = Date.now();
    if (now - this.lastSuccessfulReconciliation < this.reconciliationCooldownMs) {
      return;
    }

    const task = (async (): Promise<void> => {
      try {
        this.lastReconciliationTime = Date.now();

        // 1. Garante conexão Realtime ativa
        this.ensureRealtimeConnected(userId);

        // 2. Verifica se há mutações locais na fila elegíveis para PUSH imediato
        const queue = await indexedDBStorage.getPendingSyncItems(userId);
        const hasEligiblePush = queue.some((i) => !i.next_retry_at || Date.now() >= i.next_retry_at);

        if (hasEligiblePush) {
          // Se há PUSH local a enviar, agenda o processamento
          this.scheduleSync(50);
          this.lastSuccessfulReconciliation = Date.now();
          return;
        }

        // 3. PULL incremental de reconciliação:
        // O Realtime entrega novos eventos apenas a partir do momento da subscrição.
        // As alterações feitas em outro dispositivo enquanto este esteve fechado/em segundo plano
        // precisam ser recuperadas pelo PULL incremental (gt('updated_at', lastSync)).
        // Se houver qualquer operação remota em andamento para o usuário, não duplica.
        if (remoteOperationGuard.isUserBusy(userId)) {
          this.lastSuccessfulReconciliation = Date.now();
          return;
        }

        if (!this.isProcessing && !this.isPulling) {
          this.isPulling = true;
          try {
            await this.pullIncrementalChanges(userId);
            this.lastSuccessfulReconciliation = Date.now();
          } catch (err) {
            console.warn('[SyncEngine] Falha silenciosa na reconciliação PULL:', err);
          } finally {
            this.isPulling = false;
          }
        }
      } catch (err) {
        console.warn('[SyncEngine] Falha ao verificar fila para reconciliação:', err);
      } finally {
        this.inFlightReconciliation.delete(userId);
      }
    })();

    this.inFlightReconciliation.set(userId, task);
    return task;
  }

  /**
   * Garante que o canal Supabase Realtime esteja conectado e saudável para o usuário.
   */
  public ensureRealtimeConnected(userId: string) {
    if (!isSupabaseConfigured() || !userId || typeof window === 'undefined') return;
    if (networkMonitor.getIsQuotaExceeded()) return;

    if (
      this.realtimeChannel &&
      this.activeRealtimeUserId === userId &&
      (this.realtimeStatus === 'SUBSCRIBED' || this.realtimeStatus === 'CONNECTING')
    ) {
      return;
    }

    this.setupRealtimeSubscription(userId);
  }

  /**
   * Trata reconexão do Supabase Realtime com backoff exponencial e proteção de quota.
   */
  private handleRealtimeReconnect(userId: string) {
    if (this.reconnectTimeout) return;
    if (networkMonitor.getIsQuotaExceeded()) {
      console.log('[Realtime] Reconexão suspensa: Quota de egress excedida.');
      return;
    }

    this.reconnectAttempts++;
    // Backoff exponencial: 5s, 10s, 20s, 40s, até max 120s
    const delay = Math.min(120000, 5000 * Math.pow(1.8, Math.min(this.reconnectAttempts, 6)));
    console.log(`[Realtime] RECONNECT agendado em ${Math.round(delay / 1000)}s (tentativa ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (
        this.activeUserId === userId &&
        (typeof navigator === 'undefined' || navigator.onLine) &&
        !networkMonitor.getIsQuotaExceeded()
      ) {
        this.setupRealtimeSubscription(userId);
        // Só reconcilia se a última foi há mais de 60 segundos
        if (Date.now() - this.lastReconciliationTime > 60000) {
          this.performSilentReconciliation(userId);
        }
      }
    }, delay);
  }

  /**
   * Configura o ouvinte em tempo real (Supabase Realtime) para notes e folders.
   * Garante exatamente 1 canal por userId e reutiliza adequadamente.
   */
  private setupRealtimeSubscription(userId: string) {
    if (!isSupabaseConfigured() || !userId || userId === 'demo-user' || userId === 'local-user' || typeof window === 'undefined') return;
    if (networkMonitor.getIsQuotaExceeded()) return;

    // Se já estiver SUBSCRIBED ou CONNECTING para o mesmo usuário, não cria outro canal
    if (
      this.realtimeChannel &&
      this.activeRealtimeUserId === userId &&
      (this.realtimeStatus === 'SUBSCRIBED' || this.realtimeStatus === 'CONNECTING')
    ) {
      return;
    }

    try {
      const supabase = createClient();
      this.activeRealtimeUserId = userId;
      this.realtimeStatus = 'CONNECTING';

      if (this.realtimeChannel) {
        try {
          supabase.removeChannel(this.realtimeChannel);
        } catch {
          // Ignora se já estiver fechado
        }
        this.realtimeChannel = null;
      }

      // Remove canais órfãos ou duplicados para o mesmo tópico
      const channelName = `user-realtime-${userId}`;
      const existingChannels = (supabase as any).getChannels?.() || [];
      for (const ch of existingChannels) {
        if (ch && (ch.topic === `realtime:${channelName}` || ch.topic === channelName)) {
          try {
            supabase.removeChannel(ch);
          } catch {}
        }
      }

      this.realtimeChannel = supabase
        .channel(channelName)
        .on(
          'postgres_changes' as any,
          {
            event: '*',
            schema: 'public',
            table: 'notes',
            filter: `user_id=eq.${userId}`,
          },
          async (payload: any) => {
            await this.handleRealtimeNoteChange(userId, payload);
          }
        )
        .on(
          'postgres_changes' as any,
          {
            event: '*',
            schema: 'public',
            table: 'folders',
            filter: `user_id=eq.${userId}`,
          },
          async (payload: any) => {
            await this.handleRealtimeFolderChange(userId, payload);
          }
        )
        .on(
          'postgres_changes' as any,
          {
            event: 'INSERT',
            schema: 'public',
            table: 'sync_tombstones',
            filter: `user_id=eq.${userId}`,
          },
          async (payload: any) => {
            await this.handleRealtimeTombstoneChange(userId, payload);
          }
        )
        .subscribe((status: any) => {
          if (status === 'SUBSCRIBED') {
            this.realtimeStatus = 'SUBSCRIBED';
            this.reconnectAttempts = 0; // Reset das tentativas com reconexão bem-sucedida
            console.log('[Realtime] CONNECTED');
            console.log('[Realtime] SUBSCRIBED');
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.realtimeStatus = 'DISCONNECTED';
            console.log(`[Realtime] RECONNECT (${status})`);
            this.handleRealtimeReconnect(userId);
          }
        });
    } catch (err) {
      console.warn('[Realtime] Falha ao configurar canal de tempo real:', err);
      this.realtimeStatus = 'DISCONNECTED';
    }
  }

  /**
   * Trata alterações recebidas em tempo real para a tabela 'notes'.
   * 1. Valida user_id.
   * 2. Verifica se há mutações pendentes locais no IndexedDB (syncRequired = true ou SaveQueue).
   * 3. Compara revisões.
   * 4. Trata conflitos não-destrutivos se necessário.
   * 5. Atualiza o IndexedDB com syncRequired: false e syncStatus: 'synced' (NÃO marca como pendente!).
   */
  private async handleRealtimeNoteChange(userId: string, payload: any) {
    try {
      const { eventType, new: newRecord, old: oldRecord } = payload;
      const noteId = (newRecord && newRecord.id) || (oldRecord && oldRecord.id);
      if (!noteId) return;

      const recordUserId = (newRecord && newRecord.user_id) || (oldRecord && oldRecord.user_id);
      if (recordUserId && recordUserId !== userId) {
        console.warn(`[Realtime] Evento ignorado: user_id diferente do autenticado (${recordUserId} !== ${userId})`);
        return;
      }

      console.log(`[Realtime] REMOTE CHANGE [${eventType}] noteId=${noteId}`);

      // Verifica se a nota possui alterações locais pendentes
      const existingLocalNote = await indexedDBStorage.getNoteById(userId, noteId);
      const pendingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
      const hasQueuePending = pendingQueue.some((q) => q.entity_id === noteId);
      const isSaving = saveQueue.hasPendingSaveForNote(noteId);
      const hasLocalPendingEdits = Boolean(
        existingLocalNote?.syncRequired || existingLocalNote?.needs_sync || hasQueuePending || isSaving
      );

      if (eventType === 'DELETE') {
        console.log(`[Realtime] DELETE noteId=${noteId}`);
        if (hasLocalPendingEdits) {
          console.log(`[Realtime] Nota ${noteId} possui mutações locais pendentes. Preservando estado local.`);
          return;
        }

        if (existingLocalNote) {
          await indexedDBStorage.deleteNote(userId, noteId);
          console.log(`[Realtime] INDEXEDDB UPDATE noteId=${noteId}`);
          networkMonitor.notifyRemoteChange();
          await this.notifyDataSubscribers(userId);
          console.log('[Realtime] UI NOTIFIED');
        }
        return;
      }

      if (eventType === 'INSERT' || eventType === 'UPDATE') {
        if (eventType === 'INSERT') {
          console.log(`[Realtime] INSERT noteId=${noteId}`);
        } else {
          console.log(`[Realtime] UPDATE noteId=${noteId}`);
        }

        const remoteRevision = typeof newRecord.revision === 'number' ? newRecord.revision : 0;
        const localRevision = (existingLocalNote && typeof existingLocalNote.revision === 'number') ? existingLocalNote.revision : 0;

        if (hasLocalPendingEdits) {
          if (localRevision >= remoteRevision) {
            console.log(`[Realtime] Nota ${noteId} possui mutações locais pendentes (${localRevision} >= ${remoteRevision}). Preservando estado local.`);
            return;
          }

          // Conflito com alteração remota superior: cria cópia não-destrutiva de segurança
          const localContent = existingLocalNote?.content || '';
          const remoteContent = newRecord.content || '';
          if (localContent.trim() !== remoteContent.trim()) {
            console.warn(`[Realtime] CONFLICT noteId=${noteId}. Criando backup de conflito não-destrutivo.`);
            await this.handleRealtimeConflict(userId, noteId, existingLocalNote, newRecord);
            networkMonitor.notifyRemoteChange();
            await this.notifyDataSubscribers(userId);
            console.log('[Realtime] UI NOTIFIED');
            return;
          }
        }

        // Se a nota local já existe e possui revisão superior, não regride
        if (existingLocalNote && localRevision > remoteRevision) {
          console.log(`[Realtime] REMOTE CHANGE ignorada: versão local mais recente (${localRevision} > ${remoteRevision})`);
          return;
        }

        // Processa tags normalizadas
        const rawTags = newRecord.tags;
        let noteTags: string[] = [];
        if (Array.isArray(rawTags)) {
          noteTags = normalizeTags(rawTags);
        } else if (typeof rawTags === 'string') {
          try {
            noteTags = normalizeTags(JSON.parse(rawTags));
          } catch {
            noteTags = normalizeTags(rawTags.split(','));
          }
        }

        // Conteúdo da nota
        let finalContent = newRecord.content;
        if (finalContent === undefined || finalContent === null) {
          try {
            const storageMarkdown = await readNoteMarkdown(userId, noteId);
            if (storageMarkdown !== null) {
              const { tags: extractedTags, body } = parseMarkdownWithTags(storageMarkdown);
              finalContent = body;
              if (noteTags.length === 0 && extractedTags.length > 0) {
                noteTags = extractedTags;
              }
            } else {
              finalContent = existingLocalNote?.content || '';
            }
          } catch (err) {
            console.warn(`[Realtime] Aviso ao carregar Markdown do Storage para nota ${noteId}:`, err);
            finalContent = existingLocalNote?.content || '';
          }
        }

        // Se a nota local já possui exatamente os mesmos dados e não tem pendências, evita re-renders desnecessários
        const isIdentical =
          existingLocalNote &&
          existingLocalNote.title === newRecord.title &&
          (existingLocalNote.content || '').trim() === (finalContent || '').trim() &&
          existingLocalNote.folder_id === newRecord.folder_id &&
          existingLocalNote.position === newRecord.position &&
          Boolean(existingLocalNote.is_archived) === Boolean(newRecord.is_archived) &&
          JSON.stringify(existingLocalNote.tags || []) === JSON.stringify(noteTags);

        if (isIdentical && !hasLocalPendingEdits) {
          if ((existingLocalNote.revision || 0) < remoteRevision || existingLocalNote.updated_at !== newRecord.updated_at) {
            await indexedDBStorage.putNote(userId, {
              ...existingLocalNote,
              revision: Math.max(remoteRevision, existingLocalNote.revision || 0),
              updated_at: newRecord.updated_at || existingLocalNote.updated_at,
              syncRequired: false,
              syncStatus: 'synced',
              needs_sync: false,
            });
          }
          return;
        }

        // Salva no IndexedDB como SINCRONIZADO (syncRequired = false, syncStatus = 'synced')
        await indexedDBStorage.putNote(userId, {
          ...newRecord,
          content: finalContent ?? '',
          tags: noteTags,
          position: newRecord.position ?? 0,
          is_archived: Boolean(newRecord.is_archived),
          syncRequired: false,
          syncStatus: 'synced',
          sync_status: 'synced',
          needs_sync: false,
          revision: Math.max(remoteRevision, localRevision),
        });

        console.log(`[Realtime] INDEXEDDB UPDATE noteId=${noteId}`);
        networkMonitor.notifyRemoteChange();
        await this.notifyDataSubscribers(userId);
        console.log('[Realtime] UI NOTIFIED');
      }
    } catch (err) {
      console.error('[Realtime] Erro ao processar evento de nota remota:', err);
    }
  }

  /**
   * Resolução não-destrutiva de conflito em tempo real:
   * Cria uma cópia local de segurança preservando o trabalho do usuário e atualiza a original com a remota.
   */
  private async handleRealtimeConflict(
    userId: string,
    noteId: string,
    localNote: ExtendedNote | null | undefined,
    remoteRecord: any
  ) {
    try {
      const conflictNoteId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `note-conflict-${Date.now()}`;
      const conflictTitle = `[Conflito] ${localNote?.title || remoteRecord?.title || 'Nota'} (Cópia Local)`;
      const conflictContent = localNote?.content || '';
      const conflictTags = localNote?.tags || [];

      // Grava a cópia de segurança no IndexedDB com syncRequired = true
      await indexedDBStorage.putNote(userId, {
        id: conflictNoteId,
        user_id: userId,
        folder_id: localNote?.folder_id || remoteRecord?.folder_id || null,
        title: conflictTitle,
        content: conflictContent,
        position: 0,
        tags: conflictTags,
        is_archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        syncRequired: true,
        syncStatus: 'pending',
        sync_status: 'pending_sync',
        needs_sync: true,
        revision: 1,
      });

      // Enfileira a cópia de conflito na SyncQueue para sincronizar com o Supabase
      await indexedDBStorage.enqueueSyncItem(userId, {
        action: 'CREATE_NOTE',
        entity_type: 'note',
        entity_id: conflictNoteId,
        payload: {
          noteId: conflictNoteId,
          title: conflictTitle,
          folderId: localNote?.folder_id || remoteRecord?.folder_id || null,
          position: 0,
          content: conflictContent,
          tags: conflictTags,
        },
        revision: 1,
      });

      // Atualiza a nota principal com a versão remota convergente
      const rawTags = remoteRecord.tags;
      let remoteTags: string[] = [];
      if (Array.isArray(rawTags)) {
        remoteTags = normalizeTags(rawTags);
      } else if (typeof rawTags === 'string') {
        try {
          remoteTags = normalizeTags(JSON.parse(rawTags));
        } catch {
          remoteTags = normalizeTags(rawTags.split(','));
        }
      }

      await indexedDBStorage.putNote(userId, {
        ...remoteRecord,
        tags: remoteTags,
        is_archived: Boolean(remoteRecord.is_archived),
        syncRequired: false,
        syncStatus: 'synced',
        sync_status: 'synced',
        needs_sync: false,
      });

      console.log(`[Realtime] CONFLICT resolvido com cópia de backup: ${conflictNoteId}`);
    } catch (err) {
      console.error('[Realtime] Erro ao tratar conflito em tempo real:', err);
    }
  }

  /**
   * Trata alterações recebidas em tempo real para a tabela 'folders'.
   */
  private async handleRealtimeFolderChange(userId: string, payload: any) {
    try {
      const { eventType, new: newRecord, old: oldRecord } = payload;
      const folderId = (newRecord && newRecord.id) || (oldRecord && oldRecord.id);
      if (!folderId) return;

      const recordUserId = (newRecord && newRecord.user_id) || (oldRecord && oldRecord.user_id);
      if (recordUserId && recordUserId !== userId) {
        console.warn(`[Realtime] Evento de pasta ignorado: user_id diferente (${recordUserId} !== ${userId})`);
        return;
      }

      console.log(`[Realtime] REMOTE CHANGE [${eventType}] folderId=${folderId}`);

      const existingFolder = await indexedDBStorage.getFolderById(userId, folderId);
      const pendingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
      const hasQueuePending = pendingQueue.some((q) => q.entity_id === folderId);
      const isLocalPending = Boolean(existingFolder?.syncRequired || existingFolder?.needs_sync || hasQueuePending);

      if (isLocalPending) {
        console.log(`[Realtime] Pasta ${folderId} possui mutações locais pendentes. Preservando estado local.`);
        return;
      }

      if (eventType === 'DELETE') {
        console.log(`[Realtime] DELETE folderId=${folderId}`);
        if (existingFolder) {
          await indexedDBStorage.deleteFolder(userId, folderId);
          console.log(`[Realtime] INDEXEDDB UPDATE folderId=${folderId}`);
          networkMonitor.notifyRemoteChange();
          await this.notifyDataSubscribers(userId);
          console.log('[Realtime] UI NOTIFIED');
        }
      } else if (eventType === 'INSERT' || eventType === 'UPDATE') {
        if (eventType === 'INSERT') {
          console.log(`[Realtime] INSERT folderId=${folderId}`);
        } else {
          console.log(`[Realtime] UPDATE folderId=${folderId}`);
        }

        const isIdentical =
          existingFolder &&
          existingFolder.name === newRecord.name &&
          existingFolder.parent_id === newRecord.parent_id &&
          existingFolder.position === newRecord.position &&
          existingFolder.color === newRecord.color &&
          Boolean(existingFolder.is_smart) === Boolean(newRecord.is_smart) &&
          JSON.stringify(existingFolder.smart_tags || []) === JSON.stringify(newRecord.smart_tags || []);

        if (isIdentical && !isLocalPending) {
          const remoteRev = typeof newRecord.revision === 'number' ? newRecord.revision : 0;
          if ((existingFolder.revision || 0) < remoteRev || existingFolder.updated_at !== newRecord.updated_at) {
            await indexedDBStorage.putFolder(userId, {
              ...existingFolder,
              revision: Math.max(remoteRev, existingFolder.revision || 0),
              updated_at: newRecord.updated_at || existingFolder.updated_at,
              syncRequired: false,
              syncStatus: 'synced',
              needs_sync: false,
            });
          }
          return;
        }

        await indexedDBStorage.putFolder(userId, {
          ...newRecord,
          is_smart: Boolean(newRecord.is_smart),
          revision: typeof newRecord.revision === 'number' ? newRecord.revision : 0,
          syncRequired: false,
          syncStatus: 'synced',
          needs_sync: false,
          sync_status: 'synced',
        });

        console.log(`[Realtime] INDEXEDDB UPDATE folderId=${folderId}`);
        networkMonitor.notifyRemoteChange();
        await this.notifyDataSubscribers(userId);
        console.log('[Realtime] UI NOTIFIED');
      }
    } catch (err) {
      console.error('[Realtime] Erro ao processar evento de pasta remota:', err);
    }
  }

  /**
   * Trata evento de tombstone (deleção canônica) recebido em tempo real.
   * Conforme item 3 e 4: exclui a nota ou pasta correspondente do IndexedDB local,
   * desde que não existam mutações locais pendentes válidas.
   */
  private async handleRealtimeTombstoneChange(userId: string, payload: any) {
    try {
      const record = payload?.new;
      if (!record || !record.entity_id || !record.entity_type) return;
      if (record.user_id && record.user_id !== userId) return;

      const entityId = record.entity_id;
      const entityType = record.entity_type;

      console.log(`[Realtime] TOMBSTONE DETECTED type=${entityType} id=${entityId}`);

      const pendingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
      const isPendingInQueue = pendingQueue.some((q) => q.entity_id === entityId);

      if (entityType === 'note') {
        const localNote = await indexedDBStorage.getNoteById(userId, entityId);
        const isSaving = saveQueue.hasPendingSaveForNote(entityId);
        if (localNote && (localNote.syncRequired || localNote.needs_sync || isPendingInQueue || isSaving)) {
          console.log(`[Realtime] Nota ${entityId} possui alterações locais pendentes. Preservando edição local.`);
          return;
        }
        if (localNote) {
          await indexedDBStorage.deleteNote(userId, entityId);
          console.log(`[Realtime] INDEXEDDB DELETE (Tombstone) noteId=${entityId}`);
          networkMonitor.notifyRemoteChange();
          await this.notifyDataSubscribers(userId);
        }
      } else if (entityType === 'folder') {
        const localFolder = await indexedDBStorage.getFolderById(userId, entityId);
        if (localFolder && (localFolder.syncRequired || localFolder.needs_sync || isPendingInQueue)) {
          console.log(`[Realtime] Pasta ${entityId} possui alterações locais pendentes. Preservando edição local.`);
          return;
        }
        if (localFolder) {
          await indexedDBStorage.deleteFolder(userId, entityId);
          console.log(`[Realtime] INDEXEDDB DELETE (Tombstone) folderId=${entityId}`);
          networkMonitor.notifyRemoteChange();
          await this.notifyDataSubscribers(userId);
        }
      }
    } catch (err) {
      console.warn('[Realtime] Erro ao tratar evento de tombstone:', err);
    }
  }

  /**
   * Inscreve um ouvinte para receber notificações sempre que novos dados forem sincronizados.
   */
  public subscribeToData(subscriber: DataSubscriber): () => void {
    this.dataSubscribers.add(subscriber);
    return () => {
      this.dataSubscribers.delete(subscriber);
    };
  }

  /**
   * Notifica todos os ouvintes com os dados mais recentes do IndexedDB.
   */
  public async notifyDataSubscribers(userId: string) {
    if (!userId) return;
    try {
      const localFolders = await indexedDBStorage.getAllFolders(userId);
      const localNotes = await indexedDBStorage.getAllNotes(userId);
      const sortedFolders = localFolders.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const sortedNotes = localNotes.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

      for (const sub of this.dataSubscribers) {
        try {
          sub({ userId, folders: sortedFolders, notes: sortedNotes });
        } catch (err) {
          console.error('[SyncEngine] Erro no data subscriber:', err);
        }
      }
      console.log('[SyncEngine] STATE UPDATE: NOTES REFRESHED');
    } catch (err) {
      console.error('[SyncEngine] Erro ao carregar dados locais para notificar subscribers:', err);
    }
  }

  /**
   * Atualiza o contador de itens pendentes no monitor de rede consultando a SyncQueue (O(p)).
   */
  public async updatePendingCount(userId: string): Promise<number> {
    if (!userId) return 0;
    try {
      const queueCount = await indexedDBStorage.getSyncQueueCount(userId);
      networkMonitor.updatePendingCount(queueCount);
      return queueCount;
    } catch {
      return 0;
    }
  }

  /**
   * Agenda uma sincronização da fila com debounce.
   * Se um processamento já estiver em andamento, sinaliza hasPendingSyncRequest para rodar ao finalizar.
   */
  public scheduleSync(delayMs: number = 300) {
    const targetTime = Date.now() + delayMs;

    if (this.isProcessing) {
      this.hasPendingSyncRequest = true;
      if (this.minNextSyncTime === 0 || targetTime > this.minNextSyncTime) {
        this.minNextSyncTime = targetTime;
      }
      return;
    }

    if (this.syncTimeout) clearTimeout(this.syncTimeout);
    this.syncTimeout = setTimeout(() => {
      this.syncTimeout = null;
      this.minNextSyncTime = 0;
      if (this.activeUserId) {
        this.processQueue(this.activeUserId);
      }
    }, delayMs);
  }

  /**
   * Calcula o tempo de backoff para retentativas baseado no número de tentativas.
   */
  private calculateBackoffDelay(attempts: number): number {
    switch (attempts) {
      case 1:
        return 1000;  // 1s
      case 2:
        return 3000;  // 3s
      case 3:
        return 10000; // 10s
      default:
        return 30000; // 30s
    }
  }

  /**
   * Processa o ciclo completo de sincronização (SyncGuard):
   * 1. PUSH (ACTIVE_SYNC): Processa operações pendentes da SyncQueue (O(p)).
   *    Ativa setSyncing(true) SOMENTE se houver itens elegíveis reais para envio.
   * 2. PULL (BACKGROUND_SYNC): Busca alterações remotas do Supabase e atualiza o IndexedDB de forma silenciosa.
   */
  public async processQueue(userId: string): Promise<{ success: boolean; processed: number }> {
    if (!userId) {
      return { success: false, processed: 0 };
    }

    if (this.isProcessing) {
      this.hasPendingSyncRequest = true;
      return { success: false, processed: 0 };
    }

    this.isProcessing = true;
    this.hasPendingSyncRequest = false;
    let processedCount = 0;
    let didSetActiveSync = false;

    try {
      // 1. Verifica conectividade real antes de processar
      const reachable = await networkMonitor.checkBackendReachability();
      if (!reachable) {
        await this.updatePendingCount(userId);
        return { success: false, processed: 0 };
      }

      const supabase = createClient();

      // 2. Valida sessão de autenticação ativa no Supabase antes de operações remotas
      let authenticatedUid: string | null = null;
      let hasValidSession = false;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user?.id && sessionData?.session?.access_token) {
          authenticatedUid = sessionData.session.user.id;
          hasValidSession = true;
        } else {
          const { data: refreshData } = await supabase.auth.refreshSession();
          if (refreshData?.session?.user?.id && refreshData?.session?.access_token) {
            authenticatedUid = refreshData.session.user.id;
            hasValidSession = true;
          } else {
            const { data: userData } = await supabase.auth.getUser();
            if (userData?.user?.id) {
              authenticatedUid = userData.user.id;
              hasValidSession = true;
            }
          }
        }
      } catch (authErr) {
        console.warn('[SyncEngine] Falha ao verificar autenticação para sync:', authErr);
      }

      if (userId !== 'demo-user') {
        if (!hasValidSession || !authenticatedUid) {
          console.warn(`[AUTH] SESSION_NOT_READY: Sync adiado para userId=${userId}. Aguardando sessão ativa.`);
          await this.updatePendingCount(userId);
          return { success: false, processed: 0 };
        }
        if (authenticatedUid !== userId) {
          console.warn(`[AUTH] USER_MISMATCH: Sync pausado. Autenticado (${authenticatedUid}) diverge do userId local (${userId}).`);
          await this.updatePendingCount(userId);
          return { success: false, processed: 0 };
        }
      }

      console.log(`[SYNC] START userId=${userId}`);
      console.log('[AUTH] SESSION_READY');
      console.log('[AUTH] USER_READY');

      // 1. ETAPA PUSH: Processamento de operações pendentes da SyncQueue (ACTIVE_SYNC)
      const queue = await indexedDBStorage.getPendingSyncItems(userId);
      const now = Date.now();
      const eligibleItems = queue.filter((item) => !item.next_retry_at || now >= item.next_retry_at);

      if (eligibleItems.length > 0) {
        // Ativa indicador visual de sincronização SOMENTE durante PUSH ativo real
        didSetActiveSync = true;
        networkMonitor.setSyncing(true);

        console.log(`[QUEUE] COUNT=${queue.length}, ELIGIBLE=${eligibleItems.length}`);
        const getActionPriority = (action: string) => {
          if (action === 'CREATE_FOLDER') return 0;
          if (action === 'UPDATE_FOLDER') return 1;
          if (action === 'CREATE_NOTE') return 2;
          if (action === 'UPLOAD_ATTACHMENT') return 3;
          if (action === 'UPDATE_NOTE_CONTENT') return 4;
          return 5;
        };
        eligibleItems.sort((a, b) => {
          const prioDiff = getActionPriority(a.action) - getActionPriority(b.action);
          if (prioDiff !== 0) return prioDiff;
          if (a.action === 'CREATE_FOLDER' && b.action === 'CREATE_FOLDER') {
            const aHasParent = (a.payload as any)?.parent_id ? 1 : 0;
            const bHasParent = (b.payload as any)?.parent_id ? 1 : 0;
            return aHasParent - bHasParent;
          }
          return 0;
        });

        console.log(`[SyncEngine] PROCESS: ${eligibleItems.length} OPERATIONS`);

        let earliestRetryAt: number | null = null;

        for (const item of eligibleItems) {
          if (!navigator.onLine) {
            console.warn('[SyncEngine] Conexão interrompida durante o processamento da fila.');
            break;
          }

          await indexedDBStorage.updateSyncItemStatus(userId, item.id, 'processing');

          try {
            const itemSuccess = await this.executeQueueItem(userId, item, authenticatedUid);
            if (itemSuccess) {
              await indexedDBStorage.removeSyncQueueItem(userId, item.id);
              if (item.action === 'UPLOAD_ATTACHMENT') {
                console.log('[ATTACHMENT] QUEUE_REMOVED');
                console.log(`[ATTACHMENT] QUEUE_REMOVED queueId=${item.id}`);
              } else if (item.action === 'CREATE_NOTE' || item.action === 'UPDATE_NOTE_CONTENT') {
                console.log('[NOTE] QUEUE_REMOVED');
                console.log(`[NOTE] QUEUE_REMOVED queueId=${item.id}`);
              }
              processedCount++;
            } else {
              const attempts = (item.attempts || 0) + 1;
              const backoffDelay = this.calculateBackoffDelay(attempts);
              const nextRetryAt = Date.now() + backoffDelay;
              earliestRetryAt = earliestRetryAt === null ? nextRetryAt : Math.min(earliestRetryAt, nextRetryAt);
              const isWaitingAtt = item.action === 'CREATE_NOTE' || item.action === 'UPDATE_NOTE_CONTENT';
              const friendlyErr = isWaitingAtt
                ? 'Aguardando sincronização de anexos pendentes'
                : 'Supabase não confirmou o recebimento da operação';
              await indexedDBStorage.updateSyncItemStatus(
                userId,
                item.id,
                'failed',
                friendlyErr,
                { reason: 'Execução retornou falso', attempts },
                nextRetryAt
              );
            }
          } catch (err: any) {
            const attempts = (item.attempts || 0) + 1;
            const backoffDelay = this.calculateBackoffDelay(attempts);
            const nextRetryAt = Date.now() + backoffDelay;
            earliestRetryAt = earliestRetryAt === null ? nextRetryAt : Math.min(earliestRetryAt, nextRetryAt);
            console.error(`[SyncEngine] Falha ao processar item ${item.id} (${item.action}):`, err);
            const friendlyErr = formatFriendlyErrorMessage(err);
            await indexedDBStorage.updateSyncItemStatus(
              userId,
              item.id,
              'failed',
              friendlyErr,
              {
                message: err?.message || String(err),
                code: err?.code || err?.statusCode || null,
                details: err?.details || null,
                attempts,
              },
              nextRetryAt
            );
            if (err?.name === 'AbortError' || err?.message?.includes('fetch') || err?.message?.includes('network')) {
              break;
            }
          }
        }

        console.log('[SyncEngine] SUCCESS: PUSH COMPLETE');

        if (earliestRetryAt !== null) {
          const delay = Math.max(1000, earliestRetryAt - Date.now());
          this.minNextSyncTime = Math.max(this.minNextSyncTime, Date.now() + delay);
          this.hasPendingSyncRequest = true;
        }

        // Desliga indicador de PUSH imediatamente após envio
        didSetActiveSync = false;
        networkMonitor.setSyncing(false);
      }

      await this.updatePendingCount(userId);

      // 2. ETAPA PULL: PULL incremental pós-processamento SOMENTE se o usuário ainda não tiver nenhuma sincronização prévia
      // e não houver fetch ou pull em andamento. Se Realtime estiver conectado ou lastSync existir, o Realtime cuida disso.
      const lastSync = await indexedDBStorage.getMetadata<string>(userId, 'last_sync_timestamp');
      if (!lastSync && this.realtimeStatus !== 'SUBSCRIBED' && !remoteOperationGuard.isUserBusy(userId)) {
        await this.pullIncrementalChanges(userId);
      }

      return { success: true, processed: processedCount };
    } catch (err) {
      console.error('[SyncEngine] ERROR no processamento da sincronização:', err);
      return { success: false, processed: processedCount };
    } finally {
      this.isProcessing = false;
      if (didSetActiveSync) {
        networkMonitor.setSyncing(false);
      }
      await this.updatePendingCount(userId);

      // Reagendamento seguro com backoff respeitado e sem loops infinitos
      if (this.hasPendingSyncRequest && this.activeUserId) {
        this.hasPendingSyncRequest = false;
        const remainingQueue = await indexedDBStorage.getPendingSyncItems(this.activeUserId);
        const nowAfter = Date.now();
        const hasEligible = remainingQueue.some((i) => !i.next_retry_at || nowAfter >= i.next_retry_at);
        const waitDelay = this.minNextSyncTime > nowAfter ? Math.max(100, this.minNextSyncTime - nowAfter) : (hasEligible ? 100 : 0);
        this.minNextSyncTime = 0;

        if (hasEligible || waitDelay >= 1000) {
          if (this.syncTimeout) clearTimeout(this.syncTimeout);
          this.syncTimeout = setTimeout(() => {
            this.syncTimeout = null;
            if (this.activeUserId) {
              this.processQueue(this.activeUserId);
            }
          }, waitDelay);
        }
      }
    }
  }

  /**
   * Executa uma operação individual da fila no Supabase.
   * Somente marca syncRequired = false após confirmação de sucesso real.
   */
  private async executeQueueItem(
    userId: string,
    item: SyncQueueItem,
    authenticatedUid?: string | null
  ): Promise<boolean> {
    if (!isSupabaseConfigured()) return false;
    const supabase = createClient();

    switch (item.action) {
      case 'CREATE_NOTE': {
        const rawPayload = item.payload as ExtendedNote;
        const noteId = rawPayload.id || item.entity_id;

        // 1. Lê a versão mais atualizada da nota no IndexedDB
        const localNote = await indexedDBStorage.getNoteById(userId, noteId);
        
        // Verifica se a nota foi excluída localmente ou se há um DELETE_NOTE pendente
        const pendingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
        const hasPendingDelete = pendingQueue.some(
          (q) => q.entity_id === noteId && q.action === 'DELETE_NOTE'
        );

        if (!localNote || hasPendingDelete) {
          console.log(`[SyncEngine] CREATE_NOTE descartado para noteId=${noteId} (nota excluída localmente antes do envio)`);
          return true;
        }

        const effectiveNote = localNote || rawPayload;
        const effectiveRevision = Math.max(
          item.revision || 1,
          rawPayload.revision || 1,
          typeof effectiveNote.revision === 'number' ? effectiveNote.revision : 1
        );

        let currentContent = (effectiveNote.content !== undefined && effectiveNote.content !== null)
          ? effectiveNote.content
          : (rawPayload.content || '');
        const noteTags = normalizeTags(effectiveNote.tags || rawPayload.tags || []);
        const noteTitle = effectiveNote.title || rawPayload.title || 'Nova nota';

        // 2. Detecta se há anexos locais pendentes ou referências não resolvidas
        let hasPendingAttachments = false;
        const attachmentRefs = extractAttachmentReferences(currentContent);
        if (attachmentRefs.length > 0) {
          for (const attId of attachmentRefs) {
            const att = await indexedDBStorage.getAttachment(userId, attId);
            if (!att || att.syncStatus !== 'synced' || !att.remote_url) {
              hasPendingAttachments = true;
              break;
            }
          }
        }

        if (!hasPendingAttachments && hasUnresolvedLocalMedia(currentContent)) {
          hasPendingAttachments = true;
        }

        let contentToSend = '';

        if (hasPendingAttachments) {
          // Quando houver referências locais de anexos ainda não sincronizados:
          // - NÃO deve falhar.
          // - NÃO deve ficar esperando o anexo.
          // - NÃO deve tentar gravar attachment:// no Supabase.
          // - Cria a nota no Supabase com conteúdo temporariamente seguro ('').
          // - O conteúdo completo continua 100% preservado no IndexedDB local.
          contentToSend = '';
          console.log(`[NOTE] CREATE_NOTE noteId=${noteId}: criando registro no Supabase com conteúdo vazio temporário para viabilizar UPLOAD_ATTACHMENT`);
        } else {
          // Quando NÃO houver anexos pendentes: prepara e valida o conteúdo normalmente
          const { preparedContent, allResolved } = await prepareNoteContentForPersistence(
            userId,
            noteId,
            currentContent
          );

          if (allResolved) {
            if (localNote && localNote.content !== preparedContent) {
              localNote.content = preparedContent;
              await indexedDBStorage.putNote(userId, localNote);
            }
            contentToSend = preparedContent;
          } else {
            contentToSend = '';
          }

          // Validação: Nenhuma referência transitória ou Base64 permitida
          const validation = validateNoteContentForRemotePersistence(contentToSend);
          if (!validation.valid || hasUnresolvedLocalMedia(contentToSend)) {
            contentToSend = '';
          }
        }

        console.log(`[NOTE] READY_TO_SYNC noteId=${noteId}`);
        console.log(`[NOTE] CONTENT PERSIST START noteId=${noteId} revision=${effectiveRevision}`);

        // Garante preventivamente que a pasta exista no Supabase antes de vincular a nota
        if (effectiveNote.folder_id) {
          await this.ensureFolderSyncedToSupabase(supabase, userId, effectiveNote.folder_id);
        }

        // 3. Grava na tabela notes (idempotente via upsert com mesmo noteId)
        const notePayload: Record<string, any> = {
          id: noteId,
          user_id: userId,
          folder_id: effectiveNote.folder_id || null,
          title: noteTitle,
          content: contentToSend,
          position: effectiveNote.position ?? 0,
          tags: noteTags,
          is_archived: Boolean(effectiveNote.is_archived),
          previous_folder_id: effectiveNote.previous_folder_id || null,
          revision: effectiveRevision,
          workspace_type: effectiveNote.workspace_type || 'notes',
          entry_date: effectiveNote.entry_date || null,
          diary_year: effectiveNote.diary_year !== undefined ? effectiveNote.diary_year : null,
          diary_month: effectiveNote.diary_month !== undefined ? effectiveNote.diary_month : null,
          diary_day: effectiveNote.diary_day !== undefined ? effectiveNote.diary_day : null,
          created_at: effectiveNote.created_at || new Date().toISOString(),
          updated_at: effectiveNote.updated_at || new Date().toISOString(),
        };

        let { error: upsertError } = await supabase.from('notes').upsert(notePayload);

        // Tratamento de violação de Foreign Key (notes_folder_id_fkey / code 23503)
        if (
          upsertError &&
          (upsertError.code === '23503' ||
            (upsertError.message && upsertError.message.includes('notes_folder_id_fkey')))
        ) {
          console.warn(`[SyncEngine] Violação de chave estrangeira (notes_folder_id_fkey) para nota ${noteId}. Tentando recuperar pasta ${notePayload.folder_id}...`);
          let resolved = false;
          if (notePayload.folder_id) {
            resolved = await this.ensureFolderSyncedToSupabase(supabase, userId, notePayload.folder_id);
            if (resolved) {
              const retryWithFolder = await supabase.from('notes').upsert(notePayload);
              upsertError = retryWithFolder.error;
            }
          }
          // Se ainda falhar (pasta não existe remotamente nem no IndexedDB), salvar com folder_id = null para nunca perder dados do usuário
          if (
            upsertError &&
            (upsertError.code === '23503' ||
              (upsertError.message && upsertError.message.includes('notes_folder_id_fkey')))
          ) {
            console.warn(`[SyncEngine] Pasta id=${notePayload.folder_id} inacessível no Supabase. Persistindo nota ${noteId} com folder_id=null para preservar dados.`);
            notePayload.folder_id = null;
            const retryNoFolder = await supabase.from('notes').upsert(notePayload);
            upsertError = retryNoFolder.error;
          }
        }

        // Fallback defensivo: se colunas novas ainda não existirem no Supabase, tenta sem elas
        if (upsertError && upsertError.message && (upsertError.message.includes('column') || upsertError.message.includes('schema cache'))) {
          delete notePayload.workspace_type;
          delete notePayload.entry_date;
          delete notePayload.diary_year;
          delete notePayload.diary_month;
          delete notePayload.diary_day;
          const retry = await supabase.from('notes').upsert(notePayload);
          upsertError = retry.error;
        }

        if (upsertError) {
          console.error(`[NOTE] PERSIST ERROR noteId=${noteId}:`, upsertError.message || upsertError);
          throw upsertError;
        }

        // 4. Grava .md canônico no Supabase Storage se o conteúdo final estiver disponível
        if (!hasPendingAttachments && contentToSend) {
          try {
            const fullMarkdown = serializeMarkdownWithTags(contentToSend, noteTags);
            await writeNoteMarkdown(userId, noteId, fullMarkdown);
          } catch (storageErr) {
            console.warn(`[SyncEngine] Aviso ao gravar Markdown no Storage para nota ${noteId}:`, storageErr);
          }
        }

        console.log(`[NOTE] CONTENT PERSIST SUCCESS noteId=${noteId}`);

        // Sincroniza tags associadas
        try {
          await this.syncTagsWithSupabase(supabase, userId, noteId, noteTags);
        } catch (tagErr) {
          console.warn('[SyncEngine] Aviso ao sincronizar tags:', tagErr);
        }

        // 5. Marca a nota como sincronizada APENAS em relação ao CREATE_NOTE
        if (!hasPendingAttachments) {
          // Sem anexos pendentes: a nota pode ser marcada como totalmente sincronizada
          await indexedDBStorage.markNoteSynced(userId, noteId, effectiveRevision);
          console.log(`[NOTE] SYNC_SUCCESS noteId=${noteId}`);
          console.log(`[NOTE] SYNC CONFIRMED noteId=${noteId} revision=${effectiveRevision}`);

          // Elimina operações redundantes de UPDATE_NOTE_CONTENT já consolidadas neste CREATE_NOTE
          const remainingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
          for (const q of remainingQueue) {
            if (
              q.entity_id === noteId &&
              q.action === 'UPDATE_NOTE_CONTENT' &&
              (typeof q.revision === 'number' ? q.revision <= effectiveRevision : true)
            ) {
              console.log(`[SyncEngine] Removendo UPDATE_NOTE_CONTENT redundante (id=${q.id}) já consolidado no CREATE_NOTE`);
              await indexedDBStorage.removeSyncQueueItem(userId, q.id);
            }
          }
        } else {
          // Com anexos pendentes:
          // O CREATE_NOTE foi concluído com sucesso no Supabase (FK satisfeita para note_attachments),
          // mas a nota NÃO é considerada totalmente sincronizada no IndexedDB.
          // O conteúdo completo local permanece intacto no IndexedDB.
          console.log(`[NOTE] CREATE_NOTE_PARTIAL noteId=${noteId}: registro remoto criado; aguardando upload dos anexos`);
          const remainingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
          const hasUpdateInQueue = remainingQueue.some(
            (q) => q.entity_id === noteId && q.action === 'UPDATE_NOTE_CONTENT'
          );
          if (!hasUpdateInQueue) {
            await indexedDBStorage.enqueueSyncItem(userId, {
              action: 'UPDATE_NOTE_CONTENT',
              entity_type: 'note',
              entity_id: noteId,
              payload: {
                noteId,
                content: currentContent,
                tags: noteTags,
                revision: effectiveRevision,
              },
              revision: effectiveRevision,
            });
          }
        }

        return true;
      }

      case 'UPDATE_NOTE_CONTENT': {
        const { noteId, content: rawPayloadContent, tags: rawPayloadTags, baseUpdatedAt, revision: payloadRevision } = item.payload;

        // 1. Lê a versão viva mais recente do IndexedDB
        const localNote = await indexedDBStorage.getNoteById(userId, noteId);
        const revision = payloadRevision || item.revision || (localNote?.revision || 1);

        let content = (localNote && localNote.content !== undefined && localNote.content !== null)
          ? localNote.content
          : (rawPayloadContent || '');
        const cleanTags = normalizeTags((localNote && localNote.tags) || rawPayloadTags || []);

        // 2. Prepara e migra mídias/anexos locais ANTES de persistir no Supabase
        const attachmentRefs = extractAttachmentReferences(content);
        if (attachmentRefs.length > 0) {
          for (const attId of attachmentRefs) {
            const att = await indexedDBStorage.getAttachment(userId, attId);
            if (!att || att.syncStatus !== 'synced' || !att.remote_url) {
              console.log(`[NOTE] WAITING_FOR_ATTACHMENT noteId=${noteId} pendingAttachmentId=${attId}`);
              return false; // Permanece na fila aguardando sincronização do anexo
            }
          }
        }

        const { preparedContent, allResolved } = await prepareNoteContentForPersistence(
          userId,
          noteId,
          content
        );

        if (!allResolved) {
          console.warn(`[NOTE] WAITING_FOR_ATTACHMENT noteId=${noteId}: UPDATE_NOTE_CONTENT abortado pois há anexos locais ainda não resolvidos`);
          return false;
        }

        if (localNote && localNote.content !== preparedContent) {
          localNote.content = preparedContent;
          await indexedDBStorage.putNote(userId, localNote);
        }

        // Validação Absoluta: Nenhuma referência transitória ou Base64 permitida
        const validation = validateNoteContentForRemotePersistence(preparedContent);
        if (!validation.valid || hasUnresolvedLocalMedia(preparedContent)) {
          console.error(`[NOTE] PERSIST ERROR noteId=${noteId}: UPDATE_NOTE_CONTENT abortado pois o conteúdo ainda possui referências não resolvidas: ${validation.errors.join('; ')}`);
          return false;
        }

        console.log(`[NOTE] READY_TO_SYNC noteId=${noteId}`);

        // 3. Verificação de Conflito com a versão no Supabase
        const { data: remoteNote, error: fetchErr } = await supabase
          .from('notes')
          .select('id, user_id, updated_at, revision, content, title, folder_id')
          .eq('id', noteId)
          .eq('user_id', userId)
          .maybeSingle();

        if (!fetchErr && remoteNote) {
          const remoteUpdatedAt = new Date(remoteNote.updated_at).getTime();
          const localBaseUpdatedAt = baseUpdatedAt ? new Date(baseUpdatedAt).getTime() : 0;
          const remoteRevision = typeof remoteNote.revision === 'number' ? remoteNote.revision : 0;

          // Se o servidor possui revisão superior à base da edição e conteúdo divergente -> Conflito
          if (
            remoteRevision > revision &&
            remoteUpdatedAt > localBaseUpdatedAt + 1000 &&
            remoteNote.content &&
            remoteNote.content.trim() !== (preparedContent || '').trim()
          ) {
            console.warn(`[SyncGuard] Conflito detectado na nota ${noteId}. Preservando ambas as versões de forma não-destrutiva.`);

            const conflictNoteId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `note-conflict-${Date.now()}`;
            const conflictTitle = `[Conflito] ${remoteNote.title || 'Nota'} (Cópia Local)`;

            // Grava cópia no Supabase
            const conflictMarkdown = serializeMarkdownWithTags(preparedContent, cleanTags);
            await writeNoteMarkdown(userId, conflictNoteId, conflictMarkdown);
            await supabase.from('notes').insert({
              id: conflictNoteId,
              user_id: userId,
              folder_id: remoteNote.folder_id || null,
              title: conflictTitle,
              content: preparedContent,
              position: 0,
              tags: cleanTags,
              revision: 1,
              is_archived: false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

            // Atualiza o IndexedDB com a nota de conflito
            await indexedDBStorage.putNote(userId, {
              id: conflictNoteId,
              user_id: userId,
              folder_id: remoteNote.folder_id || null,
              title: conflictTitle,
              content: preparedContent,
              position: 0,
              tags: cleanTags,
              is_archived: false,
              revision: 1,
              syncRequired: false,
              syncStatus: 'synced',
              needs_sync: false,
              sync_status: 'synced',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

            // Atualiza a nota original local com o conteúdo do servidor para convergir
            await indexedDBStorage.putNote(userId, {
              ...remoteNote,
              user_id: userId,
              syncRequired: false,
              syncStatus: 'synced',
              sync_status: 'synced',
              needs_sync: false,
              tags: Array.isArray(remoteNote.tags) ? remoteNote.tags : [],
            });

            console.log(`[NOTE] CONTENT PERSIST SUCCESS (Conflict Handled) noteId=${noteId}`);
            return true;
          }
        }

        console.log(`[NOTE] CONTENT PERSIST START noteId=${noteId} revision=${revision}`);

        let remotePersisted = false;

        // Se a nota já existe remotamente, tenta o UPDATE
        if (remoteNote) {
          const { data: updatedRows, error: updateErr } = await supabase
            .from('notes')
            .update({
              content: preparedContent,
              tags: cleanTags,
              revision: revision,
              updated_at: new Date().toISOString(),
            })
            .eq('id', noteId)
            .eq('user_id', userId)
            .select('id');

          if (updateErr) {
            console.error(`[NOTE] PERSIST ERROR noteId=${noteId}:`, updateErr.message || updateErr);
            throw updateErr;
          }

          if (updatedRows && updatedRows.length > 0) {
            remotePersisted = true;
          }
        }

        // Se a nota não existia remotamente ou o UPDATE não afetou nenhuma linha (ex: criada offline), realiza UPSERT completo
        if (!remotePersisted) {
          console.log(`[NOTE] Nota não encontrada remotamente para UPDATE. Executando UPSERT canônico noteId=${noteId}`);
          if (localNote?.folder_id) {
            await this.ensureFolderSyncedToSupabase(supabase, userId, localNote.folder_id);
          }

          const notePayload: Record<string, any> = {
            id: noteId,
            user_id: userId,
            folder_id: localNote?.folder_id || null,
            title: localNote?.title || 'Nova nota',
            content: preparedContent,
            position: localNote?.position ?? 0,
            tags: cleanTags,
            is_archived: Boolean(localNote?.is_archived),
            previous_folder_id: localNote?.previous_folder_id || null,
            revision: revision,
            workspace_type: localNote?.workspace_type || 'notes',
            entry_date: localNote?.entry_date || null,
            diary_year: localNote?.diary_year !== undefined ? localNote.diary_year : null,
            diary_month: localNote?.diary_month !== undefined ? localNote.diary_month : null,
            diary_day: localNote?.diary_day !== undefined ? localNote.diary_day : null,
            created_at: localNote?.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          let { error: upsertErr } = await supabase.from('notes').upsert(notePayload);

          if (upsertErr && (upsertErr.code === '23503' || upsertErr.message?.includes('notes_folder_id_fkey'))) {
            console.warn(`[SyncEngine] Chave estrangeira de pasta inválida para nota ${noteId}. Reatribuindo para raiz (null)`);
            notePayload.folder_id = null;
            const retry = await supabase.from('notes').upsert(notePayload);
            upsertErr = retry.error;
          }

          if (upsertErr && upsertErr.message && (upsertErr.message.includes('column') || upsertErr.message.includes('schema cache'))) {
            delete notePayload.workspace_type;
            delete notePayload.entry_date;
            delete notePayload.diary_year;
            delete notePayload.diary_month;
            delete notePayload.diary_day;
            const retry = await supabase.from('notes').upsert(notePayload);
            upsertErr = retry.error;
          }

          if (upsertErr) {
            console.error(`[NOTE] PERSIST UPSERT ERROR noteId=${noteId}:`, upsertErr.message || upsertErr);
            throw upsertErr;
          }
        }

        // Grava arquivo .md no Supabase Storage se disponível (não-bloqueante)
        try {
          const fullMarkdown = serializeMarkdownWithTags(preparedContent, cleanTags);
          await writeNoteMarkdown(userId, noteId, fullMarkdown);
        } catch (storageErr) {
          console.warn(`[NOTE] Aviso ao gravar Markdown no Storage para nota ${noteId}:`, storageErr);
        }

        try {
          await this.syncTagsWithSupabase(supabase, userId, noteId, cleanTags);
        } catch (tagErr) {
          console.warn('[SyncEngine] Aviso ao sincronizar tags:', tagErr);
        }

        console.log(`[NOTE] CONTENT PERSIST SUCCESS noteId=${noteId}`);

        // Marca como sincronizado no IndexedDB APENAS após confirmação remota
        await indexedDBStorage.markNoteSynced(userId, noteId, revision);
        console.log(`[NOTE] SYNC_SUCCESS noteId=${noteId}`);
        console.log(`[NOTE] SYNC CONFIRMED noteId=${noteId} revision=${revision}`);
        return true;
      }

      case 'UPDATE_NOTE': {
        const { noteId, updates } = item.payload;
        const revision = item.revision || 1;
        const { error } = await supabase
          .from('notes')
          .update({
            ...updates,
            revision,
            updated_at: new Date().toISOString(),
          })
          .eq('id', noteId)
          .eq('user_id', userId);

        if (error) {
          console.error(`[SyncGuard] PUSH ERROR noteId=${noteId}:`, error.message || error);
          throw error;
        }

        await indexedDBStorage.markNoteSynced(userId, noteId, revision);
        console.log(`[SyncGuard] MARK SYNCED noteId=${noteId} revision=${revision}`);
        return true;
      }

      case 'DELETE_NOTE': {
        const noteId = item.entity_id;
        const workspaceType = item.payload?.workspace_type || 'notes';

        // 1. Registra tombstone no Supabase
        try {
          await supabase.from('sync_tombstones').insert({
            user_id: userId,
            entity_type: 'note',
            entity_id: noteId,
            workspace_type: workspaceType,
            deleted_at: new Date().toISOString(),
          });
        } catch (tombErr) {
          console.warn('[SyncEngine] Falha ao registrar tombstone de nota:', tombErr);
        }

        // 2. Remove o arquivo markdown do Storage
        try {
          await deleteNoteMarkdown(userId, noteId);
        } catch (mdErr) {
          console.warn('[SyncEngine] Falha ao remover markdown no storage:', mdErr);
        }

        // 3. Exclui a nota da tabela notes
        const { error } = await supabase
          .from('notes')
          .delete()
          .eq('id', noteId)
          .eq('user_id', userId);

        if (error) throw error;
        return true;
      }

      case 'MOVE_NOTE': {
        const { noteId, newFolderId, newPosition } = item.payload;
        const revision = item.revision || 1;
        if (newFolderId) {
          await this.ensureFolderSyncedToSupabase(supabase, userId, newFolderId);
        }
        let { error } = await supabase
          .from('notes')
          .update({
            folder_id: newFolderId,
            position: newPosition,
            revision,
            updated_at: new Date().toISOString(),
          })
          .eq('id', noteId)
          .eq('user_id', userId);

        if (error && (error.code === '23503' || (error.message && error.message.includes('notes_folder_id_fkey')))) {
          console.warn(`[SyncEngine] MOVE_NOTE falhou por chave estrangeira da pasta ${newFolderId}. Tentando sincronizar pasta...`);
          const synced = newFolderId ? await this.ensureFolderSyncedToSupabase(supabase, userId, newFolderId) : false;
          if (synced) {
            const retry = await supabase
              .from('notes')
              .update({
                folder_id: newFolderId,
                position: newPosition,
                revision,
                updated_at: new Date().toISOString(),
              })
              .eq('id', noteId)
              .eq('user_id', userId);
            error = retry.error;
          }
          if (error && (error.code === '23503' || (error.message && error.message.includes('notes_folder_id_fkey')))) {
            const fallbackRetry = await supabase
              .from('notes')
              .update({
                folder_id: null,
                position: newPosition,
                revision,
                updated_at: new Date().toISOString(),
              })
              .eq('id', noteId)
              .eq('user_id', userId);
            error = fallbackRetry.error;
          }
        }

        if (error) throw error;
        await indexedDBStorage.markNoteSynced(userId, noteId, revision);
        console.log(`[SyncGuard] MARK SYNCED noteId=${noteId} revision=${revision}`);
        return true;
      }

      case 'ARCHIVE_NOTE': {
        const { noteId, previousFolderId } = item.payload;
        const revision = item.revision || 1;
        const { error } = await supabase
          .from('notes')
          .update({
            is_archived: true,
            previous_folder_id: previousFolderId,
            folder_id: null,
            revision,
            updated_at: new Date().toISOString(),
          })
          .eq('id', noteId)
          .eq('user_id', userId);

        if (error) throw error;
        await indexedDBStorage.markNoteSynced(userId, noteId, revision);
        console.log(`[SyncGuard] MARK SYNCED noteId=${noteId} revision=${revision}`);
        return true;
      }

      case 'UNARCHIVE_NOTE': {
        const { noteId, destinationFolderId } = item.payload;
        const revision = item.revision || 1;
        if (destinationFolderId) {
          await this.ensureFolderSyncedToSupabase(supabase, userId, destinationFolderId);
        }
        let { error } = await supabase
          .from('notes')
          .update({
            is_archived: false,
            folder_id: destinationFolderId,
            previous_folder_id: null,
            revision,
            updated_at: new Date().toISOString(),
          })
          .eq('id', noteId)
          .eq('user_id', userId);

        if (error && (error.code === '23503' || (error.message && error.message.includes('notes_folder_id_fkey')))) {
          const synced = destinationFolderId ? await this.ensureFolderSyncedToSupabase(supabase, userId, destinationFolderId) : false;
          if (synced) {
            const retry = await supabase
              .from('notes')
              .update({
                is_archived: false,
                folder_id: destinationFolderId,
                previous_folder_id: null,
                revision,
                updated_at: new Date().toISOString(),
              })
              .eq('id', noteId)
              .eq('user_id', userId);
            error = retry.error;
          }
          if (error && (error.code === '23503' || (error.message && error.message.includes('notes_folder_id_fkey')))) {
            const retryNoFolder = await supabase
              .from('notes')
              .update({
                is_archived: false,
                folder_id: null,
                previous_folder_id: null,
                revision,
                updated_at: new Date().toISOString(),
              })
              .eq('id', noteId)
              .eq('user_id', userId);
            error = retryNoFolder.error;
          }
        }

        if (error) throw error;
        await indexedDBStorage.markNoteSynced(userId, noteId, revision);
        console.log(`[SyncGuard] MARK SYNCED noteId=${noteId} revision=${revision}`);
        return true;
      }

      case 'CREATE_FOLDER': {
        const folder = item.payload as ExtendedFolder;
        const folderId = folder.id || item.entity_id;
        const revision = item.revision || folder.revision || 1;

        const folderPayload: Record<string, any> = {
          id: folderId,
          user_id: userId,
          name: folder.name || 'Nova pasta',
          parent_id: folder.parent_id || null,
          position: folder.position ?? 0,
          color: folder.color || null,
          is_smart: Boolean(folder.is_smart),
          smart_tags: folder.smart_tags || [],
          revision,
          workspace_type: folder.workspace_type || 'notes',
          diary_year: folder.diary_year !== undefined ? folder.diary_year : null,
          diary_month: folder.diary_month !== undefined ? folder.diary_month : null,
          created_at: folder.created_at || new Date().toISOString(),
          updated_at: folder.updated_at || new Date().toISOString(),
        };

        let { error } = await supabase.from('folders').upsert(folderPayload);

        // Fallback defensivo: se colunas novas ainda não existirem no Supabase, tenta sem elas
        if (error && error.message && (error.message.includes('column') || error.message.includes('schema cache'))) {
          delete folderPayload.workspace_type;
          delete folderPayload.diary_year;
          delete folderPayload.diary_month;
          const retry = await supabase.from('folders').upsert(folderPayload);
          error = retry.error;
        }

        if (error) {
          console.error(`[SyncGuard] PUSH ERROR folderId=${folderId}:`, error.message || error);
          throw error;
        }

        await indexedDBStorage.markFolderSynced(userId, folderId, revision);
        console.log(`[SyncGuard] MARK SYNCED folderId=${folderId} revision=${revision}`);
        return true;
      }

      case 'UPDATE_FOLDER': {
        const { folderId, updates } = item.payload;
        const revision = item.revision || 1;
        const { error } = await supabase
          .from('folders')
          .update({
            ...updates,
            revision,
            updated_at: new Date().toISOString(),
          })
          .eq('id', folderId)
          .eq('user_id', userId);

        if (error) {
          console.error(`[SyncGuard] PUSH ERROR folderId=${folderId}:`, error.message || error);
          throw error;
        }

        await indexedDBStorage.markFolderSynced(userId, folderId, revision);
        console.log(`[SyncGuard] MARK SYNCED folderId=${folderId} revision=${revision}`);
        return true;
      }

      case 'DELETE_FOLDER': {
        const folderId = item.entity_id;
        const workspaceType = item.payload?.workspace_type || 'notes';

        // 1. Registra tombstone no Supabase
        try {
          await supabase.from('sync_tombstones').insert({
            user_id: userId,
            entity_type: 'folder',
            entity_id: folderId,
            workspace_type: workspaceType,
            deleted_at: new Date().toISOString(),
          });
        } catch (tombErr) {
          console.warn('[SyncEngine] Falha ao registrar tombstone de pasta:', tombErr);
        }

        // 2. Exclui a pasta da tabela folders
        const { error } = await supabase
          .from('folders')
          .delete()
          .eq('id', folderId)
          .eq('user_id', userId);

        if (error) throw error;
        return true;
      }

      case 'MOVE_FOLDER': {
        const { folderId, newParentId, newPosition } = item.payload;
        const revision = item.revision || 1;
        const { error } = await supabase
          .from('folders')
          .update({
            parent_id: newParentId,
            position: newPosition,
            revision,
            updated_at: new Date().toISOString(),
          })
          .eq('id', folderId)
          .eq('user_id', userId);

        if (error) throw error;
        await indexedDBStorage.markFolderSynced(userId, folderId, revision);
        console.log(`[SyncGuard] MARK SYNCED folderId=${folderId} revision=${revision}`);
        return true;
      }

      case 'UPDATE_TAGS': {
        const { noteId, tags } = item.payload;
        const cleanTags = normalizeTags(tags || []);
        await this.syncTagsWithSupabase(supabase, userId, noteId, cleanTags);
        return true;
      }

      case 'UPLOAD_ATTACHMENT': {
        const attachmentId = item.entity_id;
        const noteId = item.payload?.noteId || null;

        if (authenticatedUid && userId !== 'demo-user' && authenticatedUid !== userId) {
          console.error(`[ATTACHMENT] UPLOAD_ERROR attachmentId=${attachmentId} error="Auth mismatch itemUserId=${userId} authUid=${authenticatedUid}"`);
          return false;
        }

        console.log(`[ATTACHMENT] PROCESSING attachmentId=${attachmentId}`);

        if (this.uploadingAttachments.has(attachmentId)) {
          console.log(`[ATTACHMENT] UPLOAD ALREADY IN FLIGHT attachmentId=${attachmentId}`);
          return false;
        }

        this.uploadingAttachments.add(attachmentId);

        try {
          const attachment = await indexedDBStorage.getAttachment(userId, attachmentId);
          if (!attachment) {
            console.error(`[ATTACHMENT] UPLOAD_ERROR attachmentId=${attachmentId} error="Attachment not found in IndexedDB"`);
            return false;
          }

          const targetNoteId = attachment.note_id || noteId;

          if (attachment.syncStatus === 'synced' && attachment.remote_url) {
            console.log(`[ATTACHMENT] ALREADY_SYNCED attachmentId=${attachmentId} remoteUrl="${attachment.remote_url}"`);
            // Se o anexo já está sincronizado, garante que as referências locais na nota sejam substituídas e a sincronização prossiga
            if (targetNoteId) {
              const note = await indexedDBStorage.getNoteById(userId, targetNoteId);
              if (note && note.content) {
                const canonicalRefRegex = new RegExp(`attachment://${attachmentId}`, 'g');
                const localRefRegex = new RegExp(`local-attachment://${attachmentId}`, 'g');
                if (canonicalRefRegex.test(note.content) || localRefRegex.test(note.content)) {
                  let updatedContent = note.content
                    .replace(canonicalRefRegex, attachment.remote_url)
                    .replace(localRefRegex, attachment.remote_url);
                  if (attachment.data_url && updatedContent.includes(attachment.data_url)) {
                    updatedContent = updatedContent.split(attachment.data_url).join(attachment.remote_url);
                  }
                  note.content = updatedContent;
                  await indexedDBStorage.putNote(userId, note);
                  replaceAttachmentReferencesInEditor(targetNoteId, { [attachmentId]: attachment.remote_url });
                }
              }
              this.scheduleSync(10);
            }
            return true;
          }

          if (!attachment.blob) {
            console.error(`[ATTACHMENT] UPLOAD_ERROR attachmentId=${attachmentId} error="Blob missing in IndexedDB"`);
            return false;
          }

          // Executa upload físico via kernel central desacoplado
          const result = await uploadAttachmentBinary(userId, attachment, supabase);
          if (!result.success || !result.remoteUrl) {
            throw result.error || new Error('Upload falhou sem confirmação de URL remota');
          }

          const remoteUrl = result.remoteUrl;
          const storagePath = result.storagePath;

          // 4. Atualiza anexo local no IndexedDB com syncRequired = false e syncStatus = 'synced'
          attachment.remote_url = remoteUrl;
          attachment.storage_path = storagePath;
          attachment.syncRequired = false;
          attachment.syncStatus = 'synced';
          attachment.sync_status = 'synced';
          if (targetNoteId && !attachment.note_id) {
            attachment.note_id = targetNoteId;
          }
          await indexedDBStorage.putAttachment(userId, attachment);
          console.log(`[ATTACHMENT] SYNCED attachmentId=${attachmentId}`);
          console.log(`[ATTACHMENT] MARKED_SYNCED attachmentId=${attachmentId}`);

          // 5. Se o anexo estiver associado a uma nota, substitui referências locais no Markdown
          if (targetNoteId) {
            const note = await indexedDBStorage.getNoteById(userId, targetNoteId);
            if (note && note.content) {
              let updatedContent = note.content;

              const canonicalRefRegex = new RegExp(`attachment://${attachmentId}`, 'g');
              const localRefRegex = new RegExp(`local-attachment://${attachmentId}`, 'g');
              updatedContent = updatedContent.replace(canonicalRefRegex, remoteUrl);
              updatedContent = updatedContent.replace(localRefRegex, remoteUrl);

              if (attachment.data_url && updatedContent.includes(attachment.data_url)) {
                updatedContent = updatedContent.split(attachment.data_url).join(remoteUrl);
              }

              if (updatedContent !== note.content) {
                console.log(`[ATTACHMENT] REPLACED REFS noteId=${targetNoteId} attachmentId=${attachmentId} remoteUrl="${remoteUrl}"`);
                note.content = updatedContent;
                await indexedDBStorage.putNote(userId, note);

                // Notifica o editor Tiptap ativo sem recriar o documento
                replaceAttachmentReferencesInEditor(targetNoteId, { [attachmentId]: remoteUrl });
              }

              // Valida se NÃO resta NENHUM outro anexo pendente (attachment://, local-attachment://, blob: ou Base64)
              const remainingRefs = extractAttachmentReferences(note.content);
              let allAttachmentsResolved = true;

              if (remainingRefs.length > 0) {
                for (const remainingId of remainingRefs) {
                  const remAtt = await indexedDBStorage.getAttachment(userId, remainingId);
                  if (!remAtt || remAtt.syncStatus !== 'synced' || !remAtt.remote_url) {
                    allAttachmentsResolved = false;
                    break;
                  }
                }
              }

              if (allAttachmentsResolved && !hasUnresolvedLocalMedia(note.content)) {
                const validation = validateNoteContentForRemotePersistence(note.content);
                if (validation.valid) {
                  console.log(`[NOTE] ALL_ATTACHMENTS_RESOLVED noteId=${targetNoteId}: sincronizando conteúdo definitivo no Supabase`);
                  const cleanTags = normalizeTags(note.tags || []);
                  const effectiveRevision = typeof note.revision === 'number' ? note.revision : 1;

                  // Atualiza .md canônico no Supabase Storage
                  try {
                    const fullMarkdown = serializeMarkdownWithTags(note.content, cleanTags);
                    await writeNoteMarkdown(userId, targetNoteId, fullMarkdown);
                  } catch (storageErr) {
                    console.warn(`[SyncEngine] Erro ao atualizar Markdown no Storage para nota ${targetNoteId}:`, storageErr);
                  }

                  // Atualiza tabela notes no Supabase com conteúdo definitivo HTTPS
                  const { error: noteUpdateError } = await supabase
                    .from('notes')
                    .update({
                      content: note.content,
                      tags: cleanTags,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', targetNoteId)
                    .eq('user_id', userId);

                  if (noteUpdateError) {
                    console.error(`[NOTE] PERSIST ERROR noteId=${targetNoteId}:`, noteUpdateError.message || noteUpdateError);
                  } else {
                    // Sincroniza tags
                    try {
                      await this.syncTagsWithSupabase(supabase, userId, targetNoteId, cleanTags);
                    } catch (tagErr) {
                      console.warn('[SyncEngine] Aviso ao sincronizar tags:', tagErr);
                    }

                    // Marca a nota como sincronizada no IndexedDB
                    await indexedDBStorage.markNoteSynced(userId, targetNoteId, effectiveRevision);
                    console.log(`[NOTE] FULLY_SYNCED_AFTER_ATTACHMENTS noteId=${targetNoteId} revision=${effectiveRevision}`);

                    // Remove operações UPDATE_NOTE_CONTENT pendentes para esta nota
                    const remainingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
                    for (const q of remainingQueue) {
                      if (q.entity_id === targetNoteId && q.action === 'UPDATE_NOTE_CONTENT') {
                        await indexedDBStorage.removeSyncQueueItem(userId, q.id);
                      }
                    }
                  }
                }
              }
            }

            // Registra a URL remota no cache em memória para acesso síncrono imediato
            if (remoteUrl) {
              registerResolvedAttachmentUrl(attachmentId, remoteUrl);
            }

            if (targetNoteId) {
              this.recentlySyncedNoteIds.set(targetNoteId, Date.now() + 15000);
            }

            // Emite evento interno e agenda sincronização imediata da fila
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('attachment:sync-complete', {
                  detail: { attachmentId, noteId: targetNoteId, remoteUrl },
                })
              );
            }
            this.scheduleSync(10);
          }

          return true;
        } finally {
          this.uploadingAttachments.delete(attachmentId);
        }
      }

      default:
        console.warn(`[SyncEngine] Ação desconhecida: ${(item as any).action}`);
        return true;
    }
  }

  /**
   * Assegura preventivamente que uma pasta (e suas pastas pai) existam no Supabase antes de vincular uma nota.
   * Evita violações de chave estrangeira (foreign key constraint "notes_folder_id_fkey" / código 23503).
   */
  private async ensureFolderSyncedToSupabase(
    supabase: any,
    userId: string,
    folderId: string
  ): Promise<boolean> {
    if (!folderId || !userId) return false;

    try {
      // 1. Verifica se a pasta já existe no Supabase
      const { data: existingRemote, error: selectErr } = await supabase
        .from('folders')
        .select('id')
        .eq('id', folderId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!selectErr && existingRemote && existingRemote.id) {
        return true;
      }

      // 2. Se não existir no Supabase, busca do IndexedDB local
      const localFolder = await indexedDBStorage.getFolderById(userId, folderId);
      if (!localFolder) {
        console.warn(`[SyncEngine] Pasta com id=${folderId} não encontrada localmente no IndexedDB.`);
        return false;
      }

      // 3. Se a pasta local possuir parent_id, assegura recursivamente que a pasta pai exista primeiro
      if (localFolder.parent_id) {
        await this.ensureFolderSyncedToSupabase(supabase, userId, localFolder.parent_id);
      }

      // 4. Upsert da pasta no Supabase
      const folderPayload: Record<string, any> = {
        id: localFolder.id,
        user_id: userId,
        name: localFolder.name || 'Nova pasta',
        parent_id: localFolder.parent_id || null,
        position: localFolder.position ?? 0,
        color: localFolder.color || null,
        is_smart: Boolean(localFolder.is_smart),
        smart_tags: localFolder.smart_tags || [],
        revision: localFolder.revision || 1,
        workspace_type: localFolder.workspace_type || 'notes',
        diary_year: localFolder.diary_year !== undefined ? localFolder.diary_year : null,
        diary_month: localFolder.diary_month !== undefined ? localFolder.diary_month : null,
        created_at: localFolder.created_at || new Date().toISOString(),
        updated_at: localFolder.updated_at || new Date().toISOString(),
      };

      let { error: upsertErr } = await supabase.from('folders').upsert(folderPayload);

      // Fallback defensivo para colunas que possam não existir no schema cache
      if (
        upsertErr &&
        upsertErr.message &&
        (upsertErr.message.includes('column') || upsertErr.message.includes('schema cache'))
      ) {
        delete folderPayload.workspace_type;
        delete folderPayload.diary_year;
        delete folderPayload.diary_month;
        const retry = await supabase.from('folders').upsert(folderPayload);
        upsertErr = retry.error;
      }

      if (upsertErr) {
        console.error(
          `[SyncEngine] Falha ao sincronizar pasta id=${folderId} no Supabase:`,
          upsertErr.message || upsertErr
        );
        return false;
      }

      await indexedDBStorage.markFolderSynced(userId, localFolder.id, localFolder.revision || 1);
      console.log(`[SyncEngine] Pasta id=${folderId} sincronizada preventivamente no Supabase com sucesso.`);
      return true;
    } catch (err) {
      console.warn(`[SyncEngine] Erro ao assegurar pasta id=${folderId} no Supabase:`, err);
      return false;
    }
  }

  /**
   * Sincroniza tabelas tags e note_tags no Supabase.
   */
  private async syncTagsWithSupabase(
    supabase: any,
    userId: string,
    noteId: string,
    cleanTags: string[]
  ): Promise<void> {
    if (cleanTags.length === 0) {
      await supabase.from('note_tags').delete().eq('note_id', noteId).eq('user_id', userId);
      return;
    }

    const tagRows = cleanTags.map((name) => ({
      user_id: userId,
      name: name.toLowerCase(),
    }));

    await supabase.from('tags').upsert(tagRows, { onConflict: 'user_id,name' });

    const { data: userTags } = await supabase
      .from('tags')
      .select('id, name')
      .eq('user_id', userId)
      .in('name', cleanTags.map((t) => t.toLowerCase()));

    if (userTags && userTags.length > 0) {
      await supabase.from('note_tags').delete().eq('note_id', noteId).eq('user_id', userId);
      const noteTagRecords = userTags.map((t: any) => ({
        note_id: noteId,
        tag_id: t.id,
        user_id: userId,
      }));
      await supabase.from('note_tags').insert(noteTagRecords);
    }
  }

  /**
   * Puxa alterações incrementais do Supabase para o IndexedDB sem bloquear a UI.
   * Marca dados remotos como syncRequired = false e syncStatus = 'synced'.
   */
  public async pullIncrementalChanges(userId: string): Promise<void> {
    if (!isSupabaseConfigured() || !userId) return;
    if (networkMonitor.getIsQuotaExceeded()) return;

    return remoteOperationGuard.execute(`pull:${userId}`, async (): Promise<void> => {
      // Se houver um fetch inicial em andamento para este usuário, aguarda a conclusão para evitar requisições duplicadas
      const inFlightFetch =
        remoteOperationGuard.getInFlight(`fetch:foldersAndNotes:${userId}:notes`) ||
        remoteOperationGuard.getInFlight(`fetch:foldersAndNotes:${userId}:all`) ||
        remoteOperationGuard.getInFlight(`fetch:foldersAndNotes:${userId}:diary`);

      if (inFlightFetch) {
        console.log('[SyncEngine] PULL aguardando fetch inicial em andamento para deduplicação');
        await inFlightFetch;
        return;
      }

      try {
        const supabase = createClient();
        let remoteChangesCount = 0;

        // Recupera timestamp da última sincronização bem-sucedida para busca incremental real
        // O cursor deve representar estritamente o último ponto confirmado pelo servidor
        const pullStartedAt = new Date().toISOString();
        const lastSync = await indexedDBStorage.getMetadata<string>(userId, 'last_sync_timestamp');

        const pendingQueue = await indexedDBStorage.getPendingSyncItems(userId);
        const pendingFolderIds = new Set(pendingQueue.filter((q) => q.entity_type === 'folder').map((f) => f.entity_id));
        const pendingNoteIds = new Set(pendingQueue.filter((q) => q.entity_type === 'note').map((n) => n.entity_id));
        const pendingAttachmentIds = new Set(pendingQueue.filter((q) => q.entity_type === 'attachment' || q.action === 'UPLOAD_ATTACHMENT').map((a) => a.entity_id));

      // Protege notas com uploads de anexos pendentes de serem sobrescritas prematuramente pelo PULL
      for (const q of pendingQueue) {
        if (q.action === 'UPLOAD_ATTACHMENT' && q.payload?.noteId) {
          pendingNoteIds.add(q.payload.noteId);
        }
      }

      // 0. Sincroniza metadados de anexos remotos (note_attachments)
      try {
        let attsQuery = supabase
          .from('note_attachments')
          .select('id, user_id, note_id, file_name, mime_type, file_size, storage_path, created_at, updated_at')
          .eq('user_id', userId);

        if (lastSync) {
          attsQuery = attsQuery.gt('updated_at', lastSync);
        }

        const { data: remoteAttachments, error: attsErr } = await remoteOperationGuard.execute(
          `fetch:attachments:${userId}`,
          async () => attsQuery
        );

        if (attsErr) {
          if (attsErr.status === 402 || (attsErr.message && attsErr.message.includes('exceed_egress_quota'))) {
            networkMonitor.setQuotaExceeded(true, attsErr.message);
            return;
          }
        } else if (remoteAttachments) {
          for (const rAtt of remoteAttachments) {
            if (!pendingAttachmentIds.has(rAtt.id)) {
              const existingAtt = await indexedDBStorage.getAttachment(userId, rAtt.id);
              if (!existingAtt || !existingAtt.remote_url) {
                const { data: pubData } = supabase.storage
                  .from(ATTACHMENTS_BUCKET_NAME)
                  .getPublicUrl(rAtt.storage_path);

                const remoteUrl = pubData?.publicUrl || null;
                await indexedDBStorage.putAttachment(userId, {
                  id: rAtt.id,
                  user_id: userId,
                  note_id: rAtt.note_id,
                  file_name: rAtt.file_name,
                  file_type: rAtt.mime_type,
                  mime_type: rAtt.mime_type,
                  file_size: rAtt.file_size,
                  storage_path: rAtt.storage_path,
                  remote_url: remoteUrl,
                  syncRequired: false,
                  syncStatus: 'synced',
                  sync_status: 'synced',
                  created_at: rAtt.created_at,
                  updated_at: rAtt.updated_at,
                });
                console.log(`[SyncGuard] PULL: ATTACHMENT SYNCED ${rAtt.id} path="${rAtt.storage_path}"`);
                remoteChangesCount++;
              }
            }
          }
        }
      } catch (attPullErr) {
        console.warn('[SyncEngine] Aviso ao sincronizar anexos remotos:', attPullErr);
      }

      // 1. Busca pastas remotas (filtrado por lastSync se disponível)
      let foldersQuery = supabase
        .from('folders')
        .select('id, user_id, name, parent_id, position, color, is_smart, smart_tags, revision, workspace_type, diary_year, diary_month, created_at, updated_at')
        .eq('user_id', userId);

      if (lastSync) {
        foldersQuery = foldersQuery.gt('updated_at', lastSync);
      }

      const { data: remoteFolders, error: foldersErr } = await remoteOperationGuard.execute(
        `fetch:folders:${userId}`,
        async () => foldersQuery
      );

      if (foldersErr) {
        if (foldersErr.status === 402 || (foldersErr.message && foldersErr.message.includes('exceed_egress_quota'))) {
          networkMonitor.setQuotaExceeded(true, foldersErr.message);
          return;
        }
      } else if (remoteFolders) {
        const localFolders = await indexedDBStorage.getAllFolders(userId);
        const localFoldersMap = new Map(localFolders.map((f) => [f.id, f]));
        const remoteFolderIds = new Set(remoteFolders.map((f: any) => f.id));

        for (const rFolder of remoteFolders) {
          // Se existe operação pendente na SyncQueue, preserva o estado local
          if (pendingFolderIds.has(rFolder.id)) {
            continue;
          }

          const existing = localFoldersMap.get(rFolder.id);

          // Se a pasta local tem alterações não sincronizadas pendentes, preserva o estado local
          if (existing && (existing.syncRequired || existing.needs_sync)) {
            continue;
          }

          // Se não existe localmente: INSERIR no IndexedDB (convergência de outro dispositivo)
          if (!existing) {
            await indexedDBStorage.putFolder(userId, {
              ...rFolder,
              is_smart: Boolean(rFolder.is_smart),
              revision: rFolder.revision || 0,
              syncRequired: false,
              syncStatus: 'synced',
              needs_sync: false,
              sync_status: 'synced',
              workspace_type: rFolder.workspace_type || 'notes',
            });
            console.log(`[SyncGuard] PULL: INSERT REMOTE FOLDER ${rFolder.id}`);
            remoteChangesCount++;
            continue;
          }

          // Se existe localmente e NÃO está pendente: compara propriedades e revisão
          const isDifferent =
            existing.name !== rFolder.name ||
            existing.parent_id !== rFolder.parent_id ||
            existing.position !== rFolder.position ||
            existing.color !== rFolder.color ||
            existing.workspace_type !== rFolder.workspace_type ||
            existing.is_smart !== Boolean(rFolder.is_smart) ||
            (rFolder.revision || 0) > (existing.revision || 0) ||
            JSON.stringify(existing.smart_tags || []) !== JSON.stringify(rFolder.smart_tags || []);

          if (isDifferent) {
            await indexedDBStorage.putFolder(userId, {
              ...rFolder,
              is_smart: Boolean(rFolder.is_smart),
              revision: Math.max(rFolder.revision || 0, existing.revision || 0),
              syncRequired: false,
              syncStatus: 'synced',
              needs_sync: false,
              sync_status: 'synced',
              workspace_type: rFolder.workspace_type || existing.workspace_type || 'notes',
            });
            console.log(`[SyncGuard] PULL: UPDATE FOLDER ${rFolder.id}`);
            remoteChangesCount++;
          }
        }

        // Detecta pastas deletadas remotamente (SOMENTE na sincronização completa inicial sem lastSync)
        if (!lastSync) {
          for (const lFolder of localFolders) {
            if (
              !remoteFolderIds.has(lFolder.id) &&
              !pendingFolderIds.has(lFolder.id) &&
              !lFolder.syncRequired &&
              !lFolder.needs_sync &&
              lFolder.syncStatus === 'synced'
            ) {
              await indexedDBStorage.deleteFolder(userId, lFolder.id);
              console.log(`[SyncGuard] PULL: DELETE LOCAL FOLDER ${lFolder.id}`);
              remoteChangesCount++;
            }
          }
        }
      }

      // 2. Busca notas remotas (filtrado por lastSync se disponível, incluindo content e workspace_type)
      let notesQuery = supabase
        .from('notes')
        .select('id, user_id, folder_id, title, content, position, is_archived, previous_folder_id, revision, tags, workspace_type, entry_date, diary_year, diary_month, diary_day, created_at, updated_at')
        .eq('user_id', userId);

      if (lastSync) {
        notesQuery = notesQuery.gt('updated_at', lastSync);
      }

      const { data: remoteNotes, error: notesErr } = await remoteOperationGuard.execute(
        `fetch:notes:${userId}`,
        async () => notesQuery
      );

      if (notesErr) {
        if (notesErr.status === 402 || (notesErr.message && notesErr.message.includes('exceed_egress_quota'))) {
          networkMonitor.setQuotaExceeded(true, notesErr.message);
          return;
        }
      } else if (remoteNotes) {
        const localNotes = await indexedDBStorage.getAllNotes(userId);
        const localNotesMap = new Map(localNotes.map((n) => [n.id, n]));
        const remoteNoteIds = new Set(remoteNotes.map((n: any) => n.id));

        for (const rNote of remoteNotes) {
          // Se a nota está na fila de pendências locais, preserva a versão local
          if (pendingNoteIds.has(rNote.id)) {
            continue;
          }

          const rawTags = rNote.tags;
          let noteTags: string[] = [];
          if (Array.isArray(rawTags)) {
            noteTags = normalizeTags(rawTags);
          } else if (typeof rawTags === 'string') {
            try {
              noteTags = normalizeTags(JSON.parse(rawTags));
            } catch {
              noteTags = normalizeTags(rawTags.split(','));
            }
          }

          const existingNote = localNotesMap.get(rNote.id);

          // Se a nota local tem alterações não sincronizadas, protege a edição local
          if (existingNote && (existingNote.syncRequired || existingNote.needs_sync)) {
            continue;
          }

          // Proteção contra rollback de anexos recém-sincronizados
          const isRecentlySynced = this.recentlySyncedNoteIds.has(rNote.id) && Date.now() < (this.recentlySyncedNoteIds.get(rNote.id) || 0);
          if (isRecentlySynced && existingNote) {
            const localHasResolved = (existingNote.content || '').includes('https://') || (existingNote.content || '').includes('http://');
            const remoteHasUnresolved = hasUnresolvedLocalMedia(rNote.content);
            if (localHasResolved && remoteHasUnresolved) {
              console.log(`[SyncGuard] PULL: Preservando nota local ${rNote.id} contra rollback remoto (anexos recém-sincronizados)`);
              continue;
            }
          }

          // Se NÃO existe localmente: INSERIR no IndexedDB (convergência de outro dispositivo)
          if (!existingNote) {
            await indexedDBStorage.putNote(userId, {
              ...rNote,
              content: rNote.content !== undefined ? rNote.content : '',
              tags: noteTags,
              revision: rNote.revision || 0,
              syncRequired: false,
              syncStatus: 'synced',
              needs_sync: false,
              is_archived: Boolean(rNote.is_archived),
              sync_status: 'synced',
              workspace_type: rNote.workspace_type || 'notes',
              entry_date: rNote.entry_date || null,
              diary_year: rNote.diary_year,
              diary_month: rNote.diary_month,
              diary_day: rNote.diary_day,
            });
            console.log(`[SyncGuard] PULL: INSERT REMOTE NOTE ${rNote.id}`);
            remoteChangesCount++;
            continue;
          }

          const normalizeContent = (str?: string) => (str || '').replace(/\r\n/g, '\n').trim();

          // Compara metadados e conteúdo se disponível
          const contentMatches = rNote.content !== undefined
            ? normalizeContent(existingNote.content) === normalizeContent(rNote.content)
            : true;

          const functionalContentMatches =
            existingNote.title === rNote.title &&
            contentMatches &&
            existingNote.folder_id === rNote.folder_id &&
            existingNote.position === rNote.position &&
            Boolean(existingNote.is_archived) === Boolean(rNote.is_archived) &&
            existingNote.previous_folder_id === rNote.previous_folder_id &&
            existingNote.workspace_type === rNote.workspace_type &&
            JSON.stringify(existingNote.tags || []) === JSON.stringify(noteTags);

          if (functionalContentMatches) {
            // Se apenas updated_at ou revision mudou no servidor, atualiza silenciosamente no IndexedDB
            if (existingNote.updated_at !== rNote.updated_at || (existingNote.revision || 0) < (rNote.revision || 0)) {
              await indexedDBStorage.putNote(userId, {
                ...existingNote,
                revision: Math.max(rNote.revision || 0, existingNote.revision || 0),
                updated_at: rNote.updated_at,
                syncRequired: false,
                syncStatus: 'synced',
                needs_sync: false,
              });
            }
            continue;
          }

          // Se existe localmente, NÃO tem pendência e difere da remota: aplica versão remota preservando conteúdo local se não veio na projeção
          await indexedDBStorage.putNote(userId, {
            ...rNote,
            content: rNote.content !== undefined ? rNote.content : (existingNote.content ?? ''),
            tags: noteTags,
            revision: Math.max(rNote.revision || 0, existingNote.revision || 0),
            syncRequired: false,
            syncStatus: 'synced',
            needs_sync: false,
            is_archived: Boolean(rNote.is_archived),
            sync_status: 'synced',
            workspace_type: rNote.workspace_type || existingNote.workspace_type || 'notes',
            entry_date: rNote.entry_date || existingNote.entry_date || null,
            diary_year: rNote.diary_year !== undefined ? rNote.diary_year : existingNote.diary_year,
            diary_month: rNote.diary_month !== undefined ? rNote.diary_month : existingNote.diary_month,
            diary_day: rNote.diary_day !== undefined ? rNote.diary_day : existingNote.diary_day,
          });
          console.log(`[SyncGuard] PULL: UPDATE NOTE ${rNote.id} revision=${rNote.revision || 0}`);
          remoteChangesCount++;
        }

        // Detecta notas deletadas remotamente (SOMENTE na sincronização completa inicial sem lastSync)
        if (!lastSync) {
          for (const lNote of localNotes) {
            if (
              !remoteNoteIds.has(lNote.id) &&
              !pendingNoteIds.has(lNote.id) &&
              !lNote.syncRequired &&
              !lNote.needs_sync &&
              lNote.syncStatus === 'synced'
            ) {
              await indexedDBStorage.deleteNote(userId, lNote.id);
              console.log(`[SyncGuard] PULL: DELETE LOCAL NOTE ${lNote.id}`);
              remoteChangesCount++;
            }
          }
        }
      }

      // 3. Busca tombstones (deleções remotas ocorridas desde o último lastSync)
      try {
        let tombstonesQuery = supabase
          .from('sync_tombstones')
          .select('id, entity_type, entity_id, deleted_at')
          .eq('user_id', userId);

        if (lastSync) {
          tombstonesQuery = tombstonesQuery.gt('deleted_at', lastSync);
        }

        const { data: remoteTombstones, error: tombErr } = await tombstonesQuery;
        if (!tombErr && remoteTombstones && remoteTombstones.length > 0) {
          for (const tomb of remoteTombstones) {
            if (tomb.entity_type === 'note') {
              if (!pendingNoteIds.has(tomb.entity_id)) {
                const localNote = await indexedDBStorage.getNoteById(userId, tomb.entity_id);
                if (localNote && !localNote.syncRequired && !localNote.needs_sync) {
                  await indexedDBStorage.deleteNote(userId, tomb.entity_id);
                  console.log(`[SyncGuard] PULL: TOMBSTONE DELETE NOTE ${tomb.entity_id}`);
                  remoteChangesCount++;
                }
              }
            } else if (tomb.entity_type === 'folder') {
              if (!pendingFolderIds.has(tomb.entity_id)) {
                const localFolder = await indexedDBStorage.getFolderById(userId, tomb.entity_id);
                if (localFolder && !localFolder.syncRequired && !localFolder.needs_sync) {
                  await indexedDBStorage.deleteFolder(userId, tomb.entity_id);
                  console.log(`[SyncGuard] PULL: TOMBSTONE DELETE FOLDER ${tomb.entity_id}`);
                  remoteChangesCount++;
                }
              }
            }
          }
        }
      } catch (tombCatchErr) {
        console.warn('[SyncGuard] Falha ao consultar sync_tombstones no PULL:', tombCatchErr);
      }

      console.log(`[SyncGuard] PULL: FOUND ${remoteChangesCount} REMOTE CHANGES`);

      // 4. Notifica a aplicação se houver alterações para atualizar o React State
      if (remoteChangesCount > 0) {
        networkMonitor.notifyRemoteChange();
        await this.notifyDataSubscribers(userId);
      }

      // 5. Atualiza timestamp da última sincronização bem sucedida com o início do ciclo confirmado pelo servidor
      await indexedDBStorage.setMetadata(userId, 'last_sync_timestamp', pullStartedAt);
    } catch (err) {
      console.warn('[SyncEngine] Erro ao sincronizar dados remotos:', err);
    }
  });
}

  /**
   * Reconstrução segura do cache local a partir do estado canônico do Supabase.
   * Conforme item 27:
   * 1. obtém estado canônico remoto;
   * 2. obtém tombstones;
   * 3. compara com IndexedDB;
   * 4. insere registros remotos ausentes;
   * 5. atualiza registros divergentes;
   * 6. exclui registros locais órfãos (que não existem mais remotamente e não possuem mutação pendente);
   * 7. preserva pendências locais válidas;
   * 8. conclui com IndexedDB = estado canônico do Supabase.
   */
  public async rebuildLocalCacheFromServer(userId: string): Promise<void> {
    if (!userId || userId === 'demo-user' || userId === 'local-user') return;
    if (!isSupabaseConfigured() || !networkMonitor.getState().isBackendReachable) return;

    return remoteOperationGuard.execute(`rebuildLocalCache:${userId}`, async () => {
      const supabase = createClient();

      // 1. Coleta estado local e pendências
      const [localNotes, localFolders, pendingQueue] = await Promise.all([
        indexedDBStorage.getAllNotes(userId),
        indexedDBStorage.getAllFolders(userId),
        indexedDBStorage.getPendingSyncQueue(userId),
      ]);

      const pendingNoteIds = new Set<string>();
      const pendingFolderIds = new Set<string>();

      for (const q of pendingQueue) {
        if (q.entity_type === 'note') pendingNoteIds.add(q.entity_id);
        if (q.entity_type === 'folder') pendingFolderIds.add(q.entity_id);
      }

      for (const n of localNotes) {
        if (n.syncRequired || n.needs_sync || n.syncStatus === 'pending' || saveQueue.hasPendingSaveForNote(n.id)) {
          pendingNoteIds.add(n.id);
        }
      }

      for (const f of localFolders) {
        if (f.syncRequired || f.needs_sync || f.syncStatus === 'pending') {
          pendingFolderIds.add(f.id);
        }
      }

      // 2. Busca estado canônico remoto no Supabase
      const [foldersRes, notesRes, tombstonesRes] = await Promise.all([
        supabase
          .from('folders')
          .select('id, user_id, name, parent_id, position, color, is_smart, smart_tags, revision, workspace_type, diary_year, diary_month, created_at, updated_at')
          .eq('user_id', userId),
        supabase
          .from('notes')
          .select('id, user_id, folder_id, title, content, position, is_archived, previous_folder_id, revision, tags, workspace_type, entry_date, diary_year, diary_month, diary_day, created_at, updated_at')
          .eq('user_id', userId),
        supabase
          .from('sync_tombstones')
          .select('id, entity_type, entity_id, deleted_at')
          .eq('user_id', userId)
          .order('deleted_at', { ascending: false })
          .limit(1000),
      ]);

      if (foldersRes.error) {
        console.warn('[RebuildCache] Erro ao buscar pastas remotas:', foldersRes.error);
        throw foldersRes.error;
      }
      if (notesRes.error) {
        console.warn('[RebuildCache] Erro ao buscar notas remotas:', notesRes.error);
        throw notesRes.error;
      }

      const remoteFolders = (foldersRes.data || []) as ExtendedFolder[];
      const remoteNotes = (notesRes.data || []) as ExtendedNote[];
      const remoteTombstones = (tombstonesRes.data || []) as Array<{ entity_type: string; entity_id: string }>;

      const tombstoneNoteIds = new Set(
        remoteTombstones.filter((t) => t.entity_type === 'note').map((t) => t.entity_id)
      );
      const tombstoneFolderIds = new Set(
        remoteTombstones.filter((t) => t.entity_type === 'folder').map((t) => t.entity_id)
      );

      const remoteFoldersMap = new Map(remoteFolders.map((f) => [f.id, f]));
      const localFoldersMap = new Map(localFolders.map((f) => [f.id, f]));

      // 3. Reconciliação de Pastas
      for (const rFolder of remoteFolders) {
        if (tombstoneFolderIds.has(rFolder.id)) continue;
        const lFolder = localFoldersMap.get(rFolder.id);

        if (!lFolder) {
          // Remoto existe, local ausente -> Insere
          await indexedDBStorage.putFolder(userId, {
            ...rFolder,
            is_smart: Boolean(rFolder.is_smart),
            revision: rFolder.revision || 0,
            syncRequired: false,
            syncStatus: 'synced',
            sync_status: 'synced',
            needs_sync: false,
            workspace_type: rFolder.workspace_type || 'notes',
          });
        } else if (!pendingFolderIds.has(rFolder.id)) {
          // Ambos existem e não está pendente -> Atualiza com versão canônica do servidor
          await indexedDBStorage.putFolder(userId, {
            ...rFolder,
            is_smart: Boolean(rFolder.is_smart),
            revision: Math.max(rFolder.revision || 0, lFolder.revision || 0),
            syncRequired: false,
            syncStatus: 'synced',
            sync_status: 'synced',
            needs_sync: false,
            workspace_type: rFolder.workspace_type || lFolder.workspace_type || 'notes',
          });
        }
      }

      // Limpeza de pastas locais órfãs (Regra do Caso C)
      for (const lFolder of localFolders) {
        if (pendingFolderIds.has(lFolder.id)) continue; // Preserva edições locais pendentes!
        if (tombstoneFolderIds.has(lFolder.id) || !remoteFoldersMap.has(lFolder.id)) {
          // Não existe no Supabase e não há pendência local -> Excluir do IndexedDB
          await indexedDBStorage.deleteFolder(userId, lFolder.id);
          console.log(`[RebuildCache] Órfão removido (pasta): ${lFolder.id}`);
        }
      }

      // 4. Reconciliação de Notas
      const remoteNotesMap = new Map(remoteNotes.map((n) => [n.id, n]));
      const localNotesMap = new Map(localNotes.map((n) => [n.id, n]));

      for (const rNote of remoteNotes) {
        if (tombstoneNoteIds.has(rNote.id)) continue;
        const lNote = localNotesMap.get(rNote.id);

        let noteTags: string[] = [];
        if (Array.isArray(rNote.tags)) {
          noteTags = normalizeTags(rNote.tags);
        } else if (typeof rNote.tags === 'string') {
          try {
            noteTags = normalizeTags(JSON.parse(rNote.tags));
          } catch {
            noteTags = normalizeTags((rNote.tags as string).split(','));
          }
        }

        if (!lNote) {
          // Remoto existe, local ausente -> Insere
          await indexedDBStorage.putNote(userId, {
            ...rNote,
            content: rNote.content ?? '',
            tags: noteTags,
            revision: rNote.revision || 0,
            syncRequired: false,
            syncStatus: 'synced',
            sync_status: 'synced',
            needs_sync: false,
            is_archived: Boolean(rNote.is_archived),
            workspace_type: rNote.workspace_type || 'notes',
            entry_date: rNote.entry_date || null,
            diary_year: rNote.diary_year,
            diary_month: rNote.diary_month,
            diary_day: rNote.diary_day,
          });
        } else if (!pendingNoteIds.has(rNote.id)) {
          // Ambos existem e não está pendente -> Atualiza com servidor
          await indexedDBStorage.putNote(userId, {
            ...rNote,
            content: rNote.content !== undefined ? rNote.content : (lNote.content ?? ''),
            tags: noteTags,
            revision: Math.max(rNote.revision || 0, lNote.revision || 0),
            syncRequired: false,
            syncStatus: 'synced',
            sync_status: 'synced',
            needs_sync: false,
            is_archived: Boolean(rNote.is_archived),
            workspace_type: rNote.workspace_type || lNote.workspace_type || 'notes',
            entry_date: rNote.entry_date || lNote.entry_date || null,
            diary_year: rNote.diary_year !== undefined ? rNote.diary_year : lNote.diary_year,
            diary_month: rNote.diary_month !== undefined ? rNote.diary_month : lNote.diary_month,
            diary_day: rNote.diary_day !== undefined ? rNote.diary_day : lNote.diary_day,
          });
        }
      }

      // Limpeza de notas locais órfãs (Regra do Caso C)
      for (const lNote of localNotes) {
        if (pendingNoteIds.has(lNote.id)) continue; // Preserva notas pendentes offline!
        if (tombstoneNoteIds.has(lNote.id) || !remoteNotesMap.has(lNote.id)) {
          // Não existe no Supabase e não há pendência -> Excluir do IndexedDB
          await indexedDBStorage.deleteNote(userId, lNote.id);
          console.log(`[RebuildCache] Órfão removido (nota): ${lNote.id}`);
        }
      }

      // 5. Atualiza timestamp do checkpoint
      await indexedDBStorage.setMetadata(userId, 'last_sync_timestamp', new Date().toISOString());

      // 6. Notifica UI
      networkMonitor.notifyRemoteChange();
      await this.notifyDataSubscribers(userId);
      console.log('[RebuildCache] Reconciliação canônica concluída com sucesso.');
    });
  }

  /**
   * Executa a sincronização manual completa "Sincronizar Agora" bidirecional.
   * Conforme item 6 e 7 do requisito:
   * ETAPA 1 → verificar conectividade
   * ETAPA 2 → verificar sessão autenticada
   * ETAPA 3 → flush de saves locais pendentes
   * ETAPA 4 → processar SyncQueue
   * ETAPA 5 → enviar tudo o que estiver pendente ao Supabase
   * ETAPA 6 → aguardar confirmação real
   * ETAPA 7 a 10 → reconciliação autoritativa do servidor para o IndexedDB
   * ETAPA 11 → notificar UI
   * ETAPA 12 → confirmar estado convergido (local = servidor)
   */
  public async forceSynchronizeNow(userId: string): Promise<{ success: boolean; error?: string }> {
    if (!userId || userId === 'demo-user' || userId === 'local-user') {
      return { success: false, error: 'Usuário local ou não configurado.' };
    }

    try {
      // ETAPA 1: Conectividade
      if (!networkMonitor.getState().isOnline || !networkMonitor.getState().isBackendReachable) {
        networkMonitor.setStatus('offline');
        return { success: false, error: 'Dispositivo sem conexão com a internet.' };
      }

      // ETAPA 2: Sessão autenticada
      if (isSupabaseConfigured()) {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) {
          return { success: false, error: 'Sessão de usuário não autenticada no Supabase.' };
        }
      }

      networkMonitor.setStatus('syncing');

      // ETAPA 3: Flush de saves locais pendentes
      await saveQueue.flushAll();

      // ETAPA 4, 5, 6: Processa a fila de envio para o Supabase
      await this.processQueue(userId);

      // ETAPA 7 a 10: Reconciliação canônica autoritativa Supabase -> IndexedDB
      await this.rebuildLocalCacheFromServer(userId);

      // ETAPA 11 & 12: Confirma estado final
      const remainingQueueCount = await indexedDBStorage.getSyncQueueCount(userId);
      networkMonitor.updatePendingCount(remainingQueueCount);
      networkMonitor.setStatus(remainingQueueCount === 0 ? 'synced' : 'pending_sync');

      return { success: true };
    } catch (err: any) {
      console.error('[SyncEngine] Erro em forceSynchronizeNow:', err);
      networkMonitor.setStatus('error');
      return { success: false, error: err.message || 'Erro durante a sincronização.' };
    }
  }
}

export const syncEngine = new SyncEngine();
