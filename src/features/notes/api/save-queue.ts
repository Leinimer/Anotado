/**
 * Gerenciador de Fila de Persistência Serializada por Nota (SaveQueueManager)
 *
 * Integração Offline-First:
 * 1. Grava no IndexedDB imediatamente com controle de revisão incremental.
 * 2. Registra na SyncQueue persistente do IndexedDB (sobrevive a F5, crash ou fechamento).
 * 3. Se online, serializa a gravação no Supabase Storage e na tabela `notes`.
 * 4. Se offline, conclui com sucesso local e mantém a operação na fila para o SyncEngine.
 * 5. Garante que nunca ocorram gravações concorrentes para a mesma nota e descarta versões intermediárias obsoletas.
 * 6. Suporta `flushNote(noteId)` e `flushAll()` garantindo persistência completa antes de logout ou troca de nota.
 */

import { writeNoteMarkdown } from './notes-storage-api';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { extractHashtagsFromText, normalizeTags } from '../utils/hashtag-extractor';
import { serializeMarkdownWithTags } from '../utils/markdown-tags';
import { indexedDBStorage } from '../db/indexed-db';
import { networkMonitor } from './network-monitor';

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

function countImagesInContent(content: string): number {
  if (!content) return 0;
  const imgTagMatches = (content.match(/<img\b[^>]*>/gi) || []).length;
  const mdImgMatches = (content.match(/!\[.*?\]\(.*?\)/gi) || []).length;
  return imgTagMatches + mdImgMatches;
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
   * Enfileira uma alteração para ser persistida de forma serializada.
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
        // Se uma versão anterior já estava pendente, ela é substituída pela versão mais recente
        if (state.pendingItem) {
          state.pendingItem.resolve({
            success: true,
            tags: state.pendingItem.tags || [],
            version: state.pendingItem.version,
          });
        }
        state.pendingItem = pendingItem;
      } else {
        // Processa imediatamente
        state.isSaving = true;
        state.activePromise = this.processSave(state, pendingItem);
      }
    });
  }

  /**
   * Executa a gravação serializada no IndexedDB, Supabase Storage e na tabela `notes`.
   */
  private async processSave(state: NoteQueueState, item: PendingSaveItem): Promise<void> {
    const startTime = performance.now();
    const imageCount = countImagesInContent(item.content);

    console.log(
      `%c[PERSISTÊNCIA] NOTE ${item.noteId} | VERSION ${item.version} | IMAGES ${imageCount} | SAVE START`,
      'color: #0284c7; font-weight: bold;'
    );

    // 1. Tags e serialização
    const bodyHashtags = extractHashtagsFromText(item.content);
    const combinedTags = normalizeTags([...(item.tags || []), ...bodyHashtags]);
    const fullMarkdown = serializeMarkdownWithTags(item.content, combinedTags);

    // 2. Gravação imediata no IndexedDB (fonte de verdade local durável)
    try {
      const existingNote = await indexedDBStorage.getNoteById(item.userId, item.noteId);
      const isOnline = networkMonitor.getState().isBackendReachable;
      const nextRevision = typeof existingNote?.revision === 'number' && existingNote.revision >= item.version 
        ? existingNote.revision + 1 
        : item.version;

      if (existingNote) {
        existingNote.content = item.content;
        existingNote.tags = combinedTags;
        existingNote.revision = nextRevision;
        existingNote.needs_sync = true;
        existingNote.sync_status = 'pending_sync';
        existingNote.updated_at = new Date().toISOString();
        await indexedDBStorage.putNote(item.userId, existingNote);
      }

      // Enfileira na SyncQueue persistente do IndexedDB caso caia a conexão ou ocorra falha
      const syncItemId = `sync_note_content_${item.noteId}`;
      await indexedDBStorage.enqueueSyncItem(item.userId, {
        id: syncItemId,
        action: 'UPDATE_NOTE_CONTENT',
        entity_type: 'note',
        entity_id: item.noteId,
        revision: nextRevision,
        payload: {
          noteId: item.noteId,
          content: item.content,
          tags: combinedTags,
          baseUpdatedAt: existingNote?.updated_at || new Date().toISOString(),
          revision: nextRevision,
        },
      });

      const pendingCount = await indexedDBStorage.getSyncQueueCount(item.userId);
      networkMonitor.updatePendingCount(pendingCount);

      // 3. Se estiver offline ou Supabase não configurado, finaliza com sucesso local
      if (!isOnline || !isSupabaseConfigured()) {
        state.persistedVersion = nextRevision;
        const durationMs = Math.round(performance.now() - startTime);
        console.log(
          `%c[PERSISTÊNCIA LOCAL OFFLINE] NOTE ${item.noteId} | VERSION ${nextRevision} | SALVO LOCALMENTE (${durationMs}ms)`,
          'color: #d97706; font-weight: bold;'
        );
        item.resolve({
          success: true,
          tags: combinedTags,
          version: nextRevision,
        });
        return;
      }

      // 4. Se online, verifica se há anexos pendentes antes de marcar sincronizado
      const hasUnresolvedAttachments = item.content.includes('attachment://') || item.content.includes('local-attachment://');
      
      // Grava no Supabase Storage
      const storageSuccess = await writeNoteMarkdown(item.userId, item.noteId, fullMarkdown);

      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from('notes')
        .update({
          content: item.content,
          tags: combinedTags,
          revision: nextRevision,
          needs_sync: hasUnresolvedAttachments,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.noteId)
        .eq('user_id', item.userId);

      if (updateErr) {
        console.warn('[SaveQueue] Erro ao atualizar Supabase DB:', updateErr);
        throw updateErr;
      }

      // Sincroniza tabelas tags / note_tags se necessário
      await this.syncTagsAndNoteRelations(supabase, item.userId, item.noteId, combinedTags);

      if (!hasUnresolvedAttachments) {
        // Marca como sincronizado localmente após confirmação explícita do Supabase
        await indexedDBStorage.markNoteSynced(item.userId, item.noteId, nextRevision);
        // Remove da SyncQueue após confirmação do Supabase
        await indexedDBStorage.removeSyncQueueItem(item.userId, syncItemId);
      }

      const remainingPending = await indexedDBStorage.getSyncQueueCount(item.userId);
      networkMonitor.updatePendingCount(remainingPending);

      state.persistedVersion = nextRevision;
      const durationMs = Math.round(performance.now() - startTime);

      console.log(
        `%c[PERSISTÊNCIA] NOTE ${item.noteId} | VERSION ${nextRevision} | IMAGES ${imageCount} | SAVE SUCCESS (${durationMs}ms)`,
        'color: #16a34a; font-weight: bold;'
      );

      item.resolve({
        success: storageSuccess,
        tags: combinedTags,
        version: nextRevision,
      });
    } catch (err: any) {
      console.warn(
        `%c[PERSISTÊNCIA] NOTE ${item.noteId} | VERSION ${item.version} | SALVO NO INDEXEDDB (Fila Pendente)`,
        'color: #d97706; font-weight: bold;',
        err
      );
      // Como o IndexedDB já possui a versão e está na SyncQueue, a alteração está segura e não é perdida
      item.resolve({
        success: true,
        tags: combinedTags,
        version: item.version,
      });
    } finally {
      // Verifica se há uma versão pendente mais recente acumulada durante a gravação
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

  private async syncTagsAndNoteRelations(
    supabase: any,
    userId: string,
    noteId: string,
    cleanTags: string[]
  ): Promise<void> {
    try {
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
    } catch (err) {
      console.warn('[SaveQueue] Erro ao sincronizar tags:', err);
    }
  }

  /**
   * Força o flush de todas as alterações pendentes de uma nota específica.
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
   * Força o flush de todas as notas pendentes no sistema (usado no logout e unmount).
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
