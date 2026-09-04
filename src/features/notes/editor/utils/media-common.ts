import { indexedDBStorage } from '@/src/features/notes/db/indexed-db';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { ATTACHMENTS_BUCKET_NAME } from '@/src/features/notes/api/storage-api';

export type ResizeDirection =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'left'
  | 'right';

export interface ResizeCalculationOptions {
  direction: ResizeDirection;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startWidth: number;
  aspectRatio?: number;
  minWidth: number;
  maxContainerWidth: number;
}

/**
 * Calcula a nova largura baseada no arraste dos handles de redimensionamento,
 * respeitando aspecto de proporção (quando fornecido) e limites de largura mínima/máxima.
 */
export function calculateResizedWidth({
  direction,
  startX,
  startY,
  currentX,
  currentY,
  startWidth,
  aspectRatio,
  minWidth,
  maxContainerWidth,
}: ResizeCalculationOptions): number {
  const deltaX = currentX - startX;
  const deltaY = currentY - startY;

  let calculatedWidth = startWidth;

  if (aspectRatio && aspectRatio > 0) {
    switch (direction) {
      case 'right':
        calculatedWidth = startWidth + deltaX;
        break;
      case 'left':
        calculatedWidth = startWidth - deltaX;
        break;
      case 'bottom-right': {
        const widthFromX = startWidth + deltaX;
        const widthFromY = startWidth + deltaY * aspectRatio;
        calculatedWidth = Math.abs(deltaX) > Math.abs(deltaY) ? widthFromX : widthFromY;
        break;
      }
      case 'bottom-left': {
        const widthFromX = startWidth - deltaX;
        const widthFromY = startWidth + deltaY * aspectRatio;
        calculatedWidth = Math.abs(deltaX) > Math.abs(deltaY) ? widthFromX : widthFromY;
        break;
      }
      case 'top-right': {
        const widthFromX = startWidth + deltaX;
        const widthFromY = startWidth - deltaY * aspectRatio;
        calculatedWidth = Math.abs(deltaX) > Math.abs(deltaY) ? widthFromX : widthFromY;
        break;
      }
      case 'top-left': {
        const widthFromX = startWidth - deltaX;
        const widthFromY = startWidth - deltaY * aspectRatio;
        calculatedWidth = Math.abs(deltaX) > Math.abs(deltaY) ? widthFromX : widthFromY;
        break;
      }
    }
  } else {
    // Redimensionamento horizontal uniforme (ex: cartões de documentos)
    if (direction === 'right' || direction === 'top-right' || direction === 'bottom-right') {
      calculatedWidth = startWidth + deltaX;
    } else {
      calculatedWidth = startWidth - deltaX;
    }
  }

  return Math.min(Math.max(calculatedWidth, minWidth), maxContainerWidth);
}

/**
 * Retorna as classes Tailwind flex de alinhamento para os containers de mídia.
 */
export function getMediaAlignmentClass(alignment?: string): string {
  if (alignment === 'center') return 'justify-center';
  if (alignment === 'right') return 'justify-end';
  return 'justify-start';
}

/**
 * Formata bytes em representação legível (ex: KB, MB, GB).
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Extrai o ID de um protocolo canônico attachment:// ou local-attachment://
 */
export function extractAttachmentId(src: string): string | null {
  if (src.startsWith('attachment://') || src.startsWith('local-attachment://')) {
    return src.replace(/^(?:attachment|local-attachment):\/\//, '').trim();
  }
  return null;
}

export interface ResolvedAttachmentResult {
  resolvedUrl: string | null;
  remoteUrl: string | null;
  blobUrl: string | null;
}

// Caches em memória para reuso estável de Blob URLs e URLs remotas (evita recriação e flicker)
const attachmentBlobUrlCache = new Map<string, string>();
const attachmentRemoteUrlCache = new Map<string, string>();

/**
 * Consulta síncrona do cache em memória para anexo já resolvido.
 */
export function getCachedAttachmentUrl(rawSrc: string): string | null {
  if (!rawSrc) return null;
  const attachmentId = extractAttachmentId(rawSrc);
  if (!attachmentId) {
    if (
      rawSrc.startsWith('http://') ||
      rawSrc.startsWith('https://') ||
      rawSrc.startsWith('data:') ||
      rawSrc.startsWith('blob:')
    ) {
      return rawSrc;
    }
    return null;
  }
  return attachmentRemoteUrlCache.get(attachmentId) || attachmentBlobUrlCache.get(attachmentId) || null;
}

/**
 * Registra formalmente a URL remota resolvida de um anexo no cache em memória.
 */
export function registerResolvedAttachmentUrl(attachmentId: string, remoteUrl: string): void {
  if (!attachmentId || !remoteUrl) return;
  attachmentRemoteUrlCache.set(attachmentId, remoteUrl);
}

/**
 * Resolve assincronamente a URL de exibição de um anexo local ou remoto,
 * consultando IndexedDB e fazendo fallback no Supabase note_attachments se necessário.
 */
export async function resolveAttachmentSource(
  rawSrc: string,
  currentUserId: string = 'anonymous'
): Promise<ResolvedAttachmentResult> {
  const attachmentId = extractAttachmentId(rawSrc);
  if (!attachmentId) {
    return { resolvedUrl: rawSrc, remoteUrl: null, blobUrl: null };
  }

  // 1. Verifica cache remoto em memória primeiro
  if (attachmentRemoteUrlCache.has(attachmentId)) {
    const remoteUrl = attachmentRemoteUrlCache.get(attachmentId)!;
    return {
      resolvedUrl: remoteUrl,
      remoteUrl,
      blobUrl: null,
    };
  }

  try {
    let attachment = await indexedDBStorage.getAttachment(currentUserId, attachmentId);
    if (!attachment && currentUserId !== 'anonymous') {
      attachment = await indexedDBStorage.getAttachment('anonymous', attachmentId);
    }

    if (attachment) {
      if (attachment.remote_url) {
        attachmentRemoteUrlCache.set(attachmentId, attachment.remote_url);
        return {
          resolvedUrl: attachment.remote_url,
          remoteUrl: attachment.remote_url,
          blobUrl: null,
        };
      }

      if (attachment.blob) {
        // Reutiliza Blob URL existente em vez de instanciar novos repetidamente
        let blobUrl = attachmentBlobUrlCache.get(attachmentId);
        if (!blobUrl) {
          blobUrl = URL.createObjectURL(attachment.blob);
          attachmentBlobUrlCache.set(attachmentId, blobUrl);
        }
        return {
          resolvedUrl: blobUrl,
          remoteUrl: null,
          blobUrl,
        };
      }
    }

    // Se não encontrou no IndexedDB local, consulta Supabase se online
    if (isSupabaseConfigured() && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const supabase = createClient();
        const { data: dbAtt } = await supabase
          .from('note_attachments')
          .select('*')
          .eq('id', attachmentId)
          .maybeSingle();

        if (dbAtt && dbAtt.storage_path) {
          const bucketsToTry = [dbAtt.bucket_id, ATTACHMENTS_BUCKET_NAME, 'attachments'].filter(Boolean) as string[];
          const uniqueBuckets = Array.from(new Set(bucketsToTry));

          let remoteUrl: string | null = null;

          for (const bucket of uniqueBuckets) {
            // Tenta URL assinada (7200s = 2h) permitida para viewers pelas RLS de Storage
            const { data: signedData, error: signedErr } = await supabase.storage
              .from(bucket)
              .createSignedUrl(dbAtt.storage_path, 7200);

            if (!signedErr && signedData?.signedUrl) {
              remoteUrl = signedData.signedUrl;
              break;
            }

            // Fallback para getPublicUrl se o bucket for público
            const { data: pubData } = supabase.storage
              .from(bucket)
              .getPublicUrl(dbAtt.storage_path);

            if (pubData?.publicUrl) {
              remoteUrl = pubData.publicUrl;
              break;
            }
          }

          if (remoteUrl) {
            attachmentRemoteUrlCache.set(attachmentId, remoteUrl);

            // Regra de Isolamento: Apenas persiste no IndexedDB se for o próprio proprietário do anexo
            if (currentUserId && currentUserId !== 'anonymous' && currentUserId === dbAtt.user_id) {
              try {
                await indexedDBStorage.putAttachment(currentUserId, {
                  id: dbAtt.id,
                  user_id: currentUserId,
                  note_id: dbAtt.note_id,
                  file_name: dbAtt.file_name,
                  file_type: dbAtt.mime_type,
                  mime_type: dbAtt.mime_type,
                  file_size: dbAtt.file_size,
                  storage_path: dbAtt.storage_path,
                  remote_url: remoteUrl,
                  syncRequired: false,
                  syncStatus: 'synced',
                  sync_status: 'synced',
                  created_at: dbAtt.created_at,
                  updated_at: dbAtt.updated_at,
                });
              } catch (saveErr) {
                console.warn('[AttachmentResolver] Aviso ao persistir anexo local:', saveErr);
              }
            }

            return {
              resolvedUrl: remoteUrl,
              remoteUrl,
              blobUrl: null,
            };
          }
        }
      } catch (fetchErr) {
        console.warn('[AttachmentResolver] Falha ao consultar Supabase:', fetchErr);
      }
    }
  } catch (err) {
    console.warn('[AttachmentResolver] Falha ao resolver anexo local:', err);
  }

  // Fallback: se houver blob url no cache
  if (attachmentBlobUrlCache.has(attachmentId)) {
    const blobUrl = attachmentBlobUrlCache.get(attachmentId)!;
    return { resolvedUrl: blobUrl, remoteUrl: null, blobUrl };
  }

  return { resolvedUrl: null, remoteUrl: null, blobUrl: null };
}
