'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Cloud,
  RefreshCw,
  X,
  FileText,
  Folder,
  Paperclip,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Tag as TagIcon,
} from 'lucide-react';
import { indexedDBStorage, SyncQueueItem } from '../db/indexed-db';
import { syncEngine } from '../api/sync-engine';
import { networkMonitor } from '../api/network-monitor';

interface SyncPendingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string;
}

interface PendingDisplayItem {
  id: string;
  type: 'note' | 'folder' | 'attachment' | 'tag' | 'queue';
  actionLabel: string;
  title: string;
  timestamp: string;
  status: 'pending' | 'processing' | 'failed' | 'synced';
  attempts: number;
  lastError?: string | null;
}

async function fetchPendingItemsList(userId: string): Promise<PendingDisplayItem[]> {
  const displayList: PendingDisplayItem[] = [];

  // 1. Fila de Sincronização (Sync Queue)
  const queue = await indexedDBStorage.getPendingSyncQueue(userId);
  for (const item of queue) {
    let actionLabel = 'Alteração pendente';
    let itemTitle = item.entity_id;

    switch (item.action) {
      case 'CREATE_NOTE':
        actionLabel = 'Nova Nota';
        itemTitle = item.payload?.title || 'Nota sem título';
        break;
      case 'UPDATE_NOTE':
      case 'UPDATE_NOTE_CONTENT':
        actionLabel = 'Edição de Nota';
        itemTitle = item.payload?.title || 'Nota';
        break;
      case 'DELETE_NOTE':
        actionLabel = 'Exclusão de Nota';
        break;
      case 'MOVE_NOTE':
        actionLabel = 'Movimentação de Nota';
        break;
      case 'CREATE_FOLDER':
        actionLabel = 'Nova Pasta';
        itemTitle = item.payload?.name || 'Pasta';
        break;
      case 'UPDATE_FOLDER':
        actionLabel = 'Edição de Pasta';
        itemTitle = item.payload?.name || 'Pasta';
        break;
      case 'DELETE_FOLDER':
        actionLabel = 'Exclusão de Pasta';
        break;
      case 'UPLOAD_ATTACHMENT':
        actionLabel = 'Upload de Mídia / Anexo';
        itemTitle = item.payload?.file_name || 'Arquivo';
        break;
      case 'DELETE_ATTACHMENT':
        actionLabel = 'Exclusão de Anexo';
        break;
    }

    displayList.push({
      id: item.id,
      type: item.entity_type,
      actionLabel,
      title: itemTitle,
      timestamp: item.created_at,
      status: item.status,
      attempts: item.attempts || 0,
      lastError: item.last_error,
    });
  }

  // 2. Entidades que precisam de sincronização direta
  const entities = await indexedDBStorage.getEntitiesRequiringSync(userId);
  for (const note of entities.notes) {
    if (!displayList.some((d) => d.id.includes(note.id))) {
      displayList.push({
        id: `note_${note.id}`,
        type: 'note',
        actionLabel: 'Nota não sincronizada',
        title: note.title || 'Nota sem título',
        timestamp: note.updated_at || note.created_at,
        status: (note.syncStatus as any) || 'pending',
        attempts: 0,
      });
    }
  }

  for (const folder of entities.folders) {
    if (!displayList.some((d) => d.id.includes(folder.id))) {
      displayList.push({
        id: `folder_${folder.id}`,
        type: 'folder',
        actionLabel: 'Pasta não sincronizada',
        title: folder.name || 'Pasta',
        timestamp: folder.updated_at || folder.created_at,
        status: (folder.syncStatus as any) || 'pending',
        attempts: 0,
      });
    }
  }

  for (const att of entities.attachments) {
    if (!displayList.some((d) => d.id.includes(att.id))) {
      displayList.push({
        id: `att_${att.id}`,
        type: 'attachment',
        actionLabel: 'Anexo / Mídia pendente',
        title: att.file_name || 'Arquivo',
        timestamp: att.updated_at || att.created_at,
        status: (att.syncStatus as any) || 'pending',
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#fbf9f4] border border-[#e4e2dd] rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95"
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
                {items.length === 0
                  ? 'Nenhuma alteração aguardando envio'
                  : `${items.length} item(ns) aguardando envio ao Supabase`}
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
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-[#7f756e]">
              <RefreshCw className="w-5 h-5 animate-spin text-[#68594d]" />
              <span className="text-xs font-sans-ui">Verificando banco de dados local...</span>
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
                  Todas as suas notas, pastas e anexos estão persistidos com segurança no IndexedDB e no Supabase.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 p-3 bg-white border border-[#e4e2dd] rounded-xl shadow-2xs text-xs font-sans-ui"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
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
                    <div className="min-w-0">
                      <p className="font-semibold text-[#1b1c19] truncate leading-snug">
                        {item.title}
                      </p>
                      <p className="text-[11px] text-[#7f756e] mt-0.5">
                        {item.actionLabel} • {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {item.lastError && (
                        <p className="text-[10px] text-[#ba1a1a] mt-1 line-clamp-1">
                          {item.lastError}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-1.5">
                    {item.status === 'processing' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#e0f2fe] text-[#0369a1] flex items-center gap-1">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                        Enviando
                      </span>
                    ) : item.status === 'failed' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#fceded] text-[#ba1a1a] flex items-center gap-1">
                        <AlertCircle className="w-2.5 h-2.5" />
                        Tentativa {item.attempts}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#fef3c7] text-[#92400e]">
                        Pendente
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
