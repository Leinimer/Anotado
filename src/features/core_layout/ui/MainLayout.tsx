'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { SidebarNavigation } from '@/src/features/notes/ui/SidebarNavigation';
import { NoteCanvas } from '@/src/features/notes/ui/NoteCanvas';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { Folder, Note } from '@/src/features/notes/types';
import {
  fetchFoldersAndNotes,
  fetchNoteContent,
  createFolder,
  renameFolder,
  deleteFolder,
  createNote,
  updateNoteTitle,
  updateNoteContent,
  deleteNote,
  moveItem,
} from '@/src/features/notes/api/notes-api';

export function MainLayout() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>('texto-2');
  const [activeFolderId, setActiveFolderId] = useState<string | null>('pasta-2');
  const [userId, setUserId] = useState<string>('local-user');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isNewNoteJustCreated, setIsNewNoteJustCreated] = useState(false);

  // 1. Carregamento inicial do Supabase e ouvinte de autenticação
  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    // Obtém o usuário autenticado atual
    supabase.auth.getUser().then(async ({ data }) => {
      if (!isMounted) return;
      const currentUserId = data?.user?.id || 'demo-user';
      setUserId(currentUserId);

      // Carrega pastas e notas reais
      const { folders: fetchedFolders, notes: fetchedNotes } = await fetchFoldersAndNotes(currentUserId);
      if (!isMounted) return;

      setFolders(fetchedFolders);
      setNotes(fetchedNotes);

      // Se houver notas, seleciona a primeira ou a padrão
      if (fetchedNotes.length > 0) {
        const exists = fetchedNotes.some((n) => n.id === 'texto-2');
        const initialSelectedId = exists ? 'texto-2' : fetchedNotes[0].id;
        setActiveNoteId(initialSelectedId);

        // Carrega o Markdown correspondente do Storage
        const selectedNote = fetchedNotes.find((n) => n.id === initialSelectedId);
        if (selectedNote) {
          fetchNoteContent(currentUserId, selectedNote).then((content) => {
            if (isMounted && content !== undefined) {
              setNotes((prev) =>
                prev.map((n) => (n.id === selectedNote.id ? { ...n, content } : n))
              );
            }
          });
        }
      } else {
        setActiveNoteId(null);
      }
    });

    if (isSupabaseConfigured()) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          if (typeof window !== 'undefined') {
            window.location.replace('/login');
          }
        }
      });

      return () => {
        isMounted = false;
        subscription.unsubscribe();
      };
    }
  }, []);

  // Carrega o conteúdo do arquivo Markdown no Storage ao selecionar uma nota
  const handleSelectNote = useCallback(
    async (noteId: string) => {
      setIsNewNoteJustCreated(false);
      setActiveNoteId(noteId);

      const targetNote = notes.find((n) => n.id === noteId);
      if (targetNote) {
        const mdContent = await fetchNoteContent(userId, targetNote);
        if (mdContent !== undefined) {
          setNotes((prev) =>
            prev.map((n) => (n.id === noteId ? { ...n, content: mdContent } : n))
          );
        }
      }
    },
    [notes, userId]
  );

  // Nota ativa selecionada atualmente
  const activeNote = useMemo(() => {
    return notes.find((n) => n.id === activeNoteId) || null;
  }, [notes, activeNoteId]);

  // Handlers de Pastas
  const handleCreateFolder = useCallback(async () => {
    // Toda nova pasta nasce SEMPRE na raiz (parent_id: null)
    const position = folders.filter((f) => f.parent_id === null).length;
    const newFolder = await createFolder(userId, {
      name: 'Nova pasta',
      parentId: null,
      position,
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

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      setFolders((prev) => prev.filter((f) => f.id !== folderId && f.parent_id !== folderId));
      setNotes((prev) => prev.filter((n) => n.folder_id !== folderId));

      // Se a nota ativa estava dentro da pasta excluída, limpa a seleção
      if (activeNote && activeNote.folder_id === folderId) {
        setActiveNoteId(null);
      }
      if (activeFolderId === folderId) {
        setActiveFolderId(null);
      }

      await deleteFolder(userId, folderId);
    },
    [userId, activeNote, activeFolderId]
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
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, content: newContent, updated_at: new Date().toISOString() } : n))
      );
      await updateNoteContent(userId, noteId, newContent);
    },
    [userId]
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
            onMoveItem={handleMoveItem}
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
                onMoveItem={handleMoveItem}
                onCloseMobile={() => setMobileSidebarOpen(false)}
              />
            </div>
          </div>
        )}

        {/* Main Note Canvas */}
        <NoteCanvas
          key={activeNote?.id || 'empty'}
          activeNote={activeNote}
          onUpdateTitle={(noteId, newTitle) => handleUpdateTitle(noteId, newTitle)}
          onUpdateContent={(noteId, newContent) => handleUpdateContent(noteId, newContent)}
          onDeleteNote={(noteId) => handleDeleteNote(noteId)}
          onCreateNewNote={() => handleCreateNote()}
          onOpenMobileMenu={() => setMobileSidebarOpen(true)}
          isNewNoteJustCreated={isNewNoteJustCreated}
        />
      </div>
    </div>
  );
}
