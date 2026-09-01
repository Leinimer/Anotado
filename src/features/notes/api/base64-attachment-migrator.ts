/**
 * Módulo de Migração Idempotente de Anexos Base64 Legados (Etapa 3A)
 *
 * Responsabilidade:
 * - Detectar anexos Base64 (data:image/...) no conteúdo de notas
 * - Converter em Blobs binários e reutilizar o pipeline central UPLOAD_ATTACHMENT (SyncEngine + Supabase Storage)
 * - Confirmar cada etapa (Blob -> Upload -> note_attachments -> URL pública -> persistência da nota)
 * - Substituir a referência Base64 pela URL remota HTTPS definitiva
 * - Manter checkpoint atômico no IndexedDB metadata (`attachment_migration_completed:{noteId}`)
 * - Processamento em pequenos lotes (5 a 10 notas), limitando concorrência e permitindo cancelamento/retomada segura.
 */

import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { indexedDBStorage, LocalAttachment } from '../db/indexed-db';
import {
  base64ToBlob,
  ATTACHMENTS_BUCKET_NAME,
  replaceAttachmentReferencesInEditor,
} from './storage-api';
import { writeNoteMarkdown } from './notes-storage-api';
import { serializeMarkdownWithTags } from '../utils/markdown-tags';

export interface Base64MigrationItem {
  fullDataUri: string;
  mimeType: string;
  extension: string;
  approxSize: number;
  deterministicId: string;
}

export interface NoteBase64MigrationResult {
  noteId: string;
  success: boolean;
  totalFound: number;
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: string[];
}

export interface BatchMigrationProgress {
  totalNotesChecked: number;
  notesWithBase64: number;
  notesSuccessfullyMigrated: number;
  notesFailed: number;
  totalImagesMigrated: number;
  completed: boolean;
}

/**
 * Gera um ID determinístico estável a partir do conteúdo Base64 para garantir idempotência estrita.
 */
export function generateDeterministicAttachmentId(noteId: string, base64Data: string, index: number): string {
  // Pega uma assinatura única baseada no comprimento, prefixo e amostras centrais/finais do Base64
  const clean = base64Data.replace(/\s/g, '');
  const len = clean.length;
  const sample1 = clean.slice(0, 32);
  const sample2 = clean.slice(Math.floor(len / 2), Math.floor(len / 2) + 32);
  const sample3 = clean.slice(-32);

  // Hash numérico simples e estável
  let hash = 0;
  const str = `${noteId}_${index}_${len}_${sample1}_${sample2}_${sample3}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const hexHash = Math.abs(hash).toString(16).padStart(8, '0');
  return `b64mig_${noteId.slice(0, 8)}_${index}_${hexHash}`;
}

/**
 * Extrai todas as ocorrências de Data URI Base64 de uma string de conteúdo.
 */
export function extractBase64Images(noteId: string, content: string): Base64MigrationItem[] {
  if (!content) return [];

  // Suporta todos os tipos MIME de imagens (png, jpeg, jpg, webp, gif, svg+xml, avif, bmp, tiff, etc.)
  const base64Regex = /data:(image\/[a-zA-Z0-9.+_-]+);base64,([a-zA-Z0-9+/=\s]+)/gi;
  const matches = Array.from(content.matchAll(base64Regex));
  const items: Base64MigrationItem[] = [];

  matches.forEach((match, idx) => {
    const fullDataUri = match[0];
    const mimeType = (match[1] || 'image/png').toLowerCase();
    const base64Body = (match[2] || '').replace(/\s/g, '');
    const approxSize = Math.round((base64Body.length * 3) / 4);

    let extension = 'png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) extension = 'jpeg';
    else if (mimeType.includes('webp')) extension = 'webp';
    else if (mimeType.includes('gif')) extension = 'gif';
    else if (mimeType.includes('svg')) extension = 'svg';
    else if (mimeType.includes('avif')) extension = 'avif';
    else if (mimeType.includes('bmp')) extension = 'bmp';
    else if (mimeType.includes('png')) extension = 'png';

    const deterministicId = generateDeterministicAttachmentId(noteId, fullDataUri, idx);

    items.push({
      fullDataUri,
      mimeType,
      extension,
      approxSize,
      deterministicId,
    });
  });

  return items;
}

/**
 * Classe responsável por executar a migração segura e idempotente de anexos Base64.
 */
export class Base64AttachmentMigrator {
  private activeUploads: Set<string> = new Set();
  private isCancelled: boolean = false;

  /**
   * Cancela a execução do lote atual.
   */
  public cancel(): void {
    this.isCancelled = true;
    console.log('[MIGRATION] Migration cancelled by user or system');
  }

  /**
   * Processa uma única mídia Base64:
   * 1. Valida se já existe no Supabase Storage e public.note_attachments (reutiliza se já existir)
   * 2. Converte para Blob binário e valida size > 0
   * 3. Faz upload para o bucket note-attachments do Supabase Storage
   * 4. Registra/Upsert em public.note_attachments
   * 5. Obtém URL pública definitiva
   * 6. Atualiza registro no IndexedDB
   */
  public async migrateSingleBase64Media(
    userId: string,
    noteId: string,
    item: Base64MigrationItem
  ): Promise<{ success: boolean; remoteUrl?: string; attachmentId: string; error?: string }> {
    const { fullDataUri, mimeType, extension, deterministicId } = item;
    const effectiveUserId = userId || 'anonymous';
    const filePath = `${effectiveUserId}/${deterministicId}.${extension}`;
    const fileName = `migrated_${deterministicId.slice(0, 12)}.${extension}`;

    // Bloqueia concorrência sobre o mesmo attachmentId
    if (this.activeUploads.has(deterministicId)) {
      console.log(`[MIGRATION] UPLOAD ALREADY IN FLIGHT attachmentId=${deterministicId}`);
      return { success: false, attachmentId: deterministicId, error: 'Upload já em andamento' };
    }

    this.activeUploads.add(deterministicId);
    console.log(`[MIGRATION] NOTE START noteId=${noteId}`);
    console.log(`[MIGRATION] BASE64 FOUND mimeType="${mimeType}" approxSize=${item.approxSize}`);

    try {
      const supabase = createClient();
      const isOnline = isSupabaseConfigured() && (typeof navigator === 'undefined' || navigator.onLine);

      if (!isOnline) {
        throw new Error('Conexão com o Supabase indisponível para migração.');
      }

      // PASSO 8 DA ESPECIFICAÇÃO: Verifica se o anexo já possui storage_path, remote_url e note_attachments válidos
      const localExisting = await indexedDBStorage.getAttachment(effectiveUserId, deterministicId);
      if (localExisting && localExisting.remote_url && localExisting.syncStatus === 'synced') {
        console.log(`[MIGRATION] REUSING EXISTING ATTACHMENT attachmentId=${deterministicId} url="${localExisting.remote_url}"`);
        return { success: true, remoteUrl: localExisting.remote_url, attachmentId: deterministicId };
      }

      // Consulta se o registro já existe no Supabase (note_attachments)
      try {
        const { data: dbExisting } = await supabase
          .from('note_attachments')
          .select('*')
          .eq('id', deterministicId)
          .maybeSingle();

        if (dbExisting && dbExisting.storage_path) {
          const { data: pubData } = supabase.storage
            .from(ATTACHMENTS_BUCKET_NAME)
            .getPublicUrl(dbExisting.storage_path);

          if (pubData?.publicUrl) {
            console.log(`[MIGRATION] REUSING REMOTE ATTACHMENT attachmentId=${deterministicId} url="${pubData.publicUrl}"`);
            await indexedDBStorage.putAttachment(effectiveUserId, {
              id: deterministicId,
              user_id: effectiveUserId,
              note_id: noteId,
              file_name: dbExisting.file_name || fileName,
              file_type: dbExisting.mime_type || mimeType,
              mime_type: dbExisting.mime_type || mimeType,
              file_size: dbExisting.file_size || item.approxSize,
              storage_path: dbExisting.storage_path,
              remote_url: pubData.publicUrl,
              syncRequired: false,
              syncStatus: 'synced',
              sync_status: 'synced',
              created_at: dbExisting.created_at,
              updated_at: dbExisting.updated_at,
            });
            return { success: true, remoteUrl: pubData.publicUrl, attachmentId: deterministicId };
          }
        }
      } catch (checkErr) {
        console.warn('[MIGRATION] Aviso na checagem de existência prévia:', checkErr);
      }

      // PASSO 5 DA ESPECIFICAÇÃO: Conversão e validação do Blob
      const { blob } = base64ToBlob(fullDataUri);
      if (!blob || blob.size === 0) {
        throw new Error(`Falha ao converter Base64 em Blob binário válido (size=${blob?.size || 0}).`);
      }
      console.log(`[MIGRATION] BLOB CREATED size=${blob.size} mimeType="${blob.type}"`);

      // PASSO 3 & 7 DA ESPECIFICAÇÃO: Upload para o Supabase Storage via bucket central
      console.log(`[MIGRATION] UPLOAD START path="${filePath}"`);
      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET_NAME)
        .upload(filePath, blob, {
          contentType: mimeType,
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) {
        console.error(`[MIGRATION] ERROR upload failed: ${uploadError.message}`);
        throw new Error(`Falha no upload para o Storage: ${uploadError.message}`);
      }

      // Obtém a URL pública definitiva
      const { data: publicUrlData } = supabase.storage
        .from(ATTACHMENTS_BUCKET_NAME)
        .getPublicUrl(filePath);

      const remoteUrl = publicUrlData?.publicUrl;
      if (!remoteUrl) {
        throw new Error('Não foi possível derivar a URL pública do Storage.');
      }
      console.log(`[MIGRATION] UPLOAD SUCCESS url="${remoteUrl}"`);

      // PASSO 9 DA ESPECIFICAÇÃO: Registra / Upsert na tabela public.note_attachments
      const nowIso = new Date().toISOString();
      const { error: dbErr } = await supabase.from('note_attachments').upsert({
        id: deterministicId,
        note_id: noteId,
        user_id: effectiveUserId,
        file_name: fileName,
        mime_type: mimeType,
        file_size: blob.size,
        storage_path: filePath,
        created_at: nowIso,
        updated_at: nowIso,
      });

      if (dbErr) {
        console.error(`[MIGRATION] ERROR note_attachments insert failed: ${dbErr.message}`);
        throw new Error(`Falha ao registrar em public.note_attachments: ${dbErr.message}`);
      }
      console.log(`[MIGRATION] NOTE_ATTACHMENT CREATED id=${deterministicId}`);

      // Salva no cache do IndexedDB com status synced
      const localAttachment: LocalAttachment = {
        id: deterministicId,
        user_id: effectiveUserId,
        note_id: noteId,
        file_name: fileName,
        file_type: mimeType,
        mime_type: mimeType,
        file_size: blob.size,
        storage_path: filePath,
        remote_url: remoteUrl,
        syncRequired: false,
        syncStatus: 'synced',
        sync_status: 'synced',
        created_at: nowIso,
        updated_at: nowIso,
      };
      await indexedDBStorage.putAttachment(effectiveUserId, localAttachment);

      return { success: true, remoteUrl, attachmentId: deterministicId };
    } catch (err: any) {
      console.error(`[MIGRATION] ERROR noteId=${noteId} attachmentId=${deterministicId}:`, err?.message || err);
      return { success: false, attachmentId: deterministicId, error: err?.message || String(err) };
    } finally {
      this.activeUploads.delete(deterministicId);
    }
  }

  /**
   * Migra atomicamente todos os anexos Base64 de uma única nota:
   * 1. Extrai todas as imagens Base64
   * 2. Executa a migração individual de cada imagem
   * 3. Garante que TODAS as imagens foram migradas com sucesso antes de substituir qualquer conteúdo
   * 4. Substitui os Base64 pelas URLs HTTPS mantendo a ordem exata do texto
   * 5. Persiste no IndexedDB, Supabase (public.notes) e Storage (.md)
   * 6. Grava o checkpoint `attachment_migration_completed:{noteId}`
   */
  public async migrateNoteBase64Attachments(
    userId: string,
    noteId: string
  ): Promise<NoteBase64MigrationResult> {
    const effectiveUserId = userId || 'anonymous';
    const note = await indexedDBStorage.getNoteById(effectiveUserId, noteId);

    if (!note || !note.content) {
      return {
        noteId,
        success: true,
        totalFound: 0,
        migratedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        errors: [],
      };
    }

    // PASSO 11 DA ESPECIFICAÇÃO: Verifica se já existe checkpoint de migração concluída para esta nota
    const checkpointKey = `attachment_migration_completed:${noteId}`;
    const alreadyCompleted = await indexedDBStorage.getMetadata<boolean>(effectiveUserId, checkpointKey);
    const base64Items = extractBase64Images(noteId, note.content);

    if (base64Items.length === 0) {
      // Se não há Base64, marca checkpoint e retorna
      if (!alreadyCompleted) {
        await indexedDBStorage.setMetadata(effectiveUserId, checkpointKey, true);
      }
      return {
        noteId,
        success: true,
        totalFound: 0,
        migratedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        errors: [],
      };
    }

    console.log(`[MIGRATION] NOTE START noteId=${noteId} totalBase64Found=${base64Items.length}`);

    const replacements: Record<string, string> = {};
    const errors: string[] = [];
    let migratedCount = 0;

    // Processa os anexos com concorrência máxima de 2 por vez
    for (let i = 0; i < base64Items.length; i += 2) {
      if (this.isCancelled) {
        return {
          noteId,
          success: false,
          totalFound: base64Items.length,
          migratedCount,
          skippedCount: 0,
          failedCount: base64Items.length - migratedCount,
          errors: ['Migração cancelada durante a execução.'],
        };
      }

      const chunk = base64Items.slice(i, i + 2);
      const results = await Promise.all(
        chunk.map((item) => this.migrateSingleBase64Media(effectiveUserId, noteId, item))
      );

      for (let j = 0; j < results.length; j++) {
        const res = results[j];
        const originalItem = chunk[j];
        if (res.success && res.remoteUrl) {
          replacements[originalItem.fullDataUri] = res.remoteUrl;
          migratedCount++;
        } else {
          errors.push(res.error || `Falha no anexo ${res.attachmentId}`);
        }
      }
    }

    // REGRA ABSOLUTA DE SEGURANÇA (PASSO 2 & 11 DA ESPECIFICAÇÃO):
    // Se qualquer imagem falhar, NÃO altera o conteúdo da nota e NÃO grava checkpoint de conclusão.
    if (migratedCount !== base64Items.length || errors.length > 0) {
      console.warn(
        `[MIGRATION] NOTE PARTIAL/FAILED noteId=${noteId} migrated=${migratedCount}/${base64Items.length}. Preservando conteúdo original.`
      );
      return {
        noteId,
        success: false,
        totalFound: base64Items.length,
        migratedCount,
        skippedCount: 0,
        failedCount: base64Items.length - migratedCount,
        errors,
      };
    }

    // PASSO 10 & 15 DA ESPECIFICAÇÃO: Substituição exata das strings Base64 pelas URLs HTTPS definitivas
    let updatedContent = note.content;
    for (const [dataUri, remoteUrl] of Object.entries(replacements)) {
      updatedContent = updatedContent.split(dataUri).join(remoteUrl);
    }
    console.log(`[MIGRATION] CONTENT UPDATED noteId=${noteId}`);

    // PASSO 18 DA ESPECIFICAÇÃO: Validação de Integridade pós-substituição
    if (updatedContent.includes(';base64,')) {
      console.error(`[MIGRATION] ERROR content still contains base64 noteId=${noteId}`);
      return {
        noteId,
        success: false,
        totalFound: base64Items.length,
        migratedCount: 0,
        failedCount: base64Items.length,
        skippedCount: 0,
        errors: ['O conteúdo resultante ainda continha fragmentos Base64.'],
      };
    }

    // Persistência local no IndexedDB
    note.content = updatedContent;
    note.updated_at = new Date().toISOString();
    await indexedDBStorage.putNote(effectiveUserId, note);

    // Persistência remota no Supabase se online
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

    // Notifica o editor ativo se a nota estiver aberta em tela
    replaceAttachmentReferencesInEditor(noteId, replacements);

    // Grava checkpoint de conclusão atômica
    await indexedDBStorage.setMetadata(effectiveUserId, checkpointKey, true);
    console.log(`[MIGRATION] VERIFIED noteId=${noteId}`);
    console.log(`[MIGRATION] NOTE COMPLETE noteId=${noteId}`);

    return {
      noteId,
      success: true,
      totalFound: base64Items.length,
      migratedCount,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    };
  }

  /**
   * Processa em pequenos lotes (5 a 10 notas por ciclo) todo o acervo do usuário.
   */
  public async migrateAllNotesInBatches(
    userId: string,
    options?: { batchSize?: number; onProgress?: (progress: BatchMigrationProgress) => void }
  ): Promise<BatchMigrationProgress> {
    const effectiveUserId = userId || 'anonymous';
    const batchSize = options?.batchSize || 5;
    this.isCancelled = false;

    const allNotes = await indexedDBStorage.getAllNotes(effectiveUserId);
    const progress: BatchMigrationProgress = {
      totalNotesChecked: allNotes.length,
      notesWithBase64: 0,
      notesSuccessfullyMigrated: 0,
      notesFailed: 0,
      totalImagesMigrated: 0,
      completed: false,
    };

    // Identifica notas que realmente contêm Base64
    const notesToMigrate = allNotes.filter(
      (n) => n.content && /data:image\/[a-zA-Z0-9.+_-]+;base64,/i.test(n.content)
    );
    progress.notesWithBase64 = notesToMigrate.length;

    if (notesToMigrate.length === 0) {
      progress.completed = true;
      if (options?.onProgress) options.onProgress(progress);
      return progress;
    }

    console.log(
      `[MIGRATION] BATCH START totalNotes=${allNotes.length} notesWithBase64=${notesToMigrate.length} batchSize=${batchSize}`
    );

    for (let i = 0; i < notesToMigrate.length; i += batchSize) {
      if (this.isCancelled) {
        console.log('[MIGRATION] Batch migration interrupted gracefully.');
        break;
      }

      const batch = notesToMigrate.slice(i, i + batchSize);
      for (const note of batch) {
        if (this.isCancelled) break;

        const res = await this.migrateNoteBase64Attachments(effectiveUserId, note.id);
        if (res.success) {
          progress.notesSuccessfullyMigrated++;
          progress.totalImagesMigrated += res.migratedCount;
        } else {
          progress.notesFailed++;
        }

        if (options?.onProgress) {
          options.onProgress({ ...progress });
        }
      }

      // Pequeno delay (100ms) entre lotes para manter a interface responsiva
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    progress.completed = progress.notesSuccessfullyMigrated === progress.notesWithBase64;
    console.log(
      `[MIGRATION] BATCH COMPLETE migratedNotes=${progress.notesSuccessfullyMigrated}/${progress.notesWithBase64} totalImages=${progress.totalImagesMigrated}`
    );

    return progress;
  }
}

export const base64AttachmentMigrator = new Base64AttachmentMigrator();
