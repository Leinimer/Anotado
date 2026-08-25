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
import { networkMonitor } from './network-monitor';
import { writeNoteMarkdown, deleteNoteMarkdown, readNoteMarkdown } from './notes-storage-api';
import { extractHashtagsFromText, normalizeTags } from '../utils/hashtag-extractor';
import { serializeMarkdownWithTags, parseMarkdownWithTags } from '../utils/markdown-tags';

class SyncEngine {
  private isProcessing: boolean = false;
  private syncTimeout: NodeJS.Timeout | null = null;
  private activeUserId: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      // Quando a rede volta a ficar disponível, dispara a sincronização
      networkMonitor.subscribe((state) => {
        if (state.isBackendReachable && state.pendingCount > 0 && !this.isProcessing) {
          this.scheduleSync(500);
        }
      });
    }
  }

  public setActiveUser(userId: string) {
    this.activeUserId = userId;
    this.updatePendingCount(userId);
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
   * Processa a fila de operações pendentes no IndexedDB.
   */
  public async processQueue(userId: string): Promise<{ success: boolean; processed: number }> {
    if (!userId || this.isProcessing) {
      return { success: false, processed: 0 };
    }

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
      const queue = await indexedDBStorage.getPendingSyncQueue(userId);
      if (queue.length === 0) {
        networkMonitor.setSyncing(false);
        networkMonitor.updatePendingCount(0);
        this.isProcessing = false;
        return { success: true, processed: 0 };
      }

      console.log(`[SyncEngine] Iniciando processamento de ${queue.length} operações pendentes para o usuário ${userId}`);

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

      await this.updatePendingCount(userId);

      // Após enviar as alterações locais, realiza um pull incremental das novidades do servidor
      await this.pullIncrementalChanges(userId);

      return { success: true, processed: processedCount };
    } catch (err) {
      console.error('[SyncEngine] Erro geral no processamento da fila:', err);
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
      const lastSync = (await indexedDBStorage.getMetadata<string>(userId, 'last_sync_timestamp')) || '1970-01-01T00:00:00Z';

      // 1. Busca pastas remotas
      const { data: remoteFolders, error: foldersErr } = await supabase
        .from('folders')
        .select('*')
        .eq('user_id', userId);

      if (!foldersErr && remoteFolders) {
        const localFolders: ExtendedFolder[] = remoteFolders.map((f: any) => ({
          ...f,
          sync_status: 'synced',
        }));
        await indexedDBStorage.putFoldersBatch(userId, localFolders);
      }

      // 2. Busca notas remotas
      const { data: remoteNotes, error: notesErr } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId);

      if (!notesErr && remoteNotes) {
        const pendingQueue = await indexedDBStorage.getPendingSyncQueue(userId);
        const pendingNoteIds = new Set(pendingQueue.filter((q) => q.entity_type === 'note').map((q) => q.entity_id));

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

            await indexedDBStorage.putNote(userId, {
              ...rNote,
              tags: noteTags,
              sync_status: 'synced',
            });
          }
        }
      }

      // 3. Atualiza timestamp da última sincronização bem sucedida
      await indexedDBStorage.setMetadata(userId, 'last_sync_timestamp', new Date().toISOString());
    } catch (err) {
      console.warn('[SyncEngine] Erro ao sincronizar dados remotos:', err);
    }
  }
}

export const syncEngine = new SyncEngine();
