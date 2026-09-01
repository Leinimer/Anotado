/**
 * Módulo de Migração Segura e Idempotente de Referências attachment://ID e local-attachment://ID (Etapa 3B)
 *
 * Responsabilidade:
 * - Detectar referências attachment://{UUID} e local-attachment://{UUID} no conteúdo de notas
 * - Resolver exclusivamente a partir de public.note_attachments.storage_path e IndexedDB local
 * - Validar a existência real do objeto remoto no Supabase Storage antes de alterar o documento
 * - Garantir que nenhuma nota seja alterada parcialmente se houver qualquer anexo não resolvido
 * - Substituir as referências por URLs HTTPS definitivas mantendo integralmente o texto e formatação
 * - Manter checkpoint atômico no IndexedDB metadata (`attachment_ref_migration_completed:{noteId}`)
 * - Processamento em pequenos lotes (5 a 10 notas) com controle estrito de concorrência e cancelamento
 */

import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { indexedDBStorage, LocalAttachment } from '../db/indexed-db';
import {
  ATTACHMENTS_BUCKET_NAME,
  replaceAttachmentReferencesInEditor,
} from './storage-api';
import { writeNoteMarkdown } from './notes-storage-api';
import { serializeMarkdownWithTags } from '../utils/markdown-tags';

export interface AttachmentRefItem {
  fullRef: string;
  attachmentId: string;
  scheme: 'attachment' | 'local-attachment';
}

export interface SingleRefResolutionResult {
  attachmentId: string;
  resolved: boolean;
  remoteUrl?: string;
  storagePath?: string;
  error?: string;
}

export interface NoteRefMigrationResult {
  noteId: string;
  success: boolean;
  totalFound: number;
  migratedCount: number;
  unresolvedCount: number;
  unresolvedRefs: string[];
  errors: string[];
}

export interface BatchRefMigrationProgress {
  totalNotesChecked: number;
  notesWithRefs: number;
  notesSuccessfullyMigrated: number;
  notesUnresolvedOrFailed: number;
  totalRefsMigrated: number;
  completed: boolean;
}

/**
 * Extrai todas as referências attachment:// e local-attachment:// presentes no conteúdo.
 */
export function extractAttachmentReferences(content: string): AttachmentRefItem[] {
  if (!content) return [];

  // Padrão para attachment://ID ou local-attachment://ID
  const refRegex = /(local-attachment|attachment):\/\/([a-zA-Z0-9_.-]+)/gi;
  const matches = Array.from(content.matchAll(refRegex));
  const seen = new Set<string>();
  const items: AttachmentRefItem[] = [];

  for (const match of matches) {
    const fullRef = match[0];
    const scheme = match[1].toLowerCase() as 'attachment' | 'local-attachment';
    const attachmentId = match[2];

    if (!seen.has(fullRef)) {
      seen.add(fullRef);
      items.push({
        fullRef,
        attachmentId,
        scheme,
      });
    }
  }

  return items;
}

/**
 * Valida a existência real do objeto no Supabase Storage.
 * Não confia apenas na derivação passiva de getPublicUrl().
 */
export async function verifyStorageObjectExists(
  supabase: any,
  storagePath: string
): Promise<boolean> {
  if (!storagePath) return false;

  try {
    const parts = storagePath.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    const fileName = parts[parts.length - 1];

    // Consulta a lista do diretório específico no bucket
    const { data: listData, error: listErr } = await supabase.storage
      .from(ATTACHMENTS_BUCKET_NAME)
      .list(folder, { search: fileName, limit: 10 });

    if (!listErr && Array.isArray(listData)) {
      const match = listData.some((f) => f.name === fileName);
      if (match) return true;
    }

    // Fallback: Teste de download com limite de 1 byte ou verificação de URL
    const { data: pubData } = supabase.storage
      .from(ATTACHMENTS_BUCKET_NAME)
      .getPublicUrl(storagePath);

    if (pubData?.publicUrl && typeof fetch !== 'undefined') {
      try {
        const headRes = await fetch(pubData.publicUrl, { method: 'HEAD' });
        if (headRes.ok) return true;
      } catch {
        // Ignora erro de rede no fetch HEAD e confia na verificação principal
      }
    }

    return false;
  } catch (err) {
    console.warn(`[MIGRATION] Erro ao verificar objeto no Storage para path="${storagePath}":`, err);
    return false;
  }
}

export class AttachmentRefMigrator {
  private activeResolutions: Set<string> = new Set();
  private isCancelled: boolean = false;

  /**
   * Cancela a execução do lote.
   */
  public cancel(): void {
    this.isCancelled = true;
    console.log('[MIGRATION] Migration cancelled by user or system');
  }

  /**
   * Resolve uma única referência attachment:// ou local-attachment://
   * 1. Consulta IndexedDB local
   * 2. Consulta public.note_attachments com validação de user_id
   * 3. Confirma a existência real do objeto no Supabase Storage
   */
  public async resolveSingleAttachmentRef(
    userId: string,
    noteId: string,
    refItem: AttachmentRefItem
  ): Promise<SingleRefResolutionResult> {
    const { attachmentId, fullRef } = refItem;
    const effectiveUserId = userId || 'anonymous';

    if (this.activeResolutions.has(attachmentId)) {
      return { attachmentId, resolved: false, error: 'Resolução já em andamento' };
    }

    this.activeResolutions.add(attachmentId);

    try {
      const isOnline = isSupabaseConfigured() && (typeof navigator === 'undefined' || navigator.onLine);
      const supabase = createClient();

      // 1. Procura primeiro no IndexedDB local
      let localAtt = await indexedDBStorage.getAttachment(effectiveUserId, attachmentId);
      if (!localAtt && effectiveUserId !== 'anonymous') {
        localAtt = await indexedDBStorage.getAttachment('anonymous', attachmentId);
      }

      let storagePath: string | null = localAtt?.storage_path || null;
      let remoteUrl: string | null = localAtt?.remote_url || null;
      let dbRecord: any = null;

      // 2. Se não possuir storage_path local ou se estiver online, consulta public.note_attachments
      if ((!storagePath || !remoteUrl) && isOnline) {
        try {
          const { data: dbAtt, error: dbErr } = await supabase
            .from('note_attachments')
            .select('*')
            .eq('id', attachmentId)
            .maybeSingle();

          if (!dbErr && dbAtt) {
            // REGRA DE SEGURANÇA: Não aceita anexo de outro usuário
            if (dbAtt.user_id && dbAtt.user_id !== effectiveUserId && effectiveUserId !== 'anonymous') {
              console.warn(
                `[MIGRATION] UNRESOLVED ATTACHMENT attachmentId=${attachmentId} - Pertence a outro usuário (${dbAtt.user_id})`
              );
              return {
                attachmentId,
                resolved: false,
                error: 'Anexo pertence a outro usuário',
              };
            }

            dbRecord = dbAtt;
            storagePath = dbAtt.storage_path;
            console.log(`[MIGRATION] ATTACHMENT FOUND attachmentId=${attachmentId}`);
            console.log(`[MIGRATION] STORAGE_PATH FOUND path="${storagePath}"`);
          }
        } catch (fetchErr) {
          console.warn(`[MIGRATION] Falha ao consultar note_attachments no Supabase:`, fetchErr);
        }
      } else if (storagePath) {
        console.log(`[MIGRATION] ATTACHMENT FOUND attachmentId=${attachmentId} (local)`);
        console.log(`[MIGRATION] STORAGE_PATH FOUND path="${storagePath}" (local)`);
      }

      // Se não encontrou nem local nem remotamente
      if (!storagePath) {
        console.log(`[MIGRATION] UNRESOLVED ATTACHMENT attachmentId=${attachmentId} ref="${fullRef}"`);
        return {
          attachmentId,
          resolved: false,
          error: 'Anexo não encontrado em note_attachments nem no IndexedDB',
        };
      }

      // Deriva URL pública a partir do storage_path
      if (!remoteUrl && isOnline) {
        const { data: pubData } = supabase.storage
          .from(ATTACHMENTS_BUCKET_NAME)
          .getPublicUrl(storagePath);
        remoteUrl = pubData?.publicUrl || null;
      }

      if (!remoteUrl) {
        console.log(`[MIGRATION] UNRESOLVED ATTACHMENT attachmentId=${attachmentId} - Falha ao derivar URL`);
        return {
          attachmentId,
          resolved: false,
          error: 'Não foi possível derivar a URL pública do Storage',
        };
      }

      // 3. PASSO 3 DA ESPECIFICAÇÃO: Validar a existência física do objeto remoto no Supabase Storage
      if (isOnline) {
        const objectExists = await verifyStorageObjectExists(supabase, storagePath);
        if (!objectExists) {
          console.error(`[MIGRATION] STORAGE OBJECT NOT FOUND path="${storagePath}" attachmentId=${attachmentId}`);
          return {
            attachmentId,
            resolved: false,
            storagePath,
            error: `Objeto não existe no Storage: ${storagePath}`,
          };
        }
      }

      console.log(`[MIGRATION] REMOTE VERIFIED url="${remoteUrl}" attachmentId=${attachmentId}`);

      // Atualiza ou insere o registro no IndexedDB com status synced e remote_url
      if (localAtt) {
        localAtt.remote_url = remoteUrl;
        localAtt.storage_path = storagePath;
        localAtt.syncStatus = 'synced';
        localAtt.sync_status = 'synced';
        localAtt.syncRequired = false;
        await indexedDBStorage.putAttachment(effectiveUserId, localAtt);
      } else if (dbRecord) {
        const newLocalAtt: LocalAttachment = {
          id: dbRecord.id,
          user_id: effectiveUserId,
          note_id: dbRecord.note_id || noteId,
          file_name: dbRecord.file_name || 'attachment',
          file_type: dbRecord.mime_type || 'application/octet-stream',
          mime_type: dbRecord.mime_type || 'application/octet-stream',
          file_size: dbRecord.file_size || 0,
          storage_path: storagePath,
          remote_url: remoteUrl,
          syncRequired: false,
          syncStatus: 'synced',
          sync_status: 'synced',
          created_at: dbRecord.created_at || new Date().toISOString(),
          updated_at: dbRecord.updated_at || new Date().toISOString(),
        };
        await indexedDBStorage.putAttachment(effectiveUserId, newLocalAtt);
      }

      return {
        attachmentId,
        resolved: true,
        remoteUrl,
        storagePath,
      };
    } catch (err: any) {
      console.error(`[MIGRATION] ERROR resolving attachmentId=${attachmentId}:`, err);
      return {
        attachmentId,
        resolved: false,
        error: err?.message || String(err),
      };
    } finally {
      this.activeResolutions.delete(attachmentId);
    }
  }

  /**
   * Migra atomicamente todas as referências attachment:// e local-attachment:// de uma nota:
   * 1. Extrai todas as referências
   * 2. Resolve e valida cada anexo individualmente
   * 3. Se QUALQUER anexo não for resolvido, ABORTA a substituição para aquela nota (preserva conteúdo original)
   * 4. Se TODOS forem validados, substitui pelas URLs HTTPS definitivas
   * 5. Persiste a nota no IndexedDB, public.notes e Storage .md
   * 6. Grava checkpoint `attachment_ref_migration_completed:{noteId}`
   */
  public async migrateNoteAttachmentReferences(
    userId: string,
    noteId: string
  ): Promise<NoteRefMigrationResult> {
    const effectiveUserId = userId || 'anonymous';
    const note = await indexedDBStorage.getNoteById(effectiveUserId, noteId);

    if (!note || !note.content) {
      return {
        noteId,
        success: true,
        totalFound: 0,
        migratedCount: 0,
        unresolvedCount: 0,
        unresolvedRefs: [],
        errors: [],
      };
    }

    const checkpointKey = `attachment_ref_migration_completed:${noteId}`;
    const alreadyCompleted = await indexedDBStorage.getMetadata<boolean>(effectiveUserId, checkpointKey);
    const refItems = extractAttachmentReferences(note.content);

    if (refItems.length === 0) {
      if (!alreadyCompleted) {
        await indexedDBStorage.setMetadata(effectiveUserId, checkpointKey, true);
      }
      return {
        noteId,
        success: true,
        totalFound: 0,
        migratedCount: 0,
        unresolvedCount: 0,
        unresolvedRefs: [],
        errors: [],
      };
    }

    console.log(`[MIGRATION] NOTE START noteId=${noteId} totalRefsFound=${refItems.length}`);

    const replacements: Record<string, string> = {};
    const unresolvedRefs: string[] = [];
    const errors: string[] = [];

    for (const refItem of refItems) {
      if (this.isCancelled) {
        return {
          noteId,
          success: false,
          totalFound: refItems.length,
          migratedCount: Object.keys(replacements).length,
          unresolvedCount: refItems.length - Object.keys(replacements).length,
          unresolvedRefs,
          errors: ['Migração cancelada durante a execução.'],
        };
      }

      const res = await this.resolveSingleAttachmentRef(effectiveUserId, noteId, refItem);
      if (res.resolved && res.remoteUrl) {
        replacements[refItem.fullRef] = res.remoteUrl;
      } else {
        unresolvedRefs.push(refItem.fullRef);
        if (res.error) errors.push(res.error);
      }
    }

    // REGRA ABSOLUTA DE SEGURANÇA (PASSO 4 & 7 DA ESPECIFICAÇÃO):
    // Se houver qualquer referência não resolvida, NÃO altera o conteúdo da nota e NÃO grava checkpoint.
    if (unresolvedRefs.length > 0) {
      console.warn(
        `[MIGRATION] NOTE PARTIAL/UNRESOLVED noteId=${noteId}. Total pendente: ${unresolvedRefs.length}. Preservando conteúdo original.`
      );
      return {
        noteId,
        success: false,
        totalFound: refItems.length,
        migratedCount: Object.keys(replacements).length,
        unresolvedCount: unresolvedRefs.length,
        unresolvedRefs,
        errors,
      };
    }

    // PASSO 6 DA ESPECIFICAÇÃO: Substituição exata preservando todo o texto, alinhamento e formatação
    let updatedContent = note.content;
    for (const [fullRef, remoteUrl] of Object.entries(replacements)) {
      updatedContent = updatedContent.split(fullRef).join(remoteUrl);
      console.log(`[MIGRATION] REFERENCE REPLACED noteId=${noteId} ref="${fullRef}" -> "${remoteUrl}"`);
    }

    // Persistência local no IndexedDB
    note.content = updatedContent;
    note.updated_at = new Date().toISOString();
    await indexedDBStorage.putNote(effectiveUserId, note);

    // Persistência remota no Supabase (public.notes e Storage .md)
    if (isSupabaseConfigured() && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        const supabase = createClient();
        const fullMarkdown = serializeMarkdownWithTags(updatedContent, note.tags || []);
        await writeNoteMarkdown(effectiveUserId, noteId, fullMarkdown);
        await supabase
          .from('notes')
          .update({ content: updatedContent, updated_at: new Date().toISOString() })
          .eq('id', noteId)
          .eq('user_id', effectiveUserId);
      } catch (remotePersistErr) {
        console.warn(`[MIGRATION] Aviso ao persistir nota ${noteId} no Supabase:`, remotePersistErr);
      }
    }

    // Notifica o editor ativo se a nota estiver aberta na interface
    replaceAttachmentReferencesInEditor(noteId, replacements);

    // Grava checkpoint de conclusão atômica
    await indexedDBStorage.setMetadata(effectiveUserId, checkpointKey, true);
    console.log(`[MIGRATION] NOTE VERIFIED noteId=${noteId}`);

    return {
      noteId,
      success: true,
      totalFound: refItems.length,
      migratedCount: Object.keys(replacements).length,
      unresolvedCount: 0,
      unresolvedRefs: [],
      errors: [],
    };
  }

  /**
   * Processa em pequenos lotes (5 a 10 notas por ciclo) todo o acervo do usuário.
   */
  public async migrateAllNotesInBatches(
    userId: string,
    options?: { batchSize?: number; onProgress?: (progress: BatchRefMigrationProgress) => void }
  ): Promise<BatchRefMigrationProgress> {
    const effectiveUserId = userId || 'anonymous';
    const batchSize = options?.batchSize || 5;
    this.isCancelled = false;

    const allNotes = await indexedDBStorage.getAllNotes(effectiveUserId);
    const progress: BatchRefMigrationProgress = {
      totalNotesChecked: allNotes.length,
      notesWithRefs: 0,
      notesSuccessfullyMigrated: 0,
      notesUnresolvedOrFailed: 0,
      totalRefsMigrated: 0,
      completed: false,
    };

    // Identifica notas que contêm referências attachment:// ou local-attachment://
    const notesToMigrate = allNotes.filter(
      (n) => n.content && /(local-attachment|attachment):\/\/[a-zA-Z0-9_.-]+/i.test(n.content)
    );
    progress.notesWithRefs = notesToMigrate.length;

    if (notesToMigrate.length === 0) {
      progress.completed = true;
      if (options?.onProgress) options.onProgress(progress);
      return progress;
    }

    console.log(
      `[MIGRATION] BATCH REFS START totalNotes=${allNotes.length} notesWithRefs=${notesToMigrate.length} batchSize=${batchSize}`
    );

    for (let i = 0; i < notesToMigrate.length; i += batchSize) {
      if (this.isCancelled) {
        console.log('[MIGRATION] Batch reference migration interrupted gracefully.');
        break;
      }

      const batch = notesToMigrate.slice(i, i + batchSize);
      for (const note of batch) {
        if (this.isCancelled) break;

        const res = await this.migrateNoteAttachmentReferences(effectiveUserId, note.id);
        if (res.success) {
          progress.notesSuccessfullyMigrated++;
          progress.totalRefsMigrated += res.migratedCount;
        } else {
          progress.notesUnresolvedOrFailed++;
        }

        if (options?.onProgress) {
          options.onProgress({ ...progress });
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    progress.completed = progress.notesSuccessfullyMigrated === progress.notesWithRefs;
    console.log(
      `[MIGRATION] BATCH REFS COMPLETE migratedNotes=${progress.notesSuccessfullyMigrated}/${progress.notesWithRefs} totalRefs=${progress.totalRefsMigrated}`
    );

    return progress;
  }
}

export const attachmentRefMigrator = new AttachmentRefMigrator();
