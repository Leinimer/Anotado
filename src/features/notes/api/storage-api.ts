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

  // Log obrigatório de criação do anexo
  console.log(`[Attachment] CREATED noteId=${noteId || 'none'} attachmentId=${attachmentId} fileName="${file.name}" fileSize=${file.size} mimeType="${file.type}"`);

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
    sync_status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    await indexedDBStorage.putAttachment(effectiveUserId, localAttachment);
    console.log(`[Attachment] STORED LOCAL noteId=${noteId || 'none'} attachmentId=${attachmentId} fileSize=${file.size}`);
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
      console.log(`[Attachment] UPLOAD START noteId=${noteId || 'none'} attachmentId=${attachmentId} fileName="${file.name}" fileSize=${file.size} mimeType="${file.type}" path="${filePath}"`);
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
        console.warn(`[Attachment] UPLOAD ERROR noteId=${noteId || 'none'} attachmentId=${attachmentId}:`, uploadError.message);
      } else {
        const { data: publicUrlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        if (publicUrlData?.publicUrl) {
          const remoteUrl = publicUrlData.publicUrl;
          console.log(`[Attachment] UPLOAD SUCCESS noteId=${noteId || 'none'} attachmentId=${attachmentId} remoteUrl="${remoteUrl}"`);
          console.log(`[Attachment] REMOTE URL noteId=${noteId || 'none'} attachmentId=${attachmentId} url="${remoteUrl}"`);

          // Atualiza anexo como sincronizado no IndexedDB
          localAttachment.remote_url = remoteUrl;
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
      console.warn(`[Attachment] UPLOAD ERROR noteId=${noteId || 'none'} attachmentId=${attachmentId}:`, err?.message || err);
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
