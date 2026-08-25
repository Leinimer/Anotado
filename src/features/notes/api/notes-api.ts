import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { Folder, Note } from '../types';
import {
  readNoteMarkdown,
  writeNoteMarkdown,
  deleteNoteMarkdown,
} from './notes-storage-api';
import { saveQueue } from './save-queue';
import {
  parseMarkdownWithTags,
  serializeMarkdownWithTags,
} from '../utils/markdown-tags';
import { extractHashtagsFromText, normalizeTags } from '../utils/hashtag-extractor';
import { generateUUID } from '../utils/uuid';
import { indexedDBStorage, ExtendedFolder, ExtendedNote } from '../db/indexed-db';
import { networkMonitor } from './network-monitor';
import { syncEngine } from './sync-engine';

export { normalizeTags };

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

/**
 * Inicializa o IndexedDB com seed inicial se for a primeira abertura do usuário.
 */
async function initializeLocalSeedIfNeeded(userId: string): Promise<{ folders: Folder[]; notes: Note[] }> {
  const seedFolders: ExtendedFolder[] = INITIAL_DEMO_FOLDERS.map((f) => ({
    ...f,
    user_id: userId,
    sync_status: 'synced',
  }));

  const seedNotes: ExtendedNote[] = INITIAL_DEMO_NOTES.map((n) => ({
    ...n,
    user_id: userId,
    sync_status: 'synced',
    revision: 1,
  }));

  await indexedDBStorage.putFoldersBatch(userId, seedFolders);
  await indexedDBStorage.putNotesBatch(userId, seedNotes);

  return { folders: seedFolders, notes: seedNotes };
}

/**
 * Sincroniza as tags de uma nota com as tabelas normalizadas public.tags e public.note_tags no Supabase.
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
      await supabase
        .from('note_tags')
        .delete()
        .eq('note_id', noteId)
        .eq('user_id', userId);
      return;
    }

    const tagRows = cleanTags.map((name) => ({
      user_id: userId,
      name: name.toLowerCase(),
    }));

    await supabase
      .from('tags')
      .upsert(tagRows, { onConflict: 'user_id,name' });

    const { data: userTags } = await supabase
      .from('tags')
      .select('id, name')
      .eq('user_id', userId)
      .in('name', cleanTags.map((t) => t.toLowerCase()));

    if (userTags && userTags.length > 0) {
      const activeTagIds = new Set(userTags.map((t: any) => t.id));
      await supabase
        .from('note_tags')
        .delete()
        .eq('note_id', noteId)
        .eq('user_id', userId);

      const noteTagRecords = Array.from(activeTagIds).map((tagId) => ({
        note_id: noteId,
        tag_id: tagId,
        user_id: userId,
      }));

      await supabase
        .from('note_tags')
        .insert(noteTagRecords);
    }
  } catch (err) {
    console.warn('[DB Tags Sync] Exceção ao sincronizar tabelas de tags/note_tags:', err);
  }
}

/**
 * Busca todas as pastas e notas:
 * 1. Lê instantaneamente do IndexedDB (latência < 5ms).
 * 2. Se o usuário estiver online, sincroniza de forma transparente e não-bloqueante com o Supabase.
 */
export async function fetchFoldersAndNotes(
  userId: string
): Promise<{ folders: Folder[]; notes: Note[] }> {
  syncEngine.setActiveUser(userId);

  // 1. Leitura imediata do IndexedDB
  try {
    const localFolders = await indexedDBStorage.getAllFolders(userId);
    const localNotes = await indexedDBStorage.getAllNotes(userId);

    if (localFolders.length > 0 || localNotes.length > 0) {
      // Dispara sync incremental em background se online
      if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
        syncEngine.scheduleSync(500);
      }
      return {
        folders: localFolders.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
        notes: localNotes.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      };
    }
  } catch (idbErr) {
    console.warn('[NotesAPI] Aviso ao ler do IndexedDB:', idbErr);
  }

  // 2. Se o IndexedDB está vazio e estamos online com o Supabase, carrega do servidor e popula o IndexedDB
  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    try {
      const supabase = createClient();
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

      if (!foldersRes.error && !notesRes.error) {
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
          return {
            ...n,
            tags: noteTags,
            sync_status: 'synced',
          };
        }) as Note[];

        if (folders.length > 0 || notes.length > 0) {
          // Salva no IndexedDB
          await indexedDBStorage.putFoldersBatch(userId, folders as ExtendedFolder[]);
          await indexedDBStorage.putNotesBatch(userId, notes as ExtendedNote[]);
          return { folders, notes };
        }
      }
    } catch (err) {
      console.warn('[NotesAPI] Falha ao carregar do Supabase:', err);
    }
  }

  // 3. Se for usuário novo ou sem registros, popula com o seed inicial
  return initializeLocalSeedIfNeeded(userId);
}

/**
 * Carrega o conteúdo Markdown de uma nota específica a partir do IndexedDB ou do Supabase Storage.
 */
export async function fetchNoteContent(
  userId: string,
  note: Note
): Promise<{ content: string; tags?: string[] }> {
  if (!userId || !note) return { content: '', tags: [] };

  // 1. Consulta IndexedDB
  let localNoteContent: string | null = null;
  let localTags: string[] | null = null;
  try {
    const localNote = await indexedDBStorage.getNoteById(userId, note.id);
    if (localNote) {
      localTags = Array.isArray(localNote.tags) ? localNote.tags : null;
      if (localNote.content !== undefined && localNote.content !== null) {
        localNoteContent = localNote.content;
      }
    }
  } catch (err) {
    console.warn('[NotesAPI] Erro ao buscar nota no IndexedDB:', err);
  }

  // Se temos conteúdo local robusto (não-vazio), retorna de imediato
  if (localNoteContent !== null && localNoteContent.trim() !== '') {
    const noteTags = localTags || (Array.isArray(note.tags) ? note.tags : []);
    return { content: localNoteContent, tags: noteTags };
  }

  // 2. Se o conteúdo local for vazio ou ausente, e estivermos online, busca a versão canônica completa do Supabase Storage (.md)
  const isOnline = networkMonitor.getState().isBackendReachable;
  if (isOnline && isSupabaseConfigured()) {
    try {
      const storageContent = await readNoteMarkdown(userId, note.id);
      if (storageContent !== null && storageContent.trim() !== '') {
        const { tags: extractedTags, body } = parseMarkdownWithTags(storageContent);
        const noteHasExplicitTags = Array.isArray(note.tags) && note.tags.length > 0;
        const finalTags = noteHasExplicitTags ? note.tags : extractedTags;

        // Atualiza IndexedDB local com o documento canônico completo
        try {
          await indexedDBStorage.putNote(userId, {
            ...note,
            content: body,
            tags: finalTags,
            sync_status: 'synced',
          });
        } catch {}

        return { content: body, tags: finalTags };
      }
    } catch (storageErr) {
      console.warn('[NotesAPI] Erro ao buscar .md no Storage:', storageErr);
    }
  }

  // 3. Fallback para o conteúdo existente local ou da nota
  const fallbackContent = localNoteContent !== null ? localNoteContent : (note.content || '');
  const fallbackTags = localTags || (Array.isArray(note.tags) ? note.tags : []);
  return { content: fallbackContent, tags: fallbackTags };
}

/**
 * Cria uma nova pasta no IndexedDB e enfileira para sincronização no Supabase.
 */
export async function createFolder(
  userId: string,
  folderData: { name: string; parentId: string | null; position: number }
): Promise<Folder> {
  const folderId = generateUUID();
  const newFolder: ExtendedFolder = {
    id: folderId,
    user_id: userId,
    name: folderData.name || 'Nova pasta',
    parent_id: folderData.parentId,
    position: folderData.position,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sync_status: 'pending_sync',
  };

  // 1. Grava no IndexedDB imediatamente
  await indexedDBStorage.putFolder(userId, newFolder);

  // 2. Enfileira na SyncQueue
  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'CREATE_FOLDER',
    entity_type: 'folder',
    entity_id: folderId,
    payload: newFolder,
    revision: 1,
  });

  const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
  networkMonitor.updatePendingCount(pendingCount);

  // 3. Se online, tenta sincronizar imediatamente
  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    syncEngine.scheduleSync(100);
  }

  return newFolder;
}

/**
 * Renomeia uma pasta no IndexedDB e enfileira para sincronização.
 */
export async function renameFolder(userId: string, folderId: string, newName: string): Promise<boolean> {
  // 1. Atualiza no IndexedDB
  const localFolder = await indexedDBStorage.getFolderById(userId, folderId);
  if (localFolder) {
    localFolder.name = newName;
    localFolder.updated_at = new Date().toISOString();
    localFolder.sync_status = 'pending_sync';
    await indexedDBStorage.putFolder(userId, localFolder);
  }

  // 2. Enfileira na SyncQueue
  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'UPDATE_FOLDER',
    entity_type: 'folder',
    entity_id: folderId,
    payload: { folderId, updates: { name: newName } },
    revision: 1,
  });

  const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
  networkMonitor.updatePendingCount(pendingCount);

  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    syncEngine.scheduleSync(100);
  }

  return true;
}

/**
 * Atualiza a cor visual de uma pasta no IndexedDB e enfileira para sincronização.
 */
export async function updateFolderColor(
  userId: string,
  folderId: string,
  color: string | null
): Promise<boolean> {
  const localFolder = await indexedDBStorage.getFolderById(userId, folderId);
  if (localFolder) {
    localFolder.color = color;
    localFolder.updated_at = new Date().toISOString();
    localFolder.sync_status = 'pending_sync';
    await indexedDBStorage.putFolder(userId, localFolder);
  }

  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'UPDATE_FOLDER',
    entity_type: 'folder',
    entity_id: folderId,
    payload: { folderId, updates: { color } },
    revision: 1,
  });

  const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
  networkMonitor.updatePendingCount(pendingCount);

  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    syncEngine.scheduleSync(100);
  }

  return true;
}

/**
 * Atualiza a configuração de Pasta Inteligente no IndexedDB e enfileira para sincronização.
 */
export async function updateFolderSmartConfig(
  userId: string,
  folderId: string,
  isSmart: boolean,
  smartTags: string[]
): Promise<boolean> {
  const localFolder = await indexedDBStorage.getFolderById(userId, folderId);
  if (localFolder) {
    localFolder.is_smart = isSmart;
    localFolder.smart_tags = smartTags;
    localFolder.updated_at = new Date().toISOString();
    localFolder.sync_status = 'pending_sync';
    await indexedDBStorage.putFolder(userId, localFolder);
  }

  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'UPDATE_FOLDER',
    entity_type: 'folder',
    entity_id: folderId,
    payload: { folderId, updates: { is_smart: isSmart, smart_tags: smartTags } },
    revision: 1,
  });

  const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
  networkMonitor.updatePendingCount(pendingCount);

  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    syncEngine.scheduleSync(100);
  }

  return true;
}

/**
 * Exclui uma pasta no IndexedDB e enfileira para exclusão no Supabase.
 */
export async function deleteFolder(userId: string, folderId: string): Promise<boolean> {
  // 1. Remove do IndexedDB
  await indexedDBStorage.deleteFolder(userId, folderId);

  // 2. Enfileira na SyncQueue
  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'DELETE_FOLDER',
    entity_type: 'folder',
    entity_id: folderId,
    payload: { folderId },
    revision: 1,
  });

  const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
  networkMonitor.updatePendingCount(pendingCount);

  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    syncEngine.scheduleSync(100);
  }

  return true;
}

/**
 * Cria uma nova nota com ID estável no IndexedDB e enfileira para o Supabase.
 */
export async function createNote(
  userId: string,
  noteData: { title: string; folderId: string | null; position: number; content?: string; tags?: string[] }
): Promise<Note> {
  const noteId = generateUUID();
  const initialContent = noteData.content ?? '';
  const initialTags = normalizeTags(noteData.tags || []);

  const newNote: ExtendedNote = {
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
    sync_status: 'pending_sync',
    revision: 1,
  };

  console.log('[OfflineCreate] NOTE CREATED');
  console.log(`[OfflineCreate] NOTE ID: ${noteId}`);
  console.log(`[OfflineCreate] USER ID: ${userId}`);

  // 1. Salva no IndexedDB
  await indexedDBStorage.putNote(userId, newNote);
  console.log(`[OfflineCreate] INDEXEDDB SAVED: ${noteId}`);

  // 2. Enfileira na SyncQueue
  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'CREATE_NOTE',
    entity_type: 'note',
    entity_id: noteId,
    payload: newNote,
    revision: 1,
  });
  console.log(`[OfflineCreate] SYNC QUEUE INSERTED: ${noteId}`);

  const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
  networkMonitor.updatePendingCount(pendingCount);

  // 3. Se online, dispara sincronização
  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    syncEngine.scheduleSync(100);
  }

  return newNote;
}

/**
 * Arquiva uma nota individual no IndexedDB e enfileira para sincronização.
 */
export async function archiveNote(userId: string, noteId: string): Promise<boolean> {
  const targetNote = await indexedDBStorage.getNoteById(userId, noteId);
  const previousFolderId = targetNote ? targetNote.folder_id : null;

  if (targetNote) {
    targetNote.is_archived = true;
    targetNote.previous_folder_id = previousFolderId;
    targetNote.folder_id = null;
    targetNote.updated_at = new Date().toISOString();
    targetNote.sync_status = 'pending_sync';
    await indexedDBStorage.putNote(userId, targetNote);
  }

  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'ARCHIVE_NOTE',
    entity_type: 'note',
    entity_id: noteId,
    payload: { noteId, previousFolderId },
    revision: 1,
  });

  const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
  networkMonitor.updatePendingCount(pendingCount);

  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    syncEngine.scheduleSync(100);
  }

  return true;
}

/**
 * Desarquiva uma nota individual no IndexedDB e enfileira para sincronização.
 */
export async function unarchiveNote(
  userId: string,
  noteId: string,
  existingFolders: Folder[]
): Promise<boolean> {
  const targetNote = await indexedDBStorage.getNoteById(userId, noteId);
  const previousFolderId = targetNote?.previous_folder_id ?? null;

  const folderStillExists = previousFolderId
    ? existingFolders.some((f) => f.id === previousFolderId)
    : false;
  const destinationFolderId = folderStillExists ? previousFolderId : null;

  if (targetNote) {
    targetNote.is_archived = false;
    targetNote.folder_id = destinationFolderId;
    targetNote.previous_folder_id = null;
    targetNote.updated_at = new Date().toISOString();
    targetNote.sync_status = 'pending_sync';
    await indexedDBStorage.putNote(userId, targetNote);
  }

  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'UNARCHIVE_NOTE',
    entity_type: 'note',
    entity_id: noteId,
    payload: { noteId, destinationFolderId },
    revision: 1,
  });

  const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
  networkMonitor.updatePendingCount(pendingCount);

  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    syncEngine.scheduleSync(100);
  }

  return true;
}

/**
 * Arquiva todas as notas contidas em uma pasta e em suas subpastas recursivamente.
 */
export async function archiveFolderNotes(
  userId: string,
  folderId: string,
  allFolders: Folder[]
): Promise<boolean> {
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

  const allNotes = await indexedDBStorage.getAllNotes(userId);
  for (const n of allNotes) {
    if (n.folder_id && folderIdsToArchive.has(n.folder_id) && !n.is_archived) {
      await archiveNote(userId, n.id);
    }
  }

  return true;
}

/**
 * Atualiza o título de uma nota no IndexedDB e enfileira para sincronização.
 */
export async function updateNoteTitle(userId: string, noteId: string, newTitle: string): Promise<boolean> {
  const localNote = await indexedDBStorage.getNoteById(userId, noteId);
  if (localNote) {
    localNote.title = newTitle;
    localNote.updated_at = new Date().toISOString();
    localNote.sync_status = 'pending_sync';
    await indexedDBStorage.putNote(userId, localNote);
  }

  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'UPDATE_NOTE',
    entity_type: 'note',
    entity_id: noteId,
    payload: { noteId, updates: { title: newTitle } },
    revision: 1,
  });

  const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
  networkMonitor.updatePendingCount(pendingCount);

  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    syncEngine.scheduleSync(100);
  }

  return true;
}

/**
 * Atualiza o conteúdo de uma nota utilizando a Fila de Persistência Serializada por nota.
 */
export async function updateNoteContent(
  userId: string,
  noteId: string,
  newMarkdownContent: string,
  currentTags?: string[]
): Promise<{ success: boolean; tags: string[]; version?: number }> {
  let baseTags = currentTags;
  if (!baseTags) {
    const existing = await indexedDBStorage.getNoteById(userId, noteId);
    baseTags = existing?.tags || [];
  }
  const bodyHashtags = extractHashtagsFromText(newMarkdownContent);
  const combinedTags = normalizeTags([...(baseTags || []), ...bodyHashtags]);

  // Enfileira na fila serializada de salvamento (que grava no IndexedDB e se online no Supabase)
  const res = await saveQueue.enqueueSave(userId, noteId, newMarkdownContent, combinedTags);
  return res;
}

/**
 * Força a conclusão de qualquer gravação pendente de uma nota específica.
 */
export async function flushNoteSaves(noteId: string): Promise<void> {
  await saveQueue.flushNote(noteId);
}

/**
 * Força a conclusão de todas as gravações pendentes no sistema (ex: antes do logout).
 */
export async function flushAllPendingSaves(): Promise<void> {
  await saveQueue.flushAll();
}

/**
 * Exclui uma nota do IndexedDB e enfileira para exclusão no Supabase.
 */
export async function deleteNote(userId: string, noteId: string): Promise<boolean> {
  await indexedDBStorage.deleteNote(userId, noteId);

  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'DELETE_NOTE',
    entity_type: 'note',
    entity_id: noteId,
    payload: { noteId },
    revision: 1,
  });

  const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
  networkMonitor.updatePendingCount(pendingCount);

  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    syncEngine.scheduleSync(100);
  }

  return true;
}

/**
 * Move/reordena pasta ou nota no IndexedDB e enfileira para sincronização.
 */
export async function moveItem(
  userId: string,
  itemType: 'folder' | 'note',
  itemId: string,
  newParentId: string | null,
  newPosition: number
): Promise<boolean> {
  if (itemType === 'folder') {
    const localFolder = await indexedDBStorage.getFolderById(userId, itemId);
    if (localFolder) {
      localFolder.parent_id = newParentId;
      localFolder.position = newPosition;
      localFolder.updated_at = new Date().toISOString();
      localFolder.sync_status = 'pending_sync';
      await indexedDBStorage.putFolder(userId, localFolder);
    }

    await indexedDBStorage.enqueueSyncItem(userId, {
      action: 'MOVE_FOLDER',
      entity_type: 'folder',
      entity_id: itemId,
      payload: { folderId: itemId, newParentId, newPosition },
      revision: 1,
    });
  } else {
    const localNote = await indexedDBStorage.getNoteById(userId, itemId);
    if (localNote) {
      localNote.folder_id = newParentId;
      localNote.position = newPosition;
      localNote.updated_at = new Date().toISOString();
      localNote.sync_status = 'pending_sync';
      await indexedDBStorage.putNote(userId, localNote);
    }

    await indexedDBStorage.enqueueSyncItem(userId, {
      action: 'MOVE_NOTE',
      entity_type: 'note',
      entity_id: itemId,
      payload: { noteId: itemId, newFolderId: newParentId, newPosition },
      revision: 1,
    });
  }

  const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
  networkMonitor.updatePendingCount(pendingCount);

  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    syncEngine.scheduleSync(100);
  }

  return true;
}

/**
 * Atualiza o conjunto de tags explícitas de uma nota no IndexedDB e enfileira para sincronização.
 */
export async function updateNoteTags(
  userId: string,
  noteId: string,
  rawTags: string[],
  currentBodyContent?: string
): Promise<{ success: boolean; tags: string[] }> {
  const cleanTags = normalizeTags(rawTags);

  const localNote = await indexedDBStorage.getNoteById(userId, noteId);
  const bodyContent = currentBodyContent !== undefined ? currentBodyContent : (localNote?.content || '');

  if (localNote) {
    localNote.tags = cleanTags;
    localNote.content = bodyContent;
    localNote.updated_at = new Date().toISOString();
    localNote.sync_status = 'pending_sync';
    await indexedDBStorage.putNote(userId, localNote);
  }

  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'UPDATE_TAGS',
    entity_type: 'note',
    entity_id: noteId,
    payload: { noteId, tags: cleanTags, bodyContent },
    revision: 1,
  });

  const pendingCount = await indexedDBStorage.getSyncQueueCount(userId);
  networkMonitor.updatePendingCount(pendingCount);

  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    syncEngine.scheduleSync(100);
  }

  return { success: true, tags: cleanTags };
}

/**
 * Consulta de alta performance para obter todas as tags únicas pertencentes ao usuário.
 */
export async function fetchUserTags(userId: string): Promise<string[]> {
  if (!userId) return [];

  try {
    const notes = await indexedDBStorage.getAllNotes(userId);
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
  } catch (err) {
    console.warn('[NotesAPI] Erro ao buscar tags do IndexedDB:', err);
    return [];
  }
}
