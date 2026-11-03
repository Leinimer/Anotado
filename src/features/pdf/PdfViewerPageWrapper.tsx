'use client';

import React, { useEffect, useState } from 'react';
import { PdfEditor } from './PdfEditor';
import { createClient } from '@/src/features/auth/api/supabase-client';
import { Loader2 } from 'lucide-react';

interface PdfViewerPageWrapperProps {
  attachmentId: string;
  sourceUrl?: string;
  onClose?: () => void;
}

export function PdfViewerPageWrapper({ attachmentId, sourceUrl, onClose }: PdfViewerPageWrapperProps) {
  const [userId, setUserId] = useState<string | null>(null);
  const [isReadOnly, setIsReadOnly] = useState<boolean>(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);

  useEffect(() => {
    async function determineUserAndPermissions() {
      try {
        const supabase = createClient();
        const { data: sessionData } = await supabase.auth.getSession();
        let currentUid = sessionData?.session?.user?.id;

        if (!currentUid) {
          const { data: userData } = await supabase.auth.getUser();
          currentUid = userData?.user?.id;
        }

        if (!currentUid && typeof window !== 'undefined') {
          const cachedUid = localStorage.getItem('anotado_last_auth_user_id');
          if (cachedUid && cachedUid !== 'anonymous') {
            currentUid = cachedUid;
          }
        }

        const effectiveUid = currentUid || 'anonymous';
        setUserId(effectiveUid);

        // Se for anônimo ou se o anexo pertencer a um diário compartilhado somente leitura
        if (effectiveUid === 'anonymous') {
          setIsReadOnly(true);
        } else {
          // Verifica se o anexo pertence a outro usuário
          const { data: attData } = await supabase
            .from('note_attachments')
            .select('user_id, note_id')
            .eq('id', attachmentId)
            .maybeSingle();

          if (attData && attData.user_id !== effectiveUid) {
            // Anexo pertence a outro usuário (ex: Diário compartilhado) -> estritamente somente leitura
            setIsReadOnly(true);
          }
        }
      } catch (err) {
        console.warn('[PdfViewerPage] Falha ao verificar autenticação:', err);
        setUserId('anonymous');
        setIsReadOnly(true);
      } finally {
        setIsCheckingAuth(false);
      }
    }

    determineUserAndPermissions();
  }, [attachmentId]);

  if (isCheckingAuth || !userId) {
    return (
      <div className={`flex flex-col items-center justify-center ${onClose ? 'h-full min-h-0' : 'min-h-screen'} bg-[#fbf9f4] dark:bg-[#1a1918] text-[#1b1c19] dark:text-[#ededed]`}>
        <Loader2 className="w-7 h-7 animate-spin text-[#68594d] mb-3" />
        <p className="text-sm font-sans-ui text-[#7f756e] dark:text-[#a89f97]">
          Verificando permissões...
        </p>
      </div>
    );
  }

  return (
    <PdfEditor
      attachmentId={attachmentId}
      sourceUrl={sourceUrl}
      userId={userId}
      isReadOnly={isReadOnly}
      onClose={onClose}
    />
  );
}
