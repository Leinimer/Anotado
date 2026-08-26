'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { indexedDBStorage, SyncQueueItem, ExtendedNote, ExtendedFolder, LocalAttachment } from '../db/indexed-db';
import { syncEngine, formatFriendlyErrorMessage } from '../api/sync-engine';
import { networkMonitor } from '../api/network-monitor';

interface SyncPendingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string;
}

export interface PendingDisplayItem {
  id: string; // queue item id or entity prefixed id
  queueItemId?: string;
  entityId: string;
  type: 'note' | 'folder' | 'attachment' | 'tag' | 'queue';
  actionLabel: string;
  title: string;
  timestamp: string;
  status: 'pending' | 'processing' | 'failed' | 'synced' | 'cancelled';
  attempts: number;
  lastError?: string | null;
}

async function resolveEntityName(
  userId: string,
  type: 'note' | 'folder' | 'attachment' | 'tag' | 'queue',
  entityId: string,
  payload?: any
): Promise<string> {
  if (payload?.title) return payload.title;
  if (payload?.name) return payload.name;
  if (payload?.fileName || payload?.file_name) return payload.fileName || payload.file_name;
  if (payload?.updates?.name) return payload.updates.name;

  try {
    if (type === 'note') {
      const note = await indexedDBStorage.getNoteById(userId, entityId);
      if (note?.title) return note.title;
    } else if (type === 'folder') {
      const folder = await indexedDBStorage.getFolderById(userId, entityId);
      if (folder?.name) return folder.name;
    } else if (type === 'attachment') {
      const att = await indexedDBStorage.getAttachment(userId, entityId);
      if (att?.file_name) return att.file_name;
    }
  } catch {
    // Silently continue to fallback
  }

  if (type === 'note') return 'Nota sem título';
  if (type === 'folder') return 'Pasta';
  if (type === 'attachment') return 'Arquivo anexo';
  if (type === 'tag') return 'Tags';
  return 'Item';
}

function getActionLabel(action?: string, payload?: any, type?: string): string {
  if (!action) {
    if (type === 'note') return 'Nota pendente';
    if (type === 'folder') return 'Pasta pendente';
    if (type === 'attachment') return 'Upload de anexo pendente';
    return 'Alteração pendente';
  }

  switch (action) {
    case 'CREATE_NOTE':
      return 'Nota criada';
    case 'UPDATE_NOTE_CONTENT':
      return 'Conteúdo alterado';
    case 'UPDATE_NOTE':
      return 'Propriedades alteradas';
    case 'DELETE_NOTE':
      return 'Nota excluída';
    case 'MOVE_NOTE':
      return 'Nota movida';
    case 'ARCHIVE_NOTE':
      return 'Nota arquivada';
    case 'UNARCHIVE_NOTE':
      return 'Nota desarquivada';
    case 'CREATE_FOLDER':
      return 'Pasta criada';
    case 'UPDATE_FOLDER':
      return 'Pasta renomeada';
    case 'DELETE_FOLDER':
      return 'Pasta excluída';
    case 'MOVE_FOLDER':
      return 'Pasta movida';
    case 'UPLOAD_ATTACHMENT': {
      const ft = payload?.fileType || payload?.file_type || '';
      if (ft.includes('pdf')) return 'Upload do PDF';
      if (ft.includes('image')) return 'Upload de imagem';
      return 'Upload do anexo';
    }
    case 'DELETE_ATTACHMENT':
      return 'Exclusão do anexo';
    case 'UPDATE_TAGS':
      return 'Tags atualizadas';
    default:
      return 'Alteração local';
  }
}

async function fetchPendingItemsList(userId: string): Promise<PendingDisplayItem[]> {
  const displayList: PendingDisplayItem[] = [];
  const processedEntityIds = new Set<string>();

  // 1. Fila de Sincronização (Sync Queue)
  const queue = await indexedDBStorage.getPendingSyncQueue(userId);
  for (const item of queue) {
    const itemTitle = await resolveEntityName(userId, item.entity_type, item.entity_id, item.payload);
    const actionLabel = getActionLabel(item.action, item.payload, item.entity_type);

    processedEntityIds.add(item.entity_id);

    displayList.push({
      id: item.id,
      queueItemId: item.id,
      entityId: item.entity_id,
      type: item.entity_type,
      actionLabel,
      title: itemTitle,
      timestamp: item.created_at,
      status: item.status === 'processing' ? 'processing' : item.status === 'failed' ? 'failed' : 'pending',
      attempts: item.attempts || 0,
      lastError: item.last_error ? formatFriendlyErrorMessage(item.last_error) : null,
    });
  }

  // 2. Entidades que precisam de sincronização direta no IndexedDB
  const entities = await indexedDBStorage.getEntitiesRequiringSync(userId);
  for (const note of entities.notes) {
    if (!processedEntityIds.has(note.id)) {
      processedEntityIds.add(note.id);
      displayList.push({
        id: `note_${note.id}`,
        entityId: note.id,
        type: 'note',
        actionLabel: 'Nota não enviada',
        title: note.title || 'Nota sem título',
        timestamp: note.updated_at || note.created_at,
        status: (note.syncStatus as any) === 'error' ? 'failed' : 'pending',
        attempts: 0,
      });
    }
  }

  for (const folder of entities.folders) {
    if (!processedEntityIds.has(folder.id)) {
      processedEntityIds.add(folder.id);
      displayList.push({
        id: `folder_${folder.id}`,
        entityId: folder.id,
        type: 'folder',
        actionLabel: 'Pasta não enviada',
        title: folder.name || 'Pasta',
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
      const label = isPdf ? 'Upload do PDF pendente' : isImg ? 'Upload de imagem pendente' : 'Upload de anexo pendente';
      displayList.push({
        id: `att_${att.id}`,
        entityId: att.id,
        type: 'attachment',
        actionLabel: label,
        title: att.file_name || 'Arquivo anexo',
        timestamp: att.updated_at || att.created_at,
        status: (att.syncStatus as any) === 'error' ? 'failed' : 'pending',
        attempts: 0,
      });
    }
  }

  // 3. Entidades canceladas pelo usuário
  const cancelled = await indexedDBStorage.getCancelledEntities(userId);
  for (const note of cancelled.notes) {
    if (!processedEntityIds.has(note.id)) {
      processedEntityIds.add(note.id);
      displayList.push({
        id: `cancelled_note_${note.id}`,
        entityId: note.id,
        type: 'note',
        actionLabel: 'Sincronização pausada',
        title: note.title || 'Nota sem título',
        timestamp: note.updated_at || note.created_at,
        status: 'cancelled',
        attempts: 0,
      });
    }
  }

  for (const folder of cancelled.folders) {
    if (!processedEntityIds.has(folder.id)) {
      processedEntityIds.add(folder.id);
      displayList.push({
        id: `cancelled_folder_${folder.id}`,
        entityId: folder.id,
        type: 'folder',
        actionLabel: 'Sincronização pausada',
        title: folder.name || 'Pasta',
        timestamp: folder.updated_at || folder.created_at,
        status: 'cancelled',
        attempts: 0,
      });
    }
  }

  for (const att of cancelled.attachments) {
    if (!processedEntityIds.has(att.id)) {
      processedEntityIds.add(att.id);
      displayList.push({
        id: `cancelled_att_${att.id}`,
        entityId: att.id,
        type: 'attachment',
        actionLabel: 'Sincronização pausada',
        title: att.file_name || 'Arquivo anexo',
        timestamp: att.updated_at || att.created_at,
        status: 'cancelled',
        attempts: 0,
      });
    }
  }

  return displayList;
}

export function SyncPendingModal({ isOpen, onClose, userId = 'anonymous' }: SyncPendingModalProps) {
  const [items, setItems] = useState<PendingDisplayItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [confirmCancelItem, setConfirmCancelItem] = useState<PendingDisplayItem | null>(null);
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    if (!userId) return;
    try {
      const result = await fetchPendingItemsList(userId);
      setItems(result);
    } catch (err) {
      console.warn('[SyncPendingModal] Falha ao carregar pendências:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    fetchPendingItemsList(userId)
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
        fetchPendingItemsList(userId).then((res) => {
          if (isMounted) setItems(res);
        });
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [isOpen, userId]);

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

  if (!isOpen) return null;

  const activePendingItems = items.filter((i) => i.status !== 'cancelled');
  const cancelledItems = items.filter((i) => i.status === 'cancelled');

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#eae8e3] bg-[#f5f3ee]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#68594d]/10 text-[#68594d] flex items-center justify-center">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif-note font-bold text-base text-[#1b1c19] leading-tight">
                Pendências de Sincronização
              </h2>
              <p className="font-sans-ui text-xs text-[#7f756e]">
                {activePendingItems.length === 0
                  ? 'Nenhuma alteração aguardando envio'
                  : `${activePendingItems.length} item(ns) aguardando envio ao Supabase`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#eae8e3] rounded-xl transition-colors cursor-pointer"
            aria-label="Fechar"
            id="close-sync-modal-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content List */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-[#7f756e]">
              <RefreshCw className="w-5 h-5 animate-spin text-[#68594d]" />
              <span className="text-xs font-sans-ui">Verificando dados locais no IndexedDB...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center gap-3 text-[#7f756e]">
              <div className="w-12 h-12 rounded-full bg-[#16a34a]/10 text-[#16a34a] flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <p className="font-sans-ui text-sm font-semibold text-[#1b1c19]">
                  Tudo 100% Sincronizado!
                </p>
                <p className="font-sans-ui text-xs text-[#7f756e] max-w-xs mt-1">
                  Todas as suas notas, pastas e anexos estão salvos e sincronizados com segurança.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Lista de Itens Ativos Pendentes */}
              {activePendingItems.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold text-[#7f756e] uppercase tracking-wider block">
                    Fila Ativa de Envio ({activePendingItems.length})
                  </span>
                  {activePendingItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 p-3 bg-white border border-[#e4e2dd] rounded-xl shadow-2xs text-xs font-sans-ui hover:border-[#d5d2cb] transition-all"
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <div className="p-1.5 rounded-lg bg-[#f5f3ee] text-[#68594d] shrink-0 mt-0.5">
                          {item.type === 'note' ? (
                            <FileText className="w-3.5 h-3.5" />
                          ) : item.type === 'folder' ? (
                            <Folder className="w-3.5 h-3.5" />
                          ) : item.type === 'attachment' ? (
                            <Paperclip className="w-3.5 h-3.5" />
                          ) : item.type === 'tag' ? (
                            <TagIcon className="w-3.5 h-3.5" />
                          ) : (
                            <Clock className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[#1b1c19] truncate leading-snug">
                            {item.title}
                          </p>
                          <p className="text-[11px] text-[#7f756e] mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-[#68594d]">{item.actionLabel}</span>
                            <span>•</span>
                            <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </p>
                          {item.lastError && (
                            <p className="text-[11px] text-[#ba1a1a] mt-1.5 flex items-center gap-1 bg-[#fff5f5] p-1.5 rounded-lg border border-[#fecaca]">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[#ba1a1a]" />
                              <span className="leading-tight">{item.lastError}</span>
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {item.status === 'processing' ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-[#e0f2fe] text-[#0369a1] flex items-center gap-1">
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                            Enviando
                          </span>
                        ) : item.status === 'failed' ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-[#fceded] text-[#ba1a1a] flex items-center gap-1">
                            <AlertCircle className="w-2.5 h-2.5" />
                            Falha ({item.attempts}x)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-[#fef3c7] text-[#92400e]">
                            Pendente
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => setConfirmCancelItem(item)}
                          disabled={actionInProgressId === item.id || isSyncing}
                          className="px-2 py-1 text-[11px] font-medium text-[#7f756e] hover:text-[#ba1a1a] hover:bg-[#fceded] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          title="Pausar/cancelar sincronização deste item"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Lista de Itens Cancelados / Pausados */}
              {cancelledItems.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-[#eae8e3]">
                  <span className="text-[11px] font-semibold text-[#7f756e] uppercase tracking-wider block">
                    Sincronização Pausada Localmente ({cancelledItems.length})
                  </span>
                  {cancelledItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 p-3 bg-[#fbf9f4] border border-[#e4e2dd] border-dashed rounded-xl text-xs font-sans-ui opacity-90"
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <div className="p-1.5 rounded-lg bg-[#f0eee9] text-[#7f756e] shrink-0 mt-0.5">
                          <Ban className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-[#4e453f] truncate leading-snug">
                            {item.title}
                          </p>
                          <p className="text-[11px] text-[#7f756e] mt-0.5">
                            Salvo localmente • Não está sendo enviado ao Supabase
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleReactivateSync(item)}
                          disabled={actionInProgressId === item.id || isSyncing}
                          className="px-2.5 py-1 text-[11px] font-medium bg-[#68594d]/10 hover:bg-[#68594d]/20 text-[#68594d] rounded-lg transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50"
                        >
                          <RotateCw className={`w-3 h-3 ${actionInProgressId === item.id ? 'animate-spin' : ''}`} />
                          <span>Reativar</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal de Confirmação de Cancelamento */}
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
                  Suas alterações locais serão mantidas intactas neste dispositivo no IndexedDB, mas não serão enviadas ao Supabase até que você reative a sincronização.
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
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#ba1a1a] hover:bg-[#991b1b] text-white transition-colors cursor-pointer shadow-2xs"
              >
                {actionInProgressId === confirmCancelItem.id ? 'Cancelando...' : 'Confirmar Cancelamento'}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#eae8e3] bg-[#f5f3ee]">
          <span className="text-[11px] text-[#7f756e] font-sans-ui">
            Arquitetura Offline-First ativa
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-sans-ui font-medium text-[#4e453f] hover:bg-[#eae8e3] transition-colors cursor-pointer"
            >
              Fechar
            </button>
            <button
              type="button"
              id="sync-now-modal-btn"
              onClick={handleSyncNow}
              disabled={isSyncing}
              className="px-4 py-2 rounded-xl text-xs font-sans-ui font-medium bg-[#68594d] hover:bg-[#53463c] text-white transition-colors cursor-pointer shadow-xs flex items-center gap-1.5 disabled:opacity-60"
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
