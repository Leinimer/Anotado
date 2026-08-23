import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { Folder, Note } from '../types';
import {
  readNoteMarkdown,
  writeNoteMarkdown,
  deleteNoteMarkdown,
} from './notes-storage-api';
import {
  parseMarkdownWithTags,
  serializeMarkdownWithTags,
} from '../utils/markdown-tags';

const LOCAL_STORAGE_KEY_FOLDERS = 'anotado_local_folders';
const LOCAL_STORAGE_KEY_NOTES = 'anotado_local_notes';

// Seed inicial elegante para demonstração e novos usuários
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
    tags: ['estudo', 'nota'],
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

- [ ] First item to consider in this thought process.
- [ ] Second item, building upon the previous idea.

1. Main point number one.
2. Main point number two, containing sub-points:
   - Detail expanding on point two.
   - Another supporting detail for context.

- Final thought bullet point.
- Conclusion remark.
- Closing statement.

#Nota #Estudo #Livro`,
    tags: ['nota', 'estudo', 'livro'],
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
 * Busca todas as pastas e metadados de notas do usuário autenticado no Supabase.
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
      const folders = (foldersRes.data || []) as Folder[];
      const notes = (notesRes.data || []) as Note[];

      if (folders.length === 0 && notes.length === 0) {
        return getLocalData(userId);
      }

      saveLocalData(userId, folders, notes);
      return { folders, notes };
    } else {
      console.warn(
        'Tabelas de folders/notes não encontradas no Supabase. Utilizando cache local resiliente.',
        foldersRes.error || notesRes.error
      );
      return getLocalData(userId);
    }
  } catch (err) {
    console.warn('Erro ao conectar com Supabase folders/notes:', err);
    return getLocalData(userId);
  }
}

/**
 * Carrega o conteúdo Markdown de uma nota específica a partir do Supabase Storage.
 * Caso o arquivo ainda não exista no Storage mas esteja na tabela (migração), grava no Storage.
 */
export async function fetchNoteContent(userId: string, note: Note): Promise<string> {
  if (!userId || !note) return '';

  const storageContent = await readNoteMarkdown(userId, note.id);
  if (storageContent !== null) {
    return storageContent;
  }

  // Se não foi encontrado no Storage, utiliza o conteúdo existente e sincroniza com o Storage
  const initialContent = note.content || '';
  if (initialContent) {
    await writeNoteMarkdown(userId, note.id, initialContent);
  }

  return initialContent;
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
  const updatedFolders = current.folders.map((f) =>
    f.id === folderId ? { ...f, name: newName, updated_at: new Date().toISOString() } : f
  );
  saveLocalData(userId, updatedFolders, current.notes);
  return true;
}

/**
 * Atualiza a cor visual de uma pasta no Supabase e no cache local.
 */
export async function updateFolderColor(
  userId: string,
  folderId: string,
  color: string | null
): Promise<boolean> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('folders')
        .update({ color: color, updated_at: new Date().toISOString() })
        .eq('id', folderId)
        .eq('user_id', userId);

      if (!error) return true;
    } catch (err) {
      console.warn('Fallback local para atualizar cor da pasta:', err);
    }
  }

  // Fallback local
  const current = getLocalData(userId);
  const updatedFolders = current.folders.map((f) =>
    f.id === folderId ? { ...f, color: color, updated_at: new Date().toISOString() } : f
  );
  saveLocalData(userId, updatedFolders, current.notes);
  return true;
}

/**
 * Atualiza a configuração de Pasta Inteligente (tags dinâmicas) no Supabase e no cache local.
 */
export async function updateFolderSmartConfig(
  userId: string,
  folderId: string,
  isSmart: boolean,
  smartTags: string[]
): Promise<boolean> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('folders')
        .update({
          is_smart: isSmart,
          smart_tags: smartTags,
          updated_at: new Date().toISOString(),
        })
        .eq('id', folderId)
        .eq('user_id', userId);

      if (!error) return true;
    } catch (err) {
      console.warn('Fallback local para atualizar configuração de pasta inteligente:', err);
    }
  }

  // Fallback local
  const current = getLocalData(userId);
  const updatedFolders = current.folders.map((f) =>
    f.id === folderId
      ? {
          ...f,
          is_smart: isSmart,
          smart_tags: smartTags,
          updated_at: new Date().toISOString(),
        }
      : f
  );
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
 * Cria uma nova nota no Supabase Storage (como arquivo .md) e grava metadados na tabela notes.
 */
export async function createNote(
  userId: string,
  noteData: { title: string; folderId: string | null; position: number; content?: string; tags?: string[] }
): Promise<Note> {
  const noteId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `note-${Date.now()}`;
  const initialContent = noteData.content ?? '';
  const initialTags = normalizeTags(noteData.tags || []);

  const newNote: Note = {
    id: noteId,
    user_id: userId,
    folder_id: noteData.folderId,
    title: noteData.title || 'Nova nota',
    content: initialContent,
    position: noteData.position,
    tags: initialTags,
    is_archived: false,
    previous_folder_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // 1. Grava o arquivo Markdown individual no Supabase Storage
  await writeNoteMarkdown(userId, noteId, initialContent);

  // 2. Grava os metadados na tabela notes
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
          tags: newNote.tags,
          is_archived: false,
          previous_folder_id: null,
        })
        .select()
        .single();

      if (!error && data) {
        return { ...(data as Note), content: initialContent, tags: (data as any).tags || initialTags };
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
 * Arquiva uma nota individual:
 * Salva previous_folder_id com o folder_id atual, define is_archived = true e folder_id = null.
 * O arquivo Markdown no Storage permanece intacto com o mesmo note_id.
 */
export async function archiveNote(userId: string, noteId: string): Promise<boolean> {
  const current = getLocalData(userId);
  const targetNote = current.notes.find((n) => n.id === noteId);
  const previousFolderId = targetNote ? targetNote.folder_id : null;

  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('notes')
        .update({
          is_archived: true,
          previous_folder_id: previousFolderId,
          folder_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', noteId)
        .eq('user_id', userId);

      if (!error) {
        const updatedNotes = current.notes.map((n) =>
          n.id === noteId
            ? {
                ...n,
                is_archived: true,
                previous_folder_id: n.folder_id,
                folder_id: null,
                updated_at: new Date().toISOString(),
              }
            : n
        );
        saveLocalData(userId, current.folders, updatedNotes);
        return true;
      }
    } catch (err) {
      console.warn('Fallback local para arquivar nota:', err);
    }
  }

  // Fallback local
  const updatedNotes = current.notes.map((n) =>
    n.id === noteId
      ? {
          ...n,
          is_archived: true,
          previous_folder_id: n.folder_id,
          folder_id: null,
          updated_at: new Date().toISOString(),
        }
      : n
  );
  saveLocalData(userId, current.folders, updatedNotes);
  return true;
}

/**
 * Desarquiva uma nota individual:
 * Restaura para previous_folder_id se a pasta ainda existir na lista de pastas do usuário;
 * caso contrário, restaura para a raiz (folder_id = null).
 */
export async function unarchiveNote(
  userId: string,
  noteId: string,
  existingFolders: Folder[]
): Promise<boolean> {
  const current = getLocalData(userId);
  const targetNote = current.notes.find((n) => n.id === noteId);
  const previousFolderId = targetNote?.previous_folder_id ?? null;

  // Verifica se a pasta anterior ainda existe
  const folderStillExists = previousFolderId
    ? existingFolders.some((f) => f.id === previousFolderId)
    : false;
  const destinationFolderId = folderStillExists ? previousFolderId : null;

  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('notes')
        .update({
          is_archived: false,
          folder_id: destinationFolderId,
          previous_folder_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', noteId)
        .eq('user_id', userId);

      if (!error) {
        const updatedNotes = current.notes.map((n) =>
          n.id === noteId
            ? {
                ...n,
                is_archived: false,
                folder_id: destinationFolderId,
                previous_folder_id: null,
                updated_at: new Date().toISOString(),
              }
            : n
        );
        saveLocalData(userId, current.folders, updatedNotes);
        return true;
      }
    } catch (err) {
      console.warn('Fallback local para desarquivar nota:', err);
    }
  }

  // Fallback local
  const updatedNotes = current.notes.map((n) =>
    n.id === noteId
      ? {
          ...n,
          is_archived: false,
          folder_id: destinationFolderId,
          previous_folder_id: null,
          updated_at: new Date().toISOString(),
        }
      : n
  );
  saveLocalData(userId, current.folders, updatedNotes);
  return true;
}

/**
 * Arquiva todas as notas contidas em uma pasta e em todas as suas subpastas recursivamente.
 */
export async function archiveFolderNotes(
  userId: string,
  folderId: string,
  allFolders: Folder[]
): Promise<boolean> {
  // Coleta IDs da pasta e de todas as suas subpastas recursivamente
  const folderIdsToArchive = new Set<string>([folderId]);
  let added = true;
  while (added) {
    added = false;
    for (const folder of allFolders) {
      if (folder.parent_id && folderIdsToArchive.has(folder.parent_id) && !folderIdsToArchive.has(folder.id)) {
        folderIdsToArchive.add(folder.id);
        added = true;
      }
    }
  }

  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      // Tenta executar via RPC atômica
      const { error: rpcError } = await supabase.rpc('archive_folder_notes', {
        p_folder_id: folderId,
        p_user_id: userId,
      });

      if (rpcError) {
        // Fallback para update in
        const idArray = Array.from(folderIdsToArchive);
        await supabase
          .from('notes')
          .update({
            is_archived: true,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .in('folder_id', idArray);
      }
    } catch (err) {
      console.warn('Exceção ao arquivar notas da pasta no Supabase:', err);
    }
  }

  // Atualiza cache local
  const current = getLocalData(userId);
  const updatedNotes = current.notes.map((n) => {
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
  });
  saveLocalData(userId, current.folders, updatedNotes);
  return true;
}


/**
 * Atualiza o título de uma nota nos metadados.
 * O arquivo no Storage permanece com seu ID estável ({note_id}.md).
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
  const updatedNotes = current.notes.map((n) =>
    n.id === noteId ? { ...n, title: newTitle, updated_at: new Date().toISOString() } : n
  );
  saveLocalData(userId, current.folders, updatedNotes);
  return true;
}

/**
 * Atualiza o conteúdo de uma nota diretamente como arquivo Markdown (.md) no Supabase Storage.
 */
export async function updateNoteContent(
  userId: string,
  noteId: string,
  newMarkdownContent: string
): Promise<boolean> {
  // 1. Grava no Supabase Storage
  const storageSuccess = await writeNoteMarkdown(userId, noteId, newMarkdownContent);

  // 2. Atualiza timestamp e metadados na tabela
  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      await supabase
        .from('notes')
        .update({
          content: newMarkdownContent,
          updated_at: new Date().toISOString(),
        })
        .eq('id', noteId)
        .eq('user_id', userId);
    } catch (err) {
      console.warn('Erro ao atualizar timestamp da nota no banco:', err);
    }
  }

  // Fallback local
  const current = getLocalData(userId);
  const updatedNotes = current.notes.map((n) =>
    n.id === noteId ? { ...n, content: newMarkdownContent, updated_at: new Date().toISOString() } : n
  );
  saveLocalData(userId, current.folders, updatedNotes);

  return storageSuccess;
}

/**
 * Exclui uma nota da tabela e remove o arquivo .md correspondente do Supabase Storage.
 */
export async function deleteNote(userId: string, noteId: string): Promise<boolean> {
  // 1. Remove o arquivo Markdown do Supabase Storage
  await deleteNoteMarkdown(userId, noteId);

  // 2. Remove da tabela notes
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
 * O arquivo no Storage permanece inalterado.
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

/**
 * Normaliza um array de tags:
 * - Remove espaços e caracteres de controle
 * - Remove o símbolo '#' inicial para armazenamento consistente
 * - Remove entradas vazias
 * - Remove duplicatas ignorando maiúsculas/minúsculas
 */
export function normalizeTags(rawTags: string[]): string[] {
  if (!Array.isArray(rawTags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of rawTags) {
    if (!raw || typeof raw !== 'string') continue;
    const clean = raw.trim().replace(/\s+/g, '').replace(/^#+/, '');
    if (!clean) continue;
    const lower = clean.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(clean);
    }
  }

  return result;
}

/**
 * Atualiza o conjunto de tags explícitas de uma nota nos metadados do Supabase e no cache local.
 * Sincroniza com as buscas e árvore de pastas inteligentes.
 */
export async function updateNoteTags(
  userId: string,
  noteId: string,
  rawTags: string[]
): Promise<{ success: boolean; tags: string[] }> {
  const cleanTags = normalizeTags(rawTags);

  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();

      // 1. Atualiza a coluna tags na tabela notes
      const { error: noteUpdateError } = await supabase
        .from('notes')
        .update({
          tags: cleanTags,
          updated_at: new Date().toISOString(),
        })
        .eq('id', noteId)
        .eq('user_id', userId);

      if (!noteUpdateError) {
        // 2. Sincronização com tabela de tags se configurada
        try {
          for (const tagName of cleanTags) {
            await supabase
              .from('tags')
              .upsert(
                { user_id: userId, name: tagName.toLowerCase() },
                { onConflict: 'user_id,name' }
              );
          }
        } catch {
          // Ignora silenciosamente se tabelas normalizadas adicionais não estiverem criadas
        }
      }
    } catch (err) {
      console.warn('Fallback local para atualização de tags da nota:', err);
    }
  }

  // Fallback e atualização no cache local
  const current = getLocalData(userId);
  const updatedNotes = current.notes.map((n) =>
    n.id === noteId
      ? {
          ...n,
          tags: cleanTags,
          updated_at: new Date().toISOString(),
        }
      : n
  );
  saveLocalData(userId, current.folders, updatedNotes);

  return { success: true, tags: cleanTags };
}

