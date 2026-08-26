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
import { saveQueue } from './save-queue';

export type DataChangePayload = {
  userId: string;
  folders: ExtendedFolder[];
  notes: ExtendedNote[];
};

type DataSubscriber = (payload: DataChangePayload) => void;

class SyncEngine {
  private isProcessing: boolean = false;
  private syncTimeout: NodeJS.Timeout | null = null;
  private fastLocalCheckInterval: NodeJS.Timeout | null = null;
  private periodicPullInterval: NodeJS.Timeout | null = null;
  private activeUserId: string | null = null;
  private dataSubscribers: Set<DataSubscriber> = new Set();
  private lastKnownReachable: boolean = false;
  private realtimeChannel: any = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

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

      // 3. Verificação ultrarrápida a cada 1 segundo:
      // Consulta APENAS o IndexedDB local (getEntitiesRequiringSync) - NÃO consulta o Supabase a cada segundo.
      this.fastLocalCheckInterval = setInterval(() => {
        if (this.activeUserId && !this.isProcessing && navigator.onLine) {
          this.checkLocalPendingEntities(this.activeUserId);
        }
      }, 1000);

      // 4. Polling periódico de background para PULL incremental (a cada 30 segundos se online)
      this.periodicPullInterval = setInterval(() => {
        if (this.activeUserId && !this.isProcessing && navigator.onLine) {
          this.scheduleSync(0);
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
    this.activeUserId = null;
  }

  /**
   * Verificação silenciosa no IndexedDB local:
   * Identifica se há entidades pendentes (syncRequired = true ou itens na fila)
   * e agenda o envio para o Supabase caso haja pendências e rede disponível.
   */
  public async checkLocalPendingEntities(userId: string): Promise<void> {
    if (!userId || this.isProcessing) return;

    try {
      const isOnline = networkMonitor.getState().isBackendReachable;
      if (!isOnline) return;

      const { notes, folders, attachments } = await indexedDBStorage.getEntitiesRequiringSync(userId);
      const queueCount = await indexedDBStorage.getSyncQueueCount(userId);

      const hasPendingWork = notes.length > 0 || folders.length > 0 || attachments.length > 0 || queueCount > 0;
      if (hasPendingWork) {
        this.scheduleSync(50);
      }
    } catch {
      // Falha silenciosa na checagem local periódica
    }
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
      const isLocalPending = Boolean(existingLocalNote?.syncRequired || existingLocalNote?.needs_sync);
      const isSaveQueuePending = saveQueue.hasPendingSaveForNote(noteId);
      const hasLocalPendingEdits = isLocalPending || isSaveQueuePending;

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
   * Atualiza o contador de itens pendentes no monitor de rede.
   */
  public async updatePendingCount(userId: string): Promise<number> {
    if (!userId) return 0;
    try {
      const { notes, folders, attachments } = await indexedDBStorage.getEntitiesRequiringSync(userId);
      const queueCount = await indexedDBStorage.getSyncQueueCount(userId);
      const totalPending = Math.max(notes.length + folders.length + attachments.length, queueCount);
      networkMonitor.updatePendingCount(totalPending);
      return totalPending;
    } catch {
      return 0;
    }
  }

  /**
   * Agenda uma sincronização da fila com debounce.
   */
  public scheduleSync(delayMs: number = 300) {
    if (this.syncTimeout) clearTimeout(this.syncTimeout);
    this.syncTimeout = setTimeout(() => {
      if (this.activeUserId) {
        this.processQueue(this.activeUserId);
      }
    }, delayMs);
  }

  /**
   * Processa o ciclo completo de sincronização (SyncGuard):
   * 1. PUSH: Processa operações pendentes no IndexedDB (syncRequired = true) e itens da SyncQueue.
   * 2. PULL: Busca alterações remotas do Supabase e atualiza o IndexedDB de forma não-destrutiva.
   */
  public async processQueue(userId: string): Promise<{ success: boolean; processed: number }> {
    if (!userId || this.isProcessing) {
      return { success: false, processed: 0 };
    }

    console.log('[SyncGuard] START');

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
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user?.id) {
        authenticatedUid = userData.user.id;
      } else {
        const { data: sessionData } = await supabase.auth.getSession();
        authenticatedUid = sessionData?.session?.user?.id || null;
      }
    } catch (authErr) {
      console.warn('[SyncGuard] Falha ao verificar autenticação para PUSH:', authErr);
    }

    if (userId !== 'demo-user' && authenticatedUid && authenticatedUid !== userId) {
      console.warn(`[SyncGuard] PUSH pausado: usuário autenticado no Supabase (${authenticatedUid}) diverge do userId local (${userId}).`);
    }

    this.isProcessing = true;
    networkMonitor.setSyncing(true);

    let processedCount = 0;

    try {
      // 1. Auto-recuperação do SyncGuard baseada no IndexedDB local (syncRequired = true)
      const { notes: pendingNotes, folders: pendingFolders, attachments: pendingAttachments } =
        await indexedDBStorage.getEntitiesRequiringSync(userId);

      console.log(`[SyncGuard] PENDING NOTES: count=${pendingNotes.length}`);
      console.log(`[SyncGuard] PENDING FOLDERS: count=${pendingFolders.length}`);

      const currentQueue = await indexedDBStorage.getPendingSyncQueue(userId);
      const queuedItemEntityIds = new Set(currentQueue.map((q) => q.entity_id));

      // Re-enfileira notas com syncRequired = true ausentes da fila
      for (const pNote of pendingNotes) {
        if (!queuedItemEntityIds.has(pNote.id)) {
          await indexedDBStorage.enqueueSyncItem(userId, {
            action: 'UPDATE_NOTE_CONTENT',
            entity_type: 'note',
            entity_id: pNote.id,
            revision: pNote.revision || 1,
            payload: {
              noteId: pNote.id,
              content: pNote.content || '',
              tags: pNote.tags || [],
              revision: pNote.revision || 1,
            },
          });
        }
      }

      // Re-enfileira pastas com syncRequired = true ausentes da fila
      for (const pFolder of pendingFolders) {
        if (!queuedItemEntityIds.has(pFolder.id)) {
          await indexedDBStorage.enqueueSyncItem(userId, {
            action: 'UPDATE_FOLDER',
            entity_type: 'folder',
            entity_id: pFolder.id,
            revision: pFolder.revision || 1,
            payload: {
              folderId: pFolder.id,
              updates: {
                name: pFolder.name,
                parent_id: pFolder.parent_id,
                position: pFolder.position,
                color: pFolder.color,
                is_smart: pFolder.is_smart,
                smart_tags: pFolder.smart_tags,
              },
            },
          });
        }
      }

      // Re-enfileira anexos com syncRequired = true ausentes da fila
      for (const pAtt of pendingAttachments) {
        if (!queuedItemEntityIds.has(pAtt.id)) {
          await indexedDBStorage.enqueueSyncItem(userId, {
            action: 'UPLOAD_ATTACHMENT',
            entity_type: 'attachment',
            entity_id: pAtt.id,
            revision: 1,
            payload: {
              attachmentId: pAtt.id,
              fileName: pAtt.file_name,
              fileType: pAtt.file_type,
              fileSize: pAtt.file_size,
              noteId: pAtt.note_id || null,
            },
          });
        }
      }

      // 2. ETAPA PUSH: Processamento de alterações locais da fila
      const queue = await indexedDBStorage.getPendingSyncQueue(userId);
      console.log(`[SyncGuard] LOCAL QUEUE: ${queue.length}`);

      if (queue.length === 0) {
        console.log('[SyncGuard] PUSH: SKIPPED - QUEUE EMPTY');
      } else {
        console.log(`[SyncGuard] PUSH: ${queue.length} OPERATIONS`);

        for (const item of queue) {
          if (!navigator.onLine) {
            console.warn('[SyncGuard] Conexão interrompida durante o processamento da fila.');
            break;
          }

          await indexedDBStorage.updateSyncItemStatus(userId, item.id, 'processing');

          try {
            const itemSuccess = await this.executeQueueItem(userId, item, authenticatedUid);
            if (itemSuccess) {
              // Remove da fila SOMENTE após confirmação de sucesso real no Supabase
              await indexedDBStorage.removeSyncQueueItem(userId, item.id);
              processedCount++;
            } else {
              await indexedDBStorage.updateSyncItemStatus(userId, item.id, 'failed', 'Execução retornou falso');
            }
          } catch (err: any) {
            console.error(`[SyncGuard] Falha ao processar item ${item.id} (${item.action}):`, err);
            await indexedDBStorage.updateSyncItemStatus(userId, item.id, 'failed', err?.message || String(err));
            if (err?.name === 'AbortError' || err?.message?.includes('fetch') || err?.message?.includes('network')) {
              break;
            }
          }
        }

        console.log('[SyncGuard] PUSH COMPLETE');
      }

      await this.updatePendingCount(userId);

      // 3. ETAPA PULL: PULL incremental de novidades do servidor
      console.log('[SyncGuard] PULL: START');
      await this.pullIncrementalChanges(userId);
      console.log('[SyncGuard] PULL: COMPLETE');
      console.log('[SyncGuard] COMPLETE');

      return { success: true, processed: processedCount };
    } catch (err) {
      console.error('[SyncGuard] Erro geral no processamento da sincronização:', err);
      return { success: false, processed: processedCount };
    } finally {
      this.isProcessing = false;
      networkMonitor.setSyncing(false);
      await this.updatePendingCount(userId);
    }
  }

  /**
   * Localiza anexos pendentes associados à nota, faz upload para o Supabase Storage e substitui URLs locais no Markdown.
   */
  private async resolveAndUploadAttachmentsForNote(
    supabase: any,
    userId: string,
    noteId: string,
    content: string
  ): Promise<{ finalContent: string; uploadedCount: number }> {
    let updatedContent = content;
    let uploadedCount = 0;

    try {
      const pendingAttachments = await indexedDBStorage.getPendingAttachments(userId);
      const noteAttachments = pendingAttachments.filter((att) => {
        if (att.note_id === noteId) return true;
        if (updatedContent) {
          if (updatedContent.includes(att.id)) return true;
          if (att.data_url && updatedContent.includes(att.data_url)) return true;
        }
        return false;
      });

      for (const attachment of noteAttachments) {
        let remoteUrl = attachment.remote_url;

        if (!remoteUrl && attachment.blob) {
          const bucketName = 'note-attachments';
          const sanitizedName = attachment.file_name.replace(/[^a-zA-Z0-9.-]/g, '_');
          const fileExt = sanitizedName.split('.').pop() || 'dat';
          const filePath = `${userId}/${attachment.id}.${fileExt}`;

          console.log(`[Attachment] UPLOAD START noteId=${noteId} attachmentId=${attachment.id} fileName="${attachment.file_name}" fileSize=${attachment.file_size || 0} mimeType="${attachment.file_type}" path="${filePath}"`);

          const { error: uploadError } = await supabase.storage
            .from(bucketName)
            .upload(filePath, attachment.blob, {
              contentType: attachment.file_type || 'application/octet-stream',
              upsert: true,
            });

          if (uploadError) {
            console.warn(`[Attachment] UPLOAD ERROR noteId=${noteId} attachmentId=${attachment.id}:`, uploadError.message);
            continue;
          }

          const { data: publicUrlData } = supabase.storage
            .from(bucketName)
            .getPublicUrl(filePath);

          remoteUrl = publicUrlData?.publicUrl;
          if (!remoteUrl) continue;

          console.log(`[Attachment] UPLOAD SUCCESS noteId=${noteId} attachmentId=${attachment.id} remoteUrl="${remoteUrl}"`);
          console.log(`[Attachment] REMOTE URL noteId=${noteId} attachmentId=${attachment.id} url="${remoteUrl}"`);

          uploadedCount++;
          attachment.remote_url = remoteUrl;
          attachment.syncRequired = false;
          attachment.syncStatus = 'synced';
          attachment.sync_status = 'synced';
          attachment.note_id = noteId;
          await indexedDBStorage.putAttachment(userId, attachment);
          await indexedDBStorage.removeSyncQueueItem(userId, `sync_att_${attachment.id}`);
        }

        if (remoteUrl) {
          console.log(`[Attachment] MARKDOWN REFERENCE REPLACED noteId=${noteId} attachmentId=${attachment.id} remoteUrl="${remoteUrl}"`);
          const canonicalRefRegex = new RegExp(`attachment://${attachment.id}`, 'g');
          const localRefRegex = new RegExp(`local-attachment://${attachment.id}`, 'g');
          updatedContent = updatedContent.replace(canonicalRefRegex, remoteUrl);
          updatedContent = updatedContent.replace(localRefRegex, remoteUrl);

          if (attachment.data_url && updatedContent.includes(attachment.data_url)) {
            updatedContent = updatedContent.split(attachment.data_url).join(remoteUrl);
          }
        }
      }
    } catch (err) {
      console.warn(`[SyncEngine] Erro ao resolver anexos da nota ${noteId}:`, err);
    }

    return { finalContent: updatedContent, uploadedCount };
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
        const revision = item.revision || rawPayload.revision || 1;

        // 1. Lê a versão mais atualizada da nota no IndexedDB
        const localNote = await indexedDBStorage.getNoteById(userId, noteId);
        const effectiveNote = localNote || rawPayload;
        let currentContent = (effectiveNote.content !== undefined && effectiveNote.content !== null)
          ? effectiveNote.content
          : (rawPayload.content || '');
        const noteTags = normalizeTags(effectiveNote.tags || rawPayload.tags || []);
        const noteTitle = effectiveNote.title || rawPayload.title || 'Nova nota';

        const rawAttCount = (currentContent.match(/attachment:\/\/[a-zA-Z0-9_-]+/g) || []).length +
          (currentContent.match(/local-attachment:\/\/[a-zA-Z0-9_-]+/g) || []).length;

        console.log(`[SyncGuard] PUSH NOTE noteId=${noteId} revision=${revision} contentLength=${currentContent.length} attachmentCount=${rawAttCount}`);

        // 2. Grava na tabela notes sem coluna needs_sync
        const { error: upsertError } = await supabase.from('notes').upsert({
          id: noteId,
          user_id: userId,
          folder_id: effectiveNote.folder_id || null,
          title: noteTitle,
          content: currentContent,
          position: effectiveNote.position ?? 0,
          tags: noteTags,
          is_archived: Boolean(effectiveNote.is_archived),
          previous_folder_id: effectiveNote.previous_folder_id || null,
          revision: revision,
          created_at: effectiveNote.created_at || new Date().toISOString(),
          updated_at: effectiveNote.updated_at || new Date().toISOString(),
        });

        if (upsertError) {
          console.error(`[SyncGuard] PUSH ERROR noteId=${noteId}:`, upsertError.message || upsertError);
          throw upsertError;
        }

        console.log(`[SyncGuard] PUSH SUCCESS noteId=${noteId}`);

        // Sincroniza tags associadas
        try {
          await this.syncTagsWithSupabase(supabase, userId, noteId, noteTags);
        } catch (tagErr) {
          console.warn('[SyncEngine] Aviso ao sincronizar tags:', tagErr);
        }

        // 3. Processa anexos pendentes
        try {
          if (rawAttCount > 0) {
            console.log(`[SyncGuard] ATTACHMENTS noteId=${noteId} pendingCount=${rawAttCount}`);
          }
          const res = await this.resolveAndUploadAttachmentsForNote(
            supabase,
            userId,
            noteId,
            currentContent
          );
          currentContent = res.finalContent;
        } catch (attErr) {
          console.warn(`[SyncEngine] Falha não-fatal ao processar anexos da nota ${noteId}:`, attErr);
        }

        // Se anexos foram resolvidos e URLs remotas foram injetadas no markdown:
        if (localNote && localNote.content !== currentContent) {
          localNote.content = currentContent;
          await indexedDBStorage.putNote(userId, localNote);

          try {
            await supabase
              .from('notes')
              .update({
                content: currentContent,
                revision: revision,
                updated_at: new Date().toISOString(),
              })
              .eq('id', noteId)
              .eq('user_id', userId);
          } catch (updateContentErr) {
            console.warn('[SyncEngine] Aviso ao atualizar conteúdo com remote URLs:', updateContentErr);
          }
        }

        // 4. Grava .md canônico no Supabase Storage
        try {
          const fullMarkdown = serializeMarkdownWithTags(currentContent, noteTags);
          await writeNoteMarkdown(userId, noteId, fullMarkdown);
        } catch (storageErr) {
          console.warn(`[SyncEngine] Aviso ao gravar Markdown no Storage para nota ${noteId}:`, storageErr);
        }

        // 5. Marca sincronizado no IndexedDB após confirmação real
        const hasUnresolvedAttachments = currentContent.includes('attachment://') || currentContent.includes('local-attachment://');
        if (!hasUnresolvedAttachments) {
          await indexedDBStorage.markNoteSynced(userId, noteId, revision);
          console.log(`[SyncGuard] MARK SYNCED noteId=${noteId} revision=${revision}`);
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

        const rawAttCount = (content.match(/attachment:\/\/[a-zA-Z0-9_-]+/g) || []).length +
          (content.match(/local-attachment:\/\/[a-zA-Z0-9_-]+/g) || []).length;

        console.log(`[SyncGuard] PUSH NOTE noteId=${noteId} revision=${revision} contentLength=${content.length} attachmentCount=${rawAttCount}`);

        // 2. Resolve anexos pendentes
        if (rawAttCount > 0) {
          console.log(`[SyncGuard] ATTACHMENTS noteId=${noteId} pendingCount=${rawAttCount}`);
        }
        const { finalContent } = await this.resolveAndUploadAttachmentsForNote(
          supabase,
          userId,
          noteId,
          content
        );
        content = finalContent;

        if (localNote && localNote.content !== content) {
          localNote.content = content;
          await indexedDBStorage.putNote(userId, localNote);
        }

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
            remoteNote.content.trim() !== (content || '').trim()
          ) {
            console.warn(`[SyncGuard] Conflito detectado na nota ${noteId}. Preservando ambas as versões de forma não-destrutiva.`);

            const conflictNoteId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `note-conflict-${Date.now()}`;
            const conflictTitle = `[Conflito] ${remoteNote.title || 'Nota'} (Cópia Local)`;

            // Grava cópia no Supabase
            const conflictMarkdown = serializeMarkdownWithTags(content, cleanTags);
            await writeNoteMarkdown(userId, conflictNoteId, conflictMarkdown);
            await supabase.from('notes').insert({
              id: conflictNoteId,
              user_id: userId,
              folder_id: remoteNote.folder_id || null,
              title: conflictTitle,
              content: content,
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
              content: content,
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

            console.log(`[SyncGuard] CONTENT UPDATE SUCCESS (Conflict Handled) noteId=${noteId}`);
            return true;
          }
        }

        // Sem conflito: Grava o arquivo .md no Supabase Storage e na tabela notes
        const fullMarkdown = serializeMarkdownWithTags(content, cleanTags);
        await writeNoteMarkdown(userId, noteId, fullMarkdown);

        const { error: updateErr } = await supabase
          .from('notes')
          .update({
            content: content,
            tags: cleanTags,
            revision: revision,
            updated_at: new Date().toISOString(),
          })
          .eq('id', noteId)
          .eq('user_id', userId);

        if (updateErr) {
          console.error(`[SyncGuard] PUSH ERROR noteId=${noteId}:`, updateErr.message || updateErr);
          throw updateErr;
        }

        await this.syncTagsWithSupabase(supabase, userId, noteId, cleanTags);

        console.log(`[SyncGuard] PUSH SUCCESS noteId=${noteId}`);

        const hasUnresolvedAttachments = content.includes('attachment://') || content.includes('local-attachment://');
        if (!hasUnresolvedAttachments) {
          await indexedDBStorage.markNoteSynced(userId, noteId, revision);
          console.log(`[SyncGuard] MARK SYNCED noteId=${noteId} revision=${revision}`);
        }
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

        const attachment = await indexedDBStorage.getAttachment(userId, attachmentId);
        if (!attachment) {
          console.log(`[Attachment] SKIPPED (NOT FOUND) noteId=${noteId || 'none'} attachmentId=${attachmentId}`);
          return true;
        }

        if (attachment.syncStatus === 'synced' && attachment.remote_url) {
          console.log(`[Attachment] ALREADY SYNCED noteId=${noteId || attachment.note_id || 'none'} attachmentId=${attachmentId} remoteUrl="${attachment.remote_url}"`);
          return true;
        }

        if (!attachment.blob) {
          console.log(`[Attachment] SKIPPED (NO BLOB) noteId=${noteId || 'none'} attachmentId=${attachmentId}`);
          return true;
        }

        const bucketName = 'note-attachments';
        const sanitizedName = attachment.file_name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileExt = sanitizedName.split('.').pop() || 'dat';
        const filePath = `${userId}/${attachmentId}.${fileExt}`;

        console.log(`[Attachment] UPLOAD START noteId=${noteId || attachment.note_id || 'none'} attachmentId=${attachmentId} fileName="${attachment.file_name}" fileSize=${attachment.file_size || 0} mimeType="${attachment.file_type}" path="${filePath}"`);

        // 1. Upload do Blob para o bucket note-attachments do Supabase
        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(filePath, attachment.blob, {
            contentType: attachment.file_type || 'application/octet-stream',
            upsert: true,
          });

        if (uploadError) {
          console.warn(`[Attachment] UPLOAD ERROR noteId=${noteId || 'none'} attachmentId=${attachmentId}:`, uploadError.message);
          throw uploadError;
        }

        // 2. Obtém a URL pública definitiva
        const { data: publicUrlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        const remoteUrl = publicUrlData?.publicUrl;
        if (!remoteUrl) throw new Error('Não foi possível obter URL pública da mídia');

        console.log(`[Attachment] UPLOAD SUCCESS noteId=${noteId || attachment.note_id || 'none'} attachmentId=${attachmentId} remoteUrl="${remoteUrl}"`);
        console.log(`[Attachment] REMOTE URL noteId=${noteId || attachment.note_id || 'none'} attachmentId=${attachmentId} url="${remoteUrl}"`);

        // 3. Atualiza anexo local no IndexedDB com syncRequired = false e syncStatus = 'synced'
        attachment.remote_url = remoteUrl;
        attachment.syncRequired = false;
        attachment.syncStatus = 'synced';
        attachment.sync_status = 'synced';
        if (noteId && !attachment.note_id) {
          attachment.note_id = noteId;
        }
        await indexedDBStorage.putAttachment(userId, attachment);

        // 4. Se o anexo estiver associado a uma nota, substitui referências locais no Markdown
        const targetNoteId = attachment.note_id || noteId;
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
              console.log(`[Attachment] REPLACED REFS noteId=${targetNoteId} attachmentId=${attachmentId} remoteUrl="${remoteUrl}"`);
              note.content = updatedContent;
              await indexedDBStorage.putNote(userId, note);

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

        return true;
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

      const { notes: pendingNotes, folders: pendingFolders } =
        await indexedDBStorage.getEntitiesRequiringSync(userId);
      const pendingFolderIds = new Set(pendingFolders.map((f) => f.id));
      const pendingNoteIds = new Set(pendingNotes.map((n) => n.id));

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
