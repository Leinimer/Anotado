'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { DiarySidebarNavigation } from './DiarySidebarNavigation';
import { NoteCanvas } from '@/src/features/notes/ui/NoteCanvas';
import { CreateDiaryEntryModal } from '@/src/features/notes/ui/CreateDiaryEntryModal';
import { CreateDiaryYearModal } from '@/src/features/notes/ui/CreateDiaryYearModal';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { Folder, Note } from '@/src/features/notes/types';
import {
  fetchFoldersAndNotes,
  fetchNoteContent,
  updateNoteTitle,
  updateNoteContent,
  updateNoteTags,
  deleteNote,
  moveItem,
  flushAllPendingSaves,
} from '@/src/features/notes/api/notes-api';
import { syncEngine } from '@/src/features/notes/api/sync-engine';
import { saveQueue } from '@/src/features/notes/api/save-queue';
import { indexedDBStorage } from '@/src/features/notes/db/indexed-db';
import {
  getOrCreateTodayDiaryEntry,
  getOrCreateDiaryEntry,
  createDiaryYear,
} from '@/src/features/notes/api/diary-api';
import { formatDiaryDate } from '@/src/features/notes/utils/diary-date';
import { ShareDiaryModal } from './ShareDiaryModal';
import { PendingInvitationModal } from './PendingInvitationModal';
import {
  fetchIncomingShares,
  DiaryShare,
} from '../api/diary-sharing-api';

export function DiaryLayout() {
  const router = useRouter();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isNewNoteJustCreated, setIsNewNoteJustCreated] = useState(false);
  const [isDiaryEntryModalOpen, setIsDiaryEntryModalOpen] = useState(false);
  const [isDiaryYearModalOpen, setIsDiaryYearModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [pendingInvitation, setPendingInvitation] = useState<DiaryShare | null>(null);
  const [acceptedIncomingShares, setAcceptedIncomingShares] = useState<DiaryShare[]>([]);

  const activeNoteIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
    if (activeNoteId) {
      sessionStorage.setItem('anotado_active_diary_id', activeNoteId);
    }
  }, [activeNoteId]);

  // 1. Ouvintes de autenticação e reatividade do SyncEngine para o Diário
  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    const unsubscribeSync = syncEngine.subscribeToData(({ folders: newFolders, notes: newNotes }) => {
      if (!isMounted) return;

      // Filtra apenas dados do Diário
      const diaryNewFolders = newFolders.filter((f) => f.workspace_type === 'diary');
      const diaryNewNotes = newNotes.filter((n) => n.workspace_type === 'diary');

      setFolders((prevFolders) => {
        const pendingFolderMap = new Map(
          prevFolders.filter((f: any) => f.syncRequired || f.needs_sync).map((f) => [f.id, f])
        );
        const merged = diaryNewFolders.map((nf) => pendingFolderMap.get(nf.id) || nf);
        for (const [id, pf] of pendingFolderMap.entries()) {
          if (!merged.some((f) => f.id === id)) {
            merged.push(pf);
          }
        }
        return merged.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      });

      setNotes((prevNotes) => {
        const currentActiveId = activeNoteIdRef.current;
        const prevNotesMap = new Map(prevNotes.map((n) => [n.id, n]));

        const merged = diaryNewNotes.map((n) => {
          const currentInState = prevNotesMap.get(n.id);
          if (!currentInState) return n;

          if (n.id === currentActiveId) {
            const isPending = (currentInState as any).syncRequired || (currentInState as any).needs_sync;
            const isSaving = saveQueue.hasPendingSaveForNote(n.id);

            const chosenContent =
              isPending || isSaving
                ? currentInState.content !== undefined
                  ? currentInState.content
                  : n.content
                : n.content !== undefined
                ? n.content
                : currentInState.content;

            const chosenTags =
              currentInState.tags && currentInState.tags.length > 0
                ? currentInState.tags
                : n.tags;

            if (
              currentInState.title === n.title &&
              currentInState.content === chosenContent &&
              currentInState.folder_id === n.folder_id &&
              currentInState.position === n.position &&
              JSON.stringify(currentInState.tags || []) === JSON.stringify(chosenTags || [])
            ) {
              return currentInState;
            }

            return {
              ...n,
              content: chosenContent,
              tags: chosenTags,
            };
          }

          const isPending = (currentInState as any).syncRequired || (currentInState as any).needs_sync;
          const isSaving = saveQueue.hasPendingSaveForNote(n.id);
          if (isPending || isSaving) {
            return currentInState;
          }

          return n;
        });

        for (const [id, pn] of prevNotesMap.entries()) {
          if (!merged.some((n) => n.id === id)) {
            const isPending = (pn as any).syncRequired || (pn as any).needs_sync;
            if (isPending || id === currentActiveId) {
              merged.push(pn);
            }
          }
        }

        return merged.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      });
    });

    let sharesChannel: any = null;

    const initAuthAndData = async () => {
      let uid = 'local-user';

      if (isSupabaseConfigured()) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user?.id) {
            uid = session.user.id;
            if (session.user.email) {
              setUserEmail(session.user.email);
            }
          }
        } catch {
          // Ignora falha offline
        }
      }

      if (!isMounted) return;
      setUserId(uid);

      // Carrega compartilhamentos recebidos e assina mudanças em tempo real
      if (uid && uid !== 'local-user') {
        fetchIncomingShares(uid).then((shares) => {
          if (!isMounted) return;
          const accepted = shares.filter((s) => s.status === 'accepted');
          setAcceptedIncomingShares(accepted);
          const pending = shares.find((s) => s.status === 'pending');
          if (pending) {
            setPendingInvitation(pending);
          }
        }).catch((err) => {
          console.warn('[DiaryLayout] Erro ao carregar compartilhamentos recebidos:', err);
        });

        // Escuta convites e alterações em tempo real na tabela diary_shares
        sharesChannel = supabase
          .channel(`viewer_shares_${uid}`)
          .on(
            'postgres_changes' as any,
            {
              event: '*',
              schema: 'public',
              table: 'diary_shares',
              filter: `viewer_id=eq.${uid}`,
            },
            (payload: any) => {
              if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                const updated = payload.new as DiaryShare;
                if (updated.status === 'pending') {
                  setPendingInvitation(updated);
                } else if (updated.status === 'accepted') {
                  setPendingInvitation((curr) => (curr?.id === updated.id ? null : curr));
                  setAcceptedIncomingShares((prev) => {
                    const filtered = prev.filter((s) => s.id !== updated.id);
                    return [...filtered, updated];
                  });
                } else if (updated.status === 'rejected' || updated.status === 'revoked') {
                  setPendingInvitation((curr) => (curr?.id === updated.id ? null : curr));
                  setAcceptedIncomingShares((prev) => prev.filter((s) => s.id !== updated.id));
                }
              } else if (payload.eventType === 'DELETE') {
                const deletedId = payload.old?.id;
                if (deletedId) {
                  setPendingInvitation((curr) => (curr?.id === deletedId ? null : curr));
                  setAcceptedIncomingShares((prev) => prev.filter((s) => s.id !== deletedId));
                }
              }
            }
          )
          .subscribe();
      }

      try {
        // Carrega exclusivamente pastas e notas do Diário
        const initialData = await fetchFoldersAndNotes(uid, 'diary');
        if (!isMounted) return;

        let loadedFolders = initialData.folders.filter((f) => f.workspace_type === 'diary');
        let loadedNotes = initialData.notes.filter((n) => n.workspace_type === 'diary');

        // Se o Diário estiver vazio, cria automaticamente a entrada de Hoje e a estrutura do ano
        if (loadedNotes.length === 0) {
          try {
            const { note: todayNote } = await getOrCreateTodayDiaryEntry(uid);
            loadedNotes = [todayNote];
            loadedFolders = await indexedDBStorage.getAllFolders(uid, 'diary');
          } catch (diaryInitErr) {
            console.warn('[DiaryLayout] Aviso ao auto-criar entrada de hoje:', diaryInitErr);
          }
        }

        setFolders(loadedFolders);
        setNotes(loadedNotes);

        // Restaura entrada ativa salva na sessão ou seleciona a primeira
        const savedActiveId = sessionStorage.getItem('anotado_active_diary_id');
        if (savedActiveId && loadedNotes.some((n) => n.id === savedActiveId)) {
          setActiveNoteId(savedActiveId);
        } else if (loadedNotes.length > 0) {
          setActiveNoteId(loadedNotes[0].id);
        }
      } catch (err) {
        console.error('[DiaryLayout] Erro na inicialização:', err);
      }
    };

    initAuthAndData();

    return () => {
      isMounted = false;
      unsubscribeSync();
      if (sharesChannel) {
        supabase.removeChannel(sharesChannel);
      }
    };
  }, []);

  // 2. Carregamento de conteúdo Markdown sob demanda para a entrada selecionada
  useEffect(() => {
    let isCancelled = false;

    if (activeNoteId && userId) {
      const currentNote = notes.find((n) => n.id === activeNoteId);
      if (currentNote && (currentNote.content === undefined || currentNote.content === null)) {
        fetchNoteContent(userId, currentNote).then(({ content, tags }) => {
          if (!isCancelled) {
            setNotes((prev) =>
              prev.map((n) => {
                if (n.id === activeNoteId) {
                  return {
                    ...n,
                    content,
                    tags: tags !== undefined ? tags : n.tags,
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
  }, [activeNoteId, userId, notes]);

  // Nota atualmente ativa no editor
  const activeNote = useMemo(() => {
    return notes.find((n) => n.id === activeNoteId) || null;
  }, [notes, activeNoteId]);

  // Datas de entradas já existentes para validação no modal
  const existingDiaryDates = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n) => {
      if (n.entry_date) set.add(n.entry_date);
    });
    return set;
  }, [notes]);

  // Anos já existentes para validação no modal
  const existingDiaryYears = useMemo(() => {
    const years = new Set<number>();
    folders.forEach((f) => {
      if (f.diary_year) years.add(f.diary_year);
    });
    return Array.from(years);
  }, [folders]);

  // Alterna suavemente para a página de Notas
  const handleToggleWorkspace = useCallback(() => {
    // Salva pendências antes da troca
    flushAllPendingSaves();
    router.push('/notes');
  }, [router]);

  // Seleção de entrada
  const handleSelectNote = useCallback((noteId: string) => {
    setIsNewNoteJustCreated(false);
    setActiveNoteId(noteId);
  }, []);

  // Atalho para abrir ou criar entrada de HOJE
  const handleOpenToday = useCallback(async () => {
    if (!userId) return;
    try {
      const { note: todayNote } = await getOrCreateTodayDiaryEntry(userId);
      setNotes((prev) => {
        if (prev.some((n) => n.id === todayNote.id)) return prev;
        return [todayNote, ...prev];
      });
      const updatedFolders = await indexedDBStorage.getAllFolders(userId, 'diary');
      setFolders(updatedFolders);
      setActiveNoteId(todayNote.id);
    } catch (err) {
      console.error('[DiaryLayout] Erro ao abrir entrada de hoje:', err);
    }
  }, [userId]);

  // Criar nova entrada por data
  const handleConfirmCreateDiaryEntry = useCallback(
    async (dateStr: string, customTitle?: string) => {
      if (!userId) return;
      try {
        const { note: entryNote } = await getOrCreateDiaryEntry(userId, dateStr, customTitle);
        setNotes((prev) => {
          if (prev.some((n) => n.id === entryNote.id)) return prev;
          return [entryNote, ...prev];
        });
        const updatedFolders = await indexedDBStorage.getAllFolders(userId, 'diary');
        setFolders(updatedFolders);
        setActiveNoteId(entryNote.id);
        setIsNewNoteJustCreated(true);
      } catch (err) {
        console.error('[DiaryLayout] Erro ao criar entrada de diário:', err);
      }
    },
    [userId]
  );

  // Abertura ou criação LAZY de um dia específico (ex: 2026, 9, 3 -> '2026-09-03')
  const handleOpenOrCreateDay = useCallback(
    async (year: number, month: number, day: number) => {
      const dateStr = formatDiaryDate(year, month, day);
      await handleConfirmCreateDiaryEntry(dateStr);
    },
    [handleConfirmCreateDiaryEntry]
  );

  // Criar novo ano
  const handleConfirmCreateDiaryYear = useCallback(
    async (year: number) => {
      if (!userId) return;
      try {
        await createDiaryYear(userId, year);
        const updatedFolders = await indexedDBStorage.getAllFolders(userId, 'diary');
        setFolders(updatedFolders);
      } catch (err) {
        console.error('[DiaryLayout] Erro ao criar ano de diário:', err);
      }
    },
    [userId]
  );

  // Atualização de título
  const handleUpdateTitle = useCallback(
    async (noteId: string, newTitle: string) => {
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, title: newTitle } : n))
      );
      await updateNoteTitle(userId, noteId, newTitle);
    },
    [userId]
  );

  // Atualização de conteúdo
  const handleUpdateContent = useCallback(
    async (noteId: string, newContent: string) => {
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, content: newContent } : n))
      );
      await updateNoteContent(userId, noteId, newContent);
    },
    [userId]
  );

  // Atualização de tags
  const handleUpdateTags = useCallback(
    async (noteId: string, newTags: string[]) => {
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, tags: newTags } : n))
      );
      await updateNoteTags(userId, noteId, newTags);
    },
    [userId]
  );

  // Exclusão de entrada
  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      if (activeNoteId === noteId) {
        const remaining = notes.filter((n) => n.id !== noteId);
        setActiveNoteId(remaining.length > 0 ? remaining[0].id : null);
      }
      await deleteNote(userId, noteId);
    },
    [userId, activeNoteId, notes]
  );

  // Mover entrada entre meses
  const handleMoveItem = useCallback(
    async (
      itemType: 'note',
      itemId: string,
      targetMonthFolderId: string,
      targetPosition: number
    ) => {
      setNotes((prev) =>
        prev.map((n) => {
          if (n.id === itemId) {
            return {
              ...n,
              folder_id: targetMonthFolderId,
              position: targetPosition,
            };
          }
          return n;
        })
      );
      await moveItem(userId, 'note', itemId, targetMonthFolderId, targetPosition);
    },
    [userId]
  );

  return (
    <div id="diary-layout-root" className="flex h-screen w-screen overflow-hidden bg-[#faf8f5]">
      {/* Botão Hambúrguer Mobile */}
      <div className="md:hidden fixed top-3 left-3 z-30">
        <button
          id="diary-mobile-menu-toggle-btn"
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="p-2 bg-[#fbf9f4] border border-[#eae8e3] rounded-xl shadow-xs text-[#1b1c19] hover:bg-[#eae8e3] transition-colors cursor-pointer"
          aria-label="Abrir Menu do Diário"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden md:flex shrink-0 h-full">
        <DiarySidebarNavigation
          folders={folders}
          notes={notes}
          activeNoteId={activeNoteId}
          userId={userId}
          onSelectNote={handleSelectNote}
          onOpenOrCreateDay={handleOpenOrCreateDay}
          onCreateYear={() => setIsDiaryYearModalOpen(true)}
          onCreateEntry={() => setIsDiaryEntryModalOpen(true)}
          onOpenToday={handleOpenToday}
          onDeleteNote={handleDeleteNote}
          onRenameNote={handleUpdateTitle}
          onMoveItem={handleMoveItem}
          onToggleWorkspace={handleToggleWorkspace}
          onOpenShareModal={() => setIsShareModalOpen(true)}
          acceptedSharedDiaries={acceptedIncomingShares}
        />
      </div>

      {/* Mobile Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/30 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative w-[280px] max-w-[80vw] h-full z-10 shadow-2xl">
            <DiarySidebarNavigation
              folders={folders}
              notes={notes}
              activeNoteId={activeNoteId}
              userId={userId}
              onSelectNote={(id) => {
                handleSelectNote(id);
                setMobileSidebarOpen(false);
              }}
              onOpenOrCreateDay={(y, m, d) => {
                handleOpenOrCreateDay(y, m, d);
                setMobileSidebarOpen(false);
              }}
              onCreateYear={() => {
                setIsDiaryYearModalOpen(true);
                setMobileSidebarOpen(false);
              }}
              onCreateEntry={() => {
                setIsDiaryEntryModalOpen(true);
                setMobileSidebarOpen(false);
              }}
              onOpenToday={() => {
                handleOpenToday();
                setMobileSidebarOpen(false);
              }}
              onDeleteNote={handleDeleteNote}
              onRenameNote={handleUpdateTitle}
              onMoveItem={handleMoveItem}
              onToggleWorkspace={handleToggleWorkspace}
              onCloseMobile={() => setMobileSidebarOpen(false)}
              onOpenShareModal={() => {
                setIsShareModalOpen(true);
                setMobileSidebarOpen(false);
              }}
              acceptedSharedDiaries={acceptedIncomingShares}
            />
          </div>
        </div>
      )}

      {/* Canvas do Editor (mesmo editor rico de Notas) */}
      <NoteCanvas
        key={activeNote?.id || 'diary-empty'}
        activeNote={activeNote}
        onUpdateTitle={handleUpdateTitle}
        onUpdateContent={handleUpdateContent}
        onUpdateTags={handleUpdateTags}
        onDeleteNote={handleDeleteNote}
        onCreateNewNote={() => setIsDiaryEntryModalOpen(true)}
        onOpenMobileMenu={() => setMobileSidebarOpen(true)}
        userId={userId}
        isNewNoteJustCreated={isNewNoteJustCreated}
      />

      {/* Modais do Diário */}
      <CreateDiaryEntryModal
        isOpen={isDiaryEntryModalOpen}
        onClose={() => setIsDiaryEntryModalOpen(false)}
        onConfirm={handleConfirmCreateDiaryEntry}
        existingDates={existingDiaryDates}
      />

      <CreateDiaryYearModal
        isOpen={isDiaryYearModalOpen}
        onClose={() => setIsDiaryYearModalOpen(false)}
        onConfirm={handleConfirmCreateDiaryYear}
        existingYears={existingDiaryYears}
      />

      {/* Modal de Compartilhamento do Diário (Convidar e Gerenciar) */}
      <ShareDiaryModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        userId={userId}
        userEmail={userEmail}
      />

      {/* Modal de Notificação / Aceite de Convite Recebido */}
      <PendingInvitationModal
        invitation={pendingInvitation}
        onAccepted={(shareId) => {
          setPendingInvitation(null);
          if (userId && userId !== 'local-user') {
            fetchIncomingShares(userId).then((shares) => {
              setAcceptedIncomingShares(shares.filter((s) => s.status === 'accepted'));
            });
          }
        }}
        onRejected={() => {
          setPendingInvitation(null);
        }}
      />
    </div>
  );
}
