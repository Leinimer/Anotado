'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Download,
  Save,
  CheckCircle2,
  Clock,
  Cloud,
  CloudOff,
  AlertCircle,
  PanelLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
} from 'lucide-react';
import {
  PdfAnnotation,
  ToolMode,
  ShapeType,
  SaveStatus,
} from './types';
import { PdfEditorToolbar } from './PdfEditorToolbar';
import { PdfThumbnailSidebar } from './PdfThumbnailSidebar';
import { PdfCanvasPage } from './PdfCanvasPage';
import { createPdfPreviewWithoutAnotadoAnnotations, exportPdfWithAnnotations } from './pdf-exporter';
import { replaceNoteAttachment } from '../notes/api/storage-api';
import { indexedDBStorage, LocalAttachment } from '../notes/db/indexed-db';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { ATTACHMENTS_BUCKET_NAME } from '../notes/api/storage-constants';
import { networkMonitor } from '../notes/api/network-monitor';

interface PdfEditorProps {
  attachmentId: string;
  userId: string;
  sourceUrl?: string;
  isReadOnly?: boolean;
  onClose?: () => void;
}

function getSupabasePdfObject(sourceUrl?: string): { bucketId: string; storagePath: string } | null {
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return null;
  try {
    const url = new URL(sourceUrl);
    const segments = url.pathname.split('/').filter(Boolean).map((segment) => {
      try { return decodeURIComponent(segment); } catch { return segment; }
    });
    const objectIndex = segments.findIndex((segment) => segment === 'object');
    if (objectIndex < 0) return null;
    const mode = segments[objectIndex + 1];
    if (!['public', 'sign', 'authenticated'].includes(mode)) return null;
    const bucketId = segments[objectIndex + 2];
    const storagePath = segments.slice(objectIndex + 3).join('/');
    return bucketId && storagePath ? { bucketId, storagePath } : null;
  } catch {
    return null;
  }
}

function waitForRemotePdfReplacement(
  requestedAttachmentId: string,
  timeoutMs = 20000
): {
  promise: Promise<{ status: 'synced' | 'failed' | 'timeout'; message?: string }>;
  cancel: () => void;
} {
  let finish: ((result: { status: 'synced' | 'failed' | 'timeout'; message?: string }) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const promise = new Promise<{ status: 'synced' | 'failed' | 'timeout'; message?: string }>((resolve) => {
    finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('attachment:replace-complete', handleComplete);
      window.removeEventListener('attachment:replace-failed', handleFailed);
      resolve(result);
    };

    const matches = (detail: any) =>
      detail?.attachmentId === requestedAttachmentId ||
      detail?.requestedAttachmentId === requestedAttachmentId;

    const handleComplete = (event: Event) => {
      if (matches((event as CustomEvent).detail)) finish?.({ status: 'synced' });
    };

    const handleFailed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!matches(detail)) return;
      const stage = detail?.stage ? `Etapa: ${detail.stage}. ` : '';
      finish?.({
        status: 'failed',
        message: `${stage}${detail?.message || 'O Supabase recusou a substituição do PDF.'}`,
      });
    };

    window.addEventListener('attachment:replace-complete', handleComplete);
    window.addEventListener('attachment:replace-failed', handleFailed);
    timer = setTimeout(() => finish?.({ status: 'timeout' }), timeoutMs);
  });

  return {
    promise,
    cancel: () => finish?.({ status: 'timeout' }),
  };
}

async function verifyNativeAnotadoAnnotations(
  pdfBytes: ArrayBuffer,
  expected: PdfAnnotation[]
): Promise<void> {
  const expectedHighlightQuads = expected
    .filter((annotation) => annotation.type === 'highlight')
    .reduce((total, annotation) => {
      if (annotation.type !== 'highlight') return total;
      return total + (annotation.rects || []).filter((rect) =>
        Number.isFinite(rect.x) &&
        Number.isFinite(rect.y) &&
        Number.isFinite(rect.width) &&
        Number.isFinite(rect.height) &&
        rect.width > 0 &&
        rect.height > 0
      ).length;
    }, 0);
  const expectedNoteTexts = expected
    .filter((annotation) => annotation.type === 'sticky_note')
    .map((annotation) => annotation.type === 'sticky_note' ? (annotation.text || '') : '');

  // pdf-lib gerar um Blob não basta: reabre o arquivo com o mesmo motor de
  // visualização para confirmar que as anotações estão realmente no PDF.
  const pdfjsLib = await import('pdfjs-dist');
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  }

  const task = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBytes.slice(0)),
    cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
  });

  let verificationDoc: any = null;
  try {
    verificationDoc = await task.promise;
    let actualHighlightQuads = 0;
    const actualNoteTexts: string[] = [];

    for (let pageIndex = 0; pageIndex < verificationDoc.numPages; pageIndex += 1) {
      const page = await verificationDoc.getPage(pageIndex + 1);
      const pdfAnnotations = await page.getAnnotations({ intent: 'display' });

      for (const item of pdfAnnotations) {
        const author = item.titleObj?.str || '';
        if (author !== 'ANOTADO') continue;

        if (item.subtype === 'Highlight' && item.quadPoints?.length >= 8) {
          actualHighlightQuads += Math.floor(item.quadPoints.length / 8);
        } else if (item.subtype === 'Text') {
          actualNoteTexts.push(String(item.contentsObj?.str ?? ''));
        }
      }
    }

    const missingNoteTexts = [...expectedNoteTexts];
    for (const savedText of actualNoteTexts) {
      const index = missingNoteTexts.indexOf(savedText);
      if (index >= 0) missingNoteTexts.splice(index, 1);
    }

    if (actualHighlightQuads < expectedHighlightQuads || missingNoteTexts.length > 0) {
      throw new Error(
        `Verificação do PDF falhou: esperados ${expectedHighlightQuads} quadriláteros de grifo e ${expectedNoteTexts.length} comentários; encontrados ${actualHighlightQuads} quadriláteros e ${actualNoteTexts.length} comentários. ${missingNoteTexts.length ? 'Há comentários cujo conteúdo não foi gravado corretamente.' : ''} O arquivo não será enviado ao Supabase.`
      );
    }

    console.info('[PdfEditor] Anotações nativas verificadas no PDF exportado:', {
      expectedHighlightQuads,
      actualHighlightQuads,
      expectedNotes: expectedNoteTexts.length,
      actualNotes: actualNoteTexts.length,
      pages: verificationDoc.numPages,
    });
  } finally {
    try {
      await verificationDoc?.destroy?.();
    } catch {
      // Liberação best-effort do documento temporário de verificação.
    }
  }
}

function pdfAnnotationColorToHex(color: any, fallback: string): string {
  if (!color || typeof color.length !== 'number' || color.length < 3) return fallback;
  const channels = Array.from(color as ArrayLike<number>).slice(0, 3);
  if (channels.some((channel) => !Number.isFinite(channel))) return fallback;
  return `#${channels.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Range.getClientRects() frequentemente devolve um retângulo por fragmento
 * tipográfico (por exemplo, palavras em spans diferentes). Junta fragmentos
 * da mesma linha em segmentos contínuos, preservando linhas separadas.
 */
function mergeSelectionRectsByLine(
  input: Array<{ x: number; y: number; width: number; height: number }>
): Array<{ x: number; y: number; width: number; height: number }> {
  const valid = input
    .filter((rect) =>
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width > 0 &&
      rect.height > 0
    )
    .sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2) || a.x - b.x);

  const lines: Array<{
    top: number;
    bottom: number;
    rects: Array<{ x: number; y: number; width: number; height: number }>;
  }> = [];

  for (const rect of valid) {
    const rectCenter = rect.y + rect.height / 2;
    let matchingLine: typeof lines[number] | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const line of lines) {
      const lineHeight = line.bottom - line.top;
      const overlap = Math.max(0, Math.min(rect.y + rect.height, line.bottom) - Math.max(rect.y, line.top));
      const minHeight = Math.min(rect.height, lineHeight);
      const centerDistance = Math.abs(rectCenter - (line.top + line.bottom) / 2);
      const sameVisualLine =
        overlap >= minHeight * 0.45 ||
        centerDistance <= Math.max(rect.height, lineHeight) * 0.32;

      if (sameVisualLine && centerDistance < bestDistance) {
        matchingLine = line;
        bestDistance = centerDistance;
      }
    }

    if (matchingLine) {
      matchingLine.rects.push(rect);
      matchingLine.top = Math.min(matchingLine.top, rect.y);
      matchingLine.bottom = Math.max(matchingLine.bottom, rect.y + rect.height);
    } else {
      lines.push({
        top: rect.y,
        bottom: rect.y + rect.height,
        rects: [rect],
      });
    }
  }

  const merged: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const line of lines) {
    const ordered = [...line.rects].sort((a, b) => a.x - b.x);
    let current = { ...ordered[0] };

    for (let index = 1; index < ordered.length; index += 1) {
      const next = ordered[index];
      const gap = next.x - (current.x + current.width);
      const mergeGap = Math.max(2, Math.min(current.height, next.height) * 0.35);

      if (gap <= mergeGap) {
        const right = Math.max(current.x + current.width, next.x + next.width);
        const top = Math.min(current.y, next.y);
        const bottom = Math.max(current.y + current.height, next.y + next.height);
        current = {
          x: Math.min(current.x, next.x),
          y: top,
          width: right - Math.min(current.x, next.x),
          height: bottom - top,
        };
      } else {
        merged.push(current);
        current = { ...next };
      }
    }

    merged.push(current);
  }

  return merged.sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Recupera as anotações nativas gravadas pelo ANOTADO no próprio PDF.
 * Só importa anotações cujo autor é "ANOTADO", preservando as demais anotações
 * existentes no documento e evitando confundir comentários de outros leitores.
 */
async function readAnotadoPdfAnnotations(pdfDoc: any): Promise<PdfAnnotation[]> {
  const restored: PdfAnnotation[] = [];

  for (let pageIndex = 0; pageIndex < pdfDoc.numPages; pageIndex += 1) {
    const page = await pdfDoc.getPage(pageIndex + 1);
    const view = page.view as number[];
    const viewLeft = Number(view?.[0] ?? 0);
    const viewBottom = Number(view?.[1] ?? 0);
    const viewTop = Number(view?.[3] ?? page.getViewport({ scale: 1 }).height);
    const pageHeight = viewTop - viewBottom;
    const pdfAnnotations = await page.getAnnotations({ intent: 'display' });

    for (const item of pdfAnnotations) {
      const author = item.titleObj?.str || item.titleObj?.text || '';
      if (author !== 'ANOTADO') continue;

      const now = item.modificationDate || new Date().toISOString();
      const id = `pdf-native-${pageIndex}-${item.id || restored.length}`;

      if (item.subtype === 'Highlight' && item.quadPoints && item.quadPoints.length >= 8) {
        const values = Array.from(item.quadPoints as ArrayLike<number>);
        const rects: Array<{ x: number; y: number; width: number; height: number }> = [];

        for (let offset = 0; offset + 7 < values.length; offset += 8) {
          const xs = [values[offset], values[offset + 2], values[offset + 4], values[offset + 6]];
          const ys = [values[offset + 1], values[offset + 3], values[offset + 5], values[offset + 7]];
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          if (maxX <= minX || maxY <= minY) continue;

          rects.push({
            x: minX - viewLeft,
            y: viewTop - maxY,
            width: maxX - minX,
            height: maxY - minY,
          });
        }

        if (rects.length > 0) {
          restored.push({
            id,
            pageIndex,
            type: 'highlight',
            rects,
            color: pdfAnnotationColorToHex(item.color, '#ffe600'),
            opacity: Number.isFinite(item.opacity) ? Math.max(Number(item.opacity), 0.58) : 0.58,
            isNative: true,
            createdAt: now,
            updatedAt: now,
          });
        }
      } else if (item.subtype === 'Text' && Array.isArray(item.rect) && item.rect.length >= 4) {
        const rect = item.rect as number[];
        const text = item.contentsObj?.str ?? item.contents ?? '';
        restored.push({
          id,
          pageIndex,
          type: 'sticky_note',
          x: rect[0] - viewLeft,
          y: viewTop - rect[3],
          text: String(text),
          color: pdfAnnotationColorToHex(item.color, '#fef08a'),
          isNative: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  return restored;
}

export function PdfEditor({ attachmentId, userId, sourceUrl, isReadOnly = false, onClose }: PdfEditorProps) {
  // Loading state
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Document metadata
  const [fileName, setFileName] = useState('Documento.pdf');
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [rawPdfBytes, setRawPdfBytes] = useState<ArrayBuffer | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [isViewStateHydrated, setIsViewStateHydrated] = useState(false);
  const [restorePageIndex, setRestorePageIndex] = useState<number | null>(null);
  const currentPageRef = useRef(0);
  const viewStateKey = `pdf-editor-view:${attachmentId}`;
  currentPageRef.current = currentPage;

  // View state
  const [zoom, setZoom] = useState(1.15);
  // Miniaturas começam recolhidas em cada abertura do PDF.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const selectedPdfTextRangeRef = useRef<Range | null>(null);

  // Tools & annotations state
  const [currentMode, setCurrentMode] = useState<ToolMode>('select');
  const [penColor, setPenColor] = useState('#68594d');
  const [penWidth, setPenWidth] = useState(2);
  const [highlightColor, setHighlightColor] = useState('#ffe600');
  const [currentShape, setCurrentShape] = useState<ShapeType>('rectangle');

  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const draftKey = `pdf-editor-draft:${attachmentId}`;
  const annotationsRef = useRef<PdfAnnotation[]>([]);
  const hasUnsavedChangesRef = useRef(false);
  const isDraftHydratedRef = useRef(false);
  const isSavingRef = useRef(false);

  // Refs atualizadas durante o render para que o cleanup da aba sempre persista
  // a última versão, mesmo quando a troca de abas desmonta este componente.
  annotationsRef.current = annotations;

  // Undo / Redo history
  const [history, setHistory] = useState<PdfAnnotation[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Save / Sync status
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  hasUnsavedChangesRef.current = hasUnsavedChanges;
  const isSaving = saveStatus === 'saving_local' || saveStatus === 'syncing';

  // Load PDF data on mount
  useEffect(() => {
    let isCancelled = false;

    async function loadPdf() {
      setIsLoading(true);
      setLoadError(null);

      try {
        // 1. Tenta carregar do IndexedDB local
        let attachment: LocalAttachment | null = await indexedDBStorage.getAttachment(userId, attachmentId);
        if (!attachment && userId !== 'anonymous') {
          attachment = await indexedDBStorage.getAttachment('anonymous', attachmentId);
        }

        const sourceObject = getSupabasePdfObject(sourceUrl);
        if (userId !== 'anonymous' && sourceObject?.storagePath) {
          try {
            const localAttachments = await indexedDBStorage.getAllAttachments(userId);
            const attachmentByStoragePath = localAttachments.find(
              (candidate) =>
                candidate.storage_path === sourceObject.storagePath &&
                (!candidate.bucket_id || candidate.bucket_id === sourceObject.bucketId)
            );
            if (attachmentByStoragePath && (!attachment || attachmentByStoragePath.id !== attachment.id)) {
              attachment = attachmentByStoragePath;
              console.info('[PdfEditor] PDF local resolvido pelo storage_path canônico:', {
                requestedAttachmentId: attachmentId,
                canonicalAttachmentId: attachment.id,
                storagePath: sourceObject.storagePath,
              });
            }
          } catch (localLookupError) {
            console.warn('[PdfEditor] Não foi possível procurar o PDF local pelo storage_path:', localLookupError);
          }
        }

        if (attachment?.syncStatus === 'pending' || attachment?.syncStatus === 'syncing') {
          setSaveStatus('saved_local');
        } else if (attachment?.syncStatus === 'synced') {
          setSaveStatus('synced');
        } else if (attachment?.syncStatus === 'error') {
          setSaveStatus('error');

          // Recupera a causa da última falha de sincronização para que ela
          // continue visível mesmo depois de fechar e reabrir a aba do PDF.
          const failedItems = await indexedDBStorage.getPendingSyncItems(userId).catch(() => []);
          let failedReplacement = failedItems.find(
            (item) => item.action === 'REPLACE_ATTACHMENT' && item.entity_id === attachmentId
          );
          if (!failedReplacement && userId !== 'anonymous') {
            const anonymousItems = await indexedDBStorage.getPendingSyncItems('anonymous').catch(() => []);
            failedReplacement = anonymousItems.find(
              (item) => item.action === 'REPLACE_ATTACHMENT' && item.entity_id === attachmentId
            );
          }
          if (failedReplacement) {
            const details = failedReplacement.error_details?.message || failedReplacement.last_error;
            setSaveErrorMsg(details || 'A substituição do PDF no Supabase falhou; o arquivo local foi preservado.');
          }
        }

        let arrayBuffer: ArrayBuffer | null = null;
        let documentName = attachment?.file_name || 'Documento.pdf';
        let loadDetails = '';

        // Ao reabrir online, a versão remota confirmada é a fonte de verdade.
        // Antes o Blob local era sempre priorizado, podendo reabrir uma cópia
        // antiga mesmo depois de o Supabase ter recebido uma versão mais nova.
        // Nunca substitui um Blob local que ainda está pendente/deu erro de sync.
        const hasPendingLocalReplacement = Boolean(
          attachment &&
          (
            attachment.syncRequired ||
            attachment.syncStatus === 'pending' ||
            attachment.syncStatus === 'syncing' ||
            attachment.syncStatus === 'error' ||
            attachment.sync_status === 'pending' ||
            attachment.sync_status === 'failed'
          )
        );

        if (
          userId !== 'anonymous' &&
          !isReadOnly &&
          !hasPendingLocalReplacement &&
          isSupabaseConfigured() &&
          navigator.onLine
        ) {
          try {
            const supabase = createClient();
            const knownStoragePath = attachment?.storage_path || sourceObject?.storagePath || null;

            let { data: remoteAttachment, error: remoteMetadataError } = await supabase
              .from('note_attachments')
              .select('id, user_id, note_id, file_name, mime_type, file_size, storage_path, bucket_id, created_at, updated_at')
              .eq('id', attachmentId)
              .eq('user_id', userId)
              .maybeSingle();

            // O attachmentId de cartões antigos pode divergir do ID canônico.
            // Se houver caminho conhecido, consulta também por user_id + storage_path,
            // inclusive quando a origem recebida pelo editor é uma blob: URL.
            if (!remoteAttachment && knownStoragePath) {
              const byPath = await supabase
                .from('note_attachments')
                .select('id, user_id, note_id, file_name, mime_type, file_size, storage_path, bucket_id, created_at, updated_at')
                .eq('user_id', userId)
                .eq('storage_path', knownStoragePath)
                .maybeSingle();

              if (byPath.error) {
                remoteMetadataError = byPath.error;
              } else {
                remoteAttachment = byPath.data;
              }
            }

            if (remoteMetadataError) {
              loadDetails = remoteMetadataError.message || loadDetails;
              console.warn('[PdfEditor] Não foi possível verificar a versão remota do PDF:', remoteMetadataError);
            }

            if (remoteAttachment?.storage_path) {
              documentName = remoteAttachment.file_name || documentName;
              const bucketsToTry = Array.from(new Set(
                [remoteAttachment.bucket_id, attachment?.bucket_id, ATTACHMENTS_BUCKET_NAME, 'attachments']
                  .filter(Boolean) as string[]
              ));

              let latestRemoteBlob: Blob | null = null;
              let resolvedBucket: string | null = null;

              for (const bucketName of bucketsToTry) {
                try {
                  const { data: remoteBlob, error: downloadError } = await supabase.storage
                    .from(bucketName)
                    .download(remoteAttachment.storage_path);

                  if (downloadError) {
                    loadDetails = downloadError.message || loadDetails;
                    continue;
                  }

                  if (!remoteBlob || remoteBlob.size <= 0) continue;

                  if (
                    Number(remoteAttachment.file_size) > 0 &&
                    remoteBlob.size !== Number(remoteAttachment.file_size)
                  ) {
                    loadDetails = `O PDF remoto retornou ${remoteBlob.size} bytes, mas note_attachments registra ${remoteAttachment.file_size} bytes.`;
                    console.warn('[PdfEditor] Tamanho remoto divergente; tentando outro bucket:', {
                      bucketName,
                      remoteBlobSize: remoteBlob.size,
                      metadataSize: remoteAttachment.file_size,
                    });
                    continue;
                  }

                  latestRemoteBlob = remoteBlob;
                  resolvedBucket = bucketName;
                  break;
                } catch (downloadError: any) {
                  loadDetails = downloadError?.message || loadDetails;
                }
              }

              if (latestRemoteBlob && resolvedBucket) {
                arrayBuffer = await latestRemoteBlob.arrayBuffer();

                // Atualiza o IndexedDB com a mesma versão que acabou de ser
                // baixada do Storage. Isso impede que uma cópia antiga continue
                // prevalecendo na próxima abertura.
                const refreshedLocalAttachment: LocalAttachment = {
                  ...(attachment || {}),
                  id: remoteAttachment.id,
                  user_id: userId,
                  note_id: remoteAttachment.note_id ?? null,
                  file_name: remoteAttachment.file_name || documentName,
                  file_type: remoteAttachment.mime_type || 'application/pdf',
                  mime_type: remoteAttachment.mime_type || 'application/pdf',
                  file_size: latestRemoteBlob.size,
                  blob: latestRemoteBlob,
                  storage_path: remoteAttachment.storage_path,
                  bucket_id: remoteAttachment.bucket_id || resolvedBucket,
                  remote_url: null,
                  syncRequired: false,
                  syncStatus: 'synced',
                  sync_status: 'synced',
                  created_at: remoteAttachment.created_at || attachment?.created_at || new Date().toISOString(),
                  updated_at: remoteAttachment.updated_at || new Date().toISOString(),
                };

                await indexedDBStorage.putAttachment(userId, refreshedLocalAttachment);
                attachment = refreshedLocalAttachment;

                console.info('[PdfEditor] PDF atualizado a partir do Supabase Storage:', {
                  requestedAttachmentId: attachmentId,
                  canonicalAttachmentId: remoteAttachment.id,
                  bucket: resolvedBucket,
                  storagePath: remoteAttachment.storage_path,
                  fileSize: latestRemoteBlob.size,
                  remoteUpdatedAt: remoteAttachment.updated_at,
                });
              }
            }
          } catch (remoteRefreshError: any) {
            loadDetails = remoteRefreshError?.message || loadDetails;
            console.warn('[PdfEditor] Falha ao atualizar a cópia local com a versão remota:', remoteRefreshError);
          }
        }

        // Fallback local: útil offline ou quando a nuvem está indisponível.
        // Para sincronizações pendentes, mantém o Blob local que contém as edições.
        if (!arrayBuffer && attachment?.blob && attachment.blob.size > 0) {
          arrayBuffer = await attachment.blob.arrayBuffer();
        }

        // 2. Usa a mesma URL já resolvida para o card do documento. Ela pode ser
        // uma URL assinada do Supabase, pública ou um Blob URL do IndexedDB.
        if (!arrayBuffer && sourceUrl) {
          try {
            const response = await fetch(sourceUrl, { cache: 'no-store' });
            if (!response.ok) {
              throw new Error(`A origem do arquivo respondeu HTTP ${response.status}`);
            }
            const sourceBytes = await response.arrayBuffer();
            if (sourceBytes.byteLength > 0) {
              arrayBuffer = sourceBytes;
            } else {
              throw new Error('A origem do arquivo retornou zero bytes.');
            }
          } catch (sourceError: any) {
            loadDetails = sourceError?.message || String(sourceError);
            console.warn('[PdfEditor] Falha ao carregar pela URL já resolvida:', sourceError);
          }
        }

        // 3. Se ainda não temos os bytes, consulta os metadados remotos e tenta
        // os buckets conhecidos (o registro pode apontar para um bucket legado).
        if (!arrayBuffer && isSupabaseConfigured() && navigator.onLine) {
          try {
            const supabase = createClient();
            let { data: dbAtt, error: metadataError } = await supabase
              .from('note_attachments')
              .select('id, user_id, note_id, file_name, mime_type, file_size, storage_path, bucket_id, created_at, updated_at')
              .eq('id', attachmentId)
              .eq('user_id', userId)
              .maybeSingle();

            if (!dbAtt && sourceObject?.storagePath) {
              const byPath = await supabase
                .from('note_attachments')
                .select('id, user_id, note_id, file_name, mime_type, file_size, storage_path, bucket_id, created_at, updated_at')
                .eq('user_id', userId)
                .eq('storage_path', sourceObject.storagePath)
                .maybeSingle();
              if (byPath.error) {
                metadataError = byPath.error;
              } else {
                dbAtt = byPath.data;
              }
            }

            if (metadataError) {
              loadDetails = metadataError.message || loadDetails;
              console.warn('[PdfEditor] Falha ao consultar metadados do anexo:', metadataError);
            }

            if (dbAtt) {
              documentName = dbAtt.file_name || documentName;
              if (dbAtt.storage_path) {
                const bucketsToTry = Array.from(new Set(
                  [dbAtt.bucket_id, ATTACHMENTS_BUCKET_NAME, 'attachments'].filter(Boolean) as string[]
                ));

                for (const bucketName of bucketsToTry) {
                  try {
                    const { data: fileData, error: downloadError } = await supabase.storage
                      .from(bucketName)
                      .download(dbAtt.storage_path);

                    if (!downloadError && fileData && fileData.size > 0) {
                      arrayBuffer = await fileData.arrayBuffer();

                      // Só grava no banco local do usuário quando ele é o proprietário.
                      if (dbAtt.user_id === userId && userId !== 'anonymous') {
                        await indexedDBStorage.putAttachment(userId, {
                          id: dbAtt.id,
                          user_id: userId,
                          note_id: dbAtt.note_id,
                          file_name: dbAtt.file_name,
                          file_type: dbAtt.mime_type,
                          mime_type: dbAtt.mime_type,
                          file_size: dbAtt.file_size,
                          blob: fileData,
                          storage_path: dbAtt.storage_path,
                          bucket_id: dbAtt.bucket_id || bucketName,
                          syncRequired: false,
                          syncStatus: 'synced',
                          created_at: dbAtt.created_at,
                          updated_at: dbAtt.updated_at,
                        });
                      }
                      break;
                    }

                    if (downloadError) {
                      loadDetails = downloadError.message || loadDetails;
                    }
                  } catch (bucketError: any) {
                    loadDetails = bucketError?.message || loadDetails;
                    console.warn(`[PdfEditor] Falha ao baixar do bucket ${bucketName}:`, bucketError);
                  }
                }

                // Último fallback: URL assinada, útil em buckets com permissão de leitura restrita.
                if (!arrayBuffer) {
                  for (const bucketName of bucketsToTry) {
                    try {
                      const { data: signedData, error: signedError } = await supabase.storage
                        .from(bucketName)
                        .createSignedUrl(dbAtt.storage_path, 300);
                      if (signedError || !signedData?.signedUrl) {
                        loadDetails = signedError?.message || loadDetails;
                        continue;
                      }

                      const response = await fetch(signedData.signedUrl, { cache: 'no-store' });
                      if (!response.ok) {
                        loadDetails = `URL assinada respondeu HTTP ${response.status}`;
                        continue;
                      }
                      const signedBytes = await response.arrayBuffer();
                      if (signedBytes.byteLength > 0) {
                        arrayBuffer = signedBytes;
                        break;
                      }
                    } catch (signedError: any) {
                      loadDetails = signedError?.message || loadDetails;
                    }
                  }
                }
              }
            } else if (!metadataError) {
              loadDetails = loadDetails || 'O registro do arquivo não foi encontrado na tabela note_attachments.';
            }
          } catch (remoteError: any) {
            loadDetails = remoteError?.message || loadDetails;
            console.warn('[PdfEditor] Falha no fallback remoto do PDF:', remoteError);
          }
        }

        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
          const offlineMessage = !navigator.onLine
            ? 'O dispositivo está offline e não há uma cópia local deste PDF.'
            : 'Não foi possível obter o conteúdo do anexo no dispositivo nem no Storage.';
          throw new Error(
            loadDetails
              ? `${offlineMessage} Detalhe: ${loadDetails}`
              : offlineMessage
          );
        }

        if (isCancelled) return;

        setFileName(documentName);
        setRawPdfBytes(arrayBuffer);

        // 3. Inicializa PDFJS
        const pdfjsLib = await import('pdfjs-dist');
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        }

        const loadingTask = pdfjsLib.getDocument({
          // PDF.js pode transferir o buffer ao worker. Passe uma cópia para manter
          // rawPdfBytes intacto no thread principal para exportação/salvamento.
          data: new Uint8Array(arrayBuffer.slice(0)),
          cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
          cMapPacked: true,
        });

        const doc = await loadingTask.promise;
        if (isCancelled) return;

        // Recupera grifos e comentários nativos gravados dentro do próprio PDF.
        // O PDF é a fonte persistente; o IndexedDB guarda apenas o rascunho ainda não salvo.
        const persistedPdfAnnotations = await readAnotadoPdfAnnotations(doc);

        // O PDF original contém grifos nativos ANOTADO e o editor também os
        // desenha como SVG. Se o PDF.js pintar ambos, a exclusão remove apenas
        // o SVG e deixa o grifo antigo no canvas. A visualização usa uma cópia
        // sem os objetos ANOTADO; os bytes originais continuam intactos para salvar.
        const previewBytes = await createPdfPreviewWithoutAnotadoAnnotations(arrayBuffer);
        const previewLoadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(previewBytes),
          cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
          cMapPacked: true,
        });
        const previewDoc = await previewLoadingTask.promise;
        if (isCancelled) {
          await previewDoc.destroy();
          await doc.destroy();
          return;
        }
        await doc.destroy();
        const displayDoc = previewDoc;

        // Recupera o rascunho local de anotações para que alternar entre abas
        // internas não descarte alterações ainda não salvas no PDF.
        const draft = await indexedDBStorage.getMetadata<{
          version: number;
          annotations: PdfAnnotation[];
          updatedAt: string;
          dirty: boolean;
        }>(userId, `pdf-editor-draft:${attachmentId}`);

        let recoveredDraft = draft;
        if (!recoveredDraft && userId !== 'anonymous') {
          recoveredDraft = await indexedDBStorage.getMetadata<{
            version: number;
            annotations: PdfAnnotation[];
            updatedAt: string;
            dirty: boolean;
          }>('anonymous', `pdf-editor-draft:${attachmentId}`);
        }

        if (!isCancelled) {
          const hasDraft =
            !isReadOnly &&
            recoveredDraft?.version === 1 &&
            recoveredDraft.dirty === true &&
            Array.isArray(recoveredDraft.annotations);

          const initialAnnotations = hasDraft
            ? recoveredDraft!.annotations
            : persistedPdfAnnotations;

          annotationsRef.current = initialAnnotations;
          hasUnsavedChangesRef.current = Boolean(hasDraft);
          setAnnotations(initialAnnotations);
          setHistory(hasDraft ? [persistedPdfAnnotations, initialAnnotations] : [initialAnnotations]);
          setHistoryIndex(hasDraft ? 1 : 0);
          setHasUnsavedChanges(Boolean(hasDraft));
          setSaveStatus(hasDraft ? 'unsaved' : (persistedPdfAnnotations.length > 0 ? 'synced' : 'idle'));
        }

        // Recupera a última página visualizada deste mesmo anexo.
        const savedView = await indexedDBStorage.getMetadata<{
          version: number;
          pageIndex: number;
          updatedAt?: string;
        }>(userId, viewStateKey);

        let recoveredView = savedView;
        if (!recoveredView && userId !== 'anonymous') {
          recoveredView = await indexedDBStorage.getMetadata<{
            version: number;
            pageIndex: number;
            updatedAt?: string;
          }>('anonymous', viewStateKey);
        }

        const safePageIndex = recoveredView?.version === 1 && Number.isFinite(recoveredView.pageIndex)
          ? Math.max(0, Math.min(Math.trunc(recoveredView.pageIndex), displayDoc.numPages - 1))
          : 0;

        if (isCancelled) return;
        setCurrentPage(safePageIndex);
        setRestorePageIndex(safePageIndex);
        isDraftHydratedRef.current = true;
        setIsDraftHydrated(true);
        setIsViewStateHydrated(true);
        setPdfDoc(displayDoc);
        setNumPages(displayDoc.numPages);
        setIsLoading(false);
      } catch (err: any) {
        console.error('[PdfEditor] Erro ao carregar PDF:', err);
        if (!isCancelled) {
          setLoadError(err?.message || 'Falha ao processar o arquivo PDF.');
          setIsLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      isCancelled = true;
    };
  }, [attachmentId, userId, sourceUrl, viewStateKey]);

  // Persiste a última página lida por anexo. O estado é individual do documento
  // e não é colocado no conteúdo binário nem nos metadados compartilhados do arquivo.
  useEffect(() => {
    if (!isViewStateHydrated || numPages <= 0) return;

    const timer = setTimeout(() => {
      void indexedDBStorage.setMetadata(userId, viewStateKey, {
        version: 1,
        pageIndex: Math.max(0, Math.min(currentPage, numPages - 1)),
        updatedAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('[PdfEditor] Não foi possível salvar a última página lida:', error);
      });
    }, 350);

    return () => clearTimeout(timer);
  }, [currentPage, isViewStateHydrated, numPages, userId, viewStateKey]);

  useEffect(() => {
    return () => {
      if (!isViewStateHydrated || numPages <= 0) return;
      void indexedDBStorage.setMetadata(userId, viewStateKey, {
        version: 1,
        pageIndex: Math.max(0, Math.min(currentPageRef.current, numPages - 1)),
        updatedAt: new Date().toISOString(),
      }).catch((error) => {
        console.warn('[PdfEditor] Falha ao preservar a página atual ao fechar a aba:', error);
      });
    };
  }, [isViewStateHydrated, numPages, userId, viewStateKey]);

  // Depois que as páginas forem montadas, restaura a rolagem no ponto salvo.
  useEffect(() => {
    if (!isViewStateHydrated || numPages <= 0 || restorePageIndex === null) return;
    const targetIndex = Math.max(0, Math.min(restorePageIndex, numPages - 1));

    const frame = window.requestAnimationFrame(() => {
      const target = pageRefs.current.get(targetIndex);
      if (target && scrollContainerRef.current) {
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isViewStateHydrated, numPages, restorePageIndex]);

  // Salva rascunhos de anotações no IndexedDB, com debounce para não gravar
  // milhares de transações durante o desenho livre.
  useEffect(() => {
    if (
      !isDraftHydrated ||
      isReadOnly ||
      !hasUnsavedChanges ||
      !rawPdfBytes
    ) {
      return;
    }

    const snapshot = annotations;
    const timer = setTimeout(() => {
      void indexedDBStorage
        .setMetadata(userId, draftKey, {
          version: 1,
          annotations: snapshot,
          updatedAt: new Date().toISOString(),
          dirty: true,
        })
        .catch((error) => {
          console.warn('[PdfEditor] Não foi possível persistir o rascunho do PDF:', error);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [annotations, hasUnsavedChanges, isDraftHydrated, isReadOnly, rawPdfBytes, userId, draftKey]);

  // Flush imediato ao desmontar ao trocar de aba, fechar o workspace ou alternar
  // para outra nota. A escrita local não depende de uma nova renderização.
  useEffect(() => {
    return () => {
      if (
        !isDraftHydratedRef.current ||
        !hasUnsavedChangesRef.current ||
        isReadOnly
      ) {
        return;
      }

      void indexedDBStorage
        .setMetadata(userId, draftKey, {
          version: 1,
          annotations: annotationsRef.current,
          updatedAt: new Date().toISOString(),
          dirty: true,
        })
        .catch((error) => {
          console.warn('[PdfEditor] Falha ao preservar rascunho ao trocar de aba:', error);
        });
    };
  }, [userId, draftKey, isReadOnly]);

  // Guarda a última seleção não vazia feita na camada de texto do PDF.
  // Isso permite clicar em Marca-texto/Sublinhar/Tachar sem perder a seleção pelo foco do dock.
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim() || selection.rangeCount === 0) return;

      const anchorElement = selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode?.parentElement;
      const focusElement = selection.focusNode instanceof Element
        ? selection.focusNode
        : selection.focusNode?.parentElement;

      if (
        anchorElement?.closest('.pdf-text-layer') &&
        focusElement?.closest('.pdf-text-layer')
      ) {
        selectedPdfTextRangeRef.current = selection.getRangeAt(0).cloneRange();
      }
    };

    // Clique fora do texto e da barra de ferramentas invalida a seleção guardada.
    // Assim, uma marcação posterior não reaplica acidentalmente um trecho antigo.
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest('.pdf-text-layer') ||
        target?.closest('[data-pdf-editor-toolbar]')
      ) {
        return;
      }
      selectedPdfTextRangeRef.current = null;
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, []);

  // Confirmação e falha da substituição remota no Supabase.
  useEffect(() => {
    const matchesThisPdf = (detail: any) =>
      detail?.attachmentId === attachmentId || detail?.requestedAttachmentId === attachmentId;

    const handleReplaceComplete = (e: any) => {
      if (matchesThisPdf(e.detail)) {
        setSaveErrorMsg(null);
        setSaveStatus('synced');
      }
    };

    const handleReplaceFailed = (e: any) => {
      if (!matchesThisPdf(e.detail)) return;
      const message = e.detail?.message || 'O Supabase não confirmou a substituição do PDF.';
      const stage = e.detail?.stage ? `Etapa: ${e.detail.stage}. ` : '';
      setSaveErrorMsg(`${stage}${message}`);
      setSaveStatus('error');
    };

    window.addEventListener('attachment:replace-complete', handleReplaceComplete);
    window.addEventListener('attachment:replace-failed', handleReplaceFailed);
    return () => {
      window.removeEventListener('attachment:replace-complete', handleReplaceComplete);
      window.removeEventListener('attachment:replace-failed', handleReplaceFailed);
    };
  }, [attachmentId]);

  // Push new state to undo/redo history
  const pushHistory = useCallback(
    (newAnnotations: PdfAnnotation[]) => {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newAnnotations);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      annotationsRef.current = newAnnotations;
      hasUnsavedChangesRef.current = true;
      setAnnotations(newAnnotations);
      setHasUnsavedChanges(true);
      setSaveStatus('unsaved');
    },
    [history, historyIndex]
  );

  const handleAddAnnotation = (ann: PdfAnnotation) => {
    if (isSavingRef.current) return;
    const next = [...annotations, ann];
    pushHistory(next);
  };

  const handleUpdateAnnotation = (updated: PdfAnnotation) => {
    if (isSavingRef.current) return;
    const next = annotations.map((a) => (a.id === updated.id ? updated : a));
    pushHistory(next);
  };

  const handleDeleteAnnotation = (id: string) => {
    if (isSavingRef.current) return;
    const next = annotations.filter((a) => a.id !== id);
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
    pushHistory(next);
  };

  const handleDeleteSelected = () => {
    if (isSavingRef.current) return;
    if (selectedAnnotationId) {
      handleDeleteAnnotation(selectedAnnotationId);
    }
  };

  // Aplica marcação sobre a seleção de texto na camada de texto do PDF.
  const applyTextAnnotationFromSelection = useCallback(
    (modeToApply: 'highlight' | 'underline' | 'strikethrough', explicitRange?: Range | null) => {
      let range = explicitRange;
      if (!range) {
        const selection = document.getSelection();
        if (selection && !selection.isCollapsed && selection.toString().trim() && selection.rangeCount > 0) {
          const anchorElement = selection.anchorNode instanceof Element
            ? selection.anchorNode
            : selection.anchorNode?.parentElement;
          const focusElement = selection.focusNode instanceof Element
            ? selection.focusNode
            : selection.focusNode?.parentElement;

          if (anchorElement?.closest('.pdf-text-layer') || focusElement?.closest('.pdf-text-layer')) {
            range = selection.getRangeAt(0);
          }
        }
      }

      if (!range) {
        range = selectedPdfTextRangeRef.current;
      }

      if (!range) return false;

      const clientRects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0.5 && rect.height > 0.5
      );
      if (clientRects.length === 0) return false;

      const groupedRects = new Map<number, Array<{ x: number; y: number; width: number; height: number }>>();

      for (const [pageIndex, pageWrapper] of pageRefs.current.entries()) {
        const pageElement = pageWrapper.querySelector('[data-pdf-page-container]') as HTMLElement | null;
        if (!pageElement) continue;

        const pageBounds = pageElement.getBoundingClientRect();
        const scaleX = Number(pageElement.dataset.pdfScaleX || 0);
        const scaleY = Number(pageElement.dataset.pdfScaleY || 0);
        if (!scaleX || !scaleY) continue;

        for (const selectedRect of clientRects) {
          const left = Math.max(selectedRect.left, pageBounds.left);
          const top = Math.max(selectedRect.top, pageBounds.top);
          const right = Math.min(selectedRect.right, pageBounds.right);
          const bottom = Math.min(selectedRect.bottom, pageBounds.bottom);
          if (right <= left + 0.5 || bottom <= top + 0.5) continue;

          // O marca-texto deve ultrapassar a caixa de seleção por uma margem
          // pequena e igual nos dois lados, como um grifo convencional.
          // A caixa DOM já está alinhada à linha de base real do texto no PdfCanvasPage.
          const verticalPaddingPx = modeToApply === 'highlight' ? 1.5 : 0;
          const paddedTop = Math.max(pageBounds.top, top - verticalPaddingPx);
          const paddedBottom = Math.min(pageBounds.bottom, bottom + verticalPaddingPx);

          const converted = {
            x: Math.max(0, (left - pageBounds.left) / scaleX),
            y: Math.max(0, (paddedTop - pageBounds.top) / scaleY),
            width: (right - left) / scaleX,
            height: Math.max(0, (paddedBottom - paddedTop) / scaleY),
          };
          const existing = groupedRects.get(pageIndex) || [];
          existing.push(converted);
          groupedRects.set(pageIndex, existing);
        }
      }

      if (groupedRects.size === 0) return false;

      const now = new Date().toISOString();
      const created: PdfAnnotation[] = [];
      groupedRects.forEach((rawRects, pageIndex) => {
        // Um único objeto de anotação por seleção e página. Fragmentos de spans
        // adjacentes na mesma linha são unidos antes da gravação do PDF.
        const rects = mergeSelectionRectsByLine(rawRects);
        if (rects.length === 0) return;
        const id = `text-mark-${Date.now()}-${pageIndex}-${Math.random().toString(36).slice(2, 7)}`;
        if (modeToApply === 'highlight') {
          created.push({
            id,
            pageIndex,
            type: 'highlight',
            rects,
            color: highlightColor,
            opacity: 0.58,
            createdAt: now,
            updatedAt: now,
          });
        } else if (modeToApply === 'underline') {
          created.push({
            id,
            pageIndex,
            type: 'underline',
            rects,
            color: penColor,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          created.push({
            id,
            pageIndex,
            type: 'strikethrough',
            rects,
            color: penColor,
            createdAt: now,
            updatedAt: now,
          });
        }
      });

      if (created.length > 0) {
        pushHistory([...annotationsRef.current, ...created]);
        selectedPdfTextRangeRef.current = null;
        document.getSelection()?.removeAllRanges();
        return true;
      }

      return false;
    },
    [highlightColor, penColor, pushHistory]
  );

  // Criação contínua e imediata ao soltar o mouse com marca-texto, sublinhado ou tachado ativo
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (isReadOnly || isSavingRef.current) return;
      if (
        currentMode !== 'highlight' &&
        currentMode !== 'underline' &&
        currentMode !== 'strikethrough'
      ) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-pdf-editor-toolbar]')) return;

      setTimeout(() => {
        applyTextAnnotationFromSelection(currentMode);
      }, 10);
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [currentMode, isReadOnly, applyTextAnnotationFromSelection]);

  // Altera o modo da ferramenta. Se havia texto previamente selecionado e o usuário
  // escolheu marca-texto/sublinhado/tachado, aplica a marcação imediatamente.
  const handleSetToolMode = (nextMode: ToolMode) => {
    if (
      (nextMode === 'highlight' || nextMode === 'underline' || nextMode === 'strikethrough') &&
      selectedPdfTextRangeRef.current
    ) {
      const applied = applyTextAnnotationFromSelection(nextMode, selectedPdfTextRangeRef.current);
      if (applied) {
        setCurrentMode('select');
        return;
      }
    }

    setCurrentMode(nextMode);
  };

  const handleUndo = () => {
    if (isSavingRef.current) return;
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      annotationsRef.current = history[prevIndex];
      hasUnsavedChangesRef.current = true;
      setAnnotations(history[prevIndex]);
      setHasUnsavedChanges(true);
      setSaveStatus('unsaved');
    }
  };

  const handleRedo = () => {
    if (isSavingRef.current) return;
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      annotationsRef.current = history[nextIndex];
      hasUnsavedChangesRef.current = true;
      setAnnotations(history[nextIndex]);
      setHasUnsavedChanges(true);
      setSaveStatus('unsaved');
    }
  };

  // Zoom handlers
  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.15, 3.0));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.15, 0.5));
  const handleFitWidth = () => {
    if (!scrollContainerRef.current) return;
    const containerWidth = scrollContainerRef.current.clientWidth - (isSidebarOpen ? 260 : 60);
    // Standard A4 width is ~595px
    const targetScale = Math.max(0.5, Math.min(containerWidth / 620, 2.5));
    setZoom(targetScale);
  };
  const handleFitPage = () => {
    if (!scrollContainerRef.current) return;
    const containerHeight = scrollContainerRef.current.clientHeight - 120;
    // Standard A4 height is ~842px
    const targetScale = Math.max(0.5, Math.min(containerHeight / 860, 2.0));
    setZoom(targetScale);
  };

  // Page scroll navigation
  const scrollToPage = (pageIndex: number) => {
    setCurrentPage(pageIndex);
    const targetEl = pageRefs.current.get(pageIndex);
    if (targetEl && scrollContainerRef.current) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Mantém a página atual sincronizada com o centro da área de leitura.
  // Em vez de escolher arbitrariamente a última página que disparou o observer,
  // seleciona a página visível cujo centro está mais próximo do centro da viewport.
  useEffect(() => {
    const scrollRoot = scrollContainerRef.current;
    if (!scrollRoot || numPages === 0) return;

    const visiblePages = new Map<number, boolean>();
    const updateActivePage = () => {
      const rootBounds = scrollRoot.getBoundingClientRect();
      const centerY = rootBounds.top + rootBounds.height / 2;
      let nearestIndex: number | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const [index, isVisible] of visiblePages.entries()) {
        if (!isVisible) continue;
        const element = pageRefs.current.get(index);
        if (!element) continue;
        const bounds = element.getBoundingClientRect();
        const distance = Math.abs((bounds.top + bounds.bottom) / 2 - centerY);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }

      const nextIndex = nearestIndex;
      if (nextIndex !== null) {
        setCurrentPage((previous) => previous === nextIndex ? previous : nextIndex);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number(entry.target.getAttribute('data-page-index') || 0);
          visiblePages.set(index, entry.isIntersecting);
        }
        updateActivePage();
      },
      {
        root: scrollRoot,
        threshold: [0, 0.15, 0.3, 0.5, 0.75, 1],
      }
    );

    pageRefs.current.forEach((element) => {
      if (element) observer.observe(element);
    });

    return () => {
      observer.disconnect();
      visiblePages.clear();
    };
  }, [numPages, isLoading]);

  // Salva localmente e aguarda confirmação explícita do Supabase quando há conexão.
  const handleSave = async () => {
    if (!rawPdfBytes || isReadOnly || isSavingRef.current) return;

    isSavingRef.current = true;
    const wasOnline = navigator.onLine && networkMonitor.getState().isBackendReachable;
    const remoteWaiter = wasOnline ? waitForRemotePdfReplacement(attachmentId, 20000) : null;

    try {
      setSaveStatus(wasOnline ? 'syncing' : 'saving_local');
      setSaveErrorMsg(null);

      await indexedDBStorage.setMetadata(userId, viewStateKey, {
        version: 1,
        pageIndex: Math.max(0, Math.min(currentPage, numPages - 1)),
        updatedAt: new Date().toISOString(),
      });

      const annotationsSnapshot = [...annotationsRef.current];
      const highlightCount = annotationsSnapshot.filter(
        (annotation) => annotation.type === 'highlight'
      ).length;

      console.info('[PdfEditor] Exportando PDF para salvar:', {
        attachmentId,
        annotations: annotationsSnapshot.length,
        highlights: highlightCount,
      });

      const updatedBlob = await exportPdfWithAnnotations(rawPdfBytes, annotationsSnapshot);
      if (updatedBlob.size <= 0) {
        throw new Error('A exportação gerou um PDF vazio. O arquivo anterior foi preservado.');
      }

      // Não envia um PDF apenas porque pdf-lib retornou um Blob. Reabre o
      // arquivo exportado com PDF.js e exige que todos os grifos/notas previstos
      // existam como anotações nativas /Highlight e /Text.
      await verifyNativeAnotadoAnnotations(await updatedBlob.arrayBuffer(), annotationsSnapshot);

      const result = await replaceNoteAttachment(userId, attachmentId, updatedBlob, {
        sourceUrl,
        fileName,
      });
      if (!result.success) {
        throw new Error('O IndexedDB não confirmou a gravação local do PDF editado.');
      }

      // Neste ponto o Blob e a tarefa REPLACE_ATTACHMENT já estão no IndexedDB.
      // Isso é persistência local, ainda não é prova de que o Supabase recebeu o PDF.
      setSelectedAnnotationId(null);
      hasUnsavedChangesRef.current = false;
      setHasUnsavedChanges(false);

      await indexedDBStorage.setMetadata(userId, draftKey, null).catch((error) => {
        console.warn('[PdfEditor] Não foi possível limpar o rascunho local:', error);
      });
      if (userId !== 'anonymous') {
        await indexedDBStorage.setMetadata('anonymous', draftKey, null).catch(() => {});
      }

      if (!wasOnline || !remoteWaiter) {
        setSaveStatus('saved_local');
        setSaveErrorMsg('PDF gravado neste dispositivo. O Supabase ainda não confirmou a sincronização.');
      } else {
        const remoteResult = await remoteWaiter.promise;
        if (remoteResult.status === 'synced') {
          setSaveErrorMsg(null);
          setSaveStatus('synced');
        } else if (remoteResult.status === 'failed') {
          setSaveErrorMsg(remoteResult.message || 'O Supabase não confirmou a substituição do PDF.');
          setSaveStatus('error');
        } else {
          // A tarefa continua na SyncQueue e poderá ser retomada pelo SyncEngine.
          // Não exibir "Salvo na nuvem" sem o evento de confirmação remota.
          setSaveErrorMsg('PDF gravado neste dispositivo, mas o Supabase ainda não confirmou o recebimento. A sincronização continuará em segundo plano.');
          setSaveStatus('saved_local');
        }
      }
    } catch (err: any) {
      console.error('[PdfEditor] Erro ao salvar PDF:', err);
      setSaveStatus('error');
      setSaveErrorMsg(err?.message || 'Erro ao salvar alterações no documento.');
    } finally {
      remoteWaiter?.cancel();
      isSavingRef.current = false;
    }
  };

  // Download export
  const handleDownload = async () => {
    if (!rawPdfBytes) return;
    try {
      const blob = await exportPdfWithAnnotations(rawPdfBytes, annotations);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      console.error('[PdfEditor] Erro ao baixar PDF:', err);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'Escape') {
        setSelectedAnnotationId(null);
        setCurrentMode('select');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeTag = (document.activeElement?.tagName || '').toLowerCase();
        if (activeTag !== 'input' && activeTag !== 'textarea') {
          handleDeleteSelected();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Render status badge
  const renderStatusBadge = () => {
    switch (saveStatus) {
      case 'saving_local':
        return (
          <span className="flex items-center gap-1.5 text-xs text-[#68594d] dark:text-[#c4b5a5]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="hidden sm:inline">Salvando localmente...</span>
          </span>
        );
      case 'saved_local':
        return (
          <span className="flex items-center gap-1.5 text-xs text-[#b45309] dark:text-[#f59e0b]" title={saveErrorMsg || 'Salvo localmente no dispositivo. Sincronização pendente.'}>
            <Clock className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Salvo localmente</span>
          </span>
        );
      case 'syncing':
        return (
          <span className="flex items-center gap-1.5 text-xs text-[#2563eb]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="hidden sm:inline">Sincronizando com a nuvem...</span>
          </span>
        );
      case 'synced':
        return (
          <span className="flex items-center gap-1.5 text-xs text-[#15803d] dark:text-[#4ade80]" title="Todas as alterações estão sincronizadas com o Supabase.">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Salvo na nuvem</span>
          </span>
        );
      case 'unsaved':
        return (
          <span className="flex items-center gap-1.5 text-xs text-[#d97706]">
            <span className="w-2 h-2 rounded-full bg-[#d97706] animate-pulse" />
            <span className="hidden sm:inline">Alterações não salvas</span>
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-1.5 text-xs text-[#ba1a1a]" title={saveErrorMsg || 'Erro'}>
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Erro ao salvar</span>
          </span>
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className={`flex flex-col items-center justify-center ${onClose ? 'h-full min-h-0' : 'min-h-screen'} bg-[#fbf9f4] dark:bg-[#1a1918] text-[#1b1c19] dark:text-[#ededed]`}>
        <Loader2 className="w-8 h-8 animate-spin text-[#68594d] mb-3" />
        <p className="text-sm font-sans-ui text-[#7f756e] dark:text-[#a89f97]">
          Carregando documento PDF...
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`flex flex-col items-center justify-center ${onClose ? 'h-full min-h-0' : 'min-h-screen'} bg-[#fbf9f4] dark:bg-[#1a1918] text-[#1b1c19] dark:text-[#ededed] p-6 text-center`}>
        <AlertCircle className="w-12 h-12 text-[#ba1a1a] mb-3" />
        <h2 className="text-lg font-bold font-sans-ui mb-2">Falha ao abrir PDF</h2>
        <p className="text-sm font-sans-ui text-[#7f756e] dark:text-[#a89f97] max-w-md mb-6">
          {loadError}
        </p>
        <button
          type="button"
          onClick={() => (onClose ? onClose() : window.close())}
          className="px-4 py-2 bg-[#68594d] hover:bg-[#53463c] text-white text-sm font-medium rounded-xl transition-colors cursor-pointer"
        >
          Fechar aba
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${onClose ? 'h-full min-h-0 w-full min-w-0' : 'h-screen w-screen'} overflow-hidden bg-[#ebe8e1] dark:bg-[#151413] text-[#1b1c19] dark:text-[#ededed]`}>
      {/* Top Header */}
      <header className="h-14 border-b border-[#e4e2dd] dark:border-[#383633] bg-[#fbf9f4] dark:bg-[#201f1d] px-4 flex items-center justify-between z-30 shrink-0 select-none">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => {
              if (onClose) {
                onClose();
              } else if (window.history.length > 1) {
                window.history.back();
              } else {
                window.close();
              }
            }}
            className="p-1.5 rounded-xl text-[#68594d] dark:text-[#d4c8bc] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28] transition-colors cursor-pointer"
            title="Voltar / Fechar"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 rounded-xl text-[#7f756e] dark:text-[#a89f97] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28] transition-colors cursor-pointer"
            title="Alternar miniaturas"
            aria-label="Alternar miniaturas"
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-[#ba1a1a] shrink-0" />
            <h1 className="text-sm font-semibold truncate text-[#1b1c19] dark:text-[#ededed] font-sans-ui m-0">
              {fileName}
            </h1>
          </div>
        </div>

        {/* Center: Save / Sync status */}
        <div className="flex items-center gap-4">
          {renderStatusBadge()}

          <div className="hidden sm:flex items-center gap-1 text-xs text-[#7f756e] dark:text-[#9e958d] font-sans-ui bg-[#efebe2] dark:bg-[#2c2a28] px-2.5 py-1 rounded-lg">
            <span>Página</span>
            <span className="font-semibold text-[#1b1c19] dark:text-[#ededed]">{currentPage + 1}</span>
            <span>de</span>
            <span>{numPages}</span>
          </div>
        </div>

        {/* Right actions: Save and Download */}
        <div className="flex items-center gap-2">
          {!isReadOnly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold font-sans-ui transition-all shadow-xs cursor-pointer ${
                hasUnsavedChanges
                  ? 'bg-[#68594d] hover:bg-[#53463c] text-white'
                  : 'bg-[#eae7e0] dark:bg-[#33312e] text-[#68594d] dark:text-[#d4c8bc] hover:bg-[#dfdcd4]'
              }`}
              title="Salvar alterações no documento (Ctrl+S)"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Salvar</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleDownload}
            className="p-1.5 rounded-xl text-[#68594d] dark:text-[#d4c8bc] hover:bg-[#efebe2] dark:hover:bg-[#2c2a28] transition-colors cursor-pointer"
            title="Baixar cópia em PDF"
            aria-label="Baixar cópia em PDF"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Thumbnails Sidebar */}
        <PdfThumbnailSidebar
          numPages={numPages}
          currentPage={currentPage}
          onSelectPage={scrollToPage}
          pdfDoc={pdfDoc}
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen(false)}
        />

        {/* Scrollable Viewport */}
        <main
          ref={scrollContainerRef}
          className={`flex-1 overflow-auto p-4 sm:p-8 flex flex-col items-center relative ${
            currentMode === 'hand' ? 'cursor-grab active:cursor-grabbing' : ''
          }`}
        >
          {Array.from({ length: numPages }, (_, index) => (
            <div
              key={index}
              data-page-index={index}
              ref={(el) => {
                if (el) pageRefs.current.set(index, el);
                else pageRefs.current.delete(index);
              }}
            >
              <PdfCanvasPage
                pageIndex={index}
                pdfDoc={pdfDoc}
                zoom={zoom}
                mode={currentMode}
                onSetMode={setCurrentMode}
                penColor={penColor}
                penWidth={penWidth}
                highlightColor={highlightColor}
                currentShape={currentShape}
                annotations={annotations}
                selectedAnnotationId={selectedAnnotationId}
                onSelectAnnotation={setSelectedAnnotationId}
                onAddAnnotation={handleAddAnnotation}
                onUpdateAnnotation={handleUpdateAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                isReadOnly={isReadOnly || isSaving}
              />
            </div>
          ))}
        </main>
      </div>

      {/* Bottom Floating Toolbar */}
      {(() => {
        const selectedAnnotation = annotations.find((a) => a.id === selectedAnnotationId);
        const isTextMarkSelected = Boolean(
          selectedAnnotation &&
          (selectedAnnotation.type === 'highlight' ||
           selectedAnnotation.type === 'underline' ||
           selectedAnnotation.type === 'strikethrough')
        );

        return (
          <PdfEditorToolbar
            currentMode={currentMode}
            onSetMode={handleSetToolMode}
            penColor={penColor}
            onSetPenColor={setPenColor}
            penWidth={penWidth}
            onSetPenWidth={setPenWidth}
            highlightColor={highlightColor}
            onSetHighlightColor={setHighlightColor}
            currentShape={currentShape}
            onSetShape={setCurrentShape}
            zoom={zoom}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onFitWidth={handleFitWidth}
            onFitPage={handleFitPage}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < history.length - 1}
            onUndo={handleUndo}
            onRedo={handleRedo}
            hasSelection={Boolean(selectedAnnotationId)}
            onDeleteSelected={handleDeleteSelected}
            isTextMarkSelected={isTextMarkSelected}
            isReadOnly={isReadOnly || isSaving}
          />
        );
      })()}
    </div>
  );
}
