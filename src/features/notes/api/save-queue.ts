/**
 * Gerenciador de Fila de Persistência Serializada por Nota.
 *
 * Garante que:
 * 1. Nunca ocorram duas operações de gravação concorrentes para a mesma nota.
 * 2. Se o usuário continuar editando enquanto uma gravação estiver em andamento,
 *    somente a versão MAIS RECENTE pendente é mantida na fila (descartando intermediárias desnecessárias).
 * 3. As gravações no Supabase Storage / Banco de Dados sejam estritamente seriais (A -> C).
 * 4. Controle de versão monotônico impede que versões antigas sobrescrevam novas.
 * 5. Suporta `flushNote(noteId)` e `flushAll()` garantindo que o logout ou a troca
 *    de nota aguardem a confirmação da gravação mais recente.
 */

import { writeNoteMarkdown } from './notes-storage-api';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { extractHashtagsFromText, normalizeTags } from '../utils/hashtag-extractor';
import { serializeMarkdownWithTags } from '../utils/markdown-tags';

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
   * Executa a gravação serializada no Supabase Storage e na tabela `notes`.
   */
  private async processSave(state: NoteQueueState, item: PendingSaveItem): Promise<void> {
    const startTime = performance.now();
    const imageCount = countImagesInContent(item.content);

    console.log(
      `%c[PERSISTÊNCIA] NOTE ${item.noteId} | VERSION ${item.version} | IMAGES ${imageCount} | SAVE START`,
      'color: #0284c7; font-weight: bold;'
    );

    try {
      // 1. Tags e serialização
      const bodyHashtags = extractHashtagsFromText(item.content);
      const combinedTags = normalizeTags([...(item.tags || []), ...bodyHashtags]);
      const fullMarkdown = serializeMarkdownWithTags(item.content, combinedTags);

      // 2. Gravação do arquivo .md no Supabase Storage (notes/{userId}/{noteId}.md)
      const storageSuccess = await writeNoteMarkdown(item.userId, item.noteId, fullMarkdown);

      // 3. Atualização no banco Supabase
      if (isSupabaseConfigured()) {
        const supabase = createClient();
        const { error: updateErr } = await supabase
          .from('notes')
          .update({
            content: item.content,
            tags: combinedTags,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.noteId)
          .eq('user_id', item.userId);

        if (updateErr) {
          console.error('[SaveQueue] Erro ao sincronizar tabela notes:', updateErr);
        }
      }

      state.persistedVersion = item.version;
      const durationMs = Math.round(performance.now() - startTime);

      console.log(
        `%c[PERSISTÊNCIA] NOTE ${item.noteId} | VERSION ${item.version} | IMAGES ${imageCount} | SAVE SUCCESS (${durationMs}ms)`,
        'color: #16a34a; font-weight: bold;'
      );

      item.resolve({
        success: storageSuccess,
        tags: combinedTags,
        version: item.version,
      });
    } catch (err: any) {
      console.error(
        `%c[PERSISTÊNCIA] NOTE ${item.noteId} | VERSION ${item.version} | SAVE FAILED`,
        'color: #dc2626; font-weight: bold;',
        err
      );
      item.reject(err);
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
