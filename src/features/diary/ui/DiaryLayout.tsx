'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Plus, Menu } from 'lucide-react';
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
  ensureDiaryYearFolders,
  reconcileAndDeduplicateDiary,
  deleteDiaryFolder,
  renameDiaryFolder,
} from '@/src/features/notes/api/diary-api';
import {
  formatDiaryDate,
  getLocalDateString,
  buildDiaryDateString,
  formatDateReadable,
} from '@/src/features/notes/utils/diary-date';
import {
  isDiaryFolder,
  isDiaryNote,
} from '@/src/features/notes/utils/diary-hierarchy';
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

      // Filtra usando a hierarquia real do Diário (sem depender exclusivamente de workspace_type)
      const diaryNewFolders = newFolders.filter((f) => isDiaryFolder(f, newFolders));
      const diaryNewNotes = newNotes.filter((n) => isDiaryNote(n, newFolders));

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
        // Reconcilia e deduplica pastas de ano e meses no Diário
        await reconcileAndDeduplicateDiary(uid);

        // Garante que o ano atual (2026) e seus 12 meses existam na estrutura
        const currentYear = new Date().getFullYear();
        await ensureDiaryYearFolders(uid, currentYear);

        // Carrega pastas e notas
        const initialData = await fetchFoldersAndNotes(uid, 'diary');
        if (!isMounted) return;

        const allFolders = initialData.folders;
        const loadedFolders = allFolders.filter((f) => isDiaryFolder(f, allFolders));
        const loadedNotes = initialData.notes.filter((n) => isDiaryNote(n, allFolders));

        setFolders(loadedFolders);
        setNotes(loadedNotes);

        // REGRA 3: Ao abrir o Diário:
        // - seleciona o dia atual;
        // - se a nota do dia atual existir, abre seu conteúdo;
        // - se NÃO existir, NÃO cria automaticamente. A nota só nasce quando o usuário clicar no dia.
        const todayStr = getLocalDateString();
        const todayNote = loadedNotes.find((n) => n.entry_date === todayStr);

        if (todayNote) {
          setActiveNoteId(todayNote.id);
        } else {
          // Não cria automaticamente!
          setActiveNoteId(null);
        }
      } catch (err) {
        console.error('[DiaryLayout] Erro na inicialização:', err);
      }
    };

    initAuthAndData();

    let authSubscription: any = null;
    if (isSupabaseConfigured()) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event: any, session: any) => {
        if (!isMounted) return;
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          if (session?.user?.id && session.user.id !== userId) {
            setUserId(session.user.id);
            if (session.user.email) setUserEmail(session.user.email);
            initAuthAndData();
          }
        }
      });
      authSubscription = subscription;
    }

    return () => {
      isMounted = false;
      unsubscribeSync();
      if (authSubscription) {
        authSubscription.unsubscribe();
      }
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
      const { note: todayNote, isNew } = await getOrCreateTodayDiaryEntry(userId);
      setNotes((prev) => {
        if (prev.some((n) => n.id === todayNote.id)) return prev;
        return [todayNote, ...prev];
      });
      const allFolders = await indexedDBStorage.getAllFolders(userId);
      setFolders(allFolders.filter((f) => isDiaryFolder(f, allFolders)));
      setIsNewNoteJustCreated(isNew);
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
        const { note: entryNote, isNew } = await getOrCreateDiaryEntry(userId, dateStr, customTitle);
        setNotes((prev) => {
          if (prev.some((n) => n.id === entryNote.id)) {
            return prev.map((n) => (n.id === entryNote.id ? entryNote : n));
          }
          return [entryNote, ...prev];
        });
        const allFolders = await indexedDBStorage.getAllFolders(userId);
        setFolders(allFolders.filter((f) => isDiaryFolder(f, allFolders)));
        setIsNewNoteJustCreated(isNew);
        setActiveNoteId(entryNote.id);
      } catch (err) {
        console.error('[DiaryLayout] Erro ao criar entrada de diário:', err);
      }
    },
    [userId]
  );

  // Abertura ou criação LAZY de um dia específico
  const handleOpenOrCreateDay = useCallback(
    async (year: number, month: number, day: number) => {
      const dateStr = buildDiaryDateString(year, month, day);
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
        const allFolders = await indexedDBStorage.getAllFolders(userId);
        setFolders(allFolders.filter((f) => isDiaryFolder(f, allFolders)));
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
        setActiveNoteId(null);
      }
      await deleteNote(userId, noteId);
    },
    [userId, activeNoteId]
  );

  // Exclusão de pasta (Ano ou Mês) com suporte a exclusão em cascata
  const handleDeleteFolder = useCallback(
    async (folderId: string, cascade: boolean) => {
      if (!userId) return;
      await deleteDiaryFolder(userId, folderId, cascade);
      const updatedFolders = await indexedDBStorage.getAllFolders(userId);
      const updatedNotes = await indexedDBStorage.getAllNotes(userId);
      setFolders(updatedFolders.filter((f) => isDiaryFolder(f, updatedFolders)));
      setNotes(updatedNotes.filter((n) => isDiaryNote(n, updatedFolders)));
      if (activeNote && (activeNote.folder_id === folderId || !updatedNotes.some((n) => n.id === activeNote.id))) {
        setActiveNoteId(null);
      }
    },
    [userId, activeNote]
  );

  // Renomear pasta (Ano ou Mês)
  const handleRenameFolder = useCallback(
    async (folderId: string, newName: string) => {
      if (!userId) return;
      await renameDiaryFolder(userId, folderId, newName);
      const updatedFolders = await indexedDBStorage.getAllFolders(userId);
      setFolders(updatedFolders.filter((f) => isDiaryFolder(f, updatedFolders)));
    },
    [userId]
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

  const todayReadable = useMemo(() => formatDateReadable(getLocalDateString()), []);

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
          <Menu className="w-5 h-5" />
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
          onDeleteFolder={handleDeleteFolder}
          onRenameFolder={handleRenameFolder}
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
              onSelectNote={(noteId) => {
                handleSelectNote(noteId);
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
              onDeleteFolder={handleDeleteFolder}
              onRenameFolder={handleRenameFolder}
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

      {/* Canvas do Editor ou Estado Vazio elegante do Diário */}
      {activeNote ? (
        <NoteCanvas
          key={activeNote.id}
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
      ) : (
        <main
          id="diary-empty-canvas"
          className="flex-1 flex flex-col h-full bg-[#fbf9f4] items-center justify-center p-6 text-center select-none relative"
        >
          <div className="max-w-md space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-[#f4dfcb] text-[#68594d] mx-auto flex items-center justify-center shadow-xs">
              <Calendar className="w-8 h-8 stroke-[1.5]" />
            </div>

            <div className="space-y-1">
              <h2 className="font-serif-note font-bold text-2xl text-[#1b1c19]">
                Hoje, {todayReadable}
              </h2>
              <p className="font-sans-ui text-sm text-[#7f756e]">
                Nenhuma anotação criada para hoje ainda.
              </p>
            </div>

            <p className="font-sans-ui text-xs text-[#a1968e] max-w-xs mx-auto leading-relaxed">
              O diário mantém seus dias virtuais organizados. A anotação só nasce quando você começar a escrever.
            </p>

            <div className="pt-2">
              <button
                type="button"
                id="diary-start-today-btn"
                onClick={handleOpenToday}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#68594d] text-white rounded-xl text-xs font-sans-ui font-medium hover:bg-[#53463c] transition-colors cursor-pointer shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Começar a Escrever Hoje</span>
              </button>
            </div>
          </div>
        </main>
      )}

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

      {/* Modal de Compartilhamento do Diário */}
      <ShareDiaryModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        userId={userId}
        userEmail={userEmail}
      />

      {/* Modal de Notificação / Aceite de Convite Recebido */}
      <PendingInvitationModal
        invitation={pendingInvitation}
        onAccepted={() => {
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
