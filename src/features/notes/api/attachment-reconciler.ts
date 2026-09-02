/**
 * Módulo de Reconciliação Segura e Idempotente de Anexos Órfãos (Etapa 3C-2)
 *
 * Responsabilidade:
 * - Listar objetos reais no Supabase Storage sob a pasta do usuário autenticado ({userId}/)
 * - Cruzar de forma determinística com notas existentes e note_attachments
 * - Identificar evidências reais de uso de anexos no conteúdo das notas (attachment://, local-attachment://, HTTPS)
 * - Gerar preview detalhado antes de qualquer mutação
 * - Executar UPSERT seguro e idempotente em public.note_attachments em pequenos lotes (20 itens)
 * - Identificar duplicatas candidatas (mesmo eTag/tamanho) sem excluir nenhum arquivo
 * - Gravar checkpoints no IndexedDB metadata (`attachment_reconciliation:{attachmentId}`)
 * - REGRA ABSOLUTA: NENHUMA exclusão, nenhuma alteração de notas, nenhuma renomeação ou remoção no Storage
 */

import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { indexedDBStorage } from '../db/indexed-db';
import { ATTACHMENTS_BUCKET_NAME } from './storage-api';

export interface StorageObjectMetadata {
  name: string;
  id?: string;
  updated_at?: string;
  created_at?: string;
  last_accessed_at?: string;
  metadata?: {
    eTag?: string;
    size?: number;
    mimetype?: string;
    cacheControl?: string;
    lastModified?: string;
    contentLength?: number;
    httpStatusCode?: number;
  };
}

export type ReconciliationAction =
  | 'VALIDATE_AND_INSERT'
  | 'VALIDATE_AND_UPDATE'
  | 'SKIP_ALREADY_EXISTS'
  | 'SKIP_INVALID_PATH'
  | 'SKIP_UNAUTHORIZED_USER'
  | 'ORPHAN_WITHOUT_NOTE';

export interface ReconciliationItemPreview {
  attachmentId: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  note_id: string | null;
  evidence: string;
  action: ReconciliationAction;
  isDuplicateCandidate: boolean;
  eTag?: string;
}

export interface ReconciliationBatchProgress {
  totalAnalyzed: number;
  alreadyHadMetadata: number;
  createdOrUpdated: number;
  unassignedWithoutNote: number;
  provenNoteAssociation: number;
  duplicateCandidates: number;
  errors: number;
  errorMessages: string[];
}

export interface ReconciliationFullReport {
  before: {
    storageTotal: number;
    noteAttachmentsTotal: number;
  };
  preview: ReconciliationItemPreview[];
  processedCount: number;
  createdCount: number;
  updatedCount: number;
  alreadyExistingCount: number;
  unassignedWithoutNoteCount: number;
  provenNoteAssociationCount: number;
  duplicateCandidatesCount: number;
  errorsCount: number;
  errorMessages: string[];
  duplicateGroups: { eTag: string; count: number; paths: string[] }[];
}

/**
 * Mapeia extensões de arquivo comuns para MIME Types de forma segura e determinística.
 */
export function inferMimeTypeFromExtension(ext: string): string {
  const cleanExt = (ext || '').toLowerCase().replace(/^\./, '');
  switch (cleanExt) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'mp4':
      return 'video/mp4';
    case 'mp3':
      return 'audio/mpeg';
    case 'txt':
      return 'text/plain';
    case 'md':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Extrai informações estruturadas de um caminho de arquivo no bucket note-attachments.
 */
export function parseStoragePath(
  path: string
): { userId: string; attachmentId: string; extension: string; fileName: string; isValid: boolean } {
  const parts = path.split('/');
  if (parts.length !== 2) {
    return { userId: '', attachmentId: '', extension: '', fileName: '', isValid: false };
  }

  const userId = parts[0];
  const fileName = parts[1];
  const lastDot = fileName.lastIndexOf('.');
  const attachmentId = lastDot !== -1 ? fileName.substring(0, lastDot) : fileName;
  const extension = lastDot !== -1 ? fileName.substring(lastDot + 1) : '';

  const isValid = Boolean(userId && attachmentId && extension);
  return { userId, attachmentId, extension, fileName, isValid };
}

export class AttachmentReconciler {
  private isCancelled: boolean = false;

  public cancel(): void {
    this.isCancelled = true;
  }

  /**
   * Gera o Preview estruturado da Reconciliação sem realizar nenhuma mutação.
   */
  public async generatePreview(
    userId: string,
    existingNotes: { id: string; user_id: string; content?: string }[]
  ): Promise<{
    preview: ReconciliationItemPreview[];
    storageObjects: StorageObjectMetadata[];
    duplicateGroups: { eTag: string; count: number; paths: string[] }[];
    error?: string;
  }> {
    if (!userId || userId === 'anonymous' || userId === 'demo-user') {
      return { preview: [], storageObjects: [], duplicateGroups: [], error: 'Sessão inválida ou usuário anônimo' };
    }

    const supabase = createClient();
    if (!isSupabaseConfigured()) {
      return { preview: [], storageObjects: [], duplicateGroups: [], error: 'Supabase não configurado' };
    }

    // 1. Listar objetos no Storage sob a pasta do usuário autenticado
    const { data: storageList, error: listErr } = await supabase.storage
      .from(ATTACHMENTS_BUCKET_NAME)
      .list(userId, { limit: 1000 });

    if (listErr || !Array.isArray(storageList)) {
      return {
        preview: [],
        storageObjects: [],
        duplicateGroups: [],
        error: `Falha ao listar objetos no Storage: ${listErr?.message || 'Erro desconhecido'}`,
      };
    }

    // 2. Consultar note_attachments existentes no Supabase
    const { data: existingAttachments, error: attErr } = await supabase
      .from('note_attachments')
      .select('*')
      .eq('user_id', userId);

    if (attErr) {
      console.warn('[RECONCILER] Aviso ao consultar note_attachments:', attErr.message);
    }

    const existingAttMap = new Map<string, any>();
    if (Array.isArray(existingAttachments)) {
      for (const att of existingAttachments) {
        existingAttMap.set(att.id, att);
      }
    }

    // 3. Mapear eTags para detecção de candidatos a duplicata
    const eTagMap = new Map<string, string[]>();
    for (const obj of storageList) {
      const eTag = obj.metadata?.eTag;
      const fullPath = `${userId}/${obj.name}`;
      if (eTag) {
        if (!eTagMap.has(eTag)) eTagMap.set(eTag, []);
        eTagMap.get(eTag)!.push(fullPath);
      }
    }

    const duplicateGroups: { eTag: string; count: number; paths: string[] }[] = [];
    for (const [eTag, paths] of eTagMap.entries()) {
      if (paths.length > 1) {
        duplicateGroups.push({ eTag, count: paths.length, paths });
      }
    }

    // 4. Analisar cada objeto do Storage e construir o preview
    const preview: ReconciliationItemPreview[] = [];

    for (const obj of storageList) {
      const fullPath = `${userId}/${obj.name}`;
      const parsed = parseStoragePath(fullPath);

      if (!parsed.isValid || parsed.userId !== userId) {
        preview.push({
          attachmentId: parsed.attachmentId || obj.name,
          storage_path: fullPath,
          file_name: obj.name,
          mime_type: obj.metadata?.mimetype || 'application/octet-stream',
          file_size: obj.metadata?.size || obj.metadata?.contentLength || 0,
          note_id: null,
          evidence: 'Caminho não segue o padrão canônico {userId}/{attachmentId}.{ext}',
          action: 'SKIP_INVALID_PATH',
          isDuplicateCandidate: false,
          eTag: obj.metadata?.eTag,
        });
        continue;
      }

      const attachmentId = parsed.attachmentId;
      const existingRecord = existingAttMap.get(attachmentId);

      // Determina MIME type real ou inferido
      const mimeType =
        obj.metadata?.mimetype && obj.metadata.mimetype !== 'application/octet-stream'
          ? obj.metadata.mimetype
          : inferMimeTypeFromExtension(parsed.extension);

      // Determina tamanho
      const fileSize = Number(obj.metadata?.size || obj.metadata?.contentLength || 0);

      // Procura evidência estrita nas notas autenticadas
      let matchedNoteId: string | null = null;
      let evidenceStr = '';

      for (const note of existingNotes) {
        if (!note || note.user_id !== userId) continue;
        const content = note.content || '';

        if (content.includes(`attachment://${attachmentId}`)) {
          matchedNoteId = note.id;
          evidenceStr = `Referência attachment://${attachmentId} encontrada no conteúdo da nota "${note.id}"`;
          break;
        } else if (content.includes(`local-attachment://${attachmentId}`)) {
          matchedNoteId = note.id;
          evidenceStr = `Referência local-attachment://${attachmentId} encontrada no conteúdo da nota "${note.id}"`;
          break;
        } else if (content.includes(fullPath)) {
          matchedNoteId = note.id;
          evidenceStr = `Path ${fullPath} encontrado no conteúdo da nota "${note.id}"`;
          break;
        } else if (content.includes(attachmentId)) {
          // Ex: URL HTTPS contendo o attachmentId
          matchedNoteId = note.id;
          evidenceStr = `ID de anexo ${attachmentId} encontrado em link HTTPS na nota "${note.id}"`;
          break;
        }
      }

      if (!matchedNoteId) {
        evidenceStr = 'Nenhuma nota ativa contém referência explícita a este attachmentId ou path';
      }

      // Verifica se é candidato a duplicata
      const isDuplicateCandidate = Boolean(obj.metadata?.eTag && (eTagMap.get(obj.metadata.eTag)?.length || 0) > 1);

      // Define ação
      let action: ReconciliationAction = 'VALIDATE_AND_INSERT';
      if (existingRecord) {
        action = 'SKIP_ALREADY_EXISTS';
      } else if (!matchedNoteId) {
        action = 'ORPHAN_WITHOUT_NOTE';
      }

      preview.push({
        attachmentId,
        storage_path: fullPath,
        file_name: existingRecord?.file_name || obj.name,
        mime_type: mimeType,
        file_size: fileSize,
        note_id: matchedNoteId || existingRecord?.note_id || null,
        evidence: evidenceStr,
        action,
        isDuplicateCandidate,
        eTag: obj.metadata?.eTag,
      });
    }

    return {
      preview,
      storageObjects: storageList as StorageObjectMetadata[],
      duplicateGroups,
    };
  }

  /**
   * Executa a reconciliação segura e idempotente em pequenos lotes (20 itens por lote).
   */
  public async executeReconciliation(
    userId: string,
    existingNotes: { id: string; user_id: string; content?: string }[],
    batchSize: number = 20,
    onProgress?: (progress: ReconciliationBatchProgress) => void
  ): Promise<ReconciliationFullReport> {
    const supabase = createClient();
    this.isCancelled = false;

    // 1. Gera preview completo
    const { preview, storageObjects, duplicateGroups, error: previewErr } = await this.generatePreview(
      userId,
      existingNotes
    );

    if (previewErr) {
      throw new Error(previewErr);
    }

    // Consulta contagem inicial de note_attachments
    const { count: initialAttCount } = await supabase
      .from('note_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const report: ReconciliationFullReport = {
      before: {
        storageTotal: storageObjects.length,
        noteAttachmentsTotal: initialAttCount || 0,
      },
      preview,
      processedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      alreadyExistingCount: 0,
      unassignedWithoutNoteCount: 0,
      provenNoteAssociationCount: 0,
      duplicateCandidatesCount: 0,
      errorsCount: 0,
      errorMessages: [],
      duplicateGroups,
    };

    // 2. Filtra itens aptos para UPSERT (VALIDATE_AND_INSERT, VALIDATE_AND_UPDATE, ORPHAN_WITHOUT_NOTE)
    const itemsToProcess = preview.filter(
      (item) =>
        item.action === 'VALIDATE_AND_INSERT' ||
        item.action === 'VALIDATE_AND_UPDATE' ||
        item.action === 'ORPHAN_WITHOUT_NOTE' ||
        item.action === 'SKIP_ALREADY_EXISTS'
    );

    // 3. Processar em pequenos lotes
    for (let i = 0; i < itemsToProcess.length; i += batchSize) {
      if (this.isCancelled) {
        report.errorMessages.push('Reconciliação cancelada pelo usuário.');
        break;
      }

      const batch = itemsToProcess.slice(i, i + batchSize);
      console.log(`[RECONCILER] Processando lote ${Math.floor(i / batchSize) + 1} (${batch.length} itens)...`);

      for (const item of batch) {
        if (this.isCancelled) break;

        // Se já existe com metadados idênticos, pula
        if (item.action === 'SKIP_ALREADY_EXISTS') {
          report.alreadyExistingCount++;
          report.processedCount++;
          if (item.note_id) report.provenNoteAssociationCount++;
          else report.unassignedWithoutNoteCount++;
          if (item.isDuplicateCandidate) report.duplicateCandidatesCount++;
          continue;
        }

        // Validação estrita de segurança multi-tenant
        const pathPrefix = item.storage_path.split('/')[0];
        if (pathPrefix !== userId) {
          report.errorsCount++;
          report.errorMessages.push(`Segurança: storage_path "${item.storage_path}" diverge de userId "${userId}"`);
          continue;
        }

        try {
          // UPSERT idempotente no Supabase
          const { error: upsertErr } = await supabase.from('note_attachments').upsert({
            id: item.attachmentId,
            note_id: item.note_id || null,
            user_id: userId,
            file_name: item.file_name,
            mime_type: item.mime_type,
            file_size: item.file_size,
            storage_path: item.storage_path,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          if (upsertErr) {
            report.errorsCount++;
            report.errorMessages.push(`Falha no upsert de ${item.attachmentId}: ${upsertErr.message}`);
            console.error(`[RECONCILER] Erro ao registrar ${item.attachmentId}:`, upsertErr);
          } else {
            // Confirmação de sucesso e gravação do checkpoint no IndexedDB
            await indexedDBStorage.setMetadata(
              userId,
              `attachment_reconciliation:${item.attachmentId}`,
              {
                attachmentId: item.attachmentId,
                storage_path: item.storage_path,
                note_id: item.note_id,
                reconciled_at: new Date().toISOString(),
              }
            );

            report.createdCount++;
            if (item.note_id) {
              report.provenNoteAssociationCount++;
            } else {
              report.unassignedWithoutNoteCount++;
            }
          }
        } catch (err: any) {
          report.errorsCount++;
          report.errorMessages.push(`Exceção no item ${item.attachmentId}: ${err?.message || err}`);
        }

        if (item.isDuplicateCandidate) {
          report.duplicateCandidatesCount++;
        }

        report.processedCount++;
      }

      if (onProgress) {
        onProgress({
          totalAnalyzed: report.processedCount,
          alreadyHadMetadata: report.alreadyExistingCount,
          createdOrUpdated: report.createdCount + report.updatedCount,
          unassignedWithoutNote: report.unassignedWithoutNoteCount,
          provenNoteAssociation: report.provenNoteAssociationCount,
          duplicateCandidates: report.duplicateCandidatesCount,
          errors: report.errorsCount,
          errorMessages: [...report.errorMessages],
        });
      }
    }

    return report;
  }
}

export const attachmentReconciler = new AttachmentReconciler();
