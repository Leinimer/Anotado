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
import { Folder, Note } from '../types';
import { networkMonitor } from './network-monitor';
import { writeNoteMarkdown, deleteNoteMarkdown, readNoteMarkdown } from './notes-storage-api';
import { extractHashtagsFromText, normalizeTags } from '../utils/hashtag-extractor';
import { serializeMarkdownWithTags, parseMarkdownWithTags } from '../utils/markdown-tags';
import {
  prepareNoteContentForPersistence,
  validateNoteContentForRemotePersistence,
  hasUnresolvedLocalMedia,
  replaceAttachmentReferencesInEditor,
  extractAttachmentReferences,
  resolveAttachmentReferences,
  uploadAttachmentBinary,
  ATTACHMENTS_BUCKET_NAME,
} from './storage-api';

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
  private activeUserId: string | null = null;
  private dataSubscribers: Set<DataSubscriber> = new Set();
  private lastKnownReachable: boolean = false;
  private realtimeChannel: any = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private uploadingAttachments: Set<string> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      this.lastKnownReachable = networkMonitor.getState().isBackendReachable;

      // 1. Sincroniza imediatamente em transição de conectividade (OFFLINE -> ONLINE)
      networkMonitor.subscribe((state) => {
        const wasOffline = !this.lastKnownReachable;
        const isNowOnline = state.isBackendReachable;
        this.lastKnownReachable = isNowOnline;

        if (wasOffline && isNowOnline && this.activeUserId) {
          console.log('[Realtime] RECONNECT');
          this.setupRealtimeSubscription(this.activeUserId);
          if (!this.isProcessing) {
            this.scheduleSync(100);
          }
        }
      });

      // 2. Quando a aba/janela ganha foco ou visibilidade
      window.addEventListener('focus', () => {
        if (this.activeUserId && navigator.onLine) {
          if (!this.realtimeChannel) {
            console.log('[Realtime] RECONNECT');
            this.setupRealtimeSubscription(this.activeUserId);
          }
          if (!this.isProcessing) {
            this.scheduleSync(50);
          }
        }
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.activeUserId && navigator.onLine) {
          if (!this.realtimeChannel) {
            console.log('[Realtime] RECONNECT');
            this.setupRealtimeSubscription(this.activeUserId);
          }
          if (!this.isProcessing) {
            this.scheduleSync(50);
          }
        }
      });

      // 3. Watchdog leve de segurança a cada 30 segundos (O(p) - consulta apenas a SyncQueue)
      this.watchdogInterval = setInterval(() => {
        if (this.activeUserId && !this.isProcessing && navigator.onLine) {
          this.checkWatchdog(this.activeUserId);
        }
      }, 30000);
    }
  }

  public setActiveUser(userId: string) {
    const isNewUser = this.activeUserId !== userId;
    this.activeUserId = userId;
    this.updatePendingCount(userId);

    if (isNewUser || !this.realtimeChannel) {
      this.setupRealtimeSubscription(userId);
    }
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
    this.activeUserId = null;
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
   * Trata reconexão do Supabase Realtime com debounce e backoff.
   */
  private handleRealtimeReconnect(userId: string) {
    if (this.reconnectTimeout) return;
    console.log('[Realtime] RECONNECT');
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.activeUserId === userId && (typeof navigator === 'undefined' || navigator.onLine)) {
        this.setupRealtimeSubscription(userId);
        this.scheduleSync(100);
      }
    }, 2000);
  }

  /**
   * Configura o ouvinte em tempo real (Supabase Realtime) para notes e folders.
   */
  private setupRealtimeSubscription(userId: string) {
    if (!isSupabaseConfigured() || !userId || typeof window === 'undefined') return;

    try {
      const supabase = createClient();

      if (this.realtimeChannel) {
        try {
          supabase.removeChannel(this.realtimeChannel);
        } catch {
          // Ignora se já estiver fechado
        }
        this.realtimeChannel = null;
      }

      const channelName = `user-realtime-${userId}`;
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
        .subscribe((status: any) => {
          if (status === 'SUBSCRIBED') {
            console.log('[Realtime] CONNECTED');
            console.log('[Realtime] SUBSCRIBED');
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.log(`[Realtime] RECONNECT (${status})`);
            this.handleRealtimeReconnect(userId);
          }
        });
    } catch (err) {
      console.warn('[Realtime] Falha ao configurar canal de tempo real:', err);
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
      const hasLocalPendingEdits = Boolean(existingLocalNote?.syncRequired || existingLocalNote?.needs_sync);

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
          Boolean(existingLocalNote.is_archived) === Boolean(newRecord.is_archived) &&
          JSON.stringify(existingLocalNote.tags || []) === JSON.stringify(noteTags);

        if (isIdentical && !hasLocalPendingEdits) {
          return;
        }

        // Salva no IndexedDB como SINCRONIZADO (syncRequired = false, syncStatus = 'synced')
        await indexedDBStorage.putNote(userId, {
          ...newRecord,
          content: finalContent ?? '',
          tags: noteTags,
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
      const isLocalPending = Boolean(existingFolder?.syncRequired || existingFolder?.needs_sync);

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
    if (this.isProcessing) {
      this.hasPendingSyncRequest = true;
      return;
    }

    if (this.syncTimeout) clearTimeout(this.syncTimeout);
    this.syncTimeout = setTimeout(() => {
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
   * 1. PUSH: Processa operações pendentes da SyncQueue (O(p)).
   * 2. PULL: Busca alterações remotas do Supabase e atualiza o IndexedDB de forma não-destrutiva.
   */
  public async processQueue(userId: string): Promise<{ success: boolean; processed: number }> {
    if (!userId) {
      return { success: false, processed: 0 };
    }

    if (this.isProcessing) {
      this.hasPendingSyncRequest = true;
      return { success: false, processed: 0 };
    }

    // 1. Verifica conectividade real antes de processar
    const reachable = await networkMonitor.checkBackendReachability();
    if (!reachable) {
      await this.updatePendingCount(userId);
      networkMonitor.setSyncing(false);
      return { success: false, processed: 0 };
    }

    const supabase = createClient();

    // 2. Valida sessão de autenticação ativa no Supabase antes do PUSH
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
      console.warn('[SyncEngine] Falha ao verificar autenticação para PUSH:', authErr);
    }

    if (userId !== 'demo-user') {
      if (!hasValidSession || !authenticatedUid) {
        console.warn(`[AUTH] SESSION_NOT_READY: PUSH adiado para userId=${userId}. Aguardando sessão ativa.`);
        await this.updatePendingCount(userId);
        networkMonitor.setSyncing(false);
        return { success: false, processed: 0 };
      }
      if (authenticatedUid !== userId) {
        console.warn(`[AUTH] USER_MISMATCH: PUSH pausado. Autenticado (${authenticatedUid}) diverge do userId local (${userId}).`);
        await this.updatePendingCount(userId);
        networkMonitor.setSyncing(false);
        return { success: false, processed: 0 };
      }
    }

    console.log(`[SYNC] START userId=${userId}`);
    console.log('[AUTH] SESSION_READY');
    console.log('[AUTH] USER_READY');

    this.isProcessing = true;
    this.hasPendingSyncRequest = false;
    networkMonitor.setSyncing(true);

    let processedCount = 0;

    try {
      // 1. ETAPA PUSH: Processamento de operações pendentes da SyncQueue (O(p))
      const queue = await indexedDBStorage.getPendingSyncItems(userId);

      if (queue.length > 0) {
        console.log(`[QUEUE] COUNT=${queue.length}`);
        // Prioriza uploads de anexos (0) antes de pastas (1) e notas (2) para garantir que URLs remotas estejam prontas
        const getActionPriority = (action: string) => {
          if (action === 'UPLOAD_ATTACHMENT') return 0;
          if (action.includes('FOLDER')) return 1;
          if (action === 'CREATE_NOTE' || action === 'UPDATE_NOTE_CONTENT') return 2;
          return 3;
        };
        queue.sort((a, b) => getActionPriority(a.action) - getActionPriority(b.action));

        console.log(`[SyncEngine] PROCESS: ${queue.length} OPERATIONS`);

        const now = Date.now();
        for (const item of queue) {
          if (!navigator.onLine) {
            console.warn('[SyncEngine] Conexão interrompida durante o processamento da fila.');
            break;
          }

          // Respeita intervalo de backoff de retentativas
          if (item.next_retry_at && now < item.next_retry_at) {
            continue;
          }

          await indexedDBStorage.updateSyncItemStatus(userId, item.id, 'processing');

          try {
            const itemSuccess = await this.executeQueueItem(userId, item, authenticatedUid);
            if (itemSuccess) {
              // Remove da fila SOMENTE após confirmação de sucesso real no Supabase
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
              this.scheduleSync(backoffDelay);
            }
          } catch (err: any) {
            const attempts = (item.attempts || 0) + 1;
            const backoffDelay = this.calculateBackoffDelay(attempts);
            const nextRetryAt = Date.now() + backoffDelay;
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
            this.scheduleSync(backoffDelay);
            if (err?.name === 'AbortError' || err?.message?.includes('fetch') || err?.message?.includes('network')) {
              break;
            }
          }
        }

        console.log('[SyncEngine] SUCCESS: PUSH COMPLETE');
      }

      await this.updatePendingCount(userId);

      // 2. ETAPA PULL: PULL incremental de novidades do servidor
      await this.pullIncrementalChanges(userId);

      return { success: true, processed: processedCount };
    } catch (err) {
      console.error('[SyncEngine] ERROR no processamento da sincronização:', err);
      return { success: false, processed: processedCount };
    } finally {
      this.isProcessing = false;
      networkMonitor.setSyncing(false);
      await this.updatePendingCount(userId);

      // Se novas alterações chegaram durante o processamento, executa novo ciclo imediatamente
      if (this.hasPendingSyncRequest && this.activeUserId) {
        this.hasPendingSyncRequest = false;
        setTimeout(() => {
          if (this.activeUserId) {
            this.processQueue(this.activeUserId);
          }
        }, 50);
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

        // 2. Detecta dependências de anexos e prepara conteúdo
        const attachmentRefs = extractAttachmentReferences(currentContent);
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
          currentContent
        );

        if (!allResolved) {
          console.warn(`[NOTE] WAITING_FOR_ATTACHMENT noteId=${noteId}: CREATE_NOTE abortado pois há anexos locais ainda não resolvidos`);
          return false;
        }

        // Atualiza IndexedDB se referências locais foram substituídas por HTTPS ou Base64 migrado
        if (localNote && localNote.content !== preparedContent) {
          localNote.content = preparedContent;
          await indexedDBStorage.putNote(userId, localNote);
        }

        // Validação Absoluta: Nenhuma referência transitória ou Base64 permitida
        const validation = validateNoteContentForRemotePersistence(preparedContent);
        if (!validation.valid || hasUnresolvedLocalMedia(preparedContent)) {
          console.error(`[NOTE] PERSIST ERROR noteId=${noteId}: CREATE_NOTE abortado pois o conteúdo ainda possui referências não resolvidas: ${validation.errors.join('; ')}`);
          return false;
        }

        console.log(`[NOTE] READY_TO_SYNC noteId=${noteId}`);
        console.log(`[NOTE] CONTENT PERSIST START noteId=${noteId} revision=${effectiveRevision}`);

        // 3. Grava na tabela notes com conteúdo final HTTPS
        const { error: upsertError } = await supabase.from('notes').upsert({
          id: noteId,
          user_id: userId,
          folder_id: effectiveNote.folder_id || null,
          title: noteTitle,
          content: preparedContent,
          position: effectiveNote.position ?? 0,
          tags: noteTags,
          is_archived: Boolean(effectiveNote.is_archived),
          previous_folder_id: effectiveNote.previous_folder_id || null,
          revision: effectiveRevision,
          created_at: effectiveNote.created_at || new Date().toISOString(),
          updated_at: effectiveNote.updated_at || new Date().toISOString(),
        });

        if (upsertError) {
          console.error(`[NOTE] PERSIST ERROR noteId=${noteId}:`, upsertError.message || upsertError);
          throw upsertError;
        }

        // 4. Grava .md canônico no Supabase Storage
        try {
          const fullMarkdown = serializeMarkdownWithTags(preparedContent, noteTags);
          await writeNoteMarkdown(userId, noteId, fullMarkdown);
        } catch (storageErr) {
          console.warn(`[SyncEngine] Aviso ao gravar Markdown no Storage para nota ${noteId}:`, storageErr);
        }

        console.log(`[NOTE] CONTENT PERSIST SUCCESS noteId=${noteId}`);

        // Sincroniza tags associadas
        try {
          await this.syncTagsWithSupabase(supabase, userId, noteId, noteTags);
        } catch (tagErr) {
          console.warn('[SyncEngine] Aviso ao sincronizar tags:', tagErr);
        }

        // 5. Marca sincronizado no IndexedDB após confirmação real
        await indexedDBStorage.markNoteSynced(userId, noteId, effectiveRevision);
        console.log(`[NOTE] SYNC_SUCCESS noteId=${noteId}`);
        console.log(`[NOTE] SYNC CONFIRMED noteId=${noteId} revision=${effectiveRevision}`);

        // 6. Elimina operações redundantes de UPDATE_NOTE_CONTENT já consolidadas neste CREATE_NOTE
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
          .select('*')
          .eq('id', noteId)
          .eq('user_id', userId)
          .single();

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

        // Sem conflito: Grava o arquivo .md no Supabase Storage e na tabela notes
        const fullMarkdown = serializeMarkdownWithTags(preparedContent, cleanTags);
        await writeNoteMarkdown(userId, noteId, fullMarkdown);

        const { error: updateErr } = await supabase
          .from('notes')
          .update({
            content: preparedContent,
            tags: cleanTags,
            revision: revision,
            updated_at: new Date().toISOString(),
          })
          .eq('id', noteId)
          .eq('user_id', userId);

        if (updateErr) {
          console.error(`[NOTE] PERSIST ERROR noteId=${noteId}:`, updateErr.message || updateErr);
          throw updateErr;
        }

        await this.syncTagsWithSupabase(supabase, userId, noteId, cleanTags);

        console.log(`[NOTE] CONTENT PERSIST SUCCESS noteId=${noteId}`);

        // Marca como sincronizado no IndexedDB após confirmação real
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
        await deleteNoteMarkdown(userId, noteId);
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
        const { error } = await supabase
          .from('notes')
          .update({
            folder_id: newFolderId,
            position: newPosition,
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
        const { error } = await supabase
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

        if (error) throw error;
        await indexedDBStorage.markNoteSynced(userId, noteId, revision);
        console.log(`[SyncGuard] MARK SYNCED noteId=${noteId} revision=${revision}`);
        return true;
      }

      case 'CREATE_FOLDER': {
        const folder = item.payload as ExtendedFolder;
        const folderId = folder.id || item.entity_id;
        const revision = item.revision || folder.revision || 1;

        const { error } = await supabase.from('folders').upsert({
          id: folderId,
          user_id: userId,
          name: folder.name || 'Nova pasta',
          parent_id: folder.parent_id || null,
          position: folder.position ?? 0,
          color: folder.color || null,
          is_smart: Boolean(folder.is_smart),
          smart_tags: folder.smart_tags || [],
          revision,
          created_at: folder.created_at || new Date().toISOString(),
          updated_at: folder.updated_at || new Date().toISOString(),
        });

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

          if (attachment.syncStatus === 'synced' && attachment.remote_url) {
            console.log(`[ATTACHMENT] ALREADY_SYNCED attachmentId=${attachmentId} remoteUrl="${attachment.remote_url}"`);
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
          const targetNoteId = attachment.note_id || noteId;
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

                // Valida se não resta nenhum outro anexo pendente antes de enviar ao Supabase
                const validation = validateNoteContentForRemotePersistence(updatedContent);
                if (validation.valid && !hasUnresolvedLocalMedia(updatedContent)) {
                  // Atualiza o arquivo .md no Supabase Storage e na tabela notes
                  const fullMarkdown = serializeMarkdownWithTags(updatedContent, note.tags || []);
                  await writeNoteMarkdown(userId, note.id, fullMarkdown);
                  await supabase
                    .from('notes')
                    .update({ content: updatedContent, updated_at: new Date().toISOString() })
                    .eq('id', note.id)
                    .eq('user_id', userId);
                }
              }
            }

            // Emite evento interno e agenda sincronização imediata da nota dependente
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

    try {
      const supabase = createClient();
      let remoteChangesCount = 0;

      const pendingQueue = await indexedDBStorage.getPendingSyncItems(userId);
      const pendingFolderIds = new Set(pendingQueue.filter((q) => q.entity_type === 'folder').map((f) => f.entity_id));
      const pendingNoteIds = new Set(pendingQueue.filter((q) => q.entity_type === 'note').map((n) => n.entity_id));
      const pendingAttachmentIds = new Set(pendingQueue.filter((q) => q.entity_type === 'attachment' || q.action === 'UPLOAD_ATTACHMENT').map((a) => a.entity_id));

      // 0. Sincroniza metadados de anexos remotos (note_attachments)
      try {
        const { data: remoteAttachments, error: attsErr } = await supabase
          .from('note_attachments')
          .select('*')
          .eq('user_id', userId);

        if (!attsErr && remoteAttachments) {
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

      // 1. Busca pastas remotas
      const { data: remoteFolders, error: foldersErr } = await supabase
        .from('folders')
        .select('*')
        .eq('user_id', userId);

      if (!foldersErr && remoteFolders) {
        const localFolders = await indexedDBStorage.getAllFolders(userId);
        const localFoldersMap = new Map(localFolders.map((f) => [f.id, f]));

        for (const rFolder of remoteFolders) {
          if (!pendingFolderIds.has(rFolder.id)) {
            const existing = localFoldersMap.get(rFolder.id);

            // Se a pasta local tem alterações não sincronizadas e sua revisão é >= remota, protege edição local
            if (existing && existing.syncRequired && (existing.revision || 0) >= (rFolder.revision || 0)) {
              continue;
            }

            const isDifferent =
              !existing ||
              existing.name !== rFolder.name ||
              existing.parent_id !== rFolder.parent_id ||
              existing.position !== rFolder.position ||
              existing.color !== rFolder.color ||
              existing.is_smart !== Boolean(rFolder.is_smart) ||
              JSON.stringify(existing.smart_tags || []) !== JSON.stringify(rFolder.smart_tags || []);

            if (isDifferent) {
              await indexedDBStorage.putFolder(userId, {
                ...rFolder,
                is_smart: Boolean(rFolder.is_smart),
                revision: rFolder.revision || 0,
                syncRequired: false,
                syncStatus: 'synced',
                needs_sync: false,
                sync_status: 'synced',
              });
              remoteChangesCount++;
            }
          }
        }

        // Detecta pastas deletadas remotamente
        const remoteFolderIds = new Set(remoteFolders.map((f: any) => f.id));
        for (const lFolder of localFolders) {
          if (!remoteFolderIds.has(lFolder.id) && !pendingFolderIds.has(lFolder.id) && !lFolder.syncRequired && lFolder.syncStatus === 'synced') {
            await indexedDBStorage.deleteFolder(userId, lFolder.id);
            remoteChangesCount++;
          }
        }
      }

      // 2. Busca notas remotas
      const { data: remoteNotes, error: notesErr } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId);

      if (!notesErr && remoteNotes) {
        const localNotes = await indexedDBStorage.getAllNotes(userId);
        const localNotesMap = new Map(localNotes.map((n) => [n.id, n]));

        for (const rNote of remoteNotes) {
          if (!pendingNoteIds.has(rNote.id)) {
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

            // Se a nota local tem alterações não sincronizadas e sua revisão é >= remota, protege a edição local
            if (existingNote && existingNote.syncRequired && (existingNote.revision || 0) >= (rNote.revision || 0)) {
              continue;
            }

            const isDifferent =
              !existingNote ||
              existingNote.title !== rNote.title ||
              existingNote.content !== rNote.content ||
              existingNote.folder_id !== rNote.folder_id ||
              existingNote.position !== rNote.position ||
              Boolean(existingNote.is_archived) !== Boolean(rNote.is_archived) ||
              existingNote.previous_folder_id !== rNote.previous_folder_id ||
              existingNote.updated_at !== rNote.updated_at ||
              JSON.stringify(existingNote.tags || []) !== JSON.stringify(noteTags);

            if (isDifferent) {
              await indexedDBStorage.putNote(userId, {
                ...rNote,
                tags: noteTags,
                revision: rNote.revision || 0,
                syncRequired: false,
                syncStatus: 'synced',
                needs_sync: false,
                is_archived: Boolean(rNote.is_archived),
                sync_status: 'synced',
              });
              console.log(`[SyncGuard] INDEXEDDB: UPSERT NOTE ${rNote.id} revision=${rNote.revision || 0}`);
              remoteChangesCount++;
            }
          }
        }

        // Detecta notas deletadas remotamente
        const remoteNoteIds = new Set(remoteNotes.map((n: any) => n.id));
        for (const lNote of localNotes) {
          if (!remoteNoteIds.has(lNote.id) && !pendingNoteIds.has(lNote.id) && !lNote.syncRequired && lNote.syncStatus === 'synced') {
            await indexedDBStorage.deleteNote(userId, lNote.id);
            remoteChangesCount++;
          }
        }
      }

      console.log(`[SyncGuard] PULL: FOUND ${remoteChangesCount} REMOTE CHANGES`);

      // 3. Notifica a aplicação se houver alterações para atualizar o React State
      if (remoteChangesCount > 0) {
        await this.notifyDataSubscribers(userId);
      }

      // 4. Atualiza timestamp da última sincronização bem sucedida
      await indexedDBStorage.setMetadata(userId, 'last_sync_timestamp', new Date().toISOString());
    } catch (err) {
      console.warn('[SyncEngine] Erro ao sincronizar dados remotos:', err);
    }
  }
}

export const syncEngine = new SyncEngine();
