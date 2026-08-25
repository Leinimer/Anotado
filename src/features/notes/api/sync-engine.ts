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

  constructor() {
    if (typeof window !== 'undefined') {
      // 1. Quando o status de rede muda para online / backend reachable
      networkMonitor.subscribe((state) => {
        if (state.isBackendReachable && !this.isProcessing && this.activeUserId) {
          this.scheduleSync(300);
        }
      });

      // 2. Quando a aba/janela ganha foco ou visibilidade
      window.addEventListener('focus', () => {
        if (this.activeUserId && !this.isProcessing) {
          this.scheduleSync(100);
        }
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.activeUserId && !this.isProcessing) {
          this.scheduleSync(100);
        }
      });

      // 3. Polling leve de background (a cada 20 segundos se online)
      this.periodicInterval = setInterval(() => {
        if (this.activeUserId && !this.isProcessing && navigator.onLine) {
          this.scheduleSync(0);
        }
      }, 20000);
    }
  }

  public setActiveUser(userId: string) {
    this.activeUserId = userId;
    this.updatePendingCount(userId);
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

    // Verifica conectividade real antes de processar
    const reachable = await networkMonitor.checkBackendReachability();
    if (!reachable) {
      const count = await this.updatePendingCount(userId);
      networkMonitor.setSyncing(false);
      return { success: false, processed: 0 };
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
            const itemSuccess = await this.executeQueueItem(userId, item);
            if (itemSuccess) {
              // Remove da fila somente após confirmação do Supabase
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
   * Executa uma operação individual da fila.
   */
  private async executeQueueItem(userId: string, item: SyncQueueItem): Promise<boolean> {
    if (!isSupabaseConfigured()) return false;
    const supabase = createClient();

    switch (item.action) {
      case 'CREATE_NOTE': {
        const note = item.payload as ExtendedNote;
        const noteId = note.id || item.entity_id;
        const initialContent = note.content || '';
        const noteTags = normalizeTags(note.tags || []);

        // 1. Grava .md no Supabase Storage
        const fullMarkdown = serializeMarkdownWithTags(initialContent, noteTags);
        await writeNoteMarkdown(userId, noteId, fullMarkdown);

        // 2. Grava na tabela notes
        const { error } = await supabase.from('notes').upsert({
          id: noteId,
          user_id: userId,
          folder_id: note.folder_id || null,
          title: note.title || 'Nova nota',
          content: initialContent,
          position: note.position ?? 0,
          tags: noteTags,
          is_archived: Boolean(note.is_archived),
          previous_folder_id: note.previous_folder_id || null,
          created_at: note.created_at || new Date().toISOString(),
          updated_at: note.updated_at || new Date().toISOString(),
        });

        if (error) throw error;
        await this.syncTagsWithSupabase(supabase, userId, noteId, noteTags);

        // Atualiza status local no IndexedDB
        const localNote = await indexedDBStorage.getNoteById(userId, noteId);
        if (localNote) {
          localNote.sync_status = 'synced';
          await indexedDBStorage.putNote(userId, localNote);
        }
        return true;
      }

      case 'UPDATE_NOTE_CONTENT': {
        const { noteId, content, tags, baseUpdatedAt, revision } = item.payload;
        const cleanTags = normalizeTags(tags || []);

        // 1. Verificação de Conflito com a versão no Supabase
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

        const localNote = await indexedDBStorage.getNoteById(userId, noteId);
        if (localNote) {
          localNote.sync_status = 'synced';
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
        const attachment = await indexedDBStorage.getAttachment(userId, attachmentId);
        if (!attachment || !attachment.blob) {
          // Se não há blob, remove da fila
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

        // 3. Atualiza anexo local no IndexedDB
        attachment.remote_url = remoteUrl;
        attachment.sync_status = 'synced';
        await indexedDBStorage.putAttachment(userId, attachment);

        // 4. Se o anexo estiver associado a uma nota, substitui referências locais no Markdown
        if (attachment.note_id) {
          const note = await indexedDBStorage.getNoteById(userId, attachment.note_id);
          if (note && note.content) {
            const localRefRegex1 = new RegExp(`local-attachment://${attachmentId}`, 'g');
            const localRefRegex2 = new RegExp(`data:image/[^"'\\]\\s]+`, 'g'); // Se foi salvo como data URL
            let updatedContent = note.content.replace(localRefRegex1, remoteUrl);

            if (attachment.data_url && updatedContent.includes(attachment.data_url)) {
              updatedContent = updatedContent.split(attachment.data_url).join(remoteUrl);
            }

            if (updatedContent !== note.content) {
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
