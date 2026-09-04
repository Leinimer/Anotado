'use client';

import React, { useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  XCircle,
  Loader2,
  Users,
} from 'lucide-react';
import {
  acceptDiaryInvitation,
  rejectDiaryInvitation,
  DiaryShare,
} from '../api/diary-sharing-api';

interface PendingInvitationModalProps {
  invitation: DiaryShare | null;
  onAccepted: (shareId: string) => void;
  onRejected: (shareId: string) => void;
}

export function PendingInvitationModal({
  invitation,
  onAccepted,
  onRejected,
}: PendingInvitationModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!invitation) return null;

  const ownerDisplay =
    invitation.owner_name || invitation.owner_email || 'um usuário';

  const handleAccept = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await acceptDiaryInvitation(invitation.id);
      if (!result.success) {
        setError(result.error || 'Falha ao aceitar o convite.');
        setIsProcessing(false);
      } else {
        onAccepted(invitation.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro inesperado.';
      setError(msg);
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await rejectDiaryInvitation(invitation.id);
      if (!result.success) {
        setError(result.error || 'Falha ao rejeitar o convite.');
        setIsProcessing(false);
      } else {
        onRejected(invitation.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro inesperado.';
      setError(msg);
      setIsProcessing(false);
    }
  };

  return (
    <div
      id="pending-invitation-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        id="pending-invitation-card"
        className="w-full max-w-md bg-[#fbfaf8] border border-[#e4e2dd] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
      >
        <div className="p-6 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-[#f4dfcb] text-[#68594d] mx-auto flex items-center justify-center shadow-xs">
            <Users className="w-7 h-7 stroke-[2]" />
          </div>

          <div className="space-y-1.5">
            <h3 className="font-serif-note font-bold text-lg text-[#1b1c19]">
              Convite de Compartilhamento
            </h3>
            <p className="font-sans-ui text-xs text-[#5e4b3e] leading-relaxed px-2">
              Você recebeu um convite para visualizar o Diário de{' '}
              <strong className="text-[#1b1c19]">{ownerDisplay}</strong> em modo somente leitura.
            </p>
          </div>

          <div className="bg-[#f0eee9]/60 rounded-xl p-3 text-[11px] text-[#7f756e] font-sans-ui space-y-1 text-left border border-[#eae8e3]">
            <div className="flex items-center gap-1.5 font-medium text-[#1b1c19]">
              <BookOpen className="w-3.5 h-3.5 text-[#68594d]" />
              <span>Acesso Somente Leitura:</span>
            </div>
            <p>
              Você poderá navegar por todos os anos, meses e entradas existentes, visualizar anexos e tags, e acompanhar atualizações em tempo real sem alterar os dados originais.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-sans-ui">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              id="pending-invitation-reject-btn"
              type="button"
              onClick={handleReject}
              disabled={isProcessing}
              className="flex-1 py-2.5 px-4 rounded-xl border border-[#d8d1c7] text-[#7f756e] hover:text-red-700 hover:bg-red-50 hover:border-red-200 text-xs font-sans-ui font-semibold transition-all cursor-pointer disabled:opacity-50"
            >
              REJEITAR
            </button>

            <button
              id="pending-invitation-accept-btn"
              type="button"
              onClick={handleAccept}
              disabled={isProcessing}
              className="flex-1 py-2.5 px-4 rounded-xl bg-[#68594d] hover:bg-[#53463c] text-white text-xs font-sans-ui font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>ACEITAR</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
