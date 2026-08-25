/**
 * Camada de Persistência Local IndexedDB para o ANOTADO!
 *
 * Garante armazenamento estruturado, durável e isolado por usuário para:
 * - Notas (conteúdo Markdown, títulos, posições, revisões, tags, arquivamento)
 * - Pastas e subpastas (hierarquia, cores, pastas inteligentes, posições)
 * - Tags e relacionamentos de tags
 * - Mídias e anexos (Blobs, metadados, URLs locais e remotas)
 * - Fila de sincronização (Sync Queue) com estados e tentativas
 * - Metadados de sincronização e controle de versão
 */

import { Folder, Note } from '../types';

export interface LocalAttachment {
  id: string;
  user_id: string;
  note_id?: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  blob?: Blob;
  data_url?: string;
  remote_url?: string | null;
  sync_status: 'pending' | 'synced' | 'failed';
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
  status: 'pending' | 'processing' | 'synced' | 'failed';
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
  sync_status?: 'synced' | 'pending_sync' | 'conflict';
  local_updated_at?: string;
  conflict_backup?: {
    remote_content: string;
    remote_updated_at: string;
    server_revision?: number;
  };
}

export interface ExtendedFolder extends Folder {
  sync_status?: 'synced' | 'pending_sync';
  local_updated_at?: string;
}

const DB_VERSION = 1;

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

        // 1. Store: notes
        if (!db.objectStoreNames.contains('notes')) {
          const notesStore = db.createObjectStore('notes', { keyPath: 'id' });
          notesStore.createIndex('user_id', 'user_id', { unique: false });
          notesStore.createIndex('folder_id', 'folder_id', { unique: false });
          notesStore.createIndex('is_archived', 'is_archived', { unique: false });
          notesStore.createIndex('position', 'position', { unique: false });
          notesStore.createIndex('updated_at', 'updated_at', { unique: false });
          notesStore.createIndex('sync_status', 'sync_status', { unique: false });
        }

        // 2. Store: folders
        if (!db.objectStoreNames.contains('folders')) {
          const foldersStore = db.createObjectStore('folders', { keyPath: 'id' });
          foldersStore.createIndex('user_id', 'user_id', { unique: false });
          foldersStore.createIndex('parent_id', 'parent_id', { unique: false });
          foldersStore.createIndex('position', 'position', { unique: false });
          foldersStore.createIndex('updated_at', 'updated_at', { unique: false });
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
        if (!db.objectStoreNames.contains('attachments')) {
          const attachmentsStore = db.createObjectStore('attachments', { keyPath: 'id' });
          attachmentsStore.createIndex('user_id', 'user_id', { unique: false });
          attachmentsStore.createIndex('note_id', 'note_id', { unique: false });
          attachmentsStore.createIndex('sync_status', 'sync_status', { unique: false });
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
  // MÉTODOS GENÉRICOS DE TRANSAÇÃO
  // ==========================================

  private async performTransaction<T>(
    userId: string,
    storeName: string,
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => IDBRequest | Promise<T>
  ): Promise<T> {
    const db = await this.getDB(userId);
    return new Promise<T>((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);

        const request = callback(store);

        if (request && 'onsuccess' in request) {
          (request as IDBRequest).onsuccess = () => resolve((request as IDBRequest).result);
          (request as IDBRequest).onerror = () => reject((request as IDBRequest).error);
        }

        tx.oncomplete = () => {
          // Se o callback foi síncrono ou Promise, resolve
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error(`Transação cancelada em ${storeName}`));
      } catch (err) {
        reject(err);
      }
    });
  }

  // ==========================================
  // OPERAÇÕES: NOTAS
  // ==========================================

  public async getAllNotes(userId: string): Promise<ExtendedNote[]> {
    const db = await this.getDB(userId);
    return new Promise<ExtendedNote[]>((resolve, reject) => {
      const tx = db.transaction('notes', 'readonly');
      const store = tx.objectStore('notes');
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []) as ExtendedNote[]);
      request.onerror = () => reject(request.error);
    });
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
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      const request = store.put({
        ...note,
        user_id: userId,
        local_updated_at: note.local_updated_at || new Date().toISOString(),
      });
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
        store.put({
          ...note,
          user_id: userId,
          local_updated_at: note.local_updated_at || new Date().toISOString(),
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
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

  public async getAllFolders(userId: string): Promise<ExtendedFolder[]> {
    const db = await this.getDB(userId);
    return new Promise<ExtendedFolder[]>((resolve, reject) => {
      const tx = db.transaction('folders', 'readonly');
      const store = tx.objectStore('folders');
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []) as ExtendedFolder[]);
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
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('folders', 'readwrite');
      const store = tx.objectStore('folders');
      const request = store.put({
        ...folder,
        user_id: userId,
        local_updated_at: folder.local_updated_at || new Date().toISOString(),
      });
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
        store.put({
          ...folder,
          user_id: userId,
          local_updated_at: folder.local_updated_at || new Date().toISOString(),
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
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

  public async putAttachment(userId: string, attachment: LocalAttachment): Promise<void> {
    const db = await this.getDB(userId);
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('attachments', 'readwrite');
      const store = tx.objectStore('attachments');
      const request = store.put({
        ...attachment,
        user_id: userId,
        updated_at: new Date().toISOString(),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  public async getPendingAttachments(userId: string): Promise<LocalAttachment[]> {
    const db = await this.getDB(userId);
    return new Promise<LocalAttachment[]>((resolve, reject) => {
      const tx = db.transaction('attachments', 'readonly');
      const store = tx.objectStore('attachments');
      const index = store.index('sync_status');
      const request = index.getAll('pending');
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
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

  public async enqueueSyncItem(
    userId: string,
    item: Omit<SyncQueueItem, 'id' | 'attempts' | 'status' | 'user_id' | 'created_at'> & {
      id?: string;
      user_id?: string;
      created_at?: string;
    }
  ): Promise<SyncQueueItem> {
    const db = await this.getDB(userId);
    const syncItem: SyncQueueItem = {
      id: item.id || `sync_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      user_id: userId,
      action: item.action,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      payload: item.payload,
      revision: item.revision || 1,
      created_at: item.created_at || new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    };

    return new Promise<SyncQueueItem>((resolve, reject) => {
      const tx = db.transaction('sync_queue', 'readwrite');
      const store = tx.objectStore('sync_queue');

      // Se for uma ação repetida para o mesmo entity_id (ex: múltiplos UPDATE_NOTE_CONTENT rápidos),
      // podemos consolidar ou manter ordenado
      const request = store.put(syncItem);
      request.onsuccess = () => resolve(syncItem);
      request.onerror = () => reject(request.error);
    });
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
          .filter((item) => item.status === 'pending' || item.status === 'processing')
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
    lastError?: string
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
          item.attempts += 1;
          if (lastError !== undefined) item.last_error = lastError;
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
        const count = all.filter((i) => i.status === 'pending' || i.status === 'processing').length;
        resolve(count);
      };
      request.onerror = () => reject(request.error);
    });
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
