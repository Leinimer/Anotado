import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { indexedDBStorage, LocalAttachment } from '../db/indexed-db';
import { networkMonitor } from './network-monitor';

export interface UploadedMediaResult {
  url: string;
  name: string;
  size: number;
  type: string;
  attachmentId: string;
  isLocal: boolean;
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
 * Valida se o conteúdo possui referências locais proibidas no Supabase:
 * attachment://, local-attachment://, blob: ou data:.
 */
export function hasUnresolvedLocalMedia(content: string): boolean {
  if (!content) return false;
  return (
    content.includes('attachment://') ||
    content.includes('local-attachment://') ||
    content.includes('blob:') ||
    content.includes('data:image/') ||
    content.includes('data:application/') ||
    content.includes('data:video/')
  );
}

/**
 * Localiza todos os anexos locais do conteúdo, faz o upload físico para o Supabase Storage se necessário,
 * obtém a URL HTTPS definitiva e substitui as referências attachment://[id] no texto.
 */
export async function resolveAndUploadNoteAttachments(
  userId: string,
  noteId: string,
  content: string
): Promise<{
  resolvedContent: string;
  allResolved: boolean;
  uploadedCount: number;
}> {
  let updatedContent = content;
  let uploadedCount = 0;

  const attachmentIds = extractAttachmentReferences(updatedContent);
  if (attachmentIds.length === 0) {
    const hasUnresolved = hasUnresolvedLocalMedia(updatedContent);
    return {
      resolvedContent: updatedContent,
      allResolved: !hasUnresolved,
      uploadedCount: 0,
    };
  }

  console.log(`[MEDIA] LOCAL ATTACHMENT noteId=${noteId} count=${attachmentIds.length} ids=${attachmentIds.join(', ')}`);

  const supabase = createClient();
  const bucketName = 'note-attachments';

  for (const attachmentId of attachmentIds) {
    try {
      // 1. Busca anexo no IndexedDB
      let attachment = await indexedDBStorage.getAttachment(userId, attachmentId);
      if (!attachment && userId !== 'anonymous') {
        attachment = await indexedDBStorage.getAttachment('anonymous', attachmentId);
      }

      let remoteUrl = attachment?.remote_url || null;

      // 2. Se não tem remote_url mas tem Blob e estamos online, faz upload
      if (!remoteUrl && attachment?.blob && isSupabaseConfigured()) {
        const sanitizedName = (attachment.file_name || 'file').replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileExt = sanitizedName.split('.').pop() || 'dat';
        const filePath = `${userId}/${attachmentId}.${fileExt}`;

        console.log(`[MEDIA] UPLOAD START noteId=${noteId} attachmentId=${attachmentId} fileName="${attachment.file_name}" fileSize=${attachment.file_size || 0} mimeType="${attachment.file_type}" path="${filePath}"`);

        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(filePath, attachment.blob, {
            contentType: attachment.file_type || 'application/octet-stream',
            cacheControl: '3600',
            upsert: true,
          });

        if (uploadError) {
          console.error(`[MEDIA] UPLOAD ERROR noteId=${noteId} attachmentId=${attachmentId}:`, uploadError.message);
          continue;
        }

        const { data: publicUrlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        if (publicUrlData?.publicUrl) {
          remoteUrl = publicUrlData.publicUrl;
          console.log(`[MEDIA] UPLOAD SUCCESS noteId=${noteId} attachmentId=${attachmentId}`);
          console.log(`[MEDIA] REMOTE URL noteId=${noteId} attachmentId=${attachmentId} url="${remoteUrl}"`);

          uploadedCount++;
          attachment.remote_url = remoteUrl;
          attachment.syncRequired = false;
          attachment.syncStatus = 'synced';
          attachment.sync_status = 'synced';
          attachment.note_id = noteId;
          await indexedDBStorage.putAttachment(userId, attachment);
          await indexedDBStorage.removeSyncQueueItem(userId, `sync_att_${attachmentId}`);
        }
      }

      // 3. Substitui referências pelo remoteUrl definitivo
      if (remoteUrl) {
        const canonicalRegex = new RegExp(`attachment://${attachmentId}`, 'g');
        const localRegex = new RegExp(`local-attachment://${attachmentId}`, 'g');
        updatedContent = updatedContent.replace(canonicalRegex, remoteUrl);
        updatedContent = updatedContent.replace(localRegex, remoteUrl);

        if (attachment?.data_url && updatedContent.includes(attachment.data_url)) {
          updatedContent = updatedContent.split(attachment.data_url).join(remoteUrl);
        }

        console.log(`[MEDIA] REFERENCE REPLACED noteId=${noteId} attachmentId=${attachmentId} remoteUrl="${remoteUrl}"`);
      } else {
        console.warn(`[MEDIA] REFERENCE RESOLUTION ERROR noteId=${noteId} attachmentId=${attachmentId}: no remote_url available`);
      }
    } catch (err: any) {
      console.error(`[MEDIA] UPLOAD ERROR noteId=${noteId} attachmentId=${attachmentId}:`, err?.message || err);
    }
  }

  // Validação: não pode restar referências locais
  const stillHasUnresolved = hasUnresolvedLocalMedia(updatedContent);

  if (!stillHasUnresolved) {
    console.log(`[MEDIA] REMOTE VALIDATION SUCCESS noteId=${noteId}`);
  } else {
    console.warn(`[MEDIA] REFERENCE RESOLUTION ERROR noteId=${noteId}: content still has unresolved local media`);
  }

  return {
    resolvedContent: updatedContent,
    allResolved: !stillHasUnresolved,
    uploadedCount,
  };
}

/**
 * Faz upload de imagem ou documento para o Supabase Storage ou armazena o Blob no IndexedDB se offline.
 * NUNCA injeta strings Base64/DataURL no Markdown persistido.
 * Utiliza o protocolo leve `attachment://[attachmentId]`.
 */
export async function uploadNoteFile(
  userId: string | null,
  file: File,
  noteId?: string
): Promise<UploadedMediaResult> {
  const effectiveUserId = userId || 'anonymous';
  const attachmentId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const fileExt = sanitizedName.split('.').pop() || 'dat';
  const filePath = `${effectiveUserId}/${attachmentId}.${fileExt}`;

  // Log de criação do anexo
  console.log(`[MEDIA] LOCAL ATTACHMENT created noteId=${noteId || 'none'} attachmentId=${attachmentId} fileName="${file.name}" fileSize=${file.size} mimeType="${file.type}"`);

  // 1. Salva o anexo completo com Blob bruto no IndexedDB (sem Base64 no Markdown)
  const localAttachment: LocalAttachment = {
    id: attachmentId,
    user_id: effectiveUserId,
    note_id: noteId || null,
    file_name: file.name,
    file_type: file.type || 'application/octet-stream',
    file_size: file.size,
    blob: file,
    remote_url: null,
    syncRequired: true,
    syncStatus: 'pending',
    sync_status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    await indexedDBStorage.putAttachment(effectiveUserId, localAttachment);
    console.log(`[MEDIA] LOCAL ATTACHMENT stored in IndexedDB noteId=${noteId || 'none'} attachmentId=${attachmentId}`);
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
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        noteId: noteId || null,
      },
      revision: 1,
    });
    const pendingCount = await indexedDBStorage.getSyncQueueCount(effectiveUserId);
    networkMonitor.updatePendingCount(pendingCount);
  } catch (qErr) {
    console.warn('[StorageAPI] Aviso ao enfileirar upload na SyncQueue:', qErr);
  }

  // 3. Se online e Supabase configurado, tenta fazer upload direto
  const isOnline = networkMonitor.getState().isBackendReachable;
  if (isOnline && isSupabaseConfigured()) {
    try {
      console.log(`[MEDIA] UPLOAD START noteId=${noteId || 'none'} attachmentId=${attachmentId} fileName="${file.name}" fileSize=${file.size} mimeType="${file.type}" path="${filePath}"`);
      const supabase = createClient();
      const bucketName = 'note-attachments';

      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(filePath, file, {
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) {
        console.warn(`[MEDIA] UPLOAD ERROR noteId=${noteId || 'none'} attachmentId=${attachmentId}:`, uploadError.message);
      } else {
        const { data: publicUrlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        if (publicUrlData?.publicUrl) {
          const remoteUrl = publicUrlData.publicUrl;
          console.log(`[MEDIA] UPLOAD SUCCESS noteId=${noteId || 'none'} attachmentId=${attachmentId}`);
          console.log(`[MEDIA] REMOTE URL noteId=${noteId || 'none'} attachmentId=${attachmentId} url="${remoteUrl}"`);

          // Atualiza anexo como sincronizado no IndexedDB
          localAttachment.remote_url = remoteUrl;
          localAttachment.syncRequired = false;
          localAttachment.syncStatus = 'synced';
          localAttachment.sync_status = 'synced';
          await indexedDBStorage.putAttachment(effectiveUserId, localAttachment);
          await indexedDBStorage.removeSyncQueueItem(effectiveUserId, `sync_att_${attachmentId}`);
          const remainingCount = await indexedDBStorage.getSyncQueueCount(effectiveUserId);
          networkMonitor.updatePendingCount(remainingCount);

          return {
            url: remoteUrl,
            name: file.name,
            size: file.size,
            type: file.type,
            attachmentId,
            isLocal: false,
          };
        }
      }
    } catch (err: any) {
      console.warn(`[MEDIA] UPLOAD ERROR noteId=${noteId || 'none'} attachmentId=${attachmentId}:`, err?.message || err);
    }
  }

  // 4. Retorna a URI leve canônica do anexo local: attachment://[attachmentId]
  const localCanonicalUrl = `attachment://${attachmentId}`;
  return {
    url: localCanonicalUrl,
    name: file.name,
    size: file.size,
    type: file.type,
    attachmentId,
    isLocal: true,
  };
}
