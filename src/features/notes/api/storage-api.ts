import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { indexedDBStorage, LocalAttachment } from '../db/indexed-db';
import { networkMonitor } from './network-monitor';
import { base64AttachmentMigrator } from './base64-attachment-migrator';
import { generateUUID } from '../utils/uuid';
import { registerResolvedAttachmentUrl } from '../editor/utils/media-common';

export const ATTACHMENTS_BUCKET_NAME = 'note-attachments';

export interface UploadedMediaResult {
  url: string;
  name: string;
  size: number;
  type: string;
  attachmentId: string;
  isLocal: boolean;
  storagePath?: string;
}

/**
 * Converte uma data URI Base64 em Blob binário real com mimeType e extensão deduzida.
 */
export function base64ToBlob(base64Data: string): { blob: Blob; mimeType: string; extension: string } {
  const matches = base64Data.match(/^data:([^;]+);base64,([\s\S]*)$/);
  let mimeType = 'application/octet-stream';
  let base64String = base64Data;
  if (matches && matches[1]) {
    mimeType = matches[1].toLowerCase();
    base64String = matches[2] || '';
  }

  // Remove espaços ou quebras de linha acidentais
  const cleanBase64 = base64String.replace(/\s/g, '');
  const binaryString = typeof atob !== 'undefined' ? atob(cleanBase64) : Buffer.from(cleanBase64, 'base64').toString('binary');
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const blob = new Blob([bytes], { type: mimeType });
  let extension = 'dat';
  if (mimeType.includes('png')) extension = 'png';
  else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) extension = 'jpeg';
  else if (mimeType.includes('webp')) extension = 'webp';
  else if (mimeType.includes('gif')) extension = 'gif';
  else if (mimeType.includes('svg')) extension = 'svg';
  else if (mimeType.includes('pdf')) extension = 'pdf';
  else if (mimeType.includes('mp4')) extension = 'mp4';
  else if (mimeType.includes('quicktime')) extension = 'mov';
  else if (mimeType.includes('audio/mpeg') || mimeType.includes('mp3')) extension = 'mp3';

  return { blob, mimeType, extension };
}

/**
 * Valida se o conteúdo está 100% livre de URIs temporárias ou Base64 para persistência remota no Supabase.
 * Rejeita data:[mime];base64, blob:, attachment:// e local-attachment://.
 */
export function validateNoteContentForRemotePersistence(content: string): { valid: boolean; errors: string[] } {
  if (!content) return { valid: true, errors: [] };
  const errors: string[] = [];

  if (/data:[^;]+;base64,/i.test(content) || /data:image\//i.test(content) || /data:application\//i.test(content) || /data:video\//i.test(content) || /data:audio\//i.test(content)) {
    errors.push('Conteúdo contém dados brutos em Base64, o que é estritamente proibido na persistência remota.');
  }

  if (/blob:/i.test(content)) {
    errors.push('Conteúdo contém URLs de Blob em memória (blob:), que expiram e não podem ser persistidas no Supabase.');
  }

  if (/(?:attachment|local-attachment):\/\//i.test(content)) {
    errors.push('Conteúdo contém referências locais pendentes (attachment://), que precisam ser resolvidas para o storage antes do envio.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Lança erro explícito se o conteúdo contiver referências transitórias proibidas.
 */
export function assertNoTransientAttachmentReferences(content: string): void {
  const result = validateNoteContentForRemotePersistence(content);
  if (!result.valid) {
    throw new Error(`[Persistência Bloqueada] ${result.errors.join(' ')}`);
  }
}

/**
 * Detecta todas as referências attachment:// ou local-attachment:// em um conteúdo de nota.
 */
export function extractAttachmentReferences(content: string): string[] {
  if (!content) return [];
  const matches = content.matchAll(/(?:attachment:\/\/|local-attachment:\/\/)([a-zA-Z0-9_-]+)/g);
  const ids = new Set<string>();
  for (const m of matches) {
    if (m[1]) ids.add(m[1].trim());
  }
  return Array.from(ids);
}

/**
 * Valida rapidamente se o conteúdo possui referências locais proibidas no Supabase.
 */
export function hasUnresolvedLocalMedia(content: string): boolean {
  if (!content) return false;
  return (
    content.includes('attachment://') ||
    content.includes('local-attachment://') ||
    content.includes('blob:') ||
    content.includes('data:image/') ||
    content.includes('data:application/') ||
    content.includes('data:video/') ||
    content.includes('data:audio/') ||
    /data:[^;]+;base64,/i.test(content)
  );
}

/**
 * Caminho relativo canônico no storage: {userId}/{attachmentId}.{extension}
 */
export function getAttachmentStoragePath(userId: string, attachmentId: string, extensionOrFileName: string): string {
  const cleanUserId = userId || 'anonymous';
  const cleanExt = extensionOrFileName.includes('.')
    ? extensionOrFileName.split('.').pop() || 'dat'
    : extensionOrFileName || 'dat';
  const sanitizedExt = cleanExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'dat';
  return `${cleanUserId}/${attachmentId}.${sanitizedExt}`;
}

/**
 * Obtém URL pública de um storage_path
 */
export function resolveStoragePublicUrl(storagePath: string): string {
  if (!storagePath) return '';
  if (storagePath.startsWith('http://') || storagePath.startsWith('https://')) return storagePath;
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { data } = supabase.storage.from(ATTACHMENTS_BUCKET_NAME).getPublicUrl(storagePath);
    if (data?.publicUrl) return data.publicUrl;
  }
  return '';
}

/**
 * Função central para substituição robusta de referências de anexos locais por URLs definitivas.
 * Trata Markdown (![alt](attachment://ID)), tags HTML (data-src="attachment://ID", src="attachment://ID", href="attachment://ID") e textos.
 */
export function resolveAttachmentReferences(
  content: string,
  attachmentMap: Record<string, string>
): string {
  if (!content || !attachmentMap || Object.keys(attachmentMap).length === 0) {
    return content;
  }

  let result = content;

  for (const [rawId, remoteUrl] of Object.entries(attachmentMap)) {
    if (!remoteUrl) continue;
    const id = rawId.replace(/^(?:attachment|local-attachment):\/\//, '').trim();

    // 1. Protocolos attachment:// e local-attachment://
    const canonicalPattern = new RegExp(`attachment://${id}`, 'g');
    const localPattern = new RegExp(`local-attachment://${id}`, 'g');
    result = result.replace(canonicalPattern, remoteUrl);
    result = result.replace(localPattern, remoteUrl);

    // 2. data-src, src, href
    const dataSrcPattern = new RegExp(`data-src=["'](?:attachment|local-attachment)://${id}["']`, 'g');
    result = result.replace(dataSrcPattern, `data-src="${remoteUrl}"`);

    const srcPattern = new RegExp(`src=["'](?:attachment|local-attachment)://${id}["']`, 'g');
    result = result.replace(srcPattern, `src="${remoteUrl}"`);

    const hrefPattern = new RegExp(`href=["'](?:attachment|local-attachment)://${id}["']`, 'g');
    result = result.replace(hrefPattern, `href="${remoteUrl}"`);

    // 3. Markdown image syntax ![alt](attachment://ID)
    const mdImgPattern = new RegExp(`(!\\[[^\\]]*\\])\\((?:attachment|local-attachment)://${id}\\)`, 'g');
    result = result.replace(mdImgPattern, `$1(${remoteUrl})`);
  }

  return result;
}

/**
 * Notifica o editor Tiptap atualmente aberto para atualizar nós em memória sem gerar novo autosave.
 */
export function replaceAttachmentReferencesInEditor(
  noteId: string,
  replacements: Record<string, string>
): void {
  if (typeof window === 'undefined' || !noteId || !replacements || Object.keys(replacements).length === 0) {
    return;
  }

  for (const [attId, remoteUrl] of Object.entries(replacements)) {
    if (attId && remoteUrl) {
      registerResolvedAttachmentUrl(attId, remoteUrl);
    }
  }

  window.dispatchEvent(
    new CustomEvent('anotado:attachment-resolved', {
      detail: { noteId, replacements },
    })
  );
}

/**
 * Faz upload de imagem ou documento para o Supabase Storage ou armazena o Blob no IndexedDB se offline.
 * NUNCA injeta strings Base64/DataURL no Markdown persistido.
 * Registra o metadado na tabela public.note_attachments e salva o arquivo binário em note-attachments/{userId}/{attachmentId}.{ext}
 */
export async function uploadNoteAttachment(
  userId: string | null,
  fileOrBlob: File | Blob,
  options?: {
    noteId?: string | null;
    fileName?: string;
    mimeType?: string;
    customAttachmentId?: string;
  }
): Promise<UploadedMediaResult> {
  if (!userId || userId === 'anonymous') {
    throw new Error('Usuário não autenticado');
  }

  const attachmentId = options?.customAttachmentId || generateUUID();

  const fileName = options?.fileName || (fileOrBlob instanceof File ? fileOrBlob.name : 'attachment.dat');
  const mimeType = options?.mimeType || (fileOrBlob.type || 'application/octet-stream');
  const noteId = options?.noteId || null;
  const storagePath = getAttachmentStoragePath(userId, attachmentId, fileName);

  console.log(`[ATTACHMENT] INPUT_FILE name="${fileName}" size=${fileOrBlob.size} type="${mimeType}"`);

  // 1. Extrai imediatamente os bytes reais do arquivo para desvincular do ciclo de vida do input mobile
  const arrayBuffer = await fileOrBlob.arrayBuffer();
  console.log(`[ATTACHMENT] BYTES_CAPTURED byteLength=${arrayBuffer.byteLength}`);

  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    console.error(`[ATTACHMENT] VALIDATION_FAILED: Arquivo "${fileName}" possui 0 bytes.`);
    throw new Error('Arquivo selecionado possui 0 bytes');
  }

  // 2. Cria cópia binária independente (detached Blob) imune a limpezas de input ou suspensão de aba
  const detachedBlob = new Blob([arrayBuffer], { type: mimeType });
  const fileSize = arrayBuffer.byteLength;
  console.log(`[ATTACHMENT] CREATED attachmentId=${attachmentId} fileName="${fileName}" mimeType="${mimeType}" fileSize=${fileSize}`);
  console.log(`[ATTACHMENT] LOCAL_STORED attachmentId=${attachmentId} size=${detachedBlob.size}`);

  // 3. Salva o anexo com detachedBlob independente no IndexedDB
  const localAttachment: LocalAttachment = {
    id: attachmentId,
    user_id: userId,
    note_id: noteId,
    file_name: fileName,
    file_type: mimeType,
    mime_type: mimeType,
    file_size: fileSize,
    blob: detachedBlob,
    storage_path: storagePath,
    remote_url: null,
    syncRequired: true,
    syncStatus: 'pending',
    sync_status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    await indexedDBStorage.putAttachment(userId, localAttachment);
  } catch (idbErr) {
    console.error('[StorageAPI] Erro ao salvar anexo no IndexedDB:', idbErr);
    throw new Error(`Falha ao persistir anexo offline no IndexedDB: ${idbErr instanceof Error ? idbErr.message : String(idbErr)}`);
  }

  // 4. Registra na SyncQueue persistente para processamento exclusivo pelo SyncEngine
  try {
    console.log(`[ATTACHMENT] QUEUE_INSERT queueId=sync_att_${attachmentId} userId=${userId}`);
    await indexedDBStorage.enqueueSyncItem(userId, {
      id: `sync_att_${attachmentId}`,
      action: 'UPLOAD_ATTACHMENT',
      entity_type: 'attachment',
      entity_id: attachmentId,
      payload: {
        attachmentId,
        fileName,
        fileType: mimeType,
        mimeType,
        fileSize,
        storagePath,
        noteId,
      },
      revision: 1,
    });
    console.log(`[ATTACHMENT] QUEUED attachmentId=${attachmentId}`);
    const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
    networkMonitor.updatePendingCount(pendingCount);

    // Dispara sincronização em segundo plano no SyncEngine sem bloquear a UI
    import('./sync-engine').then(({ syncEngine }) => {
      syncEngine.scheduleSync(100);
    }).catch(() => {});
  } catch (qErr) {
    console.error('[StorageAPI] Erro ao enfileirar upload na SyncQueue:', qErr);
    throw new Error(`Falha ao registrar anexo na fila de sincronização: ${qErr instanceof Error ? qErr.message : String(qErr)}`);
  }

  // 5. Retorna IMEDIATAMENTE a URI canônica do anexo local: attachment://[attachmentId]
  const localCanonicalUrl = `attachment://${attachmentId}`;
  return {
    url: localCanonicalUrl,
    name: fileName,
    size: fileSize,
    type: mimeType,
    attachmentId,
    storagePath,
    isLocal: true,
  };
}

/**
 * Abstração central e ÚNICO ponto de execução física de upload de anexos para o Supabase Storage no codebase.
 * Valida integridade binária, cria Blob desacoplado, executa retry interno com classificação de erros e garante persistência em public.note_attachments.
 */
export async function uploadAttachmentBinary(
  userId: string,
  attachment: LocalAttachment,
  supabase: any
): Promise<{
  success: boolean;
  remoteUrl: string;
  storagePath: string;
  error?: any;
}> {
  if (!userId || userId === 'anonymous') {
    const err = new Error('Usuário não autenticado para upload');
    (err as any).code = 'AUTH_MISSING';
    console.error(`[ATTACHMENT] UPLOAD_ERROR attachmentId=${attachment.id} error="Auth missing or anonymous"`);
    return { success: false, remoteUrl: '', storagePath: '', error: err };
  }

  // 1. Obter e validar o Blob binário local
  const blob = attachment.blob;
  if (!blob) {
    const err = new Error('Blob binário ausente no IndexedDB');
    (err as any).code = 'BLOB_MISSING';
    console.error(`[ATTACHMENT] UPLOAD_ERROR attachmentId=${attachment.id} error="Blob missing in IndexedDB"`);
    return { success: false, remoteUrl: '', storagePath: '', error: err };
  }

  // 2. Obter e validar os bytes reais (ArrayBuffer)
  let buffer: ArrayBuffer;
  try {
    buffer = await blob.arrayBuffer();
  } catch (readErr: any) {
    const err = readErr || new Error('Falha ao ler ArrayBuffer do Blob');
    (err as any).code = 'BUFFER_READ_FAILED';
    console.error(`[ATTACHMENT] UPLOAD_ERROR attachmentId=${attachment.id} error="ArrayBuffer read error"`, readErr);
    return { success: false, remoteUrl: '', storagePath: '', error: err };
  }

  if (!buffer || buffer.byteLength === 0) {
    const err = new Error('ArrayBuffer do arquivo possui 0 bytes');
    (err as any).code = 'ZERO_BYTES_BLOB';
    console.error(`[ATTACHMENT] UPLOAD_ERROR attachmentId=${attachment.id} error="Buffer has 0 bytes"`);
    return { success: false, remoteUrl: '', storagePath: '', error: err };
  }

  console.log(`[ATTACHMENT] BLOB_VALIDATED attachmentId=${attachment.id} byteLength=${buffer.byteLength}`);

  // 3. Caminho permanente determinístico: {userId}/{attachmentId}.{extension}
  const sanitizedName = (attachment.file_name || 'file').replace(/[^a-zA-Z0-9.-]/g, '_');
  const fileExt = sanitizedName.includes('.') ? sanitizedName.split('.').pop() || 'dat' : 'dat';
  const filePath = attachment.storage_path || `${userId}/${attachment.id}.${fileExt}`;
  const mimeType = attachment.mime_type || attachment.file_type || 'application/octet-stream';

  // 4. Política de retry interno (Tentativa 1: imediata, Tentativa 2: 1s, Tentativa 3: 3s)
  const maxInternalAttempts = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxInternalAttempts; attempt++) {
    if (attempt > 1) {
      const waitMs = attempt === 2 ? 1000 : 3000;
      console.log(`[ATTACHMENT] RETRY_WAIT attachmentId=${attachment.id} attempt=${attempt} waitMs=${waitMs}`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));

      // Se o erro anterior foi de autenticação (401/403), tenta atualizar a sessão do Supabase antes da nova tentativa
      if (lastError?.status === 401 || lastError?.status === 403 || lastError?.message?.includes('JWT')) {
        try {
          await supabase.auth.refreshSession();
        } catch {
          // prossegue para tentar com getSession
        }
      }

      // Revalida buffer se a tentativa anterior retornou "No Content" ou 400
      try {
        buffer = await blob.arrayBuffer();
      } catch {
        // mantém buffer anterior
      }
    }

    console.log(`[ATTACHMENT] UPLOAD_START path="${filePath}" size=${buffer.byteLength} attempt=${attempt}`);

    // Criar corpo binário estável com bytes validados
    const uploadBody = new Blob([buffer], { type: mimeType });

    try {
      // 5. Upload real para o Supabase Storage (ÚNICO PONTO REAL DE EXECUÇÃO)
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET_NAME)
        .upload(filePath, uploadBody, {
          contentType: mimeType,
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError || !uploadData) {
        lastError = uploadError || new Error('Upload falhou sem confirmação de dados');
        console.error(`[ATTACHMENT] UPLOAD_ERROR attachmentId=${attachment.id} attempt=${attempt} error="${lastError.message || lastError}"`);
        continue;
      }

      console.log(`[ATTACHMENT] UPLOAD_SUCCESS path="${filePath}"`);

      // 6. Obter URL pública do Storage
      const { data: publicUrlData } = supabase.storage
        .from(ATTACHMENTS_BUCKET_NAME)
        .getPublicUrl(filePath);

      const remoteUrl = publicUrlData?.publicUrl;
      if (!remoteUrl) {
        lastError = new Error('Falha ao derivar URL pública do Storage');
        console.error(`[ATTACHMENT] UPLOAD_ERROR attachmentId=${attachment.id} error="${lastError.message}"`);
        continue;
      }

      // 7. Upsert na tabela public.note_attachments (Obrigatório para conclusão)
      console.log(`[ATTACHMENT] METADATA_START attachmentId=${attachment.id}`);
      const targetNoteId = attachment.note_id || null;
      const { error: dbErr } = await supabase.from('note_attachments').upsert({
        id: attachment.id,
        note_id: targetNoteId,
        user_id: userId,
        file_name: attachment.file_name || 'file',
        mime_type: mimeType,
        file_size: buffer.byteLength,
        storage_path: filePath,
        created_at: attachment.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (dbErr) {
        lastError = new Error(`Falha ao registrar metadados em note_attachments: ${dbErr.message}`);
        (lastError as any).code = dbErr.code || 'METADATA_UPSERT_FAILED';
        (lastError as any).details = dbErr.details || dbErr.message;
        console.error(`[ATTACHMENT] METADATA_ERROR attachmentId=${attachment.id} error="${dbErr.message}"`);
        continue;
      }

      console.log(`[ATTACHMENT] METADATA_SUCCESS attachmentId=${attachment.id}`);

      return {
        success: true,
        remoteUrl,
        storagePath: filePath,
      };
    } catch (err: any) {
      lastError = err;
      console.error(`[ATTACHMENT] UPLOAD_ERROR attachmentId=${attachment.id} attempt=${attempt} error="${err?.message || err}"`);
    }
  }

  // Se todas as 3 tentativas internas falharem, retorna o erro técnico original para gerenciamento pela SyncQueue
  return {
    success: false,
    remoteUrl: '',
    storagePath: filePath,
    error: lastError || new Error('Upload falhou após tentativas internas'),
  };
}

/**
 * Alias de retrocompatibilidade para uploadNoteAttachment.
 */
export const uploadNoteFile = (userId: string | null, file: File, noteId?: string) =>
  uploadNoteAttachment(userId, file, { noteId, fileName: file.name, mimeType: file.type });

/**
 * Remove anexo físico do storage, registro do note_attachments e do IndexedDB.
 */
export async function deleteNoteAttachment(userId: string, attachmentId: string): Promise<boolean> {
  if (!userId || userId === 'anonymous') return false;
  try {
    const attachment = await indexedDBStorage.getAttachment(userId, attachmentId);
    await indexedDBStorage.deleteAttachment(userId, attachmentId);

    if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
      const supabase = createClient();
      const storagePath = attachment?.storage_path || getAttachmentStoragePath(userId, attachmentId, attachment?.file_name || 'dat');

      await supabase.storage.from(ATTACHMENTS_BUCKET_NAME).remove([storagePath]);
      await supabase.from('note_attachments').delete().eq('id', attachmentId).eq('user_id', userId);
    }
    return true;
  } catch (err) {
    console.error('[StorageAPI] Erro ao deletar anexo:', err);
    return false;
  }
}

/**
 * Migra mídias Base64 embutidas em notas legadas para anexos isolados no Supabase Storage e na tabela note_attachments.
 * Processamento seguro, não-bloqueante e idempotente através do Base64AttachmentMigrator.
 */
export async function migrateLegacyNoteAttachments(
  userId: string,
  noteId: string,
  content: string
): Promise<{ migratedContent: string; migrationCount: number }> {
  if (!content) return { migratedContent: '', migrationCount: 0 };

  const effectiveUserId = userId || 'anonymous';
  if (!/data:image\/[a-zA-Z0-9.+_-]+;base64,/i.test(content)) {
    return { migratedContent: content, migrationCount: 0 };
  }

  const res = await base64AttachmentMigrator.migrateNoteBase64Attachments(effectiveUserId, noteId);
  const updatedNote = await indexedDBStorage.getNoteById(effectiveUserId, noteId);
  return {
    migratedContent: updatedNote?.content || content,
    migrationCount: res.migratedCount,
  };
}

/**
 * Ponto central de preparação de conteúdo para persistência remota:
 * 1. Migra Base64 legados
 * 2. Faz upload de anexos locais pendentes (attachment://) para o Supabase Storage
 * 3. Cria/atualiza registros em public.note_attachments
 * 4. Substitui referências locais por URLs públicas definitivas
 * 5. Valida se o conteúdo resultante está 100% pronto para persistência remota
 */
export async function prepareNoteContentForPersistence(
  userId: string,
  noteId: string,
  content: string
): Promise<{
  preparedContent: string;
  allResolved: boolean;
  uploadedCount: number;
  replacements: Record<string, string>;
}> {
  console.log(`[NOTE] note persistence started noteId=${noteId}`);

  // 1. Migração de Base64 legados se houver (enfileira no IndexedDB/SyncQueue e converte para attachment://)
  const { migratedContent, migrationCount } = await migrateLegacyNoteAttachments(
    userId,
    noteId,
    content || ''
  );
  let updatedContent = migratedContent;
  const replacements: Record<string, string> = {};

  // 2. Extrai IDs de anexos locais attachment:// ou local-attachment://
  const attachmentIds = extractAttachmentReferences(updatedContent);

  if (attachmentIds.length > 0) {
    for (const attachmentId of attachmentIds) {
      try {
        const attachment = await indexedDBStorage.getAttachment(userId, attachmentId);

        let remoteUrl: string | null = null;
        if (attachment && attachment.syncStatus === 'synced' && attachment.remote_url) {
          remoteUrl = attachment.remote_url;
        }

        if (remoteUrl) {
          replacements[attachmentId] = remoteUrl;
        } else {
          console.log(`[MEDIA] attachment pending upload in SyncEngine noteId=${noteId} attachmentId=${attachmentId}`);
        }
      } catch (attErr: any) {
        console.error(`[MEDIA] attachment check error noteId=${noteId} attachmentId=${attachmentId}:`, attErr?.message || attErr);
      }
    }
  }

  // 3. Aplica as substituições no conteúdo para anexos já resolvidos
  if (Object.keys(replacements).length > 0) {
    updatedContent = resolveAttachmentReferences(updatedContent, replacements);
    replaceAttachmentReferencesInEditor(noteId, replacements);
  }

  // 4. Validação Rigorosa: Verifica se restou qualquer Base64, blob: ou attachment://
  const validation = validateNoteContentForRemotePersistence(updatedContent);

  if (!validation.valid) {
    console.warn(`[NOTE] note persistence blocked by unresolved attachment noteId=${noteId} errors=${validation.errors.join('; ')}`);
    return {
      preparedContent: updatedContent,
      allResolved: false,
      uploadedCount: 0,
      replacements,
    };
  }

  console.log(`[NOTE] note persistence completed noteId=${noteId}`);
  return {
    preparedContent: updatedContent,
    allResolved: true,
    uploadedCount: 0,
    replacements,
  };
}

/**
 * Wrapper de compatibilidade para resolveAndUploadNoteAttachments
 */
export async function resolveAndUploadNoteAttachments(
  userId: string,
  noteId: string,
  content: string
): Promise<{
  resolvedContent: string;
  allResolved: boolean;
  uploadedCount: number;
  replacements: Record<string, string>;
}> {
  const result = await prepareNoteContentForPersistence(userId, noteId, content);
  return {
    resolvedContent: result.preparedContent,
    allResolved: result.allResolved,
    uploadedCount: result.uploadedCount,
    replacements: result.replacements,
  };
}

/**
 * Varre e migra em background todas as notas do usuário com anexos legados no IndexedDB.
 */
export async function migrateAllLegacyAttachments(userId: string): Promise<number> {
  if (!userId) return 0;
  let totalMigrated = 0;

  try {
    const notes = await indexedDBStorage.getAllNotes(userId);
    for (const note of notes) {
      if (note.content && hasUnresolvedLocalMedia(note.content)) {
        const { migratedContent, migrationCount } = await migrateLegacyNoteAttachments(
          userId,
          note.id,
          note.content
        );
        if (migrationCount > 0) {
          totalMigrated += migrationCount;
          note.content = migratedContent;
          await indexedDBStorage.putNote(userId, note);
        }
      }
    }
  } catch (err) {
    console.warn('[StorageAPI] Aviso durante migração geral de mídias:', err);
  }

  return totalMigrated;
}
