import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { indexedDBStorage, LocalAttachment } from '../db/indexed-db';
import { networkMonitor } from './network-monitor';

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
  const effectiveUserId = userId || 'anonymous';
  const attachmentId = options?.customAttachmentId || (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `att-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

  const fileName = options?.fileName || (fileOrBlob instanceof File ? fileOrBlob.name : 'attachment.dat');
  const mimeType = options?.mimeType || (fileOrBlob.type || 'application/octet-stream');
  const fileSize = fileOrBlob.size;
  const noteId = options?.noteId || null;
  const storagePath = getAttachmentStoragePath(effectiveUserId, attachmentId, fileName);

  // 1. Salva o anexo completo com Blob bruto no IndexedDB (sem Base64 no Markdown)
  const localAttachment: LocalAttachment = {
    id: attachmentId,
    user_id: effectiveUserId,
    note_id: noteId,
    file_name: fileName,
    file_type: mimeType,
    mime_type: mimeType,
    file_size: fileSize,
    blob: fileOrBlob,
    storage_path: storagePath,
    remote_url: null,
    syncRequired: true,
    syncStatus: 'pending',
    sync_status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    await indexedDBStorage.putAttachment(effectiveUserId, localAttachment);
  } catch (idbErr) {
    console.warn('[StorageAPI] Aviso ao salvar anexo no IndexedDB:', idbErr);
  }

  // 2. Registra na SyncQueue persistente
  try {
    await indexedDBStorage.enqueueSyncItem(effectiveUserId, {
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
    const pendingCount = await indexedDBStorage.getSyncQueueCount(effectiveUserId);
    networkMonitor.updatePendingCount(pendingCount);
  } catch (qErr) {
    console.warn('[StorageAPI] Aviso ao enfileirar upload na SyncQueue:', qErr);
  }

  // 3. Se online e Supabase configurado, faz upload físico direto
  const isOnline = networkMonitor.getState().isBackendReachable;
  if (isOnline && isSupabaseConfigured()) {
    try {
      console.log(
        `[MEDIA] attachment upload started noteId=${noteId || 'none'} attachmentId=${attachmentId} fileName="${fileName}" fileSize=${fileSize} mimeType="${mimeType}" path="${storagePath}"`
      );
      const supabase = createClient();

      const { error: uploadError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET_NAME)
        .upload(storagePath, fileOrBlob, {
          contentType: mimeType,
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) {
        console.error(`[MEDIA] attachment upload failed noteId=${noteId || 'none'} attachmentId=${attachmentId}:`, uploadError.message);
      } else {
        const { data: publicUrlData } = supabase.storage
          .from(ATTACHMENTS_BUCKET_NAME)
          .getPublicUrl(storagePath);

        const remoteUrl = publicUrlData?.publicUrl || '';
        if (remoteUrl) {
          console.log(`[MEDIA] attachment upload completed noteId=${noteId || 'none'} attachmentId=${attachmentId} url="${remoteUrl}"`);

          // Registra / Upsert na tabela public.note_attachments
          try {
            const { error: dbErr } = await supabase.from('note_attachments').upsert({
              id: attachmentId,
              note_id: noteId,
              user_id: effectiveUserId,
              file_name: fileName,
              mime_type: mimeType,
              file_size: fileSize,
              storage_path: storagePath,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            if (dbErr) {
              console.warn('[StorageAPI] Aviso ao registrar na tabela note_attachments:', dbErr.message);
            }
          } catch (dbEx) {
            console.warn('[StorageAPI] Exceção ao gravar em note_attachments:', dbEx);
          }

          // Atualiza anexo como sincronizado no IndexedDB
          localAttachment.remote_url = remoteUrl;
          localAttachment.storage_path = storagePath;
          localAttachment.syncRequired = false;
          localAttachment.syncStatus = 'synced';
          localAttachment.sync_status = 'synced';
          await indexedDBStorage.putAttachment(effectiveUserId, localAttachment);
          await indexedDBStorage.removeSyncQueueItem(effectiveUserId, `sync_att_${attachmentId}`);
          const remainingCount = await indexedDBStorage.getSyncQueueCount(effectiveUserId);
          networkMonitor.updatePendingCount(remainingCount);

          return {
            url: remoteUrl,
            name: fileName,
            size: fileSize,
            type: mimeType,
            attachmentId,
            storagePath,
            isLocal: false,
          };
        }
      }
    } catch (err: any) {
      console.error(`[MEDIA] attachment upload failed noteId=${noteId || 'none'} attachmentId=${attachmentId}:`, err?.message || err);
    }
  }

  // 4. Retorna a URI leve canônica do anexo local: attachment://[attachmentId]
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
 * Alias de retrocompatibilidade para uploadNoteAttachment.
 */
export const uploadNoteFile = (userId: string | null, file: File, noteId?: string) =>
  uploadNoteAttachment(userId, file, { noteId, fileName: file.name, mimeType: file.type });

/**
 * Remove anexo físico do storage, registro do note_attachments e do IndexedDB.
 */
export async function deleteNoteAttachment(userId: string, attachmentId: string): Promise<boolean> {
  const effectiveUserId = userId || 'anonymous';
  try {
    const attachment = await indexedDBStorage.getAttachment(effectiveUserId, attachmentId);
    await indexedDBStorage.deleteAttachment(effectiveUserId, attachmentId);

    if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
      const supabase = createClient();
      const storagePath = attachment?.storage_path || getAttachmentStoragePath(effectiveUserId, attachmentId, attachment?.file_name || 'dat');

      await supabase.storage.from(ATTACHMENTS_BUCKET_NAME).remove([storagePath]);
      await supabase.from('note_attachments').delete().eq('id', attachmentId).eq('user_id', effectiveUserId);
    }
    return true;
  } catch (err) {
    console.error('[StorageAPI] Erro ao deletar anexo:', err);
    return false;
  }
}

/**
 * Migra mídias Base64 embutidas em notas legadas para anexos isolados no Supabase Storage e na tabela note_attachments.
 * Processamento seguro, não-bloqueante e idempotente.
 */
export async function migrateLegacyNoteAttachments(
  userId: string,
  noteId: string,
  content: string
): Promise<{ migratedContent: string; migrationCount: number }> {
  if (!content) return { migratedContent: '', migrationCount: 0 };

  const effectiveUserId = userId || 'anonymous';
  let migrated = content;
  let count = 0;

  // Regex para detectar data:[mime];base64,[data]
  const base64Regex = /data:([a-zA-Z0-9/+-]+);base64,([a-zA-Z0-9+/=\s]+)/g;
  const matches = Array.from(content.matchAll(base64Regex));

  if (matches.length > 0) {
    for (const match of matches) {
      const fullDataUri = match[0];
      const mimeType = match[1] || 'application/octet-stream';
      const base64Body = (match[2] || '').replace(/\s/g, '');
      const approxSize = Math.round((base64Body.length * 3) / 4);

      console.log(`[MEDIA] attachment migration started noteId=${noteId} mimeType="${mimeType}" size=${approxSize}`);

      try {
        const { blob, extension } = base64ToBlob(fullDataUri);
        const attachmentId = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `att-migrated-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const fileName = `migrated_${attachmentId.slice(0, 8)}.${extension}`;

        const uploadResult = await uploadNoteAttachment(effectiveUserId, blob, {
          noteId,
          fileName,
          mimeType,
          customAttachmentId: attachmentId,
        });

        const targetUrl = uploadResult.url;
        migrated = migrated.split(fullDataUri).join(targetUrl);
        count++;

        console.log(`[MEDIA] attachment migration completed noteId=${noteId} attachmentId=${attachmentId}`);
      } catch (err: any) {
        console.error(`[MEDIA] attachment migration failed noteId=${noteId}:`, err?.message || err);
      }
    }
  }

  return { migratedContent: migrated, migrationCount: count };
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

  // 1. Migração de Base64 se houver
  const { migratedContent, migrationCount } = await migrateLegacyNoteAttachments(
    userId,
    noteId,
    content || ''
  );
  let updatedContent = migratedContent;
  let uploadedCount = migrationCount;
  const replacements: Record<string, string> = {};

  // 2. Extrai IDs de anexos locais attachment:// ou local-attachment://
  const attachmentIds = extractAttachmentReferences(updatedContent);

  if (attachmentIds.length > 0) {
    const supabase = createClient();
    const isOnline = networkMonitor.getState().isBackendReachable;

    for (const attachmentId of attachmentIds) {
      try {
        let attachment = await indexedDBStorage.getAttachment(userId, attachmentId);
        if (!attachment && userId !== 'anonymous') {
          attachment = await indexedDBStorage.getAttachment('anonymous', attachmentId);
        }

        let remoteUrl = attachment?.remote_url || null;

        // Se já tem storage_path e estamos online mas falta a publicUrl
        if (!remoteUrl && attachment?.storage_path && isOnline && isSupabaseConfigured()) {
          const { data: pubData } = supabase.storage
            .from(ATTACHMENTS_BUCKET_NAME)
            .getPublicUrl(attachment.storage_path);
          if (pubData?.publicUrl) {
            remoteUrl = pubData.publicUrl;
          }
        }

        // Se precisa de upload do Blob
        if (!remoteUrl && attachment?.blob && isOnline && isSupabaseConfigured()) {
          const sanitizedName = (attachment.file_name || 'file').replace(/[^a-zA-Z0-9.-]/g, '_');
          const fileExt = sanitizedName.split('.').pop() || 'dat';
          const storagePath = attachment.storage_path || getAttachmentStoragePath(userId, attachmentId, fileExt);

          console.log(
            `[MEDIA] attachment upload started noteId=${noteId} attachmentId=${attachmentId} fileName="${attachment.file_name || 'file'}" fileSize=${attachment.file_size || attachment.blob.size || 0} mimeType="${attachment.file_type || 'application/octet-stream'}" path="${storagePath}"`
          );

          const { error: uploadError } = await supabase.storage
            .from(ATTACHMENTS_BUCKET_NAME)
            .upload(storagePath, attachment.blob, {
              contentType: attachment.file_type || 'application/octet-stream',
              cacheControl: '3600',
              upsert: true,
            });

          if (uploadError) {
            console.error(`[MEDIA] attachment upload failed noteId=${noteId} attachmentId=${attachmentId}:`, uploadError.message);
          } else {
            const { data: publicUrlData } = supabase.storage
              .from(ATTACHMENTS_BUCKET_NAME)
              .getPublicUrl(storagePath);

            if (publicUrlData?.publicUrl) {
              remoteUrl = publicUrlData.publicUrl;
              uploadedCount++;

              console.log(`[MEDIA] attachment upload completed noteId=${noteId} attachmentId=${attachmentId} url="${remoteUrl}"`);

              // Registra na tabela public.note_attachments
              try {
                await supabase.from('note_attachments').upsert({
                  id: attachmentId,
                  note_id: noteId,
                  user_id: userId,
                  file_name: attachment.file_name,
                  mime_type: attachment.mime_type || attachment.file_type || 'application/octet-stream',
                  file_size: attachment.file_size || attachment.blob.size || 0,
                  storage_path: storagePath,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                });
              } catch (recErr) {
                console.warn('[StorageAPI] Aviso ao registrar em note_attachments:', recErr);
              }

              attachment.remote_url = remoteUrl;
              attachment.storage_path = storagePath;
              attachment.syncRequired = false;
              attachment.syncStatus = 'synced';
              attachment.sync_status = 'synced';
              attachment.note_id = noteId;
              await indexedDBStorage.putAttachment(userId, attachment);
              await indexedDBStorage.removeSyncQueueItem(userId, `sync_att_${attachmentId}`);
            }
          }
        }

        if (remoteUrl) {
          replacements[attachmentId] = remoteUrl;
        } else {
          console.warn(`[MEDIA] attachment unresolved noteId=${noteId} attachmentId=${attachmentId}`);
        }
      } catch (attErr: any) {
        console.error(`[MEDIA] attachment processing error noteId=${noteId} attachmentId=${attachmentId}:`, attErr?.message || attErr);
      }
    }
  }

  // 3. Aplica as substituições no conteúdo
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
      uploadedCount,
      replacements,
    };
  }

  console.log(`[NOTE] note persistence completed noteId=${noteId}`);
  return {
    preparedContent: updatedContent,
    allResolved: true,
    uploadedCount,
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
