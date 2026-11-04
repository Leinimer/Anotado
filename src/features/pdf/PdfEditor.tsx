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
import { exportPdfWithAnnotations } from './pdf-exporter';
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

  // View state
  const [zoom, setZoom] = useState(1.15);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const selectedPdfTextRangeRef = useRef<Range | null>(null);

  // Tools & annotations state
  const [currentMode, setCurrentMode] = useState<ToolMode>('select');
  const [penColor, setPenColor] = useState('#68594d');
  const [penWidth, setPenWidth] = useState(2);
  const [highlightColor, setHighlightColor] = useState('#fef08a');
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

        if (attachment?.syncStatus === 'pending' || attachment?.syncStatus === 'syncing') {
          setSaveStatus('saved_local');
        } else if (attachment?.syncStatus === 'synced') {
          setSaveStatus('synced');
        } else if (attachment?.syncStatus === 'error') {
          setSaveStatus('error');
        }

        let arrayBuffer: ArrayBuffer | null = null;
        let documentName = attachment?.file_name || 'Documento.pdf';
        let loadDetails = '';

        // 1. Prioriza o Blob local, desde que esteja íntegro.
        if (attachment?.blob && attachment.blob.size > 0) {
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
            const { data: dbAtt, error: metadataError } = await supabase
              .from('note_attachments')
              .select('id, user_id, note_id, file_name, mime_type, file_size, storage_path, bucket_id, created_at, updated_at')
              .eq('id', attachmentId)
              .maybeSingle();

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

        if (
          !isCancelled &&
          !isReadOnly &&
          recoveredDraft?.version === 1 &&
          recoveredDraft.dirty === true &&
          Array.isArray(recoveredDraft.annotations)
        ) {
          const recovered = recoveredDraft.annotations;
          annotationsRef.current = recovered;
          hasUnsavedChangesRef.current = true;
          setAnnotations(recovered);
          setHistory([[], recovered]);
          setHistoryIndex(1);
          setHasUnsavedChanges(true);
          setSaveStatus('unsaved');
        }

        if (isCancelled) return;
        isDraftHydratedRef.current = true;
        setIsDraftHydrated(true);
        setPdfDoc(doc);
        setNumPages(doc.numPages);
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
  }, [attachmentId, userId, sourceUrl]);

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

  // Listener para sincronização remota confirmada
  useEffect(() => {
    const handleReplaceComplete = (e: any) => {
      if (e.detail?.attachmentId === attachmentId) {
        setSaveStatus('synced');
      }
    };
    window.addEventListener('attachment:replace-complete', handleReplaceComplete);
    return () => {
      window.removeEventListener('attachment:replace-complete', handleReplaceComplete);
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

  // Aplica marcação exatamente sobre os retângulos reais do texto selecionado,
  // inclusive quando a seleção atravessa duas ou mais páginas.
  const handleSetToolMode = (nextMode: ToolMode) => {
    if (
      (nextMode === 'highlight' || nextMode === 'underline' || nextMode === 'strikethrough') &&
      selectedPdfTextRangeRef.current
    ) {
      const range = selectedPdfTextRangeRef.current;
      const clientRects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0.5 && rect.height > 0.5
      );
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
          if (right <= left || bottom <= top) continue;

          const converted = {
            x: Math.max(0, (left - pageBounds.left) / scaleX),
            y: Math.max(0, (top - pageBounds.top) / scaleY),
            width: (right - left) / scaleX,
            height: (bottom - top) / scaleY,
          };
          const existing = groupedRects.get(pageIndex) || [];
          existing.push(converted);
          groupedRects.set(pageIndex, existing);
        }
      }

      const now = new Date().toISOString();
      const created: PdfAnnotation[] = [];
      groupedRects.forEach((rects, pageIndex) => {
        const id = `text-mark-${Date.now()}-${pageIndex}-${Math.random().toString(36).slice(2, 7)}`;
        if (nextMode === 'highlight') {
          created.push({
            id,
            pageIndex,
            type: 'highlight',
            rects,
            color: highlightColor,
            opacity: 0.38,
            createdAt: now,
            updatedAt: now,
          });
        } else if (nextMode === 'underline') {
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
        pushHistory([...annotations, ...created]);
        selectedPdfTextRangeRef.current = null;
        document.getSelection()?.removeAllRanges();
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

  // Salva o PDF no mesmo objeto e caminho do Storage, incorporando as anotações.
  const handleSave = async () => {
    if (!rawPdfBytes || isReadOnly || isSavingRef.current) return;

    isSavingRef.current = true;
    const wasOnline = navigator.onLine && networkMonitor.getState().isBackendReachable;

    try {
      setSaveStatus(wasOnline ? 'syncing' : 'saving_local');
      setSaveErrorMsg(null);

      const annotationsSnapshot = annotations;
      const updatedBlob = await exportPdfWithAnnotations(rawPdfBytes, annotationsSnapshot);

      // Atualiza o mesmo attachmentId/storage_path localmente e enfileira a substituição remota.
      const result = await replaceNoteAttachment(userId, attachmentId, updatedBlob);
      if (!result.success) {
        throw new Error('Não foi possível salvar o PDF no armazenamento local.');
      }

      // O PDF exportado passa a ser a nova base. Recarrega o PDF.js para que as
      // marcações incorporadas apareçam na página e zera somente o overlay temporário.
      const savedBytes = await updatedBlob.arrayBuffer();
      const pdfjsLib = await import('pdfjs-dist');
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
      }
      const reloadedTask = pdfjsLib.getDocument({
        // Mantém savedBytes preservado como base local para os próximos salvamentos.
        data: new Uint8Array(savedBytes.slice(0)),
        cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
        cMapPacked: true,
      });
      const reloadedPdf = await reloadedTask.promise;

      const previousPdf = pdfDoc;
      setRawPdfBytes(savedBytes);
      setPdfDoc(reloadedPdf);
      setNumPages(reloadedPdf.numPages);
      setCurrentPage((current) => Math.min(current, reloadedPdf.numPages - 1));
      setAnnotations([]);
      annotationsRef.current = [];
      setSelectedAnnotationId(null);
      setHistory([[]]);
      setHistoryIndex(0);
      hasUnsavedChangesRef.current = false;
      setHasUnsavedChanges(false);

      // A falha ao limpar metadados de rascunho não invalida o arquivo que já foi salvo.
      await indexedDBStorage.setMetadata(userId, draftKey, null).catch((error) => {
        console.warn('[PdfEditor] Não foi possível limpar o rascunho local:', error);
      });
      if (userId !== 'anonymous') {
        await indexedDBStorage.setMetadata('anonymous', draftKey, null).catch(() => {});
      }

      try {
        await previousPdf?.destroy?.();
      } catch {
        // O novo documento já está carregado; a liberação do anterior é best-effort.
      }

      // A sincronização em nuvem só muda para "Salvo na nuvem" quando o SyncEngine
      // emitir attachment:replace-complete. Não usar timer para simular confirmação.
      // O SyncEngine pode confirmar antes ou depois do retorno do upload local.
      setSaveStatus((current) =>
        wasOnline && current === 'synced' ? 'synced' : wasOnline ? 'syncing' : 'saved_local'
      );
    } catch (err: any) {
      console.error('[PdfEditor] Erro ao salvar PDF:', err);
      setSaveStatus('error');
      setSaveErrorMsg(err?.message || 'Erro ao salvar alterações no documento.');
    } finally {
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
          <span className="flex items-center gap-1.5 text-xs text-[#b45309] dark:text-[#f59e0b]" title="Salvo localmente no dispositivo. Sincronização pendente.">
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
        isReadOnly={isReadOnly || isSaving}
      />
    </div>
  );
}
