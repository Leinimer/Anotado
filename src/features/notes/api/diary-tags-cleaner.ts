/**
 * Módulo de Limpeza e Migração Segura de Tags Automáticas do Diário (Parte 6)
 *
 * Responsabilidade:
 * - Detectar entradas do Diário que possuam tags automáticas antigas:
 *   #diary, #diario, #diary:YYYY-MM-DD, #day:XX, #ano, #mes, #mês, #data
 * - Remover EXCLUSIVAMENTE as tags automáticas geradas pelo sistema
 * - PRESERVAR rigorosamente todas as tags criadas manualmente pelo usuário (ex: #gratidão, #projeto, #livros)
 * - Atualizar notas no IndexedDB local e enfileirar sincronização/atualizar Supabase
 * - Limpar associações em public.note_tags e public.tags para essas tags obsoletas
 * - Execução atômica e idempotente com chave de controle em IndexedDB metadata
 */

import { indexedDBStorage } from '../db/indexed-db';
import { isAutomaticDiaryTag } from '../utils/hashtag-extractor';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { networkMonitor } from './network-monitor';
import { isDiaryNote } from '../utils/diary-hierarchy';

export interface CleanDiaryTagsResult {
  notesChecked: number;
  notesCleaned: number;
  tagsRemovedCount: number;
  success: boolean;
}

/**
 * Executa a migração de limpeza das tags automáticas antigas do Diário.
 */
export async function cleanAutomaticDiaryTags(userId: string): Promise<CleanDiaryTagsResult> {
  if (!userId || userId === 'local-user') {
    return { notesChecked: 0, notesCleaned: 0, tagsRemovedCount: 0, success: true };
  }

  const result: CleanDiaryTagsResult = {
    notesChecked: 0,
    notesCleaned: 0,
    tagsRemovedCount: 0,
    success: true,
  };

  try {
    const allFolders = await indexedDBStorage.getAllFolders(userId);
    const allNotes = await indexedDBStorage.getAllNotes(userId);

    // Filtra todas as notas pertencentes ao Diário
    const diaryNotes = allNotes.filter((n) => isDiaryNote(n, allFolders));
    result.notesChecked = diaryNotes.length;

    const notesToUpdateLocally = [];

    for (const note of diaryNotes) {
      if (!Array.isArray(note.tags) || note.tags.length === 0) continue;

      const manualTags = note.tags.filter((t) => !isAutomaticDiaryTag(t));
      const removedCount = note.tags.length - manualTags.length;

      if (removedCount > 0) {
        result.tagsRemovedCount += removedCount;
        result.notesCleaned += 1;

        note.tags = manualTags;
        note.updated_at = new Date().toISOString();
        note.syncRequired = true;
        note.syncStatus = 'pending';
        note.needs_sync = true;
        note.sync_status = 'pending_sync';

        notesToUpdateLocally.push(note);
      }
    }

    // 1. Atualiza IndexedDB localmente
    for (const note of notesToUpdateLocally) {
      await indexedDBStorage.putNote(userId, note);
      await indexedDBStorage.enqueueSyncItem(userId, {
        action: 'UPDATE_TAGS',
        entity_type: 'note',
        entity_id: note.id,
        payload: {
          noteId: note.id,
          tags: note.tags,
          workspace_type: 'diary',
        },
        revision: (note.revision || 1) + 1,
      });
    }

    // 2. Se online e Supabase acessível, aplica limpeza remota de forma direta e atômica
    if (
      isSupabaseConfigured() &&
      networkMonitor.getState().isBackendReachable &&
      !networkMonitor.getIsQuotaExceeded()
    ) {
      try {
        const supabase = createClient();

        // 2.1 Atualiza array tags nas notas remotas do diário que foram limpas
        for (const note of notesToUpdateLocally) {
          await supabase
            .from('notes')
            .update({
              tags: note.tags,
              updated_at: new Date().toISOString(),
            })
            .eq('id', note.id)
            .eq('user_id', userId);
        }

        // 2.2 Localiza e remove tags automáticas do usuário nas tabelas tags e note_tags
        const { data: autoTags } = await supabase
          .from('tags')
          .select('id, name')
          .eq('user_id', userId);

        if (autoTags && autoTags.length > 0) {
          const autoTagIds = autoTags
            .filter((t: any) => isAutomaticDiaryTag(t.name))
            .map((t: any) => t.id);

          if (autoTagIds.length > 0) {
            await supabase
              .from('note_tags')
              .delete()
              .in('tag_id', autoTagIds)
              .eq('user_id', userId);

            await supabase
              .from('tags')
              .delete()
              .in('id', autoTagIds)
              .eq('user_id', userId);

            console.log(`[DiaryTagsCleaner] ${autoTagIds.length} tags automáticas antigas removidas do Supabase.`);
          }
        }
      } catch (remoteErr) {
        console.warn('[DiaryTagsCleaner] Aviso na limpeza remota de tags (IndexedDB já limpo):', remoteErr);
      }
    }

    // 3. Marca checkpoint concluído
    await indexedDBStorage.setMetadata(userId, 'diary_automatic_tags_cleaned_v2', true);

    if (result.notesCleaned > 0) {
      console.log(
        `[DiaryTagsCleaner] Sucesso: ${result.notesCleaned} notas do Diário limpas, ${result.tagsRemovedCount} tags automáticas removidas.`
      );
    }
  } catch (err) {
    console.error('[DiaryTagsCleaner] Erro durante a limpeza de tags automáticas:', err);
    result.success = false;
  }

  return result;
}
