'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarNavigation } from '@/src/features/notes/ui/SidebarNavigation';
import { NoteCanvas } from '@/src/features/notes/ui/NoteCanvas';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { Folder, Note } from '@/src/features/notes/types';
import {
  fetchFoldersAndNotes,
  fetchNoteContent,
  createFolder,
  renameFolder,
  updateFolderColor,
  updateFolderSmartConfig,
  deleteFolder,
  createNote,
  updateNoteTitle,
  updateNoteContent,
  updateNoteTags,
  deleteNote,
  archiveNote,
  unarchiveNote,
  archiveFolderNotes,
  moveItem,
  flushNoteSaves,
  flushAllPendingSaves,
} from '@/src/features/notes/api/notes-api';
import { syncEngine } from '@/src/features/notes/api/sync-engine';
import { saveQueue } from '@/src/features/notes/api/save-queue';
import { perfProfiler } from '@/src/features/notes/editor/utils/media-optimizer';
import { WorkspaceType } from '@/src/features/notes/types';

export function MainLayout() {
  const router = useRouter();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isNewNoteJustCreated, setIsNewNoteJustCreated] = useState(false);

  const activeNoteIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
    if (activeNoteId) {
      sessionStorage.setItem('anotado_active_notes_id', activeNoteId);
    }
  }, [activeNoteId]);

  // 1. Carregamento inicial do Supabase, ouvintes de autenticação e reatividade do SyncEngine
  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    // Inscrição reativa para atualizações provenientes do SyncEngine e Supabase Realtime
    const unsubscribeSync = syncEngine.subscribeToData(({ folders: newFolders, notes: newNotes }) => {
      if (!isMounted) return;

      setFolders((prevFolders) => {
        const pendingFolderMap = new Map(
          prevFolders.filter((f: any) => f.syncRequired || f.needs_sync).map((f) => [f.id, f])
        );
        const merged = newFolders.map((nf) => pendingFolderMap.get(nf.id) || nf);
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

        const merged = newNotes.map((n) => {
          const currentInState = prevNotesMap.get(n.id);
          if (!currentInState) return n;

          // Se é a nota ativa aberta no Canvas
          if (n.id === currentActiveId) {
            const isPending = (currentInState as any).syncRequired || (currentInState as any).needs_sync;
            const isSaving = saveQueue.hasPendingSaveForNote(n.id);

            // Se o usuário está ativamente editando, preserva o conteúdo do editor; se ocioso, aceita conteúdo resolvido
            const chosenContent = (isPending || isSaving)
              ? (currentInState.content !== undefined ? currentInState.content : n.content)
              : (n.content !== undefined ? n.content : currentInState.content);

            const chosenTags = currentInState.tags && currentInState.tags.length > 0 ? currentInState.tags : n.tags;

            // Preserva a referência de objeto se não houve mudança substancial para evitar re-renders no Canvas
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

          // Se a nota local possui alterações pendentes ou revisão superior, preserva o estado local
          const isPending = (currentInState as any).syncRequired || (currentInState as any).needs_sync;
          const isSaving = saveQueue.hasPendingSaveForNote(n.id);
          if (isPending || isSaving || (currentInState.revision || 0) > (n.revision || 0)) {
            return currentInState;
          }

          return {
            ...n,
            content: n.content !== undefined ? n.content : currentInState.content,
          };
        });

        // Preserva notas criadas localmente que ainda estejam em processamento ou com pendências
        for (const [id, pn] of prevNotesMap.entries()) {
          const isPending = (pn as any).syncRequired || (pn as any).needs_sync;
          const isSaving = saveQueue.hasPendingSaveForNote(id);
          if ((isPending || isSaving) && !merged.some((n) => n.id === id)) {
            merged.push(pn);
          }
        }

        // Se a nota ativa foi excluída remotamente e não possui pendências locais, limpa a visualização
        if (currentActiveId && !merged.some((n) => n.id === currentActiveId)) {
          setTimeout(() => setActiveNoteId(null), 0);
        }

        return merged.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      });
    });

    // Obtém o usuário autenticado atual com suporte robusto a inicialização offline
    const resolveUserAndLoad = async () => {
      let currentUserId = 'demo-user';

      // 1. Tenta getSession (lê do armazenamento local/cache do Supabase sem requisição de rede)
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user?.id) {
          currentUserId = sessionData.session.user.id;
        }
      } catch (e) {
        console.warn('[MainLayout] Aviso ao obter sessão local:', e);
      }

      // 2. Se não encontrou e estiver online, tenta getUser
      if (currentUserId === 'demo-user' && navigator.onLine) {
        try {
          const { data: userData } = await supabase.auth.getUser();
          if (userData?.user?.id) {
            currentUserId = userData.user.id;
          }
        } catch (e) {
          console.warn('[MainLayout] Aviso ao verificar usuário online:', e);
        }
      }

      // 3. Fallback para último userId autenticado gravado localmente
      if (currentUserId === 'demo-user' && typeof window !== 'undefined') {
        const cachedId = localStorage.getItem('anotado_last_auth_user_id');
        if (cachedId && cachedId !== 'demo-user') {
          currentUserId = cachedId;
        }
      }

      if (!isMounted) return;

      if (currentUserId !== 'demo-user' && typeof window !== 'undefined') {
        localStorage.setItem('anotado_last_auth_user_id', currentUserId);
      }

      setUserId(currentUserId);
      syncEngine.setActiveUser(currentUserId);

      // Carrega pastas e notas reais diretamente do Supabase/IndexedDB
      try {
        const { folders: fetchedFolders, notes: fetchedNotes } = await fetchFoldersAndNotes(currentUserId, 'notes');
        if (!isMounted) return;

        setFolders(fetchedFolders);
        setNotes(fetchedNotes);

        const savedActiveId = typeof window !== 'undefined' ? sessionStorage.getItem('anotado_active_notes_id') : null;
        if (savedActiveId && fetchedNotes.some((n) => n.id === savedActiveId)) {
          setActiveNoteId(savedActiveId);
        } else if (fetchedNotes.length > 0) {
          setActiveNoteId(fetchedNotes[0].id);
        } else {
          setActiveNoteId(null);
        }

        // Dispara verificação imediata de sincronização PUSH/PULL
        syncEngine.scheduleSync(100);
      } catch (err) {
        console.error('[MainLayout] Erro ao carregar dados do Supabase:', err);
      }
    };

    resolveUserAndLoad();

    let authUnsubscribe: (() => void) | undefined;
    if (isSupabaseConfigured()) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event: any, session: any) => {
        if (event === 'SIGNED_OUT') {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('anotado_last_auth_user_id');
          }
          syncEngine.cleanup();
          if (typeof window !== 'undefined') {
            window.location.replace('/login');
          }
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user?.id) {
            const newUid = session.user.id;
            if (typeof window !== 'undefined') {
              localStorage.setItem('anotado_last_auth_user_id', newUid);
            }
            setUserId(newUid);
            syncEngine.setActiveUser(newUid);
            syncEngine.scheduleSync(100);
          }
        }
      });
      authUnsubscribe = () => subscription.unsubscribe();
    }

    return () => {
      isMounted = false;
      unsubscribeSync();
      syncEngine.cleanup();
      if (authUnsubscribe) authUnsubscribe();
    };
  }, []);

  // Carrega o conteúdo do arquivo Markdown no Storage ao selecionar uma nota
  const handleSelectNote = useCallback(
    async (noteId: string) => {
      perfProfiler.start(noteId);
      setIsNewNoteJustCreated(false);

      // Garante que saves pendentes da nota anterior sejam finalizados
      if (activeNoteId && activeNoteId !== noteId) {
        await flushNoteSaves(activeNoteId);
      }

      setActiveNoteId(noteId);

      const targetNote = notes.find((n) => n.id === noteId);
      if (targetNote) {
        perfProfiler.mark(noteId, 'T0.5 - Buscando Markdown no Storage');
        const { content, tags } = await fetchNoteContent(userId, targetNote);
        perfProfiler.mark(noteId, 'T0.8 - Markdown Recebido do Storage');
        setNotes((prev) =>
          prev.map((n) =>
            n.id === noteId
              ? {
                  ...n,
                  content: content !== undefined ? content : n.content,
                  tags: tags && tags.length > 0 ? tags : n.tags,
                }
              : n
          )
        );
      }
    },
    [notes, userId, activeNoteId]
  );

  // Ouvinte global para abertura de notas a partir de modais (ex: SyncPendingModal)
  useEffect(() => {
    const handleGlobalOpenNote = (e: Event) => {
      const customEvent = e as CustomEvent<{ noteId?: string; folderId?: string | null }>;
      if (customEvent.detail?.noteId) {
        if (customEvent.detail.folderId !== undefined) {
          setActiveFolderId(customEvent.detail.folderId);
        }
        handleSelectNote(customEvent.detail.noteId);
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener('anotado:open-note', handleGlobalOpenNote);
    return () => {
      window.removeEventListener('anotado:open-note', handleGlobalOpenNote);
    };
  }, [handleSelectNote]);

  // Nota ativa selecionada atualmente
  const activeNote = useMemo(() => {
    return notes.find((n) => n.id === activeNoteId) || null;
  }, [notes, activeNoteId]);

  // Filtros de isolamento por espaço (Notas vs Diário)
  const handleToggleWorkspace = useCallback(() => {
    flushAllPendingSaves();
    router.push('/diary');
  }, [router]);

  // Handlers de Pastas
  const handleCreateFolder = useCallback(async () => {
    // Toda nova pasta nasce SEMPRE na raiz (parent_id: null)
    const position = folders.filter((f) => f.parent_id === null).length;
    const newFolder = await createFolder(userId, {
      name: 'Nova pasta',
      parentId: null,
      position,
      workspaceType: 'notes',
    });

    setFolders((prev) => [...prev, newFolder]);
    return newFolder.id;
  }, [userId, folders]);

  const handleRenameFolder = useCallback(
    async (folderId: string, newName: string) => {
      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, name: newName, updated_at: new Date().toISOString() } : f))
      );
      await renameFolder(userId, folderId, newName);
    },
    [userId]
  );

  const handleUpdateFolderColor = useCallback(
    async (folderId: string, color: string | null) => {
      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, color, updated_at: new Date().toISOString() } : f))
      );
      await updateFolderColor(userId, folderId, color);
    },
    [userId]
  );

  const handleUpdateFolderSmartConfig = useCallback(
    async (folderId: string, isSmart: boolean, smartTags: string[]) => {
      setFolders((prev) =>
        prev.map((f) =>
          f.id === folderId
            ? { ...f, is_smart: isSmart, smart_tags: smartTags, updated_at: new Date().toISOString() }
            : f
        )
      );
      await updateFolderSmartConfig(userId, folderId, isSmart, smartTags);
    },
    [userId]
  );

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      const targetFolder = folders.find((f) => f.id === folderId);
      const isSmart = targetFolder?.is_smart;

      setFolders((prev) => prev.filter((f) => f.id !== folderId && f.parent_id !== folderId));
      // Se NÃO for pasta inteligente, exclui as notas contidas fisicamente
      if (!isSmart) {
        setNotes((prev) => prev.filter((n) => n.folder_id !== folderId));
      }

      // Se a nota ativa estava dentro da pasta física excluída, limpa a seleção
      if (!isSmart && activeNote && activeNote.folder_id === folderId) {
        setActiveNoteId(null);
      }
      if (activeFolderId === folderId) {
        setActiveFolderId(null);
      }

      await deleteFolder(userId, folderId);
    },
    [userId, activeNote, activeFolderId, folders]
  );

  // Handlers de Notas (com persistência em Markdown no Supabase Storage)
  const handleCreateNote = useCallback(async () => {
    // Toda nova nota nasce SEMPRE na raiz (folder_id: null)
    const position = notes.filter((n) => n.folder_id === null).length;

    const newNote = await createNote(userId, {
      title: 'Nova nota',
      folderId: null,
      position,
      content: '',
      workspaceType: 'notes',
    });

    setNotes((prev) => [...prev, newNote]);
    setIsNewNoteJustCreated(true);
    setActiveNoteId(newNote.id);
    return newNote.id;
  }, [userId, notes]);

  const handleUpdateTitle = useCallback(
    async (noteId: string, newTitle: string) => {
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, title: newTitle, updated_at: new Date().toISOString() } : n))
      );
      await updateNoteTitle(userId, noteId, newTitle);
    },
    [userId]
  );

  const handleUpdateContent = useCallback(
    async (noteId: string, newContent: string) => {
      // 1. Atualização Otimista Imediata na Memória da UI
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? {
                ...n,
                content: newContent,
                updated_at: new Date().toISOString(),
              }
            : n
        )
      );

      // 2. Persistência Serializada em Background (IndexedDB + Supabase)
      const currentNote = notes.find((n) => n.id === noteId);
      const res = await updateNoteContent(userId, noteId, newContent, currentNote?.tags);
      if (res && res.tags) {
        setNotes((prev) =>
          prev.map((n) => (n.id === noteId ? { ...n, tags: res.tags } : n))
        );
      }
    },
    [userId, notes]
  );

  const handleUpdateNoteTags = useCallback(
    async (noteId: string, newTags: string[]) => {
      const currentNote = notes.find((n) => n.id === noteId);
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId ? { ...n, tags: newTags, updated_at: new Date().toISOString() } : n
        )
      );
      const res = await updateNoteTags(userId, noteId, newTags, currentNote?.content);
      if (res.success && res.tags) {
        setNotes((prev) =>
          prev.map((n) => (n.id === noteId ? { ...n, tags: res.tags } : n))
        );
      }
    },
    [userId, notes]
  );

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

  const handleArchiveNote = useCallback(
    async (noteId: string) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? {
                ...n,
                is_archived: true,
                previous_folder_id: n.folder_id,
                folder_id: null,
                updated_at: new Date().toISOString(),
              }
            : n
        )
      );
      await archiveNote(userId, noteId);
    },
    [userId]
  );

  const handleUnarchiveNote = useCallback(
    async (noteId: string) => {
      const targetNote = notes.find((n) => n.id === noteId);
      const prevFolderId = targetNote?.previous_folder_id ?? null;
      const folderStillExists = prevFolderId ? folders.some((f) => f.id === prevFolderId) : false;
      const destinationFolderId = folderStillExists ? prevFolderId : null;

      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? {
                ...n,
                is_archived: false,
                folder_id: destinationFolderId,
                previous_folder_id: null,
                updated_at: new Date().toISOString(),
              }
            : n
        )
      );
      await unarchiveNote(userId, noteId, folders);
    },
    [userId, notes, folders]
  );

  const handleArchiveFolderNotes = useCallback(
    async (folderId: string) => {
      const folderIdsToArchive = new Set<string>([folderId]);
      let added = true;
      while (added) {
        added = false;
        for (const folder of folders) {
          if (folder.parent_id && folderIdsToArchive.has(folder.parent_id) && !folderIdsToArchive.has(folder.id)) {
            folderIdsToArchive.add(folder.id);
            added = true;
          }
        }
      }

      setNotes((prev) =>
        prev.map((n) => {
          if (n.folder_id && folderIdsToArchive.has(n.folder_id) && !n.is_archived) {
            return {
              ...n,
              is_archived: true,
              previous_folder_id: n.folder_id,
              folder_id: null,
              updated_at: new Date().toISOString(),
            };
          }
          return n;
        })
      );

      await archiveFolderNotes(userId, folderId, folders);
    },
    [userId, folders]
  );

  const handleMoveItem = useCallback(
    async (
      itemType: 'folder' | 'note',
      itemId: string,
      targetFolderId: string | null,
      targetPosition: number
    ) => {
      if (itemType === 'folder') {
        setFolders((prev) =>
          prev.map((f) =>
            f.id === itemId
              ? { ...f, parent_id: targetFolderId, position: targetPosition, updated_at: new Date().toISOString() }
              : f
          )
        );
      } else {
        setNotes((prev) =>
          prev.map((n) =>
            n.id === itemId
              ? { ...n, folder_id: targetFolderId, position: targetPosition, updated_at: new Date().toISOString() }
              : n
          )
        );
      }

      await moveItem(userId, itemType, itemId, targetFolderId, targetPosition);
    },
    [userId]
  );

  return (
    <div
      id="main-app-container"
      className="flex flex-col h-screen w-screen overflow-hidden bg-[#fbf9f4] font-sans-ui"
    >
      {/* Workspace Area: Sidebar + Canvas */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Desktop Sidebar */}
        <div className="hidden md:flex shrink-0 h-full">
          <SidebarNavigation
            folders={folders}
            notes={notes}
            activeNoteId={activeNoteId}
            activeFolderId={activeFolderId}
            onSelectNote={handleSelectNote}
            onSelectFolder={(id) => setActiveFolderId(id)}
            onCreateFolder={handleCreateFolder}
            onCreateNote={handleCreateNote}
            onRenameFolder={handleRenameFolder}
            onRenameNote={handleUpdateTitle}
            onDeleteFolder={handleDeleteFolder}
            onDeleteNote={handleDeleteNote}
            onArchiveNote={handleArchiveNote}
            onUnarchiveNote={handleUnarchiveNote}
            onArchiveFolderNotes={handleArchiveFolderNotes}
            onUpdateFolderColor={handleUpdateFolderColor}
            onUpdateFolderSmartConfig={handleUpdateFolderSmartConfig}
            onMoveItem={handleMoveItem}
            currentWorkspace="notes"
            onToggleWorkspace={handleToggleWorkspace}
          />
        </div>

        {/* Mobile Drawer Sidebar */}
        {mobileSidebarOpen && (
          <div
            id="mobile-sidebar-drawer"
            className="fixed inset-0 z-50 flex md:hidden"
          >
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
              onClick={() => setMobileSidebarOpen(false)}
            />

            {/* Slide-in Content */}
            <div className="relative w-[280px] max-w-[80vw] h-full z-10 shadow-2xl">
              <SidebarNavigation
                folders={folders}
                notes={notes}
                activeNoteId={activeNoteId}
                activeFolderId={activeFolderId}
                onSelectNote={(id) => {
                  handleSelectNote(id);
                  setMobileSidebarOpen(false);
                }}
                onSelectFolder={(id) => setActiveFolderId(id)}
                onCreateFolder={handleCreateFolder}
                onCreateNote={handleCreateNote}
                onRenameFolder={handleRenameFolder}
                onRenameNote={handleUpdateTitle}
                onDeleteFolder={handleDeleteFolder}
                onDeleteNote={handleDeleteNote}
                onArchiveNote={handleArchiveNote}
                onUnarchiveNote={handleUnarchiveNote}
                onArchiveFolderNotes={handleArchiveFolderNotes}
                onUpdateFolderColor={handleUpdateFolderColor}
                onUpdateFolderSmartConfig={handleUpdateFolderSmartConfig}
                onMoveItem={handleMoveItem}
                onCloseMobile={() => setMobileSidebarOpen(false)}
                currentWorkspace="notes"
                onToggleWorkspace={handleToggleWorkspace}
              />
            </div>
          </div>
        )}

        {/* Main Note Canvas */}
        <NoteCanvas
          key={activeNote?.id || 'empty'}
          activeNote={activeNote}
          userId={userId}
          onUpdateTitle={(noteId, newTitle) => handleUpdateTitle(noteId, newTitle)}
          onUpdateContent={(noteId, newContent) => handleUpdateContent(noteId, newContent)}
          onUpdateTags={(noteId, newTags) => handleUpdateNoteTags(noteId, newTags)}
          onDeleteNote={(noteId) => handleDeleteNote(noteId)}
          onCreateNewNote={() => handleCreateNote()}
          onOpenMobileMenu={() => setMobileSidebarOpen(true)}
          isNewNoteJustCreated={isNewNoteJustCreated}
        />
      </div>
    </div>
  );
}
