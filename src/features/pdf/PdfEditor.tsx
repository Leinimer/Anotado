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
  isReadOnly?: boolean;
  onClose?: () => void;
}

export function PdfEditor({ attachmentId, userId, isReadOnly = false, onClose }: PdfEditorProps) {
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

  // Tools & annotations state
  const [currentMode, setCurrentMode] = useState<ToolMode>('select');
  const [penColor, setPenColor] = useState('#68594d');
  const [penWidth, setPenWidth] = useState(2);
  const [highlightColor, setHighlightColor] = useState('#fef08a');
  const [currentShape, setCurrentShape] = useState<ShapeType>('rectangle');

  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  // Undo / Redo history
  const [history, setHistory] = useState<PdfAnnotation[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Save / Sync status
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

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

        let arrayBuffer: ArrayBuffer | null = null;
        let documentName = 'Documento.pdf';

        if (attachment?.blob) {
          arrayBuffer = await attachment.blob.arrayBuffer();
          documentName = attachment.file_name || 'Documento.pdf';
        } else if (isSupabaseConfigured() && navigator.onLine) {
          // 2. Fallback no Supabase
          const supabase = createClient();
          const { data: dbAtt } = await supabase
            .from('note_attachments')
            .select('*')
            .eq('id', attachmentId)
            .maybeSingle();

          if (dbAtt && dbAtt.storage_path) {
            documentName = dbAtt.file_name || 'Documento.pdf';
            const { data: fileData, error: downloadErr } = await supabase.storage
              .from(ATTACHMENTS_BUCKET_NAME)
              .download(dbAtt.storage_path);

            if (downloadErr) throw downloadErr;
            if (fileData) {
              arrayBuffer = await fileData.arrayBuffer();
              // Salva localmente no IndexedDB
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
          }
        }

        if (!arrayBuffer) {
          throw new Error('Não foi possível carregar o arquivo PDF. Verifique sua conexão.');
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
          data: new Uint8Array(arrayBuffer),
          cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
          cMapPacked: true,
        });

        const doc = await loadingTask.promise;
        if (isCancelled) return;

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
  }, [attachmentId, userId]);

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
      setAnnotations(newAnnotations);
      setHasUnsavedChanges(true);
      setSaveStatus('unsaved');
    },
    [history, historyIndex]
  );

  const handleAddAnnotation = (ann: PdfAnnotation) => {
    const next = [...annotations, ann];
    pushHistory(next);
  };

  const handleUpdateAnnotation = (updated: PdfAnnotation) => {
    const next = annotations.map((a) => (a.id === updated.id ? updated : a));
    pushHistory(next);
  };

  const handleDeleteAnnotation = (id: string) => {
    const next = annotations.filter((a) => a.id !== id);
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
    pushHistory(next);
  };

  const handleDeleteSelected = () => {
    if (selectedAnnotationId) {
      handleDeleteAnnotation(selectedAnnotationId);
    }
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setAnnotations(history[prevIndex]);
      setHasUnsavedChanges(true);
      setSaveStatus('unsaved');
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
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

  // IntersectionObserver to update currentPage during scroll
  useEffect(() => {
    if (!scrollContainerRef.current || numPages === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute('data-page-index') || 0);
            setCurrentPage(index);
          }
        }
      },
      {
        root: scrollContainerRef.current,
        threshold: 0.3,
      }
    );

    pageRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [numPages, isLoading]);

  // Save handler: burns annotations into PDF and overwrites same object in Supabase
  const handleSave = async () => {
    if (!rawPdfBytes || isReadOnly) return;

    try {
      setSaveStatus('saving_local');
      setSaveErrorMsg(null);

      // 1. Gera o PDF binário real com as anotações mescladas
      const updatedBlob = await exportPdfWithAnnotations(rawPdfBytes, annotations);

      // 2. Persiste localmente e enfileira para substituição idempotente no Supabase
      const result = await replaceNoteAttachment(userId, attachmentId, updatedBlob);

      if (result.success) {
        setHasUnsavedChanges(false);
        const isOnline = navigator.onLine && networkMonitor.getState().isBackendReachable;
        if (isOnline) {
          setSaveStatus('syncing');
          // Em breve o syncEngine confirmará e emitirá 'attachment:replace-complete'
          setTimeout(() => {
            setSaveStatus((current) => (current === 'syncing' ? 'synced' : current));
          }, 1500);
        } else {
          setSaveStatus('saved_local');
        }
      }
    } catch (err: any) {
      console.error('[PdfEditor] Erro ao salvar PDF:', err);
      setSaveStatus('error');
      setSaveErrorMsg(err?.message || 'Erro ao salvar alterações no documento.');
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
              disabled={saveStatus === 'saving_local'}
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
                isReadOnly={isReadOnly}
              />
            </div>
          ))}
        </main>
      </div>

      {/* Bottom Floating Toolbar */}
      <PdfEditorToolbar
        currentMode={currentMode}
        onSetMode={setCurrentMode}
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
        isReadOnly={isReadOnly}
      />
    </div>
  );
}
