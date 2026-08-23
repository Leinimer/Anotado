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
import { extractHashtagsFromText } from '../utils/hashtag-extractor';

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
 * Sincroniza as tags de uma nota com as tabelas normalizadas public.tags e public.note_tags.
 */
async function syncTagsAndNoteRelations(
  supabase: any,
  userId: string,
  noteId: string,
  cleanTags: string[]
): Promise<void> {
  if (!supabase || !userId || !noteId) return;

  try {
    if (cleanTags.length === 0) {
      // Se não há tags, remove todas as associações dessa nota
      const { error: delErr } = await supabase
        .from('note_tags')
        .delete()
        .eq('note_id', noteId)
        .eq('user_id', userId);
      if (delErr) {
        console.warn('[DB NoteTags] Aviso ao remover note_tags:', delErr.message);
      }
      return;
    }

    // 1. Insere/garante que as tags existam em public.tags para este usuário
    const tagRows = cleanTags.map((name) => ({
      user_id: userId,
      name: name.toLowerCase(),
    }));

    const { error: tagUpsertErr } = await supabase
      .from('tags')
      .upsert(tagRows, { onConflict: 'user_id,name' });

    if (tagUpsertErr) {
      console.warn('[DB Tags] Aviso ao cadastrar catálogo de tags:', tagUpsertErr.message);
    }

    // 2. Busca os IDs das tags normalizadas pertencentes ao usuário
    const { data: userTags, error: fetchTagsErr } = await supabase
      .from('tags')
      .select('id, name')
      .eq('user_id', userId)
      .in(
        'name',
        cleanTags.map((t) => t.toLowerCase())
      );

    if (!fetchTagsErr && userTags && userTags.length > 0) {
      const activeTagIds = new Set(userTags.map((t: any) => t.id));

      // 3. Remove relacionamentos note_tags que não fazem mais parte das tags atuais
      await supabase
        .from('note_tags')
        .delete()
        .eq('note_id', noteId)
        .eq('user_id', userId);

      // 4. Insere os novos relacionamentos em public.note_tags
      const noteTagRecords = Array.from(activeTagIds).map((tagId) => ({
        note_id: noteId,
        tag_id: tagId,
        user_id: userId,
      }));

      const { error: noteTagInsertErr } = await supabase
        .from('note_tags')
        .insert(noteTagRecords);

      if (noteTagInsertErr) {
        console.warn('[DB NoteTags] Aviso ao vincular note_tags:', noteTagInsertErr.message);
      }
    }
  } catch (err) {
    console.warn('[DB Tags Sync] Exceção ao sincronizar tabelas de tags/note_tags:', err);
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

    if (foldersRes.error) {
      console.error('[Supabase DB] Erro ao carregar pastas:', foldersRes.error);
      throw foldersRes.error;
    }
    if (notesRes.error) {
      console.error('[Supabase DB] Erro ao carregar notas:', notesRes.error);
      throw notesRes.error;
    }

    const folders = (foldersRes.data || []) as Folder[];
    const notes = (notesRes.data || []).map((n: any) => {
      let noteTags: string[] = [];
      if (Array.isArray(n.tags)) {
        noteTags = normalizeTags(n.tags);
      } else if (typeof n.tags === 'string') {
        try {
          const parsed = JSON.parse(n.tags);
          noteTags = Array.isArray(parsed) ? normalizeTags(parsed) : [];
        } catch {
          noteTags = normalizeTags(n.tags.split(','));
        }
      }
      // Se a coluna content possuir hashtags (caso já gravado no DB), consolida no índice
      if (n.content && typeof n.content === 'string') {
        const bodyTags = extractHashtagsFromText(n.content);
        if (bodyTags.length > 0) {
          noteTags = normalizeTags([...noteTags, ...bodyTags]);
        }
      }
      return {
        ...n,
        tags: noteTags,
      };
    }) as Note[];

    // Sincroniza cache local e retorna dados reais do usuário autenticado
    saveLocalData(userId, folders, notes);
    return { folders, notes };
  } catch (err) {
    console.error('[Supabase DB] Erro na consulta de pastas/notas:', err);
    return getLocalData(userId);
  }
}

/**
 * Carrega o conteúdo Markdown de uma nota específica a partir do Supabase Storage.
 * Sincroniza as tags contidas no .md com a nota se necessário, retornando o corpo limpo para o editor.
 */
export async function fetchNoteContent(
  userId: string,
  note: Note
): Promise<{ content: string; tags?: string[] }> {
  if (!userId || !note) return { content: '', tags: [] };

  const storageContent = await readNoteMarkdown(userId, note.id);
  if (storageContent !== null) {
    const { tags: extractedTags, body } = parseMarkdownWithTags(storageContent);
    // Se a nota não possuía tags na tabela mas o arquivo .md possuía, retorna para sincronizar
    const noteHasExplicitTags = Array.isArray(note.tags) && note.tags.length > 0;
    const finalTags = noteHasExplicitTags ? note.tags : extractedTags;
    return { content: body, tags: finalTags };
  }

  // Se não foi encontrado no Storage, utiliza o conteúdo existente e sincroniza com o Storage
  const initialContent = note.content || '';
  const noteTags = Array.isArray(note.tags) ? note.tags : [];
  const fullMarkdown = serializeMarkdownWithTags(initialContent, noteTags);
  await writeNoteMarkdown(userId, note.id, fullMarkdown);

  return { content: initialContent, tags: noteTags };
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

    if (error) {
      console.error('[Supabase DB] Erro ao criar pasta:', error);
      throw error;
    }

    if (data) {
      const current = getLocalData(userId);
      saveLocalData(userId, [...current.folders.filter(f => f.id !== newFolder.id), data as Folder], current.notes);
      return data as Folder;
    }
  }

  // Fallback local caso Supabase não esteja configurado
  const current = getLocalData(userId);
  saveLocalData(userId, [...current.folders, newFolder], current.notes);
  return newFolder;
}

/**
 * Renomeia uma pasta no Supabase e no cache local.
 */
export async function renameFolder(userId: string, folderId: string, newName: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { error } = await supabase
      .from('folders')
      .update({ name: newName, updated_at: new Date().toISOString() })
      .eq('id', folderId)
      .eq('user_id', userId);

    if (error) {
      console.error('[Supabase DB] Erro ao renomear pasta:', error);
      throw error;
    }
  }

  // Atualização no cache local
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
    const supabase = createClient();
    const { error } = await supabase
      .from('folders')
      .update({ color: color, updated_at: new Date().toISOString() })
      .eq('id', folderId)
      .eq('user_id', userId);

    if (error) {
      console.error('[Supabase DB] Erro ao atualizar cor da pasta:', error);
      throw error;
    }
  }

  // Atualização no cache local
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

    if (error) {
      console.error('[Supabase DB] Erro ao atualizar configuração inteligente da pasta:', error);
      throw error;
    }
  }

  // Atualização no cache local
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
    const supabase = createClient();
    const { error } = await supabase
      .from('folders')
      .delete()
      .eq('id', folderId)
      .eq('user_id', userId);

    if (error) {
      console.error('[Supabase DB] Erro ao excluir pasta:', error);
      throw error;
    }
  }

  // Atualização no cache local
  const current = getLocalData(userId);
  const updatedFolders = current.folders.filter((f) => f.id !== folderId && f.parent_id !== folderId);
  const updatedNotes = current.notes.filter((n) => n.folder_id !== folderId);
  saveLocalData(userId, updatedFolders, updatedNotes);
  return true;
}

/**
 * Cria uma nova nota no Supabase Storage (como arquivo .md) e grava metadados na tabela notes.
 * Confirma o registro através do Supabase antes de retornar.
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

  // 1. Grava o arquivo Markdown individual no Supabase Storage com as tags
  const fullMarkdown = serializeMarkdownWithTags(initialContent, initialTags);
  const storageSuccess = await writeNoteMarkdown(userId, noteId, fullMarkdown);
  if (!storageSuccess) {
    console.error('[Storage] Falha ao gravar arquivo .md inicial da nota no bucket');
  }

  // 2. Grava os metadados na tabela notes
  if (isSupabaseConfigured()) {
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

    if (error) {
      console.error('[Supabase DB] Erro fatal ao inserir nota em public.notes:', error);
      throw error;
    }

    if (data) {
      // Sincroniza tabelas tags e note_tags se existirem tags
      if (initialTags.length > 0) {
        await syncTagsAndNoteRelations(supabase, userId, noteId, initialTags);
      }

      const confirmedNote: Note = {
        ...(data as Note),
        content: initialContent,
        tags: Array.isArray((data as any).tags) ? normalizeTags((data as any).tags) : initialTags,
      };

      const current = getLocalData(userId);
      saveLocalData(userId, current.folders, [...current.notes.filter(n => n.id !== noteId), confirmedNote]);
      return confirmedNote;
    }
  }

  // Fallback local se Supabase não estiver configurado
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

    if (error) {
      console.error('[Supabase DB] Erro ao arquivar nota:', error);
      throw error;
    }
  }

  // Atualização no cache local
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

    if (error) {
      console.error('[Supabase DB] Erro ao desarquivar nota:', error);
      throw error;
    }
  }

  // Atualização no cache local
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
    const supabase = createClient();
    // Tenta executar via RPC atômica
    const { error: rpcError } = await supabase.rpc('archive_folder_notes', {
      p_folder_id: folderId,
      p_user_id: userId,
    });

    if (rpcError) {
      // Fallback para update in direto
      const idArray = Array.from(folderIdsToArchive);
      const { error: batchErr } = await supabase
        .from('notes')
        .update({
          is_archived: true,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .in('folder_id', idArray);

      if (batchErr) {
        console.error('[Supabase DB] Erro ao arquivar notas em lote:', batchErr);
        throw batchErr;
      }
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
    const supabase = createClient();
    const { error } = await supabase
      .from('notes')
      .update({ title: newTitle, updated_at: new Date().toISOString() })
      .eq('id', noteId)
      .eq('user_id', userId);

    if (error) {
      console.error('[Supabase DB] Erro ao atualizar título da nota:', error);
      throw error;
    }
  }

  // Atualização no cache local
  const current = getLocalData(userId);
  const updatedNotes = current.notes.map((n) =>
    n.id === noteId ? { ...n, title: newTitle, updated_at: new Date().toISOString() } : n
  );
  saveLocalData(userId, current.folders, updatedNotes);
  return true;
}

/**
 * Atualiza o conteúdo de uma nota diretamente como arquivo Markdown (.md) no Supabase Storage.
 * Preserva as tags associadas à nota no cabeçalho do arquivo Markdown e sincroniza com o banco.
 */
export async function updateNoteContent(
  userId: string,
  noteId: string,
  newMarkdownContent: string,
  currentTags?: string[]
): Promise<{ success: boolean; tags: string[] }> {
  // 1. Extrai hashtags do corpo e combina com as tags explícitas existentes
  let baseTags = currentTags;
  if (!baseTags) {
    const current = getLocalData(userId);
    const existing = current.notes.find((n) => n.id === noteId);
    baseTags = existing?.tags || [];
  }
  const bodyHashtags = extractHashtagsFromText(newMarkdownContent);
  const combinedTags = normalizeTags([...(baseTags || []), ...bodyHashtags]);

  const fullMarkdown = serializeMarkdownWithTags(newMarkdownContent, combinedTags);

  // 2. Grava no Supabase Storage
  const storageSuccess = await writeNoteMarkdown(userId, noteId, fullMarkdown);

  // 3. Atualiza timestamp, conteúdo e coluna tags na tabela notes
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from('notes')
      .update({
        content: newMarkdownContent,
        tags: combinedTags,
        updated_at: new Date().toISOString(),
      })
      .eq('id', noteId)
      .eq('user_id', userId);

    if (updateErr) {
      console.error('[Supabase DB] Erro ao atualizar conteúdo da nota:', updateErr);
      throw updateErr;
    }

    // Sincroniza tabelas tags e note_tags
    await syncTagsAndNoteRelations(supabase, userId, noteId, combinedTags);
  }

  // Atualização no cache local
  const current = getLocalData(userId);
  const updatedNotes = current.notes.map((n) =>
    n.id === noteId ? { ...n, content: newMarkdownContent, tags: combinedTags, updated_at: new Date().toISOString() } : n
  );
  saveLocalData(userId, current.folders, updatedNotes);

  return { success: storageSuccess, tags: combinedTags };
}

/**
 * Exclui uma nota da tabela e remove o arquivo .md correspondente do Supabase Storage.
 */
export async function deleteNote(userId: string, noteId: string): Promise<boolean> {
  // 1. Remove o arquivo Markdown do Supabase Storage
  await deleteNoteMarkdown(userId, noteId);

  // 2. Remove da tabela notes
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', noteId)
      .eq('user_id', userId);

    if (error) {
      console.error('[Supabase DB] Erro ao excluir nota:', error);
      throw error;
    }
  }

  // Atualização no cache local
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

      if (error) {
        console.error('[Supabase DB] Erro ao mover pasta:', error);
        throw error;
      }
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

      if (error) {
        console.error('[Supabase DB] Erro ao mover nota:', error);
        throw error;
      }
    }
  }

  // Atualização no cache local
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
 * Atualiza o conjunto de tags explícitas de uma nota nos metadados do Supabase,
 * no arquivo .md no Supabase Storage e nas tabelas normalizadas tags e note_tags.
 */
export async function updateNoteTags(
  userId: string,
  noteId: string,
  rawTags: string[],
  currentBodyContent?: string
): Promise<{ success: boolean; tags: string[] }> {
  const cleanTags = normalizeTags(rawTags);

  // 1. Determina o corpo da nota para sincronizar o arquivo .md no Storage
  let bodyContent = currentBodyContent;
  if (bodyContent === undefined) {
    const current = getLocalData(userId);
    const existing = current.notes.find((n) => n.id === noteId);
    bodyContent = existing?.content || '';
  }

  // 2. Grava o arquivo Markdown atualizado com a linha de tags no Supabase Storage
  const fullMarkdown = serializeMarkdownWithTags(bodyContent, cleanTags);
  await writeNoteMarkdown(userId, noteId, fullMarkdown);

  // 3. Atualiza os metadados no Supabase DB
  if (isSupabaseConfigured()) {
    const supabase = createClient();

    // Atualiza a coluna tags na tabela notes
    const { error: noteUpdateError } = await supabase
      .from('notes')
      .update({
        tags: cleanTags,
        updated_at: new Date().toISOString(),
      })
      .eq('id', noteId)
      .eq('user_id', userId);

    if (noteUpdateError) {
      console.error('[Supabase DB] Erro ao atualizar tags da nota:', noteUpdateError);
      throw noteUpdateError;
    }

    // Sincroniza tabelas normalizadas tags e note_tags
    await syncTagsAndNoteRelations(supabase, userId, noteId, cleanTags);
  }

  // 4. Atualização no cache local
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

/**
 * Consulta de alta performance para obter todas as tags únicas pertencentes ao usuário autenticado.
 * Executa uma única query otimizada na coluna tags da tabela public.notes, com deduplicação e normalização.
 */
export async function fetchUserTags(userId: string): Promise<string[]> {
  if (!userId) return [];

  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('notes')
        .select('tags')
        .eq('user_id', userId);

      if (!error && data) {
        const tagMap = new Map<string, string>();
        for (const row of data) {
          if (Array.isArray(row.tags)) {
            for (const rawTag of row.tags) {
              const clean = (rawTag || '').replace(/^#+/, '').trim();
              if (clean) {
                const lower = clean.toLowerCase();
                if (!tagMap.has(lower)) {
                  tagMap.set(lower, `#${clean}`);
                }
              }
            }
          }
        }
        return Array.from(tagMap.values()).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
      }
    } catch (err) {
      console.warn('Fallback local para busca de tags:', err);
    }
  }

  const { notes } = getLocalData(userId);
  const tagMap = new Map<string, string>();
  for (const n of notes) {
    if (Array.isArray(n.tags)) {
      for (const rawTag of n.tags) {
        const clean = (rawTag || '').replace(/^#+/, '').trim();
        if (clean) {
          const lower = clean.toLowerCase();
          if (!tagMap.has(lower)) {
            tagMap.set(lower, `#${clean}`);
          }
        }
      }
    }
  }
  return Array.from(tagMap.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

