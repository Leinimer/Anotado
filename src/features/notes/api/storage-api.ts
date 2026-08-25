import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { indexedDBStorage, LocalAttachment } from '../db/indexed-db';
import { networkMonitor } from './network-monitor';

export interface UploadedMediaResult {
  url: string;
  name: string;
  size: number;
  type: string;
  attachmentId?: string;
  isLocal?: boolean;
}

/**
 * Converte File para DataURL de forma assíncrona.
 */
function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Faz upload de imagem ou documento para o Supabase Storage ou armazena no IndexedDB se offline.
 * Sobrevive a quedas de conexão, F5 e fechamento do navegador.
 */
export async function uploadNoteFile(
  userId: string | null,
  file: File,
  noteId?: string
): Promise<UploadedMediaResult> {
  const effectiveUserId = userId || 'anonymous';
  const attachmentId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const fileExt = sanitizedName.split('.').pop() || 'dat';
  const filePath = `${effectiveUserId}/${attachmentId}.${fileExt}`;

  // 1. Gera DataURL para persistência local visual imediata
  let localDataUrl = '';
  try {
    localDataUrl = await fileToDataURL(file);
  } catch {
    localDataUrl = URL.createObjectURL(file);
  }

  // 2. Salva o anexo completo (com Blob) no IndexedDB
  const localAttachment: LocalAttachment = {
    id: attachmentId,
    user_id: effectiveUserId,
    note_id: noteId || null,
    file_name: file.name,
    file_type: file.type,
    file_size: file.size,
    blob: file,
    data_url: localDataUrl,
    remote_url: null,
    sync_status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    await indexedDBStorage.putAttachment(effectiveUserId, localAttachment);
  } catch (idbErr) {
    console.warn('[StorageAPI] Aviso ao salvar anexo no IndexedDB:', idbErr);
  }

  // 3. Registra na SyncQueue persistente
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
        noteId,
      },
      revision: 1,
    });
    const pendingCount = await indexedDBStorage.getSyncQueueCount(effectiveUserId);
    networkMonitor.updatePendingCount(pendingCount);
  } catch (qErr) {
    console.warn('[StorageAPI] Aviso ao enfileirar upload na SyncQueue:', qErr);
  }

  // 4. Se online e Supabase configurado, tenta fazer upload direto
  const isOnline = networkMonitor.getState().isBackendReachable;
  if (isOnline && isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const bucketName = 'note-attachments';

      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(filePath, file, {
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600',
          upsert: true,
        });

      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        if (publicUrlData?.publicUrl) {
          // Atualiza anexo como sincronizado no IndexedDB
          localAttachment.remote_url = publicUrlData.publicUrl;
          localAttachment.sync_status = 'synced';
          await indexedDBStorage.putAttachment(effectiveUserId, localAttachment);
          await indexedDBStorage.removeSyncQueueItem(effectiveUserId, `sync_att_${attachmentId}`);
          const remainingCount = await indexedDBStorage.getSyncQueueCount(effectiveUserId);
          networkMonitor.updatePendingCount(remainingCount);

          return {
            url: publicUrlData.publicUrl,
            name: file.name,
            size: file.size,
            type: file.type,
            attachmentId,
            isLocal: false,
          };
        }
      }
    } catch (err) {
      console.warn('[StorageAPI] Falha no upload online do Supabase, mantendo cópia offline segura no IndexedDB:', err);
    }
  }

  // Retorna com a URL local persistida (funciona 100% offline)
  return {
    url: localDataUrl,
    name: file.name,
    size: file.size,
    type: file.type,
    attachmentId,
    isLocal: true,
  };
}
