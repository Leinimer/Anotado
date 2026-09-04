/**
 * Camada de Persistência Local IndexedDB para o ANOTADO!
 *
 * Garante armazenamento estruturado, durável e isolado por usuário para:
 * - Notas (conteúdo Markdown, títulos, posições, revisões, tags, arquivamento, syncRequired, syncStatus)
 * - Pastas e subpastas (hierarquia, cores, pastas inteligentes, posições, syncRequired, syncStatus)
 * - Tags e relacionamentos de tags
 * - Mídias e anexos (Blobs, metadados, referências locais 'attachment://', URLs remotas, syncRequired, syncStatus)
 * - Fila de sincronização (Sync Queue) com estados, idempotência e tentativas
 * - Metadados de sincronização e controle de versão
 *
 * ARQUITETURA LOCAL-FIRST:
 * O estado "esta entidade precisa ser enviada ao Supabase" (syncRequired = true)
 * é controlado EXCLUSIVAMENTE pelo IndexedDB neste dispositivo, e NUNCA pelo Supabase.
 */

import { Folder, Note, WorkspaceType } from '../types';

export type SyncEntityStatus = 'synced' | 'pending' | 'syncing' | 'error' | 'cancelled';

export interface LocalAttachment {
  id: string;
  user_id: string;
  note_id?: string | null;
  file_name: string;
  file_type: string;
  mime_type?: string;
  file_size: number;
  blob?: Blob;
  data_url?: string;
  storage_path?: string | null;
  remote_url?: string | null;
  syncRequired: boolean;
  syncStatus: SyncEntityStatus;
  sync_status?: 'pending' | 'synced' | 'failed'; // compatibilidade legada
  created_at: string;
  updated_at: string;
}

export type SyncAction =
  | 'CREATE_NOTE'
  | 'UPDATE_NOTE'
  | 'UPDATE_NOTE_CONTENT'
  | 'DELETE_NOTE'
  | 'MOVE_NOTE'
  | 'ARCHIVE_NOTE'
  | 'UNARCHIVE_NOTE'
  | 'CREATE_FOLDER'
  | 'UPDATE_FOLDER'
  | 'DELETE_FOLDER'
  | 'MOVE_FOLDER'
  | 'UPDATE_TAGS'
  | 'UPLOAD_ATTACHMENT'
  | 'DELETE_ATTACHMENT';

export interface SyncQueueItem {
  id: string;
  user_id: string;
  action: SyncAction;
  entity_type: 'note' | 'folder' | 'tag' | 'attachment';
  entity_id: string;
  payload: any;
  revision: number;
  created_at: string;
  attempts: number;
  last_error?: string | null;
  error_details?: any;
  last_attempt_at?: string;
  next_retry_at?: number;
  status: 'pending' | 'processing' | 'synced' | 'failed' | 'cancelled';
}

export interface LocalTag {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface LocalNoteTag {
  id: string; // `${note_id}_${tag_id}`
  user_id: string;
  note_id: string;
  tag_id: string;
  created_at: string;
}

export interface LocalMetadata {
  key: string;
  value: any;
  updated_at: string;
}

export interface ExtendedNote extends Note {
  revision?: number;
  syncRequired?: boolean;
  syncStatus?: SyncEntityStatus;
  // Compatibilidade transitória
  needs_sync?: boolean;
  sync_status?: 'synced' | 'pending_sync' | 'conflict';
  local_updated_at?: string;
  conflict_backup?: {
    remote_content: string;
    remote_updated_at: string;
    server_revision?: number;
  };
}

export interface ExtendedFolder extends Folder {
  revision?: number;
  syncRequired?: boolean;
  syncStatus?: SyncEntityStatus;
  // Compatibilidade transitória
  needs_sync?: boolean;
  sync_status?: 'synced' | 'pending_sync';
  local_updated_at?: string;
}

export interface EntitiesRequiringSync {
  notes: ExtendedNote[];
  folders: ExtendedFolder[];
  attachments: LocalAttachment[];
  hasPending: boolean;
  totalCount: number;
}

const DB_VERSION = 4;

class IndexedDBStorage {
  private dbInstances: Map<string, Promise<IDBDatabase>> = new Map();

  /**
   * Obtém a instância do IndexedDB isolada para o usuário especificado.
   */
  public async getDB(userId: string): Promise<IDBDatabase> {
    const cleanUserId = userId || 'anonymous';
    const dbName = `anotado_db_${cleanUserId}`;

    const existing = this.dbInstances.get(dbName);
    if (existing) {
      return existing;
    }

    const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return reject(new Error('IndexedDB não suportado neste ambiente.'));
      }

      const request = indexedDB.open(dbName, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = (event.target as IDBOpenDBRequest).transaction!;

        // 1. Store: notes
        let notesStore: IDBObjectStore;
        if (!db.objectStoreNames.contains('notes')) {
          notesStore = db.createObjectStore('notes', { keyPath: 'id' });
          notesStore.createIndex('user_id', 'user_id', { unique: false });
          notesStore.createIndex('folder_id', 'folder_id', { unique: false });
          notesStore.createIndex('is_archived', 'is_archived', { unique: false });
          notesStore.createIndex('position', 'position', { unique: false });
          notesStore.createIndex('updated_at', 'updated_at', { unique: false });
          notesStore.createIndex('syncRequired', 'syncRequired', { unique: false });
          notesStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          notesStore.createIndex('revision', 'revision', { unique: false });
          notesStore.createIndex('needs_sync', 'needs_sync', { unique: false });
          notesStore.createIndex('sync_status', 'sync_status', { unique: false });
          notesStore.createIndex('workspace_type', 'workspace_type', { unique: false });
          notesStore.createIndex('entry_date', 'entry_date', { unique: false });
          notesStore.createIndex('diary_year', 'diary_year', { unique: false });
          notesStore.createIndex('user_entry_date', ['user_id', 'entry_date'], { unique: false });
        } else {
          notesStore = tx.objectStore('notes');
          if (!notesStore.indexNames.contains('syncRequired')) {
            notesStore.createIndex('syncRequired', 'syncRequired', { unique: false });
          }
          if (!notesStore.indexNames.contains('syncStatus')) {
            notesStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          }
          if (!notesStore.indexNames.contains('revision')) {
            notesStore.createIndex('revision', 'revision', { unique: false });
          }
          if (!notesStore.indexNames.contains('workspace_type')) {
            notesStore.createIndex('workspace_type', 'workspace_type', { unique: false });
          }
          if (!notesStore.indexNames.contains('entry_date')) {
            notesStore.createIndex('entry_date', 'entry_date', { unique: false });
          }
          if (!notesStore.indexNames.contains('diary_year')) {
            notesStore.createIndex('diary_year', 'diary_year', { unique: false });
          }
          if (!notesStore.indexNames.contains('user_entry_date')) {
            notesStore.createIndex('user_entry_date', ['user_id', 'entry_date'], { unique: false });
          }
        }

        // 2. Store: folders
        let foldersStore: IDBObjectStore;
        if (!db.objectStoreNames.contains('folders')) {
          foldersStore = db.createObjectStore('folders', { keyPath: 'id' });
          foldersStore.createIndex('user_id', 'user_id', { unique: false });
          foldersStore.createIndex('parent_id', 'parent_id', { unique: false });
          foldersStore.createIndex('position', 'position', { unique: false });
          foldersStore.createIndex('updated_at', 'updated_at', { unique: false });
          foldersStore.createIndex('syncRequired', 'syncRequired', { unique: false });
          foldersStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          foldersStore.createIndex('revision', 'revision', { unique: false });
          foldersStore.createIndex('needs_sync', 'needs_sync', { unique: false });
          foldersStore.createIndex('workspace_type', 'workspace_type', { unique: false });
          foldersStore.createIndex('diary_year', 'diary_year', { unique: false });
        } else {
          foldersStore = tx.objectStore('folders');
          if (!foldersStore.indexNames.contains('syncRequired')) {
            foldersStore.createIndex('syncRequired', 'syncRequired', { unique: false });
          }
          if (!foldersStore.indexNames.contains('syncStatus')) {
            foldersStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          }
          if (!foldersStore.indexNames.contains('revision')) {
            foldersStore.createIndex('revision', 'revision', { unique: false });
          }
          if (!foldersStore.indexNames.contains('workspace_type')) {
            foldersStore.createIndex('workspace_type', 'workspace_type', { unique: false });
          }
          if (!foldersStore.indexNames.contains('diary_year')) {
            foldersStore.createIndex('diary_year', 'diary_year', { unique: false });
          }
        }

        // 3. Store: tags
        if (!db.objectStoreNames.contains('tags')) {
          const tagsStore = db.createObjectStore('tags', { keyPath: 'id' });
          tagsStore.createIndex('user_id', 'user_id', { unique: false });
          tagsStore.createIndex('name', 'name', { unique: false });
          tagsStore.createIndex('user_name', ['user_id', 'name'], { unique: true });
        }

        // 4. Store: note_tags
        if (!db.objectStoreNames.contains('note_tags')) {
          const noteTagsStore = db.createObjectStore('note_tags', { keyPath: 'id' });
          noteTagsStore.createIndex('note_id', 'note_id', { unique: false });
          noteTagsStore.createIndex('tag_id', 'tag_id', { unique: false });
          noteTagsStore.createIndex('user_id', 'user_id', { unique: false });
        }

        // 5. Store: attachments (mídias locais: imagens, PDFs, vídeos)
        let attachmentsStore: IDBObjectStore;
        if (!db.objectStoreNames.contains('attachments')) {
          attachmentsStore = db.createObjectStore('attachments', { keyPath: 'id' });
          attachmentsStore.createIndex('user_id', 'user_id', { unique: false });
          attachmentsStore.createIndex('note_id', 'note_id', { unique: false });
          attachmentsStore.createIndex('syncRequired', 'syncRequired', { unique: false });
          attachmentsStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          attachmentsStore.createIndex('sync_status', 'sync_status', { unique: false });
        } else {
          attachmentsStore = tx.objectStore('attachments');
          if (!attachmentsStore.indexNames.contains('syncRequired')) {
            attachmentsStore.createIndex('syncRequired', 'syncRequired', { unique: false });
          }
          if (!attachmentsStore.indexNames.contains('syncStatus')) {
            attachmentsStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          }
        }

        // 6. Store: sync_queue (fila de sincronização persistente)
        if (!db.objectStoreNames.contains('sync_queue')) {
          const queueStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
          queueStore.createIndex('user_id', 'user_id', { unique: false });
          queueStore.createIndex('status', 'status', { unique: false });
          queueStore.createIndex('entity_id', 'entity_id', { unique: false });
          queueStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // 7. Store: metadata (timestamps, status de sync)
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.dbInstances.delete(dbName);
        };
        resolve(db);
      };

      request.onerror = () => {
        this.dbInstances.delete(dbName);
        reject(request.error);
      };
    });

    this.dbInstances.set(dbName, dbPromise);
    return dbPromise;
  }

  // ==========================================
  // CONSULTA EFICIENTE DE ENTIDADES PENDENTES
  // ==========================================

  /**
   * Consulta ultra-rápida das entidades que precisam de sincronização.
   * Não consulta o Supabase. Consulta apenas o IndexedDB local.
   */
  public async getEntitiesRequiringSync(userId: string): Promise<EntitiesRequiringSync> {
    const db = await this.getDB(userId);

    return new Promise<EntitiesRequiringSync>((resolve, reject) => {
      try {
        const tx = db.transaction(['notes', 'folders', 'attachments'], 'readonly');
        const notesStore = tx.objectStore('notes');
        const foldersStore = tx.objectStore('folders');
        const attachmentsStore = tx.objectStore('attachments');

        const pendingNotes: ExtendedNote[] = [];
        const pendingFolders: ExtendedFolder[] = [];
        const pendingAttachments: LocalAttachment[] = [];

        // Notas
        const notesReq = notesStore.openCursor();
        notesReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const note = cursor.value as ExtendedNote;
            const isCancelled = note.syncStatus === 'cancelled';
            const isSynced = note.syncStatus === 'synced';
            const isPending =
              !isCancelled &&
              !isSynced &&
              (note.syncRequired === true ||
                note.syncStatus === 'pending' ||
                note.syncStatus === 'error' ||
                note.needs_sync === true ||
                note.sync_status === 'pending_sync');

            if (isPending) {
              pendingNotes.push(note);
            }
            cursor.continue();
          }
        };

        // Pastas
        const foldersReq = foldersStore.openCursor();
        foldersReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const folder = cursor.value as ExtendedFolder;
            const isCancelled = folder.syncStatus === 'cancelled';
            const isSynced = folder.syncStatus === 'synced';
            const isPending =
              !isCancelled &&
              !isSynced &&
              (folder.syncRequired === true ||
                folder.syncStatus === 'pending' ||
                folder.syncStatus === 'error' ||
                folder.needs_sync === true ||
                folder.sync_status === 'pending_sync');

            if (isPending) {
              pendingFolders.push(folder);
            }
            cursor.continue();
          }
        };

        // Anexos
        const attReq = attachmentsStore.openCursor();
        attReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const att = cursor.value as LocalAttachment;
            const isCancelled = att.syncStatus === 'cancelled';
            const isSynced = att.syncStatus === 'synced';
            const isPending =
              !isCancelled &&
              !isSynced &&
              (att.syncRequired === true ||
                att.syncStatus === 'pending' ||
                att.syncStatus === 'error' ||
                att.sync_status === 'pending' ||
                (!att.remote_url && Boolean(att.blob)));

            if (isPending) {
              pendingAttachments.push(att);
            }
            cursor.continue();
          }
        };

        tx.oncomplete = () => {
          const totalCount = pendingNotes.length + pendingFolders.length + pendingAttachments.length;
          resolve({
            notes: pendingNotes,
            folders: pendingFolders,
            attachments: pendingAttachments,
            hasPending: totalCount > 0,
            totalCount,
          });
        };

        tx.onerror = () => reject(tx.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  // ==========================================
  // OPERAÇÕES: NOTAS
  // ==========================================

  public async getAllNotes(userId: string, workspaceType?: WorkspaceType): Promise<ExtendedNote[]> {
    const db = await this.getDB(userId);
    return new Promise<ExtendedNote[]>((resolve, reject) => {
      const tx = db.transaction('notes', 'readonly');
      const store = tx.objectStore('notes');
      const request = store.getAll();
      request.onsuccess = () => {
        let list = (request.result || []) as ExtendedNote[];
        if (workspaceType === 'diary') {
          list = list.filter((n) => n.workspace_type === 'diary');
        } else if (workspaceType === 'notes') {
          list = list.filter((n) => !n.workspace_type || n.workspace_type === 'notes');
        }
        resolve(list);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Busca uma entrada do Diário para uma data específica (YYYY-MM-DD).
   * Garante: "Não permitir duas entradas para o mesmo: usuário + data + diário."
   */
  public async getDiaryEntryByDate(userId: string, entryDate: string): Promise<ExtendedNote | null> {
    const all = await this.getAllNotes(userId, 'diary');
    const clean = entryDate.trim();
    const parts = clean.split('-');
    const y = parts.length === 3 ? parseInt(parts[0], 10) : null;
    const m = parts.length === 3 ? parseInt(parts[1], 10) : null;
    const d = parts.length === 3 ? parseInt(parts[2], 10) : null;

    const found = all.find((n) => {
      if (n.is_archived) return false;
      if (n.entry_date && n.entry_date.trim() === clean) return true;
      if (
        y !== null &&
        m !== null &&
        d !== null &&
        n.diary_year === y &&
        n.diary_month === m &&
        n.diary_day === d
      ) {
        return true;
      }
      return false;
    });
    return found || null;
  }

  public async getNoteById(userId: string, noteId: string): Promise<ExtendedNote | null> {
    const db = await this.getDB(userId);
    return new Promise<ExtendedNote | null>((resolve, reject) => {
      const tx = db.transaction('notes', 'readonly');
      const store = tx.objectStore('notes');
      const request = store.get(noteId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  public async putNote(userId: string, note: ExtendedNote): Promise<void> {
    const db = await this.getDB(userId);
    const syncReq = note.syncRequired !== undefined
      ? note.syncRequired
      : (note.syncStatus ? note.syncStatus !== 'synced' : (note.needs_sync !== undefined ? note.needs_sync : true));

    const status: SyncEntityStatus = note.syncStatus || (syncReq ? 'pending' : 'synced');

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      const record: ExtendedNote = {
        ...note,
        user_id: userId,
        workspace_type: note.workspace_type || 'notes',
        entry_date: note.entry_date || null,
        diary_year: note.diary_year !== undefined ? note.diary_year : null,
        diary_month: note.diary_month !== undefined ? note.diary_month : null,
        diary_day: note.diary_day !== undefined ? note.diary_day : null,
        syncRequired: syncReq,
        syncStatus: status,
        needs_sync: syncReq,
        sync_status: syncReq ? 'pending_sync' : 'synced',
        revision: typeof note.revision === 'number' ? note.revision : 0,
        local_updated_at: note.local_updated_at || new Date().toISOString(),
      };

      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public async putNotesBatch(userId: string, notes: ExtendedNote[]): Promise<void> {
    if (notes.length === 0) return;
    const db = await this.getDB(userId);
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      for (const note of notes) {
        const syncReq = note.syncRequired !== undefined
          ? note.syncRequired
          : (note.syncStatus ? note.syncStatus !== 'synced' : (note.needs_sync !== undefined ? note.needs_sync : true));

        const status: SyncEntityStatus = note.syncStatus || (syncReq ? 'pending' : 'synced');

        store.put({
          ...note,
          user_id: userId,
          syncRequired: syncReq,
          syncStatus: status,
          needs_sync: syncReq,
          sync_status: syncReq ? 'pending_sync' : 'synced',
          revision: typeof note.revision === 'number' ? note.revision : 0,
          local_updated_at: note.local_updated_at || new Date().toISOString(),
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getPendingSyncNotes(userId: string): Promise<ExtendedNote[]> {
    const res = await this.getEntitiesRequiringSync(userId);
    return res.notes;
  }

  /**
   * Marca a nota como sincronizada no IndexedDB (syncRequired = false, syncStatus = 'synced').
   * Ocorre SOMENTE após a confirmação de sucesso pelo Supabase.
   */
  public async markNoteSynced(userId: string, noteId: string, serverRevision?: number): Promise<void> {
    const note = await this.getNoteById(userId, noteId);
    if (!note) return;
    note.syncRequired = false;
    note.syncStatus = 'synced';
    note.needs_sync = false;
    note.sync_status = 'synced';
    if (typeof serverRevision === 'number') {
      note.revision = serverRevision;
    }
    await this.putNote(userId, note);
  }

  public async markNoteSyncError(userId: string, noteId: string): Promise<void> {
    const note = await this.getNoteById(userId, noteId);
    if (!note) return;
    note.syncRequired = true;
    note.syncStatus = 'error';
    await this.putNote(userId, note);
  }

  public async deleteNote(userId: string, noteId: string): Promise<void> {
    const db = await this.getDB(userId);
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      const request = store.delete(noteId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ==========================================
  // OPERAÇÕES: PASTAS
  // ==========================================

  public async getAllFolders(userId: string, workspaceType?: WorkspaceType): Promise<ExtendedFolder[]> {
    const db = await this.getDB(userId);
    return new Promise<ExtendedFolder[]>((resolve, reject) => {
      const tx = db.transaction('folders', 'readonly');
      const store = tx.objectStore('folders');
      const request = store.getAll();
      request.onsuccess = () => {
        let list = (request.result || []) as ExtendedFolder[];
        if (workspaceType === 'diary') {
          list = list.filter((f) => f.workspace_type === 'diary');
        } else if (workspaceType === 'notes') {
          list = list.filter((f) => !f.workspace_type || f.workspace_type === 'notes');
        }
        resolve(list);
      };
      request.onerror = () => reject(request.error);
    });
  }

  public async getFolderById(userId: string, folderId: string): Promise<ExtendedFolder | null> {
    const db = await this.getDB(userId);
    return new Promise<ExtendedFolder | null>((resolve, reject) => {
      const tx = db.transaction('folders', 'readonly');
      const store = tx.objectStore('folders');
      const request = store.get(folderId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  public async putFolder(userId: string, folder: ExtendedFolder): Promise<void> {
    const db = await this.getDB(userId);
    const syncReq = folder.syncRequired !== undefined
      ? folder.syncRequired
      : (folder.syncStatus ? folder.syncStatus !== 'synced' : (folder.needs_sync !== undefined ? folder.needs_sync : true));

    const status: SyncEntityStatus = folder.syncStatus || (syncReq ? 'pending' : 'synced');

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('folders', 'readwrite');
      const store = tx.objectStore('folders');
      const record: ExtendedFolder = {
        ...folder,
        user_id: userId,
        workspace_type: folder.workspace_type || 'notes',
        diary_year: folder.diary_year !== undefined ? folder.diary_year : null,
        diary_month: folder.diary_month !== undefined ? folder.diary_month : null,
        syncRequired: syncReq,
        syncStatus: status,
        needs_sync: syncReq,
        sync_status: syncReq ? 'pending_sync' : 'synced',
        revision: typeof folder.revision === 'number' ? folder.revision : 0,
        local_updated_at: folder.local_updated_at || new Date().toISOString(),
      };

      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public async putFoldersBatch(userId: string, folders: ExtendedFolder[]): Promise<void> {
    if (folders.length === 0) return;
    const db = await this.getDB(userId);
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('folders', 'readwrite');
      const store = tx.objectStore('folders');
      for (const folder of folders) {
        const syncReq = folder.syncRequired !== undefined
          ? folder.syncRequired
          : (folder.syncStatus ? folder.syncStatus !== 'synced' : (folder.needs_sync !== undefined ? folder.needs_sync : true));

        const status: SyncEntityStatus = folder.syncStatus || (syncReq ? 'pending' : 'synced');

        store.put({
          ...folder,
          user_id: userId,
          syncRequired: syncReq,
          syncStatus: status,
          needs_sync: syncReq,
          sync_status: syncReq ? 'pending_sync' : 'synced',
          revision: typeof folder.revision === 'number' ? folder.revision : 0,
          local_updated_at: folder.local_updated_at || new Date().toISOString(),
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getPendingSyncFolders(userId: string): Promise<ExtendedFolder[]> {
    const res = await this.getEntitiesRequiringSync(userId);
    return res.folders;
  }

  /**
   * Marca a pasta como sincronizada no IndexedDB (syncRequired = false, syncStatus = 'synced').
   * Ocorre SOMENTE após confirmação de sucesso pelo Supabase.
   */
  public async markFolderSynced(userId: string, folderId: string, serverRevision?: number): Promise<void> {
    const folder = await this.getFolderById(userId, folderId);
    if (!folder) return;
    folder.syncRequired = false;
    folder.syncStatus = 'synced';
    folder.needs_sync = false;
    folder.sync_status = 'synced';
    if (typeof serverRevision === 'number') {
      folder.revision = serverRevision;
    }
    await this.putFolder(userId, folder);
  }

  public async markFolderSyncError(userId: string, folderId: string): Promise<void> {
    const folder = await this.getFolderById(userId, folderId);
    if (!folder) return;
    folder.syncRequired = true;
    folder.syncStatus = 'error';
    await this.putFolder(userId, folder);
  }

  public async deleteFolder(userId: string, folderId: string): Promise<void> {
    const db = await this.getDB(userId);
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('folders', 'readwrite');
      const store = tx.objectStore('folders');
      const request = store.delete(folderId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ==========================================
  // OPERAÇÕES: TAGS
  // ==========================================

  public async getAllTags(userId: string): Promise<LocalTag[]> {
    const db = await this.getDB(userId);
    return new Promise<LocalTag[]>((resolve, reject) => {
      const tx = db.transaction('tags', 'readonly');
      const store = tx.objectStore('tags');
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []) as LocalTag[]);
      request.onerror = () => reject(request.error);
    });
  }

  public async putTagsBatch(userId: string, tags: { id?: string; name: string }[]): Promise<void> {
    if (tags.length === 0) return;
    const db = await this.getDB(userId);
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('tags', 'readwrite');
      const store = tx.objectStore('tags');
      for (const tag of tags) {
        const cleanName = tag.name.toLowerCase().trim().replace(/^#+/, '');
        if (!cleanName) continue;
        const tagId = tag.id || `tag_${cleanName}`;
        store.put({
          id: tagId,
          user_id: userId,
          name: cleanName,
          created_at: new Date().toISOString(),
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ==========================================
  // OPERAÇÕES: ATTACHMENTS (MÍDIAS & ARQUIVOS)
  // ==========================================

  public async getAttachment(userId: string, attachmentId: string): Promise<LocalAttachment | null> {
    const db = await this.getDB(userId);
    return new Promise<LocalAttachment | null>((resolve, reject) => {
      const tx = db.transaction('attachments', 'readonly');
      const store = tx.objectStore('attachments');
      const request = store.get(attachmentId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  public async getAttachmentsByNoteId(userId: string, noteId: string): Promise<LocalAttachment[]> {
    const db = await this.getDB(userId);
    return new Promise<LocalAttachment[]>((resolve, reject) => {
      const tx = db.transaction('attachments', 'readonly');
      const store = tx.objectStore('attachments');
      const index = store.index('note_id');
      const request = index.getAll(noteId);
      request.onsuccess = () => resolve((request.result || []) as LocalAttachment[]);
      request.onerror = () => reject(request.error);
    });
  }

  public async getAllAttachments(userId: string): Promise<LocalAttachment[]> {
    const db = await this.getDB(userId);
    return new Promise<LocalAttachment[]>((resolve, reject) => {
      const tx = db.transaction('attachments', 'readonly');
      const store = tx.objectStore('attachments');
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []) as LocalAttachment[]);
      request.onerror = () => reject(request.error);
    });
  }

  public async putAttachment(
    userId: string,
    attachment: Partial<LocalAttachment> & {
      id: string;
      user_id: string;
      file_name: string;
      file_type: string;
      file_size: number;
    }
  ): Promise<void> {
    const db = await this.getDB(userId);
    const syncReq = attachment.syncRequired !== undefined
      ? attachment.syncRequired
      : (attachment.syncStatus ? attachment.syncStatus !== 'synced' : (attachment.remote_url ? false : true));

    const status: SyncEntityStatus = attachment.syncStatus || (syncReq ? 'pending' : 'synced');

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('attachments', 'readwrite');
      const store = tx.objectStore('attachments');
      const record: LocalAttachment = {
        id: attachment.id,
        user_id: userId,
        note_id: attachment.note_id || null,
        file_name: attachment.file_name,
        file_type: attachment.file_type || attachment.mime_type || 'application/octet-stream',
        mime_type: attachment.mime_type || attachment.file_type || 'application/octet-stream',
        file_size: attachment.file_size,
        blob: attachment.blob,
        data_url: attachment.data_url,
        storage_path: attachment.storage_path || null,
        remote_url: attachment.remote_url || null,
        syncRequired: syncReq,
        syncStatus: status,
        sync_status: syncReq ? 'pending' : 'synced',
        created_at: attachment.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public async getPendingAttachments(userId: string): Promise<LocalAttachment[]> {
    const res = await this.getEntitiesRequiringSync(userId);
    return res.attachments;
  }

  /**
   * Marca o anexo como sincronizado no IndexedDB após upload bem-sucedido no Supabase Storage.
   */
  public async markAttachmentSynced(userId: string, attachmentId: string, remoteUrl: string): Promise<void> {
    const att = await this.getAttachment(userId, attachmentId);
    if (!att) return;
    att.remote_url = remoteUrl;
    att.syncRequired = false;
    att.syncStatus = 'synced';
    att.sync_status = 'synced';
    await this.putAttachment(userId, att);
  }

  public async deleteAttachment(userId: string, attachmentId: string): Promise<void> {
    const db = await this.getDB(userId);
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('attachments', 'readwrite');
      const store = tx.objectStore('attachments');
      const request = store.delete(attachmentId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ==========================================
  // OPERAÇÕES: FILA DE SINCRONIZAÇÃO (SYNC QUEUE)
  // ==========================================

  /**
   * Enfileira ou atualiza de forma consolidada uma operação na SyncQueue.
   * Utiliza chaves determinísticas por entidade para evitar duplicações e acumulações desnecessárias.
   */
  public async enqueueSyncItem(
    userId: string,
    item: Omit<SyncQueueItem, 'id' | 'attempts' | 'status' | 'user_id' | 'created_at'> & {
      id?: string;
      user_id?: string;
      created_at?: string;
    }
  ): Promise<SyncQueueItem> {
    const db = await this.getDB(userId);

    // Chave determinística padrão por tipo e id de entidade se não fornecida explicitamente
    let deterministicId = item.id;
    if (!deterministicId) {
      if (item.action === 'CREATE_NOTE') {
        deterministicId = `sync_create_note_${item.entity_id}`;
      } else if (item.action === 'UPDATE_NOTE_CONTENT' || item.action === 'UPDATE_NOTE') {
        deterministicId = `sync_note_${item.entity_id}`;
      } else if (item.action === 'DELETE_NOTE') {
        deterministicId = `sync_delete_note_${item.entity_id}`;
      } else if (item.action === 'CREATE_FOLDER') {
        deterministicId = `sync_create_folder_${item.entity_id}`;
      } else if (item.action === 'UPDATE_FOLDER' || item.action === 'MOVE_FOLDER') {
        deterministicId = `sync_folder_${item.entity_id}`;
      } else if (item.action === 'DELETE_FOLDER') {
        deterministicId = `sync_delete_folder_${item.entity_id}`;
      } else if (item.action === 'UPLOAD_ATTACHMENT') {
        deterministicId = `sync_att_${item.entity_id}`;
      } else if (item.action === 'DELETE_ATTACHMENT') {
        deterministicId = `sync_del_att_${item.entity_id}`;
      } else {
        deterministicId = `sync_${item.entity_type}_${item.entity_id}`;
      }
    }

    return new Promise<SyncQueueItem>((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      const getReq = store.get(deterministicId);

      getReq.onsuccess = () => {
        const existing = getReq.result as SyncQueueItem | undefined;

        const syncItem: SyncQueueItem = {
          id: deterministicId,
          user_id: userId,
          action: item.action,
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          payload: item.payload,
          revision: item.revision || (existing ? existing.revision : 1),
          created_at: existing?.created_at || item.created_at || new Date().toISOString(),
          attempts: existing ? existing.attempts : 0,
          status: existing ? (existing.status === 'processing' ? 'pending' : existing.status) : 'pending',
          last_error: existing?.last_error,
          error_details: existing?.error_details,
          last_attempt_at: existing?.last_attempt_at,
          next_retry_at: existing?.next_retry_at,
        };

        const putReq = store.put(syncItem);
        putReq.onsuccess = () => resolve(syncItem);
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * Consulta O(p) das operações pendentes da SyncQueue.
   * Não percorre notes, folders ou attachments com cursores.
   */
  public async getPendingSyncItems(userId: string): Promise<SyncQueueItem[]> {
    return this.getPendingSyncQueue(userId);
  }

  public async getPendingSyncQueue(userId: string): Promise<SyncQueueItem[]> {
    const db = await this.getDB(userId);
    return new Promise<SyncQueueItem[]>((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readonly');
      const store = tx.objectStore('sync_queue');
      const request = store.getAll();
      request.onsuccess = () => {
        const all = (request.result || []) as SyncQueueItem[];
        const pending = all
          .filter((item) => item.status === 'pending' || item.status === 'processing' || item.status === 'failed')
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        resolve(pending);
      };
      request.onerror = () => reject(request.error);
    });
  }

  public async updateSyncItemStatus(
    userId: string,
    itemId: string,
    status: SyncQueueItem['status'],
    lastError?: string,
    errorDetails?: any,
    nextRetryAt?: number
  ): Promise<void> {
    const db = await this.getDB(userId);
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      const getReq = store.get(itemId);
      getReq.onsuccess = () => {
        const item = getReq.result as SyncQueueItem | undefined;
        if (item) {
          item.status = status;
          item.attempts = (item.attempts || 0) + 1;
          item.last_attempt_at = new Date().toISOString();
          if (lastError !== undefined) item.last_error = lastError;
          if (errorDetails !== undefined) item.error_details = errorDetails;
          if (nextRetryAt !== undefined) item.next_retry_at = nextRetryAt;
          store.put(item);
        }
        resolve();
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  public async removeSyncQueueItem(userId: string, itemId: string): Promise<void> {
    const db = await this.getDB(userId);
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');
      const request = store.delete(itemId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public async getSyncQueueCount(userId: string): Promise<number> {
    const db = await this.getDB(userId);
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readonly');
      const store = tx.objectStore('sync_queue');
      const request = store.getAll();
      request.onsuccess = () => {
        const all = (request.result || []) as SyncQueueItem[];
        const count = all.filter((i) => i.status === 'pending' || i.status === 'processing' || i.status === 'failed').length;
        resolve(count);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Cancela deliberadamente a sincronização de uma entidade específica:
   * - Atualiza o syncStatus da entidade para 'cancelled' (somente local no IndexedDB);
   * - Define syncRequired = false e needs_sync = false para que o verificador automático de 1s NÃO a reenfileire;
   * - Remove ou invalida itens da SyncQueue associados;
   * - Preserva 100% dos dados locais (título, conteúdo, anexos e metadados).
   */
  public async cancelEntitySync(
    userId: string,
    entityType: 'note' | 'folder' | 'attachment' | 'tag' | 'queue',
    entityId: string,
    queueItemId?: string
  ): Promise<void> {
    const db = await this.getDB(userId);

    // 1. Remove ou atualiza item da SyncQueue
    if (queueItemId) {
      await this.removeSyncQueueItem(userId, queueItemId);
    }
    // Remove qualquer outro item na fila relacionado à mesma entidade
    const queue = await this.getPendingSyncQueue(userId);
    for (const q of queue) {
      if (q.entity_id === entityId || (queueItemId && q.id === queueItemId)) {
        await this.removeSyncQueueItem(userId, q.id);
      }
    }

    // 2. Atualiza status no IndexedDB conforme o tipo de entidade
    if (entityType === 'note') {
      const note = await this.getNoteById(userId, entityId);
      if (note) {
        note.syncStatus = 'cancelled';
        note.syncRequired = false;
        note.needs_sync = false;
        await this.putNote(userId, note);
      }
    } else if (entityType === 'folder') {
      const folder = await this.getFolderById(userId, entityId);
      if (folder) {
        folder.syncStatus = 'cancelled';
        folder.syncRequired = false;
        folder.needs_sync = false;
        await this.putFolder(userId, folder);
      }
    } else if (entityType === 'attachment') {
      const att = await this.getAttachment(userId, entityId);
      if (att) {
        att.syncStatus = 'cancelled';
        att.syncRequired = false;
        await this.putAttachment(userId, att);
      }
    }
  }

  /**
   * Reativa a sincronização de uma entidade cancelada:
   * - Define syncStatus = 'pending', syncRequired = true no IndexedDB local;
   * - Reenfileira a operação na SyncQueue;
   * - Permite que o SyncEngine processe e confirme no Supabase.
   */
  public async reactivateEntitySync(
    userId: string,
    entityType: 'note' | 'folder' | 'attachment' | 'tag' | 'queue',
    entityId: string
  ): Promise<void> {
    if (entityType === 'note') {
      const note = await this.getNoteById(userId, entityId);
      if (note) {
        note.syncStatus = 'pending';
        note.syncRequired = true;
        note.needs_sync = true;
        note.sync_status = 'pending_sync';
        await this.putNote(userId, note);
        await this.enqueueSyncItem(userId, {
          action: 'UPDATE_NOTE_CONTENT',
          entity_type: 'note',
          entity_id: note.id,
          revision: note.revision || 1,
          payload: {
            noteId: note.id,
            content: note.content || '',
            tags: note.tags || [],
            revision: note.revision || 1,
          },
        });
      }
    } else if (entityType === 'folder') {
      const folder = await this.getFolderById(userId, entityId);
      if (folder) {
        folder.syncStatus = 'pending';
        folder.syncRequired = true;
        folder.needs_sync = true;
        folder.sync_status = 'pending_sync';
        await this.putFolder(userId, folder);
        await this.enqueueSyncItem(userId, {
          action: 'UPDATE_FOLDER',
          entity_type: 'folder',
          entity_id: folder.id,
          revision: folder.revision || 1,
          payload: {
            folderId: folder.id,
            updates: {
              name: folder.name,
              parent_id: folder.parent_id,
              position: folder.position,
              color: folder.color,
              is_smart: folder.is_smart,
              smart_tags: folder.smart_tags,
            },
          },
        });
      }
    } else if (entityType === 'attachment') {
      const att = await this.getAttachment(userId, entityId);
      if (att) {
        att.syncStatus = 'pending';
        att.syncRequired = true;
        att.sync_status = 'pending';
        await this.putAttachment(userId, att);
        await this.enqueueSyncItem(userId, {
          action: 'UPLOAD_ATTACHMENT',
          entity_type: 'attachment',
          entity_id: att.id,
          revision: 1,
          payload: {
            attachmentId: att.id,
            fileName: att.file_name,
            fileType: att.file_type,
            fileSize: att.file_size,
            noteId: att.note_id || null,
          },
        });
      }
    }
  }

  /**
   * Retorna todas as entidades locais com status 'cancelled'
   */
  public async getCancelledEntities(userId: string): Promise<{
    notes: ExtendedNote[];
    folders: ExtendedFolder[];
    attachments: LocalAttachment[];
  }> {
    const allNotes = await this.getAllNotes(userId);
    const allFolders = await this.getAllFolders(userId);
    const allAttachments = await this.getAllAttachments(userId);

    return {
      notes: allNotes.filter((n) => n.syncStatus === 'cancelled'),
      folders: allFolders.filter((f) => f.syncStatus === 'cancelled'),
      attachments: allAttachments.filter((a) => a.syncStatus === 'cancelled'),
    };
  }

  // ==========================================
  // OPERAÇÕES: METADATA
  // ==========================================

  public async getMetadata<T = any>(userId: string, key: string): Promise<T | null> {
    const db = await this.getDB(userId);
    return new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction('metadata', 'readonly');
      const store = tx.objectStore('metadata');
      const request = store.get(key);
      request.onsuccess = () => {
        const res = request.result as LocalMetadata | undefined;
        resolve(res ? res.value : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  public async setMetadata(userId: string, key: string, value: any): Promise<void> {
    const db = await this.getDB(userId);
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('metadata', 'readwrite');
      const store = tx.objectStore('metadata');
      const request = store.put({
        key,
        value,
        updated_at: new Date().toISOString(),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Limpa todos os dados locais do usuário especificado.
   */
  public async clearUserData(userId: string): Promise<void> {
    const cleanUserId = userId || 'anonymous';
    const dbName = `anotado_db_${cleanUserId}`;
    if (this.dbInstances.has(dbName)) {
      const db = await this.dbInstances.get(dbName);
      db?.close();
      this.dbInstances.delete(dbName);
    }
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

export const indexedDBStorage = new IndexedDBStorage();
