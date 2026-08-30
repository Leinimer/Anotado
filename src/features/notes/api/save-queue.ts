/**
 * Gerenciador de Fila de Persistência Local-First por Nota (SaveQueueManager)
 *
 * Responsabilidade Estrita Local-First:
 * EDITOR -> SaveQueueManager -> IndexedDB -> SyncQueue -> Retorna imediatamente.
 *
 * O SaveQueueManager NÃO realiza chamadas de rede, uploads ou gravações no Supabase.
 * Toda persistência remota é delegada exclusivamente ao SyncEngine através da SyncQueue.
 */

import { extractHashtagsFromText, normalizeTags } from '../utils/hashtag-extractor';
import { indexedDBStorage } from '../db/indexed-db';
import { networkMonitor } from './network-monitor';
import { syncEngine } from './sync-engine';

interface PendingSaveItem {
  userId: string;
  noteId: string;
  content: string;
  tags?: string[];
  version: number;
  resolve: (res: { success: boolean; tags: string[]; version: number }) => void;
  reject: (err: any) => void;
}

interface NoteQueueState {
  userId: string;
  isSaving: boolean;
  currentVersion: number;
  persistedVersion: number;
  pendingItem: PendingSaveItem | null;
  activePromise: Promise<void> | null;
}

class SaveQueueManager {
  private queues: Map<string, NoteQueueState> = new Map();

  private getOrCreateState(userId: string, noteId: string): NoteQueueState {
    let state = this.queues.get(noteId);
    if (!state) {
      state = {
        userId,
        isSaving: false,
        currentVersion: 0,
        persistedVersion: 0,
        pendingItem: null,
        activePromise: null,
      };
      this.queues.set(noteId, state);
    }
    state.userId = userId;
    return state;
  }

  /**
   * Enfileira uma alteração para ser persistida de forma local e serializada no IndexedDB.
   */
  public enqueueSave(
    userId: string,
    noteId: string,
    content: string,
    tags?: string[]
  ): Promise<{ success: boolean; tags: string[]; version: number }> {
    const state = this.getOrCreateState(userId, noteId);
    state.currentVersion += 1;
    const version = state.currentVersion;

    return new Promise((resolve, reject) => {
      const pendingItem: PendingSaveItem = {
        userId,
        noteId,
        content,
        tags,
        version,
        resolve,
        reject,
      };

      if (state.isSaving) {
        // Se uma versão anterior já estava pendente, ela é consolidada com a versão mais recente
        if (state.pendingItem) {
          state.pendingItem.resolve({
            success: true,
            tags: state.pendingItem.tags || [],
            version: state.pendingItem.version,
          });
        }
        state.pendingItem = pendingItem;
      } else {
        // Processa imediatamente a gravação local
        state.isSaving = true;
        state.activePromise = this.processSave(state, pendingItem);
      }
    });
  }

  /**
   * Executa a gravação Local-First no IndexedDB e atualiza a SyncQueue para o SyncEngine.
   */
  private async processSave(state: NoteQueueState, item: PendingSaveItem): Promise<void> {
    const startTime = performance.now();

    // 1. Extração e normalização de tags
    const bodyHashtags = extractHashtagsFromText(item.content);
    const combinedTags = normalizeTags([...(item.tags || []), ...bodyHashtags]);

    try {
      // 2. Busca nota atual no IndexedDB
      const existingNote = await indexedDBStorage.getNoteById(item.userId, item.noteId);
      const currentContent = item.content !== undefined && item.content !== null ? item.content : (existingNote?.content || '');
      const currentRevision = typeof existingNote?.revision === 'number' ? existingNote.revision : 0;
      const nextRevision = Math.max(currentRevision + 1, item.version);

      console.log(`[NOTE] PERSIST LOCAL START noteId=${item.noteId} revision=${nextRevision}`);

      // 3. Atualiza entidade no IndexedDB com status pendente de sincronização
      if (existingNote) {
        existingNote.content = currentContent;
        existingNote.tags = combinedTags;
        existingNote.revision = nextRevision;
        existingNote.syncRequired = true;
        existingNote.syncStatus = 'pending';
        existingNote.needs_sync = true;
        existingNote.sync_status = 'pending_sync';
        existingNote.updated_at = new Date().toISOString();
        await indexedDBStorage.putNote(item.userId, existingNote);
      }

      // 4. Verifica se a nota ainda tem um CREATE_NOTE pendente na SyncQueue
      const pendingQueue = await indexedDBStorage.getPendingSyncQueue(item.userId);
      const hasPendingCreate = pendingQueue.some(
        (q) =>
          q.entity_id === item.noteId &&
          q.action === 'CREATE_NOTE' &&
          (q.status === 'pending' || q.status === 'processing' || q.status === 'failed')
      );

      if (hasPendingCreate) {
        // Se a criação ainda não foi enviada ao Supabase, CREATE_NOTE lerá o IndexedDB mais recente.
        // Não criamos UPDATE_NOTE_CONTENT redundante.
        const pendingCount = await indexedDBStorage.getSyncQueueCount(item.userId);
        networkMonitor.updatePendingCount(pendingCount);

        state.persistedVersion = nextRevision;
        const durationMs = Math.round(performance.now() - startTime);
        console.log(
          `%c[PERSISTÊNCIA LOCAL] NOTE ${item.noteId} | REVISION ${nextRevision} | CREATE_NOTE PENDENTE (${durationMs}ms)`,
          'color: #0284c7; font-weight: bold;'
        );

        // Dispara agendamento do SyncEngine em segundo plano
        syncEngine.scheduleSync(500);

        item.resolve({
          success: true,
          tags: combinedTags,
          version: nextRevision,
        });
        return;
      }

      // 5. Se já foi criada remotamente (ou não tem CREATE_NOTE pendente), enfileira UPDATE_NOTE_CONTENT
      const syncItemId = `sync_note_content_${item.noteId}`;
      await indexedDBStorage.enqueueSyncItem(item.userId, {
        id: syncItemId,
        action: 'UPDATE_NOTE_CONTENT',
        entity_type: 'note',
        entity_id: item.noteId,
        revision: nextRevision,
        payload: {
          noteId: item.noteId,
          content: currentContent,
          tags: combinedTags,
          baseUpdatedAt: existingNote?.updated_at || new Date().toISOString(),
          revision: nextRevision,
        },
      });

      const pendingCount = await indexedDBStorage.getSyncQueueCount(item.userId);
      networkMonitor.updatePendingCount(pendingCount);

      state.persistedVersion = nextRevision;
      const durationMs = Math.round(performance.now() - startTime);

      console.log(
        `%c[PERSISTÊNCIA LOCAL] NOTE ${item.noteId} | REVISION ${nextRevision} | SALVO NO INDEXEDDB (${durationMs}ms)`,
        'color: #16a34a; font-weight: bold;'
      );

      // 6. Solicita agendamento de sincronização no SyncEngine (em segundo plano, sem bloquear)
      syncEngine.scheduleSync(500);

      item.resolve({
        success: true,
        tags: combinedTags,
        version: nextRevision,
      });
    } catch (err: any) {
      console.error(
        `%c[PERSISTÊNCIA LOCAL] NOTE ${item.noteId} | ERRO AO GRAVAR NO INDEXEDDB`,
        'color: #ba1a1a; font-weight: bold;',
        err
      );
      item.reject(err);
    } finally {
      // 7. Consolidar próxima versão acumulada na fila, se houver
      if (state.pendingItem) {
        const nextItem = state.pendingItem;
        state.pendingItem = null;
        state.activePromise = this.processSave(state, nextItem);
      } else {
        state.isSaving = false;
        state.activePromise = null;
      }
    }
  }

  /**
   * Força a conclusão de qualquer gravação pendente de uma nota específica.
   */
  public async flushNote(noteId: string): Promise<void> {
    const state = this.queues.get(noteId);
    if (!state) return;

    while (state.isSaving || state.pendingItem || state.activePromise) {
      if (state.activePromise) {
        await state.activePromise;
      } else {
        break;
      }
    }
  }

  /**
   * Força a conclusão de todas as notas pendentes no sistema (usado no logout e unmount).
   */
  public async flushAll(): Promise<void> {
    const noteIds = Array.from(this.queues.keys());
    await Promise.all(noteIds.map((id) => this.flushNote(id)));
  }

  /**
   * Retorna se existem gravações ativas ou pendentes no momento para uma nota específica.
   */
  public hasPendingSaveForNote(noteId: string): boolean {
    const state = this.queues.get(noteId);
    return Boolean(state && (state.isSaving || state.pendingItem !== null));
  }

  /**
   * Retorna se existem gravações ativas ou pendentes no momento.
   */
  public hasPendingSaves(): boolean {
    for (const state of this.queues.values()) {
      if (state.isSaving || state.pendingItem !== null) {
        return true;
      }
    }
    return false;
  }
}

export const saveQueue = new SaveQueueManager();
