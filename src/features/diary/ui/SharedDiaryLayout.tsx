'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Menu,
  ArrowLeft,
  AlertCircle,
  Loader2,
  BookOpen,
  Eye,
  ShieldAlert,
  Calendar,
} from 'lucide-react';
import {
  fetchSharedDiaryData,
  fetchSharedNoteContent,
  DiaryShare,
} from '../api/diary-sharing-api';
import { SharedDiarySidebarNavigation } from './SharedDiarySidebarNavigation';
import { NoteCanvas } from '@/src/features/notes/ui/NoteCanvas';
import { Folder, Note } from '@/src/features/notes/types';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import {
  getLocalDateString,
  formatDateReadable,
  buildDiaryDateString,
  MONTH_NAMES_PT,
} from '@/src/features/notes/utils/diary-date';

interface SharedDiaryLayoutProps {
  shareId: string;
}

export function SharedDiaryLayout({ shareId }: SharedDiaryLayoutProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRevoked, setIsRevoked] = useState(false);

  const [share, setShare] = useState<DiaryShare | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const activeNoteIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
  }, [activeNoteId]);

  // 1. Carrega dados iniciais do Diário compartilhado
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchSharedDiaryData(shareId);
        if (!isMounted) return;

        if (res.error || !res.share) {
          setError(res.error || 'Acesso não autorizado.');
          if (res.share?.status === 'revoked') {
            setIsRevoked(true);
          }
          setLoading(false);
          return;
        }

        setShare(res.share);
        setFolders(res.folders);
        setNotes(res.notes);

        // Identifica data atual no fuso horário do Diário
        const todayDateStr = getLocalDateString();
        const now = new Date();
        const curYear = now.getFullYear();
        const curMonth = now.getMonth() + 1;
        const curDay = now.getDate();

        // Localiza estritamente se existe entrada para o dia de hoje
        const todayNote = res.notes.find((n) => {
          if (n.entry_date === todayDateStr) return true;
          if (n.diary_year === curYear && n.diary_month === curMonth && n.diary_day === curDay) {
            return true;
          }
          const dayFormatted = String(curDay).padStart(2, '0');
          return Boolean(n.title && n.title.toLowerCase().startsWith(`dia ${dayFormatted}`));
        });

        // Se a nota de hoje existir, seleciona-a. Se não existir, permanece null (não cria e não abre nota aleatória)
        if (todayNote) {
          setActiveNoteId(todayNote.id);
        } else {
          setActiveNoteId(null);
        }
      } catch (err) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : 'Falha ao carregar Diário.';
        setError(msg);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [shareId]);

  // 2. Carrega conteúdo Markdown da nota ativa sob demanda
  useEffect(() => {
    let isCancelled = false;

    if (activeNoteId && share?.owner_id) {
      const currentNote = notes.find((n) => n.id === activeNoteId);
      if (currentNote && (currentNote.content === undefined || currentNote.content === null)) {
        fetchSharedNoteContent(share.owner_id, activeNoteId).then(({ content, tags }) => {
          if (!isCancelled) {
            setNotes((prev) =>
              prev.map((n) => {
                if (n.id === activeNoteId) {
                  return {
                    ...n,
                    content,
                    tags: tags.length > 0 ? tags : n.tags,
                  };
                }
                return n;
              })
            );
          }
        });
      }
    }

    return () => {
      isCancelled = true;
    };
  }, [activeNoteId, share?.owner_id, notes]);

  // 3. Subscrição Supabase Realtime para atualizações em tempo real
  useEffect(() => {
    if (!share?.owner_id || !isSupabaseConfigured()) return;

    const supabase = createClient();
    const ownerId = share.owner_id;
    const channelName = `shared_diary_channel_${shareId}`;

    const channel = supabase
      .channel(channelName)
      // Observa mudanças nas notas do Diário do proprietário
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'notes',
          filter: `user_id=eq.${ownerId}`,
        },
        async (payload: any) => {
          if (payload.eventType === 'INSERT') {
            const newNote = payload.new as Note;
            if (!newNote.is_archived) {
              setNotes((prev) => {
                if (prev.some((n) => n.id === newNote.id)) return prev;
                return [...prev, { ...newNote, workspace_type: 'diary' as const }].sort(
                  (a, b) => (a.position ?? 0) - (b.position ?? 0)
                );
              });

              // Se não havia nota aberta e a nova nota inserida for de hoje, abre-a
              const todayStr = getLocalDateString();
              if (!activeNoteIdRef.current && (newNote.entry_date === todayStr || (newNote.title || '').includes(todayStr))) {
                setActiveNoteId(newNote.id);
              }
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedNote = payload.new as Note;
            if (updatedNote.is_archived) {
              setNotes((prev) => prev.filter((n) => n.id !== updatedNote.id));
              if (activeNoteIdRef.current === updatedNote.id) {
                setActiveNoteId(null);
              }
            } else {
              setNotes((prev) =>
                prev.map((n) =>
                  n.id === updatedNote.id
                    ? { ...n, ...updatedNote, workspace_type: 'diary' as const }
                    : n
                )
              );
              // Se a nota atualizada for a que está atualmente aberta na tela, busca seu markdown mais recente
              if (activeNoteIdRef.current === updatedNote.id) {
                fetchSharedNoteContent(ownerId, updatedNote.id).then(({ content, tags }) => {
                  setNotes((prev) =>
                    prev.map((n) =>
                      n.id === updatedNote.id
                        ? { ...n, content, tags: tags.length > 0 ? tags : n.tags }
                        : n
                    )
                  );
                });
              }
            }
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old?.id;
            if (deletedId) {
              setNotes((prev) => prev.filter((n) => n.id !== deletedId));
              if (activeNoteIdRef.current === deletedId) {
                setActiveNoteId(null);
              }
            }
          }
        }
      )
      // Observa mudanças nas pastas do Diário do proprietário
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'folders',
          filter: `user_id=eq.${ownerId}`,
        },
        (payload: any) => {
          if (payload.eventType === 'INSERT') {
            const newFolder = payload.new as Folder;
            setFolders((prev) => {
              if (prev.some((f) => f.id === newFolder.id)) return prev;
              return [...prev, { ...newFolder, workspace_type: 'diary' as const }].sort(
                (a, b) => (a.position ?? 0) - (b.position ?? 0)
              );
            });
          } else if (payload.eventType === 'UPDATE') {
            const updatedFolder = payload.new as Folder;
            setFolders((prev) =>
              prev.map((f) =>
                f.id === updatedFolder.id
                  ? { ...f, ...updatedFolder, workspace_type: 'diary' as const }
                  : f
              )
            );
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old?.id;
            if (deletedId) {
              setFolders((prev) => prev.filter((f) => f.id !== deletedId));
            }
          }
        }
      )
      // Observa mudanças no próprio registro de compartilhamento (ex.: revogação pelo proprietário)
      .on(
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'diary_shares',
          filter: `id=eq.${shareId}`,
        },
        (payload: any) => {
          const updatedShare = payload.new as DiaryShare;
          if (updatedShare.status === 'revoked') {
            setIsRevoked(true);
            setError('Este Diário não está mais compartilhado com você.');
          }
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [share?.owner_id, shareId]);

  const activeNote = useMemo(() => {
    return notes.find((n) => n.id === activeNoteId) || null;
  }, [notes, activeNoteId]);

  // Se o acesso foi revogado
  if (isRevoked) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#faf8f5] p-6 text-center">
        <div className="max-w-md bg-white border border-red-200 rounded-2xl p-8 shadow-xl space-y-4">
          <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="font-serif-note font-bold text-lg text-[#1b1c19]">
            Acesso Revogado
          </h2>
          <p className="text-xs text-[#7f756e] font-sans-ui leading-relaxed">
            O proprietário encerrou o compartilhamento deste Diário. Você não tem mais permissão para visualizar estas entradas.
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#68594d] text-white text-xs font-sans-ui font-medium rounded-xl hover:bg-[#52443a] transition-colors shadow-2xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar para Meu Aplicativo</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Estado de Carregamento
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#faf8f5]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-[#68594d]" />
          <p className="text-xs text-[#7f756e] font-sans-ui">
            Carregando Diário compartilhado...
          </p>
        </div>
      </div>
    );
  }

  // Estado de Erro
  if (error || !share) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#faf8f5] p-6 text-center">
        <div className="max-w-md bg-white border border-[#eae8e3] rounded-2xl p-8 shadow-xl space-y-4">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="font-serif-note font-bold text-lg text-[#1b1c19]">
            Não foi possível abrir o Diário
          </h2>
          <p className="text-xs text-[#7f756e] font-sans-ui leading-relaxed">
            {error || 'O compartilhamento solicitado não existe ou você não possui permissão de leitura.'}
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#68594d] text-white text-xs font-sans-ui font-medium rounded-xl hover:bg-[#52443a] transition-colors shadow-2xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar ao Meu Início</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const ownerDisplayName = share.owner_name || share.owner_email?.split('@')[0] || 'Usuário';
  const ownerEmail = share.owner_email || '';
  const todayDateFormatted = formatDateReadable(getLocalDateString());

  return (
    <div id="shared-diary-root" className="flex h-screen w-screen overflow-hidden bg-[#faf8f5]">
      {/* Botão Mobile para Abrir Sidebar */}
      <div className="md:hidden fixed top-3 left-3 z-30">
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="p-2 bg-[#fbf9f4] border border-[#eae8e3] rounded-xl shadow-xs text-[#1b1c19] hover:bg-[#eae8e3] transition-colors cursor-pointer"
          aria-label="Abrir Menu do Diário Compartilhado"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden md:flex shrink-0 h-full">
        <SharedDiarySidebarNavigation
          ownerName={ownerDisplayName}
          ownerEmail={ownerEmail}
          folders={folders}
          notes={notes}
          activeNoteId={activeNoteId}
          onSelectNote={setActiveNoteId}
        />
      </div>

      {/* Mobile Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative w-[300px] max-w-[85vw] h-full z-10 shadow-2xl">
            <SharedDiarySidebarNavigation
              ownerName={ownerDisplayName}
              ownerEmail={ownerEmail}
              folders={folders}
              notes={notes}
              activeNoteId={activeNoteId}
              onSelectNote={(id) => {
                setActiveNoteId(id);
                setMobileSidebarOpen(false);
              }}
              onCloseMobile={() => setMobileSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Área Central: Canvas do Editor ou Mensagem Elegante de Leitura se Hoje não existir */}
      <div className="flex-1 h-full flex flex-col min-w-0 bg-[#faf8f5] overflow-hidden">
        {activeNote ? (
          <NoteCanvas
            key={activeNote.id}
            activeNote={activeNote}
            onUpdateTitle={() => {}}
            onUpdateContent={() => {}}
            onUpdateTags={() => {}}
            onCreateNewNote={() => {}}
            onOpenMobileMenu={() => setMobileSidebarOpen(true)}
            userId={share.owner_id}
            readOnly={true}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none">
            <div className="w-16 h-16 rounded-2xl bg-[#f0eee9] border border-[#e4dfd7] flex items-center justify-center text-[#68594d] mb-4 shadow-2xs">
              <Calendar className="w-8 h-8 stroke-[1.5]" />
            </div>
            <h2 className="font-serif-note font-bold text-xl text-[#1b1c19] tracking-tight mb-2">
              Nenhuma entrada registrada para hoje
            </h2>
            <p className="font-sans-ui text-sm text-[#7f756e] max-w-md mb-4 leading-relaxed">
              O proprietário ({ownerDisplayName}) ainda não publicou uma entrada no diário para o dia de hoje. Você pode navegar pelas entradas anteriores na barra lateral à esquerda.
            </p>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#f4dfcb]/60 border border-[#e8d2bd] text-[#5e4b3e] text-xs font-sans-ui font-medium">
              <Eye className="w-3.5 h-3.5" />
              <span>Modo Leitura • {todayDateFormatted}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
