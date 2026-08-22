import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { Folder, Note } from '../types';

const LOCAL_STORAGE_KEY_FOLDERS = 'anotado_local_folders';
const LOCAL_STORAGE_KEY_NOTES = 'anotado_local_notes';

// Seed inicial caso o usuário seja novo e o banco esteja vazio
export const INITIAL_DEMO_FOLDERS: Omit<Folder, 'user_id'>[] = [
  {
    id: 'pasta-1',
    name: 'Pasta 1',
    parent_id: null,
    position: 0,
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
  },
  {
    id: 'pasta-2',
    name: 'Pasta 2',
    parent_id: null,
    position: 1,
    created_at: '2026-08-20T10:01:00Z',
    updated_at: '2026-08-20T10:01:00Z',
  },
  {
    id: 'pasta-3',
    name: 'Pasta 3',
    parent_id: 'pasta-2',
    position: 0,
    created_at: '2026-08-20T10:02:00Z',
    updated_at: '2026-08-20T10:02:00Z',
  },
  {
    id: 'pasta-4',
    name: 'Pasta 4',
    parent_id: null,
    position: 2,
    created_at: '2026-08-20T10:03:00Z',
    updated_at: '2026-08-20T10:03:00Z',
  },
];

export const INITIAL_DEMO_NOTES: Omit<Note, 'user_id'>[] = [
  {
    id: 'texto-1',
    folder_id: 'pasta-2',
    title: 'texto 1',
    content: 'Primeira nota de rascunho com apontamentos iniciais.\n\n#Estudo #Nota',
    position: 0,
    created_at: '2026-08-20T10:05:00Z',
    updated_at: '2026-08-20T10:05:00Z',
  },
  {
    id: 'texto-2',
    folder_id: 'pasta-2',
    title: 'Texto II',
    content: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.

[ ] First item to consider in this thought process.
[ ] Second item, building upon the previous idea.

1. Main point number one.
2. Main point number two, containing sub-points:
   a. Detail expanding on point two.
   b. Another supporting detail for context.

- Final thought bullet point.
- Conclusion remark.
- Closing statement.

#Nota #Estudo #Livro`,
    position: 1,
    created_at: '2026-08-20T10:06:00Z',
    updated_at: '2026-08-20T10:06:00Z',
  },
];

function getLocalData(userId: string): { folders: Folder[]; notes: Note[] } {
  if (typeof window === 'undefined') {
    return {
      folders: INITIAL_DEMO_FOLDERS.map((f) => ({ ...f, user_id: userId })),
      notes: INITIAL_DEMO_NOTES.map((n) => ({ ...n, user_id: userId })),
    };
  }

  try {
    const rawFolders = localStorage.getItem(`${LOCAL_STORAGE_KEY_FOLDERS}_${userId}`);
    const rawNotes = localStorage.getItem(`${LOCAL_STORAGE_KEY_NOTES}_${userId}`);

    const folders: Folder[] = rawFolders
      ? JSON.parse(rawFolders)
      : INITIAL_DEMO_FOLDERS.map((f) => ({ ...f, user_id: userId }));

    const notes: Note[] = rawNotes
      ? JSON.parse(rawNotes)
      : INITIAL_DEMO_NOTES.map((n) => ({ ...n, user_id: userId }));

    return { folders, notes };
  } catch {
    return {
      folders: INITIAL_DEMO_FOLDERS.map((f) => ({ ...f, user_id: userId })),
      notes: INITIAL_DEMO_NOTES.map((n) => ({ ...n, user_id: userId })),
    };
  }
}

function saveLocalData(userId: string, folders: Folder[], notes: Note[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${LOCAL_STORAGE_KEY_FOLDERS}_${userId}`, JSON.stringify(folders));
    localStorage.setItem(`${LOCAL_STORAGE_KEY_NOTES}_${userId}`, JSON.stringify(notes));
  } catch (err) {
    console.error('Falha ao salvar no local storage:', err);
  }
}

/**
 * Busca todas as pastas e notas do usuário autenticado no Supabase com fallback gracioso.
 */
export async function fetchFoldersAndNotes(userId: string): Promise<{ folders: Folder[]; notes: Note[] }> {
  if (!isSupabaseConfigured()) {
    return getLocalData(userId);
  }

  const supabase = createClient();

  try {
    const [foldersRes, notesRes] = await Promise.all([
      supabase
        .from('folders')
        .select('*')
        .eq('user_id', userId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);

    // Se as tabelas existirem e responderem sem erro
    if (!foldersRes.error && !notesRes.error) {
      let folders = (foldersRes.data || []) as Folder[];
      let notes = (notesRes.data || []) as Note[];

      // Se o banco estiver completamente vazio para o usuário, inicializa com os dados iniciais elegantes
      if (folders.length === 0 && notes.length === 0) {
        const seedFolders = INITIAL_DEMO_FOLDERS.map((f) => ({
          ...f,
          id: undefined,
          user_id: userId,
        }));
        // Vamos apenas usar os dados locais ou vazios conforme requisito
        return getLocalData(userId);
      }

      saveLocalData(userId, folders, notes);
      return { folders, notes };
    } else {
      console.warn('Tabelas de folders/notes não encontradas ou inacessíveis no Supabase. Utilizando cache local resiliente.', foldersRes.error || notesRes.error);
      return getLocalData(userId);
    }
  } catch (err) {
    console.warn('Erro ao conectar com Supabase folders/notes:', err);
    return getLocalData(userId);
  }
}

/**
 * Cria uma nova pasta no Supabase e no cache local.
 */
export async function createFolder(
  userId: string,
  folderData: { name: string; parentId: string | null; position: number }
): Promise<Folder> {
  const newFolder: Folder = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `folder-${Date.now()}`,
    user_id: userId,
    name: folderData.name || 'Nova pasta',
    parent_id: folderData.parentId,
    position: folderData.position,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('folders')
        .insert({
          id: newFolder.id,
          user_id: userId,
          name: newFolder.name,
          parent_id: newFolder.parent_id,
          position: newFolder.position,
        })
        .select()
        .single();

      if (!error && data) {
        return data as Folder;
      }
    } catch (err) {
      console.warn('Fallback local para criação de pasta:', err);
    }
  }

  // Fallback local
  const current = getLocalData(userId);
  saveLocalData(userId, [...current.folders, newFolder], current.notes);
  return newFolder;
}

/**
 * Renomeia uma pasta no Supabase e no cache local.
 */
export async function renameFolder(userId: string, folderId: string, newName: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('folders')
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq('id', folderId)
        .eq('user_id', userId);

      if (!error) return true;
    } catch (err) {
      console.warn('Fallback local para renomear pasta:', err);
    }
  }

  // Fallback local
  const current = getLocalData(userId);
  const updatedFolders = current.folders.map((f) => (f.id === folderId ? { ...f, name: newName, updated_at: new Date().toISOString() } : f));
  saveLocalData(userId, updatedFolders, current.notes);
  return true;
}

/**
 * Exclui uma pasta no Supabase e no cache local.
 */
export async function deleteFolder(userId: string, folderId: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('folders')
        .delete()
        .eq('id', folderId)
        .eq('user_id', userId);

      if (!error) return true;
    } catch (err) {
      console.warn('Fallback local para exclusão de pasta:', err);
    }
  }

  // Fallback local
  const current = getLocalData(userId);
  const updatedFolders = current.folders.filter((f) => f.id !== folderId && f.parent_id !== folderId);
  const updatedNotes = current.notes.filter((n) => n.folder_id !== folderId);
  saveLocalData(userId, updatedFolders, updatedNotes);
  return true;
}

/**
 * Cria uma nova nota no Supabase e no cache local.
 */
export async function createNote(
  userId: string,
  noteData: { title: string; folderId: string | null; position: number; content?: string }
): Promise<Note> {
  const newNote: Note = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `note-${Date.now()}`,
    user_id: userId,
    folder_id: noteData.folderId,
    title: noteData.title || 'Nova nota',
    content: noteData.content || '',
    position: noteData.position,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('notes')
        .insert({
          id: newNote.id,
          user_id: userId,
          folder_id: newNote.folder_id,
          title: newNote.title,
          content: newNote.content,
          position: newNote.position,
        })
        .select()
        .single();

      if (!error && data) {
        return data as Note;
      }
    } catch (err) {
      console.warn('Fallback local para criação de nota:', err);
    }
  }

  // Fallback local
  const current = getLocalData(userId);
  saveLocalData(userId, current.folders, [...current.notes, newNote]);
  return newNote;
}

/**
 * Atualiza o título de uma nota.
 */
export async function updateNoteTitle(userId: string, noteId: string, newTitle: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('notes')
        .update({ title: newTitle, updated_at: new Date().toISOString() })
        .eq('id', noteId)
        .eq('user_id', userId);

      if (!error) return true;
    } catch (err) {
      console.warn('Fallback local para atualizar título:', err);
    }
  }

  // Fallback local
  const current = getLocalData(userId);
  const updatedNotes = current.notes.map((n) => (n.id === noteId ? { ...n, title: newTitle, updated_at: new Date().toISOString() } : n));
  saveLocalData(userId, current.folders, updatedNotes);
  return true;
}

/**
 * Atualiza o conteúdo de uma nota.
 */
export async function updateNoteContent(userId: string, noteId: string, newContent: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('notes')
        .update({ content: newContent, updated_at: new Date().toISOString() })
        .eq('id', noteId)
        .eq('user_id', userId);

      if (!error) return true;
    } catch (err) {
      console.warn('Fallback local para atualizar conteúdo:', err);
    }
  }

  // Fallback local
  const current = getLocalData(userId);
  const updatedNotes = current.notes.map((n) => (n.id === noteId ? { ...n, content: newContent, updated_at: new Date().toISOString() } : n));
  saveLocalData(userId, current.folders, updatedNotes);
  return true;
}

/**
 * Exclui uma nota.
 */
export async function deleteNote(userId: string, noteId: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('notes')
        .delete()
        .eq('id', noteId)
        .eq('user_id', userId);

      if (!error) return true;
    } catch (err) {
      console.warn('Fallback local para excluir nota:', err);
    }
  }

  // Fallback local
  const current = getLocalData(userId);
  const updatedNotes = current.notes.filter((n) => n.id !== noteId);
  saveLocalData(userId, current.folders, updatedNotes);
  return true;
}

/**
 * Move/reordena pasta ou nota.
 */
export async function moveItem(
  userId: string,
  itemType: 'folder' | 'note',
  itemId: string,
  newParentId: string | null,
  newPosition: number
): Promise<boolean> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      if (itemType === 'folder') {
        const { error } = await supabase
          .from('folders')
          .update({
            parent_id: newParentId,
            position: newPosition,
            updated_at: new Date().toISOString(),
          })
          .eq('id', itemId)
          .eq('user_id', userId);
        if (!error) return true;
      } else {
        const { error } = await supabase
          .from('notes')
          .update({
            folder_id: newParentId,
            position: newPosition,
            updated_at: new Date().toISOString(),
          })
          .eq('id', itemId)
          .eq('user_id', userId);
        if (!error) return true;
      }
    } catch (err) {
      console.warn('Fallback local para mover item:', err);
    }
  }

  // Fallback local
  const current = getLocalData(userId);
  if (itemType === 'folder') {
    const updatedFolders = current.folders.map((f) =>
      f.id === itemId ? { ...f, parent_id: newParentId, position: newPosition, updated_at: new Date().toISOString() } : f
    );
    saveLocalData(userId, updatedFolders, current.notes);
  } else {
    const updatedNotes = current.notes.map((n) =>
      n.id === itemId ? { ...n, folder_id: newParentId, position: newPosition, updated_at: new Date().toISOString() } : n
    );
    saveLocalData(userId, current.folders, updatedNotes);
  }
  return true;
}
