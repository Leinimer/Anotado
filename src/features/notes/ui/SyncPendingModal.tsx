'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Cloud,
  RefreshCw,
  X,
  FileText,
  Folder,
  Paperclip,
  AlertCircle,
  CheckCircle2,
  Clock,
  Tag as TagIcon,
  Ban,
  RotateCw,
  AlertTriangle,
  ExternalLink,
  Trash2,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import {
  indexedDBStorage,
  SyncQueueItem,
  ExtendedNote,
  ExtendedFolder,
  LocalAttachment,
} from '../db/indexed-db';
import { syncEngine, formatFriendlyErrorMessage } from '../api/sync-engine';
import { networkMonitor } from '../api/network-monitor';
import { buildFolderPath, buildNotePath } from '../utils/path-builder';
import { deleteAttachmentCompletely } from '../api/notes-api';
import { Folder as FolderType, Note as NoteType } from '../types';

interface SyncPendingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string;
  onSelectNote?: (noteId: string) => void;
  onSelectFolder?: (folderId: string | null) => void;
  folders?: FolderType[];
  notes?: NoteType[];
}

export interface PendingDisplayItem {
  id: string; // queue item id or entity prefixed id
  queueItemId?: string;
  entityId: string;
  type: 'note' | 'folder' | 'attachment' | 'tag' | 'queue';
  actionLabel: string;
  title: string;
  noteTitle?: string;
  noteId?: string | null;
  folderId?: string | null;
  path: string;
  timestamp: string;
  status: 'pending' | 'processing' | 'failed' | 'synced' | 'cancelled';
  attempts: number;
  lastError?: string | null;
  fileSize?: number;
  fileType?: string;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatRelativeTimestamp(isoDate: string): string {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (isToday) {
    return `Hoje às ${timeStr}`;
  }

  const dayMonth = date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
  return `${dayMonth} às ${timeStr}`;
}

function getActionSemanticLabel(action?: string, payload?: any, type?: string): string {
  if (!action) {
    if (type === 'note') return 'Nota pendente';
    if (type === 'folder') return 'Pasta pendente';
    if (type === 'attachment') return 'Upload de anexo pendente';
    return 'Alteração pendente';
  }

  switch (action) {
    case 'CREATE_NOTE':
      return 'Criação de nota';
    case 'UPDATE_NOTE_CONTENT':
      return 'Edição de conteúdo';
    case 'UPDATE_NOTE':
      return 'Propriedades da nota';
    case 'DELETE_NOTE':
      return 'Exclusão de nota';
    case 'MOVE_NOTE':
      return 'Mover nota';
    case 'ARCHIVE_NOTE':
      return 'Arquivar nota';
    case 'UNARCHIVE_NOTE':
      return 'Desarquivar nota';
    case 'CREATE_FOLDER':
      return 'Criação de pasta';
    case 'UPDATE_FOLDER':
      return 'Renomear pasta';
    case 'DELETE_FOLDER':
      return 'Exclusão de pasta';
    case 'MOVE_FOLDER':
      return 'Mover pasta';
    case 'UPLOAD_ATTACHMENT': {
      const ft = payload?.fileType || payload?.file_type || '';
      if (ft.includes('pdf')) return 'Upload de PDF';
      if (ft.includes('image')) return 'Upload de imagem';
      return 'Upload de anexo';
    }
    case 'DELETE_ATTACHMENT':
      return 'Exclusão de anexo';
    case 'UPDATE_TAGS':
      return 'Atualização de etiquetas';
    default:
      return 'Alteração local';
  }
}

async function fetchAllPendingDisplayItems(
  userId: string,
  providedFolders?: FolderType[],
  providedNotes?: NoteType[]
): Promise<PendingDisplayItem[]> {
  const displayList: PendingDisplayItem[] = [];
  const processedEntityIds = new Set<string>();

  // 1. Carrega dados do IndexedDB para resolução completa de caminhos e nomes caso não fornecidos
  let allFolders: any[] = providedFolders || [];
  let allNotes: any[] = providedNotes || [];

  if (allFolders.length === 0) {
    try {
      allFolders = await indexedDBStorage.getAllFolders(userId);
    } catch {
      allFolders = [];
    }
  }

  if (allNotes.length === 0) {
    try {
      allNotes = await indexedDBStorage.getAllNotes(userId);
    } catch {
      allNotes = [];
    }
  }

  const notesMap = new Map<string, any>(allNotes.map((n) => [n.id, n]));
  const foldersMap = new Map<string, any>(allFolders.map((f) => [f.id, f]));

  // Helper para resolver informações de nota
  const resolveNoteInfo = (noteId?: string | null) => {
    if (!noteId) return { noteTitle: undefined, folderId: null, path: 'Sem pasta' };
    const note = notesMap.get(noteId);
    if (!note) return { noteTitle: undefined, folderId: null, path: 'Sem pasta' };
    const folderId = note.folder_id || null;
    const path = buildFolderPath(folderId, allFolders);
    return { noteTitle: note.title || 'Nota sem título', folderId, path };
  };

  // Helper para resolver informações de pasta
  const resolveFolderInfo = (folderId?: string | null) => {
    if (!folderId) return { path: 'Sem pasta' };
    const folder = foldersMap.get(folderId);
    const parentId = folder?.parent_id || null;
    const path = parentId ? buildFolderPath(parentId, allFolders) : 'Raiz';
    return { path };
  };

  // 1. Processa itens da Fila de Sincronização (Sync Queue)
  const queue = await indexedDBStorage.getPendingSyncQueue(userId);
  for (const item of queue) {
    processedEntityIds.add(item.entity_id);

    let title = 'Item';
    let noteTitle: string | undefined;
    let noteId: string | null = null;
    let folderId: string | null = null;
    let path = 'Sem pasta';
    let fileSize: number | undefined;
    let fileType: string | undefined;

    if (item.entity_type === 'note') {
      noteId = item.entity_id;
      const note = notesMap.get(item.entity_id);
      title = item.payload?.title || note?.title || 'Nota sem título';
      const info = resolveNoteInfo(item.entity_id);
      folderId = info.folderId;
      path = info.path;
    } else if (item.entity_type === 'folder') {
      const folder = foldersMap.get(item.entity_id);
      title = item.payload?.updates?.name || item.payload?.name || folder?.name || 'Pasta';
      const info = resolveFolderInfo(item.entity_id);
      path = info.path;
      folderId = item.entity_id;
    } else if (item.entity_type === 'attachment') {
      fileSize = item.payload?.fileSize || item.payload?.file_size;
      fileType = item.payload?.fileType || item.payload?.file_type;
      title = item.payload?.fileName || item.payload?.file_name || 'Arquivo anexo';
      noteId = item.payload?.noteId || item.payload?.note_id || null;

      if (!noteId) {
        try {
          const att = await indexedDBStorage.getAttachment(userId, item.entity_id);
          if (att) {
            if (!title || title === 'Arquivo anexo') title = att.file_name;
            if (!fileSize) fileSize = att.file_size;
            if (!fileType) fileType = att.file_type;
            noteId = att.note_id || null;
          }
        } catch {
          // Fallback silencioso
        }
      }

      if (noteId) {
        const info = resolveNoteInfo(noteId);
        noteTitle = info.noteTitle;
        folderId = info.folderId;
        path = info.path;
      }
    } else if (item.entity_type === 'tag') {
      title = 'Etiquetas';
      noteId = item.payload?.noteId || item.entity_id || null;
      if (noteId) {
        const info = resolveNoteInfo(noteId);
        noteTitle = info.noteTitle;
        folderId = info.folderId;
        path = info.path;
      }
    }

    const actionLabel = getActionSemanticLabel(item.action, item.payload, item.entity_type);

    displayList.push({
      id: item.id,
      queueItemId: item.id,
      entityId: item.entity_id,
      type: item.entity_type,
      actionLabel,
      title,
      noteTitle,
      noteId,
      folderId,
      path,
      timestamp: item.created_at,
      status: item.status === 'processing' ? 'processing' : item.status === 'failed' ? 'failed' : 'pending',
      attempts: item.attempts || 0,
      lastError: item.last_error ? formatFriendlyErrorMessage(item.last_error) : null,
      fileSize,
      fileType,
    });
  }

  // 2. Entidades que precisam de sincronização direta no IndexedDB (caso não estejam na fila)
  const entities = await indexedDBStorage.getEntitiesRequiringSync(userId);
  for (const note of entities.notes) {
    if (!processedEntityIds.has(note.id)) {
      processedEntityIds.add(note.id);
      const info = resolveNoteInfo(note.id);
      displayList.push({
        id: `note_${note.id}`,
        entityId: note.id,
        noteId: note.id,
        type: 'note',
        actionLabel: 'Nota pendente',
        title: note.title || 'Nota sem título',
        folderId: info.folderId,
        path: info.path,
        timestamp: note.updated_at || note.created_at,
        status: (note.syncStatus as any) === 'error' ? 'failed' : 'pending',
        attempts: 0,
      });
    }
  }

  for (const folder of entities.folders) {
    if (!processedEntityIds.has(folder.id)) {
      processedEntityIds.add(folder.id);
      const info = resolveFolderInfo(folder.id);
      displayList.push({
        id: `folder_${folder.id}`,
        entityId: folder.id,
        folderId: folder.id,
        type: 'folder',
        actionLabel: 'Pasta pendente',
        title: folder.name || 'Pasta',
        path: info.path,
        timestamp: folder.updated_at || folder.created_at,
        status: (folder.syncStatus as any) === 'error' ? 'failed' : 'pending',
        attempts: 0,
      });
    }
  }

  for (const att of entities.attachments) {
    if (!processedEntityIds.has(att.id)) {
      processedEntityIds.add(att.id);
      const isPdf = att.file_type?.includes('pdf') || att.file_name?.toLowerCase().endsWith('.pdf');
      const isImg = att.file_type?.includes('image');
      const label = isPdf ? 'Upload de PDF' : isImg ? 'Upload de imagem' : 'Upload de anexo';
      const info = resolveNoteInfo(att.note_id);
      displayList.push({
        id: `att_${att.id}`,
        entityId: att.id,
        type: 'attachment',
        actionLabel: label,
        title: att.file_name || 'Arquivo anexo',
        noteTitle: info.noteTitle,
        noteId: att.note_id,
        folderId: info.folderId,
        path: info.path,
        timestamp: att.updated_at || att.created_at,
        status: (att.syncStatus as any) === 'error' ? 'failed' : 'pending',
        attempts: 0,
        fileSize: att.file_size,
        fileType: att.file_type,
      });
    }
  }

  // 3. Entidades canceladas / pausadas pelo usuário
  const cancelled = await indexedDBStorage.getCancelledEntities(userId);
  for (const note of cancelled.notes) {
    if (!processedEntityIds.has(note.id)) {
      processedEntityIds.add(note.id);
      const info = resolveNoteInfo(note.id);
      displayList.push({
        id: `cancelled_note_${note.id}`,
        entityId: note.id,
        noteId: note.id,
        type: 'note',
        actionLabel: 'Sincronização pausada',
        title: note.title || 'Nota sem título',
        folderId: info.folderId,
        path: info.path,
        timestamp: note.updated_at || note.created_at,
        status: 'cancelled',
        attempts: 0,
      });
    }
  }

  for (const folder of cancelled.folders) {
    if (!processedEntityIds.has(folder.id)) {
      processedEntityIds.add(folder.id);
      const info = resolveFolderInfo(folder.id);
      displayList.push({
        id: `cancelled_folder_${folder.id}`,
        entityId: folder.id,
        folderId: folder.id,
        type: 'folder',
        actionLabel: 'Sincronização pausada',
        title: folder.name || 'Pasta',
        path: info.path,
        timestamp: folder.updated_at || folder.created_at,
        status: 'cancelled',
        attempts: 0,
      });
    }
  }

  for (const att of cancelled.attachments) {
    if (!processedEntityIds.has(att.id)) {
      processedEntityIds.add(att.id);
      const info = resolveNoteInfo(att.note_id);
      displayList.push({
        id: `cancelled_att_${att.id}`,
        entityId: att.id,
        type: 'attachment',
        actionLabel: 'Sincronização pausada',
        title: att.file_name || 'Arquivo anexo',
        noteTitle: info.noteTitle,
        noteId: att.note_id,
        folderId: info.folderId,
        path: info.path,
        timestamp: att.updated_at || att.created_at,
        status: 'cancelled',
        attempts: 0,
        fileSize: att.file_size,
        fileType: att.file_type,
      });
    }
  }

  return displayList;
}

export function SyncPendingModal({
  isOpen,
  onClose,
  userId = 'anonymous',
  onSelectNote,
  onSelectFolder,
  folders = [],
  notes = [],
}: SyncPendingModalProps) {
  const [items, setItems] = useState<PendingDisplayItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'failed' | 'cancelled'>('all');
  const [confirmCancelItem, setConfirmCancelItem] = useState<PendingDisplayItem | null>(null);
  const [confirmDeleteAttachmentItem, setConfirmDeleteAttachmentItem] = useState<PendingDisplayItem | null>(null);
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    if (!userId) return;
    try {
      const result = await fetchAllPendingDisplayItems(userId, folders, notes);
      setItems(result);
    } catch (err) {
      console.warn('[SyncPendingModal] Falha ao carregar pendências:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId, folders, notes]);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;

    fetchAllPendingDisplayItems(userId, folders, notes)
      .then((result) => {
        if (isMounted) {
          setItems(result);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.warn('[SyncPendingModal] Falha ao carregar pendências:', err);
        if (isMounted) setIsLoading(false);
      });

    const unsubscribe = networkMonitor.subscribe(() => {
      if (isMounted) {
        fetchAllPendingDisplayItems(userId, folders, notes).then((res) => {
          if (isMounted) setItems(res);
        });
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [isOpen, userId, folders, notes]);

  const handleSyncNow = async () => {
    if (!userId || isSyncing) return;
    setIsSyncing(true);
    try {
      await syncEngine.processQueue(userId);
      await refreshList();
    } catch (err) {
      console.warn('[SyncPendingModal] Erro ao disparar sincronização:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleOpenNote = (item: PendingDisplayItem) => {
    const targetNoteId = item.noteId || (item.type === 'note' ? item.entityId : null);
    if (!targetNoteId) return;

    if (item.folderId && onSelectFolder) {
      onSelectFolder(item.folderId);
    }

    if (onSelectNote) {
      onSelectNote(targetNoteId);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('anotado:open-note', {
          detail: { noteId: targetNoteId, folderId: item.folderId },
        })
      );
    }

    onClose();
  };

  const handleConfirmCancelSync = async () => {
    if (!confirmCancelItem || !userId) return;
    const target = confirmCancelItem;
    setActionInProgressId(target.id);
    try {
      await indexedDBStorage.cancelEntitySync(
        userId,
        target.type,
        target.entityId,
        target.queueItemId
      );
      setConfirmCancelItem(null);
      await refreshList();
    } catch (err) {
      console.error('[SyncPendingModal] Erro ao cancelar sincronização:', err);
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleConfirmDeleteAttachment = async () => {
    if (!confirmDeleteAttachmentItem || !userId) return;
    const target = confirmDeleteAttachmentItem;
    setActionInProgressId(target.id);
    try {
      await deleteAttachmentCompletely(userId, target.entityId);
      setConfirmDeleteAttachmentItem(null);
      await refreshList();
    } catch (err) {
      console.error('[SyncPendingModal] Erro ao excluir anexo:', err);
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleReactivateSync = async (item: PendingDisplayItem) => {
    if (!userId) return;
    setActionInProgressId(item.id);
    try {
      await indexedDBStorage.reactivateEntitySync(userId, item.type, item.entityId);
      await refreshList();
      syncEngine.scheduleSync(50);
    } catch (err) {
      console.error('[SyncPendingModal] Erro ao reativar sincronização:', err);
    } finally {
      setActionInProgressId(null);
    }
  };

  const counts = useMemo(() => {
    const pendingCount = items.filter((i) => i.status === 'pending' || i.status === 'processing').length;
    const failedCount = items.filter((i) => i.status === 'failed').length;
    const cancelledCount = items.filter((i) => i.status === 'cancelled').length;
    return {
      all: items.length,
      pending: pendingCount,
      failed: failedCount,
      cancelled: cancelledCount,
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    if (activeTab === 'pending') {
      return items.filter((i) => i.status === 'pending' || i.status === 'processing');
    }
    if (activeTab === 'failed') {
      return items.filter((i) => i.status === 'failed');
    }
    if (activeTab === 'cancelled') {
      return items.filter((i) => i.status === 'cancelled');
    }
    return items;
  }, [items, activeTab]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#eae8e3] bg-[#f5f3ee]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#68594d]/10 text-[#68594d] flex items-center justify-center">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif-note font-bold text-lg text-[#1b1c19] leading-tight">
                Pendências de Sincronização
              </h2>
              <p className="font-sans-ui text-xs text-[#7f756e] mt-0.5">
                {counts.all === 0
                  ? 'Todas as alterações estão salvas e sincronizadas'
                  : `${counts.pending + counts.failed} item(ns) na fila • Operações locais salvas no IndexedDB`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-xl transition-colors cursor-pointer"
            aria-label="Fechar janela"
            id="close-sync-modal-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Filters */}
        {items.length > 0 && (
          <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-[#eae8e3] bg-white/60 text-xs font-sans-ui overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'all'
                  ? 'bg-[#68594d] text-white shadow-2xs'
                  : 'text-[#68594d] hover:bg-[#f0eee9]'
              }`}
            >
              <span>Todas</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'all' ? 'bg-white/20 text-white' : 'bg-[#e4e2dd] text-[#4e453f]'}`}>
                {counts.all}
              </span>
            </button>

            {counts.pending > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('pending')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'pending'
                    ? 'bg-[#d97706] text-white shadow-2xs'
                    : 'text-[#92400e] hover:bg-[#fef3c7]'
                }`}
              >
                <span>Aguardando</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'pending' ? 'bg-white/20 text-white' : 'bg-[#fde68a] text-[#92400e]'}`}>
                  {counts.pending}
                </span>
              </button>
            )}

            {counts.failed > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('failed')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'failed'
                    ? 'bg-[#ba1a1a] text-white shadow-2xs'
                    : 'text-[#ba1a1a] hover:bg-[#fceded]'
                }`}
              >
                <span>Falhas</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'failed' ? 'bg-white/20 text-white' : 'bg-[#fecaca] text-[#ba1a1a]'}`}>
                  {counts.failed}
                </span>
              </button>
            )}

            {counts.cancelled > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('cancelled')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'cancelled'
                    ? 'bg-[#7f756e] text-white shadow-2xs'
                    : 'text-[#7f756e] hover:bg-[#f0eee9]'
                }`}
              >
                <span>Pausadas</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'cancelled' ? 'bg-white/20 text-white' : 'bg-[#e4e2dd] text-[#4e453f]'}`}>
                  {counts.cancelled}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Content List */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-[#7f756e]">
              <RefreshCw className="w-6 h-6 animate-spin text-[#68594d]" />
              <span className="text-xs font-sans-ui font-medium">Consultando IndexedDB e fila de envio...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center gap-3 text-[#7f756e]">
              <div className="w-14 h-14 rounded-2xl bg-[#16a34a]/10 text-[#16a34a] flex items-center justify-center shadow-2xs">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <p className="font-sans-ui text-base font-bold text-[#1b1c19]">
                  Tudo 100% Sincronizado!
                </p>
                <p className="font-sans-ui text-xs text-[#7f756e] max-w-sm mx-auto leading-relaxed">
                  Não há alterações pendentes. Todas as notas, pastas e anexos foram confirmados pelo Supabase e estão salvos com segurança.
                </p>
              </div>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#7f756e] font-sans-ui">
              Nenhum item nesta categoria.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredItems.map((item) => {
                const isAttachment = item.type === 'attachment';
                const hasOpenNoteTarget = Boolean(item.noteId || item.type === 'note');

                return (
                  <div
                    key={item.id}
                    className={`p-3.5 bg-white border rounded-xl shadow-2xs text-xs font-sans-ui transition-all ${
                      item.status === 'cancelled'
                        ? 'border-[#e4e2dd] bg-[#faf8f4] border-dashed opacity-85'
                        : item.status === 'failed'
                        ? 'border-[#fecaca] bg-[#fffbfb]'
                        : 'border-[#e4e2dd] hover:border-[#d5d2cb]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: Icon + Main Info */}
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div
                          className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                            item.status === 'cancelled'
                              ? 'bg-[#f0eee9] text-[#7f756e]'
                              : item.status === 'failed'
                              ? 'bg-[#fee2e2] text-[#ba1a1a]'
                              : isAttachment
                              ? 'bg-[#ede9fe] text-[#7c3aed]'
                              : item.type === 'folder'
                              ? 'bg-[#fef3c7] text-[#b45309]'
                              : 'bg-[#f5f3ee] text-[#68594d]'
                          }`}
                        >
                          {item.type === 'note' ? (
                            <FileText className="w-4 h-4" />
                          ) : item.type === 'folder' ? (
                            <Folder className="w-4 h-4" />
                          ) : isAttachment ? (
                            <Paperclip className="w-4 h-4" />
                          ) : item.type === 'tag' ? (
                            <TagIcon className="w-4 h-4" />
                          ) : (
                            <Clock className="w-4 h-4" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          {/* Title & Hierarchy Path */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-[#1b1c19] truncate leading-tight">
                              {item.title}
                            </span>
                            {item.fileSize ? (
                              <span className="text-[11px] text-[#7f756e] font-normal">
                                ({formatBytes(item.fileSize)})
                              </span>
                            ) : null}
                          </div>

                          {/* Se for anexo e pertencer a uma nota */}
                          {isAttachment && item.noteTitle && (
                            <p className="text-[11px] text-[#4e453f] flex items-center gap-1 font-medium">
                              <span>Na nota:</span>
                              <span className="text-[#1b1c19] font-semibold">{item.noteTitle}</span>
                            </p>
                          )}

                          {/* Caminho Hierárquico das Pastas */}
                          <div className="flex items-center gap-1.5 text-[11px] text-[#7f756e] flex-wrap">
                            <span className="font-medium text-[#68594d] bg-[#f5f3ee] px-2 py-0.5 rounded-md">
                              {item.actionLabel}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1 text-[#4e453f]">
                              <Folder className="w-3 h-3 text-[#7f756e]" />
                              <span>{item.path}</span>
                            </span>
                            <span>•</span>
                            <span>{formatRelativeTimestamp(item.timestamp)}</span>
                          </div>

                          {/* Mensagem de Erro Amigável */}
                          {item.lastError && (
                            <div className="mt-1.5 flex items-start gap-1.5 bg-[#fff5f5] p-2 rounded-lg border border-[#fecaca] text-[11px] text-[#ba1a1a]">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#ba1a1a]" />
                              <span className="leading-snug font-medium">{item.lastError}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Status Badge */}
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        {item.status === 'processing' ? (
                          <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#e0f2fe] text-[#0369a1] flex items-center gap-1 shadow-2xs">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Sincronizando...
                          </span>
                        ) : item.status === 'failed' ? (
                          <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#fceded] text-[#ba1a1a] flex items-center gap-1 shadow-2xs">
                            <AlertCircle className="w-3 h-3" />
                            Falha ({item.attempts}x)
                          </span>
                        ) : item.status === 'cancelled' ? (
                          <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#f0eee9] text-[#7f756e] flex items-center gap-1">
                            <Ban className="w-3 h-3" />
                            Pausado
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#fef3c7] text-[#92400e] flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Aguardando envio
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Bottom Action Buttons per Item */}
                    <div className="mt-3 pt-2.5 border-t border-[#f0eee9] flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        {hasOpenNoteTarget && (
                          <button
                            type="button"
                            onClick={() => handleOpenNote(item)}
                            className="px-2.5 py-1 text-[11px] font-medium text-[#68594d] hover:bg-[#f5f3ee] hover:text-[#1b1c19] rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                            title="Abrir esta nota no editor"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-[#68594d]" />
                            <span>Abrir nota</span>
                          </button>
                        )}

                        {isAttachment && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteAttachmentItem(item)}
                            disabled={actionInProgressId === item.id || isSyncing}
                            className="px-2.5 py-1 text-[11px] font-medium text-[#ba1a1a] hover:bg-[#fee2e2] rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                            title="Excluir este anexo localmente"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Excluir anexo</span>
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {item.status === 'cancelled' ? (
                          <button
                            type="button"
                            onClick={() => handleReactivateSync(item)}
                            disabled={actionInProgressId === item.id || isSyncing}
                            className="px-3 py-1 text-[11px] font-medium bg-[#68594d] hover:bg-[#53463c] text-white rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-2xs disabled:opacity-50"
                          >
                            <RotateCw className={`w-3 h-3 ${actionInProgressId === item.id ? 'animate-spin' : ''}`} />
                            <span>Reativar sincronização</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmCancelItem(item)}
                            disabled={actionInProgressId === item.id || isSyncing}
                            className="px-2.5 py-1 text-[11px] font-medium text-[#7f756e] hover:text-[#ba1a1a] hover:bg-[#fceded] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title="Pausar envio deste item ao Supabase"
                          >
                            Cancelar envio
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal de Confirmação: Pausar/Cancelar Envio */}
        {confirmCancelItem && (
          <div className="px-6 py-4 bg-[#fff8f6] border-t border-[#fecaca] animate-in fade-in flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-[#fee2e2] text-[#ba1a1a] rounded-xl shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <p className="font-sans-ui text-xs font-bold text-[#1b1c19]">
                  Cancelar sincronização de &quot;{confirmCancelItem.title}&quot;?
                </p>
                <p className="font-sans-ui text-[11px] text-[#4e453f] mt-1 leading-relaxed">
                  As alterações locais serão mantidas 100% salvas no seu dispositivo (IndexedDB), mas a sincronização com o Supabase ficará pausada até que você clique em &quot;Reativar&quot;.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-1">
              <button
                type="button"
                onClick={() => setConfirmCancelItem(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#4e453f] hover:bg-[#f0eee9] transition-colors cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelSync}
                disabled={actionInProgressId === confirmCancelItem.id}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#ba1a1a] hover:bg-[#991b1b] text-white transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
              >
                {actionInProgressId === confirmCancelItem.id ? 'Cancelando...' : 'Confirmar Cancelamento'}
              </button>
            </div>
          </div>
        )}

        {/* Modal de Confirmação: Excluir Anexo */}
        {confirmDeleteAttachmentItem && (
          <div className="px-6 py-4 bg-[#fff5f5] border-t border-[#fecaca] animate-in fade-in flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-[#fee2e2] text-[#ba1a1a] rounded-xl shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <p className="font-sans-ui text-xs font-bold text-[#1b1c19]">
                  Excluir anexo &quot;{confirmDeleteAttachmentItem.title}&quot;?
                </p>
                <p className="font-sans-ui text-[11px] text-[#4e453f] mt-1 leading-relaxed">
                  O arquivo e suas referências no texto da nota serão removidos do armazenamento local (IndexedDB) e a operação de upload será cancelada.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteAttachmentItem(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#4e453f] hover:bg-[#f0eee9] transition-colors cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteAttachment}
                disabled={actionInProgressId === confirmDeleteAttachmentItem.id}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-[#ba1a1a] hover:bg-[#991b1b] text-white transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
              >
                {actionInProgressId === confirmDeleteAttachmentItem.id ? 'Excluindo...' : 'Confirmar Exclusão'}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#eae8e3] bg-[#f5f3ee]">
          <div className="flex items-center gap-1.5 text-[11px] text-[#7f756e] font-sans-ui">
            <Sparkles className="w-3.5 h-3.5 text-[#68594d]" />
            <span>Persistência local imediata (IndexedDB) ativa</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium text-[#4e453f] hover:bg-[#eae8e3] transition-colors cursor-pointer"
            >
              Fechar
            </button>
            <button
              type="button"
              id="sync-now-modal-btn"
              onClick={handleSyncNow}
              disabled={isSyncing || counts.pending + counts.failed === 0}
              className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium bg-[#68594d] hover:bg-[#53463c] text-white transition-colors cursor-pointer shadow-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar Agora'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
