'use client';

import React, { useState, useEffect, useMemo } from 'react';
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

        // Seleciona primeira nota se existir
        if (res.notes.length > 0) {
          setActiveNoteId(res.notes[0].id);
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

  // 2. Carrega conteúdo Markdown da nota ativa
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
            if (newNote.workspace_type === 'diary' && !newNote.is_archived) {
              setNotes((prev) => {
                if (prev.some((n) => n.id === newNote.id)) return prev;
                return [...prev, newNote].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedNote = payload.new as Note;
            if (updatedNote.workspace_type === 'diary') {
              if (updatedNote.is_archived) {
                setNotes((prev) => prev.filter((n) => n.id !== updatedNote.id));
              } else {
                setNotes((prev) =>
                  prev.map((n) => (n.id === updatedNote.id ? { ...n, ...updatedNote } : n))
                );
              }
            }
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old?.id;
            if (deletedId) {
              setNotes((prev) => prev.filter((n) => n.id !== deletedId));
              if (activeNoteId === deletedId) {
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
            if (newFolder.workspace_type === 'diary') {
              setFolders((prev) => {
                if (prev.some((f) => f.id === newFolder.id)) return prev;
                return [...prev, newFolder].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedFolder = payload.new as Folder;
            if (updatedFolder.workspace_type === 'diary') {
              setFolders((prev) =>
                prev.map((f) => (f.id === updatedFolder.id ? { ...f, ...updatedFolder } : f))
              );
            }
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
  }, [share?.owner_id, shareId, activeNoteId]);

  const activeNote = useMemo(() => {
    return notes.find((n) => n.id === activeNoteId) || null;
  }, [notes, activeNoteId]);

  // Se o acesso foi revogado
  if (isRevoked) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#faf8f5] p-6 text-center">
        <div className="max-w-md bg-white border border-red-200 rounded-2xl p-8 shadow-xl space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-red-100 text-red-600 mx-auto flex items-center justify-center">
            <ShieldAlert className="w-7 h-7 stroke-[2]" />
          </div>
          <h2 className="font-serif-note font-bold text-xl text-[#1b1c19]">
            Acesso Revogado
          </h2>
          <p className="font-sans-ui text-sm text-[#7f756e] leading-relaxed">
            Este Diário não está mais compartilhado com você. O proprietário revogou o acesso de leitura.
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#68594d] text-white rounded-xl text-xs font-sans-ui font-medium hover:bg-[#53463c] transition-colors cursor-pointer shadow-xs"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar ao Meu Diário</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Estado de Carregamento
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#faf8f5] flex-col gap-3">
        <Loader2 className="w-8 h-8 text-[#68594d] animate-spin" />
        <p className="font-sans-ui text-xs text-[#7f756e]">
          Carregando Diário compartilhado...
        </p>
      </div>
    );
  }

  // Estado de Erro
  if (error || !share) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#faf8f5] p-6 text-center">
        <div className="max-w-md bg-white border border-[#eae8e3] rounded-2xl p-8 shadow-xl space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 mx-auto flex items-center justify-center">
            <AlertCircle className="w-7 h-7 stroke-[2]" />
          </div>
          <h2 className="font-serif-note font-bold text-xl text-[#1b1c19]">
            Não foi possível carregar o Diário
          </h2>
          <p className="font-sans-ui text-sm text-[#7f756e] leading-relaxed">
            {error || 'Compartilhamento não encontrado ou acesso não autorizado.'}
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#68594d] text-white rounded-xl text-xs font-sans-ui font-medium hover:bg-[#53463c] transition-colors cursor-pointer shadow-xs"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar ao Início</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const ownerDisplayName = share.owner_name || share.owner_email?.split('@')[0] || 'Usuário';
  const ownerEmail = share.owner_email || '';

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

      {/* Canvas do Editor em Modo Somente Leitura */}
      <NoteCanvas
        key={activeNote?.id || 'shared-diary-empty'}
        activeNote={activeNote}
        onUpdateTitle={() => {}}
        onUpdateContent={() => {}}
        onUpdateTags={() => {}}
        onCreateNewNote={() => {}}
        onOpenMobileMenu={() => setMobileSidebarOpen(true)}
        userId={share.owner_id}
        readOnly={true}
      />
    </div>
  );
}
