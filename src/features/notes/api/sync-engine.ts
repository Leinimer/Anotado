/**
 * Motor de Sincronização Bidirecional Offline-First (SyncEngine)
 *
 * Responsável por:
 * 1. Processar a fila de sincronização persistente (SyncQueue) do IndexedDB quando online.
 * 2. Upload de mídias/anexos offline para o Supabase Storage e substituição de referências no Markdown.
 * 3. Detecção e tratamento seguro de conflitos (não-destrutivo: preservação integral de versões divergentes).
 * 4. Sincronização incremental do Supabase para o IndexedDB sem travar a interface.
 * 5. Gerenciamento idempotente de tentativas e recuperação contra quedas de conexão no meio da transferência.
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
  private periodicInterval: NodeJS.Timeout | null = null;
  private activeUserId: string | null = null;
  private dataSubscribers: Set<DataSubscriber> = new Set();
  private lastKnownReachable: boolean = false;
  private realtimeChannel: any = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.lastKnownReachable = networkMonitor.getState().isBackendReachable;

      // 1. Sincroniza APENAS em transição real de conectividade (OFFLINE -> ONLINE)
      networkMonitor.subscribe((state) => {
        const wasOffline = !this.lastKnownReachable;
        const isNowOnline = state.isBackendReachable;
        this.lastKnownReachable = isNowOnline;

        if (wasOffline && isNowOnline && this.activeUserId) {
          console.log('[Realtime] RECONNECT');
          this.setupRealtimeSubscription(this.activeUserId);
          if (!this.isProcessing) {
            this.scheduleSync(300);
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
            this.scheduleSync(100);
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
            this.scheduleSync(100);
          }
        }
      });

      // 3. Polling leve de background (a cada 30 segundos se online e não estiver ocupado)
      this.periodicInterval = setInterval(() => {
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
   * Limpa canais de tempo real e encerra ouvintes ativos (usado no logout).
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
    this.activeUserId = null;
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
   * Permite que alterações feitas no celular apareçam instantaneamente no computador e vice-versa.
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
   * 1. Valida user_id para segurança.
   * 2. Verifica se há mutações pendentes locais (SyncQueue ou SaveQueue).
   * 3. Compara versões / revisões.
   * 4. Trata conflitos de forma não-destrutiva criando cópia de segurança se necessário.
   * 5. Atualiza o IndexedDB com sync_status: 'synced' SEM reinserir na SyncQueue para evitar loops.
   * 6. Notifica dataSubscribers e atualiza a UI.
   */
  private async handleRealtimeNoteChange(userId: string, payload: any) {
    try {
      const { eventType, new: newRecord, old: oldRecord } = payload;
      const noteId = (newRecord && newRecord.id) || (oldRecord && oldRecord.id);
      if (!noteId) return;

      // Segurança: garante que apenas dados do usuário ativo sejam processados
      const recordUserId = (newRecord && newRecord.user_id) || (oldRecord && oldRecord.user_id);
      if (recordUserId && recordUserId !== userId) {
        console.warn(`[Realtime] Evento ignorado: user_id diferente do autenticado (${recordUserId} !== ${userId})`);
        return;
      }

      console.log(`[Realtime] REMOTE CHANGE [${eventType}] noteId=${noteId}`);

      // 1. Verifica se existem mutações locais pendentes para este noteId na sync_queue
      const pendingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
      const hasPendingInSyncQueue = pendingQueue.some(
        (item) => item.entity_type === 'note' && item.entity_id === noteId
      );

      // 2. Verifica se existem gravações ativas ou pendentes no SaveQueueManager
      const hasPendingInSaveQueue = saveQueue.hasPendingSaveForNote(noteId);
      const hasLocalPendingEdits = hasPendingInSyncQueue || hasPendingInSaveQueue;

      const existingLocalNote = await indexedDBStorage.getNoteById(userId, noteId);

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
        const isInsert = eventType === 'INSERT';
        if (isInsert) {
          console.log(`[Realtime] INSERT noteId=${noteId}`);
        } else {
          console.log(`[Realtime] UPDATE noteId=${noteId}`);
        }

        const remoteRevision = typeof newRecord.revision === 'number' ? newRecord.revision : 0;
        const localRevision = (existingLocalNote && typeof existingLocalNote.revision === 'number') ? existingLocalNote.revision : 0;

        // Se há mutação local pendente, analisa precedência
        if (hasLocalPendingEdits) {
          if (localRevision >= remoteRevision) {
            console.log(`[Realtime] Nota ${noteId} possui mutações locais pendentes (${localRevision} >= ${remoteRevision}). Preservando estado local.`);
            return;
          }

          // Se a versão remota é superior e há colisão de conteúdo, aciona resolução de conflito não-destrutiva
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

        // Se o conteúdo veio nulo ou ausente no payload da linha, lê o Markdown no Storage (.md)
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

        // Atualiza o IndexedDB diretamente com status 'synced' para EVITAR LOOPS
        await indexedDBStorage.putNote(userId, {
          ...newRecord,
          content: finalContent ?? '',
          tags: noteTags,
          is_archived: Boolean(newRecord.is_archived),
          sync_status: 'synced',
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

      // Grava a cópia de segurança do conflito no IndexedDB
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
        sync_status: 'pending_sync',
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
        sync_status: 'synced',
      });

      console.log(`[Realtime] CONFLICT resolvido com cópia de backup: ${conflictNoteId}`);
    } catch (err) {
      console.error('[Realtime] Erro ao tratar conflito em tempo real:', err);
    }
  }

  /**
   * Trata alterações recebidas em tempo real para a tabela 'folders'.
   * Verifica se há mutações pendentes locais antes de aplicar no IndexedDB.
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

      const pendingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
      const hasPendingMutation = pendingQueue.some(
        (item) => item.entity_type === 'folder' && item.entity_id === folderId
      );

      if (hasPendingMutation) {
        console.log(`[Realtime] Pasta ${folderId} possui mutações locais pendentes. Preservando estado local.`);
        return;
      }

      if (eventType === 'DELETE') {
        console.log(`[Realtime] DELETE folderId=${folderId}`);
        const existing = await indexedDBStorage.getFolderById(userId, folderId);
        if (existing) {
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
      const count = await indexedDBStorage.getSyncQueueCount(userId);
      networkMonitor.updatePendingCount(count);
      return count;
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
   * Processa o ciclo completo de sincronização:
   * 1. PUSH: Processa operações pendentes da fila local (se houver).
   * 2. PULL: Busca alterações remotas do Supabase e atualiza o IndexedDB (SEMPRE executado).
   */
  public async processQueue(userId: string): Promise<{ success: boolean; processed: number }> {
    if (!userId || this.isProcessing) {
      return { success: false, processed: 0 };
    }

    console.log('[SyncEngine] SYNC START');

    // 1. Verifica conectividade real antes de processar
    const reachable = await networkMonitor.checkBackendReachability();
    if (!reachable) {
      await this.updatePendingCount(userId);
      networkMonitor.setSyncing(false);
      return { success: false, processed: 0 };
    }

    const supabase = createClient();

    // 2. Valida e renova sessão de autenticação ativa no Supabase antes do PUSH
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
      console.warn('[SyncEngine] Falha ao verificar autenticação para PUSH:', authErr);
    }

    if (userId !== 'demo-user' && authenticatedUid && authenticatedUid !== userId) {
      console.warn(`[SyncEngine] PUSH pausado: usuário autenticado no Supabase (${authenticatedUid}) diverge do userId local (${userId}).`);
    }

    this.isProcessing = true;
    networkMonitor.setSyncing(true);

    let processedCount = 0;

    try {
      // 1. ETAPA PUSH: Processamento de alterações locais da fila
      const queue = await indexedDBStorage.getPendingSyncQueue(userId);
      console.log(`[SyncEngine] LOCAL QUEUE: ${queue.length}`);

      if (queue.length === 0) {
        console.log('[SyncEngine] PUSH: SKIPPED - QUEUE EMPTY');
      } else {
        console.log(`[SyncEngine] PUSH: ${queue.length} OPERATIONS`);

        for (const item of queue) {
          // Re-checa conexão antes de cada item para abortar imediatamente se cair no meio
          if (!navigator.onLine) {
            console.warn('[SyncEngine] Conexão interrompida durante o processamento da fila.');
            break;
          }

          await indexedDBStorage.updateSyncItemStatus(userId, item.id, 'processing');

          try {
            const itemSuccess = await this.executeQueueItem(userId, item, authenticatedUid);
            if (itemSuccess) {
              // Remove da fila SOMENTE após confirmação de sucesso no Supabase
              await indexedDBStorage.removeSyncQueueItem(userId, item.id);
              processedCount++;
            } else {
              await indexedDBStorage.updateSyncItemStatus(userId, item.id, 'failed', 'Execução retornou falso');
            }
          } catch (err: any) {
            console.error(`[SyncEngine] Falha ao processar item ${item.id} (${item.action}):`, err);
            await indexedDBStorage.updateSyncItemStatus(userId, item.id, 'failed', err?.message || String(err));
            // Se for erro de rede/timeout, interrompe para não sobrecarregar
            if (err?.name === 'AbortError' || err?.message?.includes('fetch') || err?.message?.includes('network')) {
              break;
            }
          }
        }

        console.log('[SyncEngine] PUSH COMPLETE');
      }

      await this.updatePendingCount(userId);

      // 2. ETAPA PULL: SEMPRE executa PULL incremental de novidades do servidor
      console.log('[SyncEngine] PULL: START');
      await this.pullIncrementalChanges(userId);
      console.log('[SyncEngine] PULL: COMPLETE');
      console.log('[SyncEngine] SYNC COMPLETE');

      return { success: true, processed: processedCount };
    } catch (err) {
      console.error('[SyncEngine] Erro geral no processamento da sincronização:', err);
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
        if (!attachment.blob) continue;

        const bucketName = 'note-attachments';
        const sanitizedName = attachment.file_name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileExt = sanitizedName.split('.').pop() || 'dat';
        const filePath = `${userId}/${attachment.id}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(filePath, attachment.blob, {
            contentType: attachment.file_type || 'application/octet-stream',
            upsert: true,
          });

        if (uploadError) {
          console.warn(`[AttachmentSync] Falha no upload do anexo ${attachment.id}:`, uploadError);
          continue;
        }

        const { data: publicUrlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        const remoteUrl = publicUrlData?.publicUrl;
        if (!remoteUrl) continue;

        uploadedCount++;
        attachment.remote_url = remoteUrl;
        attachment.sync_status = 'synced';
        attachment.note_id = noteId;
        await indexedDBStorage.putAttachment(userId, attachment);

        // Substitui referências no markdown
        const localRefRegex = new RegExp(`local-attachment://${attachment.id}`, 'g');
        updatedContent = updatedContent.replace(localRefRegex, remoteUrl);

        if (attachment.data_url && updatedContent.includes(attachment.data_url)) {
          updatedContent = updatedContent.split(attachment.data_url).join(remoteUrl);
        }
      }
    } catch (err) {
      console.warn(`[SyncEngine] Erro ao resolver anexos da nota ${noteId}:`, err);
    }

    return { finalContent: updatedContent, uploadedCount };
  }

  /**
   * Executa uma operação individual da fila.
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
        const revision = item.revision || 1;

        console.log('[SyncEngine] CREATE_NOTE START');
        console.log(`[SyncEngine] NOTE ID: ${noteId}`);
        console.log(`[SyncEngine] USER ID: ${userId}`);
        console.log(`[SyncEngine] AUTH USER ID: ${authenticatedUid || 'none'}`);

        // 1. Lê a versão viva e mais atualizada da nota no IndexedDB
        const localNote = await indexedDBStorage.getNoteById(userId, noteId);
        const effectiveNote = localNote || rawPayload;
        let currentContent = (effectiveNote.content !== undefined && effectiveNote.content !== null)
          ? effectiveNote.content
          : (rawPayload.content || '');
        const noteTags = normalizeTags(effectiveNote.tags || rawPayload.tags || []);
        const noteTitle = effectiveNote.title || rawPayload.title || 'Nova nota';

        console.log(`[SyncEngine] TITLE: "${noteTitle}"`);
        console.log(`[SyncEngine] CONTENT LENGTH: ${currentContent.length}`);

        // 2. Resolve e faz upload de quaisquer anexos pendentes da nota de forma segura
        let uploadedCount = 0;
        try {
          const res = await this.resolveAndUploadAttachmentsForNote(
            supabase,
            userId,
            noteId,
            currentContent
          );
          currentContent = res.finalContent;
          uploadedCount = res.uploadedCount;
          if (uploadedCount > 0) {
            console.log(`[SyncEngine] ATTACHMENTS UPLOADED: ${uploadedCount}`);
          }
        } catch (attErr) {
          console.warn(`[SyncEngine] Aviso ao processar anexos da nota ${noteId}:`, attErr);
        }

        // Atualiza o IndexedDB caso o conteúdo tenha sido transformado com URLs remotas
        if (localNote && localNote.content !== currentContent) {
          localNote.content = currentContent;
          await indexedDBStorage.putNote(userId, localNote);
        }

        // 3. Grava .md canônico no Supabase Storage
        try {
          const fullMarkdown = serializeMarkdownWithTags(currentContent, noteTags);
          await writeNoteMarkdown(userId, noteId, fullMarkdown);
        } catch (storageErr) {
          console.warn(`[SyncEngine] Aviso ao gravar Markdown no Storage para nota ${noteId}:`, storageErr);
        }

        // 4. Grava na tabela notes com o conteúdo completo real via UPSERT
        console.log(`[SyncEngine] SUPABASE UPSERT START: ${noteId}`);
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
          created_at: effectiveNote.created_at || new Date().toISOString(),
          updated_at: effectiveNote.updated_at || new Date().toISOString(),
        });

        if (upsertError) {
          console.error('[SyncEngine] SUPABASE UPSERT ERROR:');
          console.error(`[SyncEngine] CODE: ${upsertError.code || 'N/A'}`);
          console.error(`[SyncEngine] MESSAGE: ${upsertError.message || 'N/A'}`);
          console.error(`[SyncEngine] DETAILS: ${upsertError.details || 'N/A'}`);
          console.error(`[SyncEngine] HINT: ${upsertError.hint || 'N/A'}`);
          throw upsertError;
        }

        console.log(`[SyncEngine] SUPABASE UPSERT SUCCESS: ${noteId}`);

        // Sincroniza tags associadas
        try {
          await this.syncTagsWithSupabase(supabase, userId, noteId, noteTags);
        } catch (tagErr) {
          console.warn('[SyncEngine] Aviso ao sincronizar tags:', tagErr);
        }

        // 5. Verifica se existem operações posteriores pendentes para a mesma nota
        const remainingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
        const hasPendingMutations = remainingQueue.some(
          (qItem) =>
            qItem.id !== item.id &&
            (qItem.entity_id === noteId ||
              (qItem.payload && (qItem.payload.noteId === noteId || qItem.payload.id === noteId)))
        );

        // Atualiza status local no IndexedDB
        if (localNote) {
          localNote.sync_status = hasPendingMutations ? 'pending_sync' : 'synced';
          await indexedDBStorage.putNote(userId, localNote);
        }

        return true;
      }

      case 'UPDATE_NOTE_CONTENT': {
        const { noteId, content: rawPayloadContent, tags: rawPayloadTags, baseUpdatedAt, revision } = item.payload;

        // 1. Lê a versão viva mais recente do IndexedDB
        const localNote = await indexedDBStorage.getNoteById(userId, noteId);
        let content = (localNote && localNote.content !== undefined && localNote.content !== null)
          ? localNote.content
          : (rawPayloadContent || '');
        const cleanTags = normalizeTags((localNote && localNote.tags) || rawPayloadTags || []);

        // 2. Resolve quaisquer anexos pendentes
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

          // Se a nota no servidor foi alterada após a edição base e tem conteúdo diferente -> Conflito Detectado
          if (
            remoteUpdatedAt > localBaseUpdatedAt + 1000 &&
            remoteNote.content &&
            remoteNote.content.trim() !== (content || '').trim()
          ) {
            console.warn(`[SyncEngine] Conflito detectado na nota ${noteId}. Preservando ambas as versões de forma não-destrutiva.`);

            // Estratégia Não-Destrutiva: Cria uma cópia de segurança para o conteúdo conflitante
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
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              sync_status: 'synced',
            });

            // Atualiza a nota original local com o conteúdo do servidor para convergir
            await indexedDBStorage.putNote(userId, {
              ...remoteNote,
              user_id: userId,
              sync_status: 'synced',
              tags: Array.isArray(remoteNote.tags) ? remoteNote.tags : [],
            });

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
            updated_at: new Date().toISOString(),
          })
          .eq('id', noteId)
          .eq('user_id', userId);

        if (updateErr) throw updateErr;

        await this.syncTagsWithSupabase(supabase, userId, noteId, cleanTags);

        const remainingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
        const hasPendingMutations = remainingQueue.some(
          (qItem) =>
            qItem.id !== item.id &&
            (qItem.entity_id === noteId ||
              (qItem.payload && (qItem.payload.noteId === noteId || qItem.payload.id === noteId)))
        );

        if (localNote) {
          localNote.sync_status = hasPendingMutations ? 'pending_sync' : 'synced';
          localNote.revision = (revision || localNote.revision || 1) + 1;
          await indexedDBStorage.putNote(userId, localNote);
        }
        return true;
      }

      case 'UPDATE_NOTE': {
        const { noteId, updates } = item.payload;
        const { error } = await supabase
          .from('notes')
          .update({
            ...updates,
            updated_at: new Date().toISOString(),
          })
          .eq('id', noteId)
          .eq('user_id', userId);

        if (error) throw error;
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
        const { error } = await supabase
          .from('notes')
          .update({
            folder_id: newFolderId,
            position: newPosition,
            updated_at: new Date().toISOString(),
          })
          .eq('id', noteId)
          .eq('user_id', userId);

        if (error) throw error;
        return true;
      }

      case 'ARCHIVE_NOTE': {
        const { noteId, previousFolderId } = item.payload;
        const { error } = await supabase
          .from('notes')
          .update({
            is_archived: true,
            previous_folder_id: previousFolderId,
            folder_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', noteId)
          .eq('user_id', userId);

        if (error) throw error;
        return true;
      }

      case 'UNARCHIVE_NOTE': {
        const { noteId, destinationFolderId } = item.payload;
        const { error } = await supabase
          .from('notes')
          .update({
            is_archived: false,
            folder_id: destinationFolderId,
            previous_folder_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', noteId)
          .eq('user_id', userId);

        if (error) throw error;
        return true;
      }

      case 'CREATE_FOLDER': {
        const folder = item.payload as ExtendedFolder;
        const { error } = await supabase.from('folders').upsert({
          id: folder.id || item.entity_id,
          user_id: userId,
          name: folder.name || 'Nova pasta',
          parent_id: folder.parent_id || null,
          position: folder.position ?? 0,
          color: folder.color || null,
          is_smart: Boolean(folder.is_smart),
          smart_tags: folder.smart_tags || [],
          created_at: folder.created_at || new Date().toISOString(),
          updated_at: folder.updated_at || new Date().toISOString(),
        });

        if (error) throw error;
        return true;
      }

      case 'UPDATE_FOLDER': {
        const { folderId, updates } = item.payload;
        const { error } = await supabase
          .from('folders')
          .update({
            ...updates,
            updated_at: new Date().toISOString(),
          })
          .eq('id', folderId)
          .eq('user_id', userId);

        if (error) throw error;
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
        const { error } = await supabase
          .from('folders')
          .update({
            parent_id: newParentId,
            position: newPosition,
            updated_at: new Date().toISOString(),
          })
          .eq('id', folderId)
          .eq('user_id', userId);

        if (error) throw error;
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
        console.log(`[AttachmentSync] NOTE ${noteId || 'none'} ATTACHMENT ${attachmentId} SYNC PUSH START`);

        const attachment = await indexedDBStorage.getAttachment(userId, attachmentId);
        if (!attachment) {
          console.log(`[AttachmentSync] NOTE ${noteId || 'none'} ATTACHMENT ${attachmentId} SKIPPED (NOT FOUND)`);
          return true;
        }

        if (attachment.sync_status === 'synced' && attachment.remote_url) {
          console.log(`[AttachmentSync] NOTE ${noteId || attachment.note_id || 'none'} ATTACHMENT ${attachmentId} ALREADY SYNCED`);
          return true;
        }

        if (!attachment.blob) {
          console.log(`[AttachmentSync] NOTE ${noteId || 'none'} ATTACHMENT ${attachmentId} SKIPPED (NO BLOB)`);
          return true;
        }

        const bucketName = 'note-attachments';
        const sanitizedName = attachment.file_name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileExt = sanitizedName.split('.').pop() || 'dat';
        const filePath = `${userId}/${attachmentId}.${fileExt}`;

        // 1. Upload do Blob para o bucket note-attachments do Supabase
        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(filePath, attachment.blob, {
            contentType: attachment.file_type || 'application/octet-stream',
            upsert: true,
          });

        if (uploadError) throw uploadError;

        // 2. Obtém a URL pública definitiva
        const { data: publicUrlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        const remoteUrl = publicUrlData?.publicUrl;
        if (!remoteUrl) throw new Error('Não foi possível obter URL pública da mídia');

        console.log(`[AttachmentSync] NOTE ${noteId || attachment.note_id || 'none'} ATTACHMENT ${attachmentId} SYNC SUCCESS REMOTE_URL: ${remoteUrl}`);

        // 3. Atualiza anexo local no IndexedDB
        attachment.remote_url = remoteUrl;
        attachment.sync_status = 'synced';
        if (noteId && !attachment.note_id) {
          attachment.note_id = noteId;
        }
        await indexedDBStorage.putAttachment(userId, attachment);

        // 4. Se o anexo estiver associado a uma nota, substitui referências locais no Markdown e atualiza
        const targetNoteId = attachment.note_id || noteId;
        if (targetNoteId) {
          const note = await indexedDBStorage.getNoteById(userId, targetNoteId);
          if (note && note.content) {
            let updatedContent = note.content;

            // Substitui referências de esquema local
            const localRefRegex = new RegExp(`local-attachment://${attachmentId}`, 'g');
            updatedContent = updatedContent.replace(localRefRegex, remoteUrl);

            // Substitui data_url exata se existir
            if (attachment.data_url && updatedContent.includes(attachment.data_url)) {
              updatedContent = updatedContent.split(attachment.data_url).join(remoteUrl);
            }

            // Substitui referências por ID ou nome do arquivo caso haja blob: ou data:
            const filenameEscaped = attachment.file_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const dataUrlRegex = new RegExp(`data:[^"'\\]\\s]+`, 'g');
            const blobUrlRegex = new RegExp(`blob:[^"'\\]\\s]+`, 'g');

            if (updatedContent !== note.content) {
              console.log(`[AttachmentSync] NOTE ${targetNoteId} REPLACED LOCAL REFS WITH REMOTE URL`);
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
   */
  public async pullIncrementalChanges(userId: string): Promise<void> {
    if (!isSupabaseConfigured() || !userId) return;

    try {
      const supabase = createClient();
      let remoteChangesCount = 0;

      const pendingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
      const pendingFolderIds = new Set(pendingQueue.filter((q) => q.entity_type === 'folder').map((q) => q.entity_id));
      const pendingNoteIds = new Set(pendingQueue.filter((q) => q.entity_type === 'note').map((q) => q.entity_id));

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
                sync_status: 'synced',
              });
              remoteChangesCount++;
            }
          }
        }

        // Detecta pastas deletadas remotamente
        const remoteFolderIds = new Set(remoteFolders.map((f: any) => f.id));
        for (const lFolder of localFolders) {
          if (!remoteFolderIds.has(lFolder.id) && !pendingFolderIds.has(lFolder.id) && lFolder.sync_status === 'synced') {
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
          // Se a nota NÃO tiver alterações locais pendentes na fila, atualiza no IndexedDB
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
                is_archived: Boolean(rNote.is_archived),
                sync_status: 'synced',
              });
              console.log(`[SyncEngine] INDEXEDDB: UPSERT NOTE ${rNote.id}`);
              remoteChangesCount++;
            }
          }
        }

        // Detecta notas deletadas remotamente
        const remoteNoteIds = new Set(remoteNotes.map((n: any) => n.id));
        for (const lNote of localNotes) {
          if (!remoteNoteIds.has(lNote.id) && !pendingNoteIds.has(lNote.id) && lNote.sync_status === 'synced') {
            await indexedDBStorage.deleteNote(userId, lNote.id);
            remoteChangesCount++;
          }
        }
      }

      console.log(`[SyncEngine] PULL: FOUND ${remoteChangesCount} REMOTE CHANGES`);

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
