'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Clock,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Loader2,
  AlertCircle,
  Plus,
  BookOpen,
  UserCheck,
} from 'lucide-react';
import {
  fetchOutgoingShares,
  fetchIncomingShares,
  revokeDiaryShare,
  DiaryShare,
} from '../api/diary-sharing-api';

interface SettingsSharingTabProps {
  userId: string;
  userEmail: string;
  onOpenInviteModal?: () => void;
  onCloseSettings?: () => void;
}

export function SettingsSharingTab({
  userId,
  userEmail,
  onOpenInviteModal,
  onCloseSettings,
}: SettingsSharingTabProps) {
  const router = useRouter();
  const [outgoingShares, setOutgoingShares] = useState<DiaryShare[]>([]);
  const [incomingShares, setIncomingShares] = useState<DiaryShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [outData, inData] = await Promise.all([
        fetchOutgoingShares(userId),
        fetchIncomingShares(userId),
      ]);
      setOutgoingShares(outData);
      setIncomingShares(inData);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar compartilhamentos.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;

    Promise.all([
      fetchOutgoingShares(userId),
      fetchIncomingShares(userId),
    ])
      .then(([outData, inData]) => {
        if (!isMounted) return;
        setOutgoingShares(outData);
        setIncomingShares(inData);
      })
      .catch((err) => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Falha ao carregar compartilhamentos.';
        setError(msg);
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [userId]);

  const handleRevoke = async (shareId: string) => {
    setActionLoadingId(shareId);
    try {
      const res = await revokeDiaryShare(shareId);
      if (!res.success) {
        setError(res.error || 'Falha ao remover acesso.');
      } else {
        setConfirmRevokeId(null);
        await loadAll();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao revogar acesso.';
      setError(msg);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleOpenSharedDiary = (shareId: string) => {
    if (onCloseSettings) onCloseSettings();
    router.push(`/shared-diary/${shareId}`);
  };

  if (loading) {
    return (
      <div className="py-12 text-center space-y-2">
        <Loader2 className="w-6 h-6 text-[#68594d] animate-spin mx-auto" />
        <p className="font-sans-ui text-xs text-[#7f756e]">
          Carregando informações de compartilhamento...
        </p>
      </div>
    );
  }

  const activeOutgoing = outgoingShares.filter((s) => s.status !== 'revoked');
  const acceptedIncoming = incomingShares.filter((s) => s.status === 'accepted');

  return (
    <div id="settings-sharing-tab" className="space-y-6 text-left">
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-sans-ui flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* SEÇÃO 1: Pessoas com Acesso ao Meu Diário */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-[#1b1c19] uppercase tracking-wider font-sans-ui">
              Pessoas com acesso ao seu Diário
            </h3>
            <p className="text-[11px] text-[#7f756e] font-sans-ui">
              Usuários convidados possuem acesso em tempo real e somente leitura.
            </p>
          </div>

          {onOpenInviteModal && (
            <button
              type="button"
              id="settings-invite-btn"
              onClick={onOpenInviteModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#68594d] text-white rounded-xl text-xs font-sans-ui font-medium hover:bg-[#53463c] transition-colors cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Convidar</span>
            </button>
          )}
        </div>

        {activeOutgoing.length === 0 ? (
          <div className="p-4 bg-[#fbfaf8] border border-[#eae8e3] rounded-2xl text-center">
            <p className="text-xs text-[#7f756e] font-sans-ui italic">
              Você ainda não compartilhou seu Diário com ninguém.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeOutgoing.map((share) => {
              const isAccepted = share.status === 'accepted';
              const isPending = share.status === 'pending';

              return (
                <div
                  key={share.id}
                  className="p-3.5 bg-[#fbfaf8] border border-[#eae8e3] rounded-2xl flex items-center justify-between gap-3 shadow-2xs font-sans-ui text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[#1b1c19] truncate">
                      {share.viewer_name || share.viewer_email}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-[#7f756e] mt-0.5">
                      {isAccepted && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          Ativo (Leitura)
                        </span>
                      )}
                      {isPending && (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                          <Clock className="w-3 h-3 text-amber-600" />
                          Convite pendente
                        </span>
                      )}
                      <span>•</span>
                      <span>
                        {new Date(share.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  </div>

                  {confirmRevokeId === share.id ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] text-red-600 font-medium">Confirmar?</span>
                      <button
                        type="button"
                        onClick={() => handleRevoke(share.id)}
                        disabled={actionLoadingId === share.id}
                        className="px-2.5 py-1 bg-red-600 text-white rounded-lg text-[11px] hover:bg-red-700 font-medium cursor-pointer"
                      >
                        Sim
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeId(null)}
                        className="px-2.5 py-1 bg-[#eae8e3] text-[#1b1c19] rounded-lg text-[11px] hover:bg-[#d8d1c7] cursor-pointer"
                      >
                        Não
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRevokeId(share.id)}
                      className="px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-xl border border-transparent hover:border-red-200 transition-colors font-medium cursor-pointer flex items-center gap-1.5"
                      title="Remover acesso"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remover acesso</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Divisor */}
      <div className="border-t border-[#eae8e3]" />

      {/* SEÇÃO 2: Diários que você tem acesso para visualizar */}
      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-[#1b1c19] uppercase tracking-wider font-sans-ui flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-[#68594d]" />
            <span>Diários que você tem acesso</span>
          </h3>
          <p className="text-[11px] text-[#7f756e] font-sans-ui">
            Diários de outros usuários compartilhados com você em modo de leitura.
          </p>
        </div>

        {acceptedIncoming.length === 0 ? (
          <div className="p-4 bg-[#fbfaf8] border border-[#eae8e3] rounded-2xl text-center">
            <p className="text-xs text-[#7f756e] font-sans-ui italic">
              Nenhum Diário compartilhado com você no momento.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {acceptedIncoming.map((share) => {
              const ownerDisplay =
                share.owner_name || share.owner_email || 'Usuário';

              return (
                <div
                  key={share.id}
                  className="p-3.5 bg-[#fbfaf8] border border-[#eae8e3] rounded-2xl flex items-center justify-between gap-3 shadow-2xs font-sans-ui text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[#1b1c19] truncate">
                      Diário de {ownerDisplay}
                    </p>
                    <p className="text-[11px] text-[#7f756e] mt-0.5">
                      Recebido em {new Date(share.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenSharedDiary(share.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#68594d] text-white rounded-xl text-xs font-medium hover:bg-[#53463c] transition-colors cursor-pointer shadow-xs"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Abrir Diário</span>
                    </button>

                    {confirmRevokeId === share.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-red-600 font-medium">Sair?</span>
                        <button
                          type="button"
                          onClick={() => handleRevoke(share.id)}
                          disabled={actionLoadingId === share.id}
                          className="px-2 py-1 bg-red-600 text-white rounded-lg text-[10px] font-medium"
                        >
                          Sim
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeId(null)}
                          className="px-2 py-1 bg-[#eae8e3] text-[#1b1c19] rounded-lg text-[10px]"
                        >
                          Não
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeId(share.id)}
                        className="p-1.5 text-[#7f756e] hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
                        title="Deixar de seguir este Diário"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
