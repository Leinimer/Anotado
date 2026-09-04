'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  Mail,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Trash2,
  ShieldCheck,
} from 'lucide-react';
import {
  createDiaryShare,
  fetchOutgoingShares,
  revokeDiaryShare,
  DiaryShare,
} from '../api/diary-sharing-api';

interface ShareDiaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userEmail: string;
  onShareUpdated?: () => void;
}

export function ShareDiaryModal({
  isOpen,
  onClose,
  userId,
  userEmail,
  onShareUpdated,
}: ShareDiaryModalProps) {
  const [targetEmail, setTargetEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [shares, setShares] = useState<DiaryShare[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setTargetEmail('');
      setSuccessMessage(null);
      setErrorMessage(null);
      setConfirmRevokeId(null);
    }
  }

  const loadShares = async () => {
    if (!userId) return;
    setLoadingShares(true);
    try {
      const data = await fetchOutgoingShares(userId);
      setShares(data);
    } catch (err) {
      console.error('[ShareDiaryModal] Erro ao carregar compartilhamentos:', err);
    } finally {
      setLoadingShares(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !userId) return;
    let isMounted = true;

    fetchOutgoingShares(userId)
      .then((data) => {
        if (isMounted) setShares(data);
      })
      .catch((err) => {
        console.error('[ShareDiaryModal] Erro ao carregar compartilhamentos:', err);
      })
      .finally(() => {
        if (isMounted) setLoadingShares(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, userId]);

  // Tecla ESC para fechar
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null);

    const clean = targetEmail.trim().toLowerCase();
    if (!clean) {
      setErrorMessage('Por favor, informe o e-mail da pessoa.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await createDiaryShare(userId, userEmail, clean);
      if (!result.success) {
        setErrorMessage(result.error || 'Não foi possível compartilhar o Diário.');
      } else {
        setSuccessMessage(`Convite enviado com sucesso para ${clean}!`);
        setTargetEmail('');
        await loadShares();
        if (onShareUpdated) onShareUpdated();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao compartilhar o Diário.';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    setRevokingId(shareId);
    setErrorMessage(null);
    try {
      const result = await revokeDiaryShare(shareId);
      if (!result.success) {
        setErrorMessage(result.error || 'Falha ao remover acesso.');
      } else {
        setConfirmRevokeId(null);
        await loadShares();
        if (onShareUpdated) onShareUpdated();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao remover acesso.';
      setErrorMessage(msg);
    } finally {
      setRevokingId(null);
    }
  };

  const activeShares = shares.filter((s) => s.status === 'accepted');
  const pendingShares = shares.filter((s) => s.status === 'pending');

  return (
    <div
      id="share-diary-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="share-diary-modal-card"
        className="w-full max-w-lg bg-[#fbfaf8] border border-[#e4e2dd] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0eee9] bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#f4dfcb] text-[#68594d] flex items-center justify-center shadow-2xs">
              <Users className="w-5 h-5 stroke-[2]" />
            </div>
            <div>
              <h2 className="font-serif-note font-bold text-base text-[#1b1c19]">
                Compartilhar Diário
              </h2>
              <p className="font-sans-ui text-xs text-[#7f756e]">
                Acesso de leitura para usuários cadastrados
              </p>
            </div>
          </div>

          <button
            type="button"
            id="share-diary-close-btn"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#7f756e] hover:text-[#1b1c19] hover:bg-[#f0eee9] transition-colors cursor-pointer"
            aria-label="Fechar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo com Scroll */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-left">
          {/* Mensagens de Sucesso ou Erro */}
          {successMessage && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-sans-ui flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-sans-ui flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Formulário: Digite o e-mail da pessoa */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label
                htmlFor="share-target-email-input"
                className="block text-xs font-semibold text-[#1b1c19] uppercase tracking-wider mb-1.5 font-sans-ui"
              >
                Digite o e-mail da pessoa
              </label>
              <div className="relative">
                <input
                  id="share-target-email-input"
                  type="email"
                  value={targetEmail}
                  onChange={(e) => setTargetEmail(e.target.value)}
                  placeholder="exemplo@email.com"
                  disabled={isLoading}
                  className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#d8d1c7] rounded-xl text-xs font-sans-ui text-[#1b1c19] placeholder-[#a1968e] focus:outline-none focus:border-[#68594d] focus:ring-1 focus:ring-[#68594d]/20 transition-all shadow-2xs"
                  required
                />
                <Mail className="w-4 h-4 text-[#7f756e] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <p className="mt-1 text-[11px] text-[#7f756e] font-sans-ui">
                A pessoa convidada terá acesso em tempo real e somente de leitura a todo o Diário.
              </p>
            </div>

            <div className="flex justify-end pt-1">
              <button
                id="share-diary-submit-btn"
                type="submit"
                disabled={isLoading || !targetEmail.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#68594d] text-white rounded-xl text-xs font-sans-ui font-medium hover:bg-[#53463c] disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Verificando...</span>
                  </>
                ) : (
                  <>
                    <Users className="w-3.5 h-3.5" />
                    <span>Compartilhar</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Divisor */}
          <div className="border-t border-[#eae8e3]" />

          {/* Pessoas com Acesso */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-[#1b1c19] uppercase tracking-wider font-sans-ui flex items-center justify-between">
              <span>Pessoas com acesso</span>
              <span className="text-[10px] text-[#7f756e] font-normal lowercase">
                {activeShares.length} ativa{activeShares.length === 1 ? '' : 's'}
              </span>
            </h3>

            {loadingShares ? (
              <div className="py-4 text-center">
                <Loader2 className="w-5 h-5 text-[#68594d] animate-spin mx-auto" />
              </div>
            ) : activeShares.length === 0 ? (
              <p className="text-xs text-[#7f756e] italic font-sans-ui">
                Nenhuma pessoa com acesso ativo no momento.
              </p>
            ) : (
              <div className="space-y-2">
                {activeShares.map((share) => (
                  <div
                    key={share.id}
                    className="p-3 bg-white border border-[#eae8e3] rounded-xl flex items-center justify-between gap-3 shadow-2xs font-sans-ui text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[#1b1c19] truncate">
                        {share.viewer_name || share.viewer_email}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-[#7f756e]">
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Ativo
                        </span>
                        <span>•</span>
                        <span>Visualização</span>
                      </div>
                    </div>

                    {confirmRevokeId === share.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] text-red-600 font-medium">Remover acesso?</span>
                        <button
                          type="button"
                          onClick={() => handleRevoke(share.id)}
                          disabled={revokingId === share.id}
                          className="px-2 py-1 bg-red-600 text-white rounded-lg text-[11px] hover:bg-red-700 font-medium cursor-pointer"
                        >
                          Sim
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeId(null)}
                          className="px-2 py-1 bg-[#eae8e3] text-[#1b1c19] rounded-lg text-[11px] hover:bg-[#d8d1c7] cursor-pointer"
                        >
                          Não
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeId(share.id)}
                        className="p-1.5 text-[#7f756e] hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Remover acesso"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Convites Pendentes */}
          {pendingShares.length > 0 && (
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-semibold text-[#1b1c19] uppercase tracking-wider font-sans-ui flex items-center gap-1.5 text-amber-800">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                <span>Convites pendentes</span>
              </h3>

              <div className="space-y-2">
                {pendingShares.map((share) => (
                  <div
                    key={share.id}
                    className="p-3 bg-amber-50/50 border border-amber-200/80 rounded-xl flex items-center justify-between gap-3 shadow-2xs font-sans-ui text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[#1b1c19] truncate">
                        {share.viewer_email}
                      </p>
                      <p className="text-[11px] text-amber-700">
                        Aguardando aceitação do convidado
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRevoke(share.id)}
                      disabled={revokingId === share.id}
                      className="px-2.5 py-1 text-[11px] text-red-600 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-200 transition-colors font-medium cursor-pointer"
                    >
                      Cancelar convite
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
