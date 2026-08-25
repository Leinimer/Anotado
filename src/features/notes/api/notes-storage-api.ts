import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { indexedDBStorage } from '../db/indexed-db';
import { networkMonitor } from './network-monitor';

export const NOTES_BUCKET_NAME = 'notes';

/**
 * Retorna o caminho canônico do arquivo no Supabase Storage:
 * notes/{user_id}/{note_id}.md
 */
export function getNoteStoragePath(userId: string, noteId: string): string {
  const cleanUserId = userId || 'anonymous';
  const cleanNoteId = noteId.trim();
  return `${cleanUserId}/${cleanNoteId}.md`;
}

/**
 * Lê o arquivo Markdown de uma nota:
 * 1. Consulta primeiro a cópia local no IndexedDB para carregamento instantâneo (<5ms).
 * 2. Se não existir no IndexedDB e estiver online, baixa do Supabase Storage e armazena no IndexedDB.
 */
export async function readNoteMarkdown(userId: string, noteId: string): Promise<string | null> {
  if (!userId || !noteId) return null;

  // 1. Tenta recuperar do IndexedDB
  try {
    const localNote = await indexedDBStorage.getNoteById(userId, noteId);
    if (localNote && localNote.content !== undefined && localNote.content !== null) {
      return localNote.content;
    }
  } catch (err) {
    console.warn('[NotesStorage] Erro ao ler nota do IndexedDB:', err);
  }

  // 2. Se online e configurado, busca do Supabase Storage
  const isOnline = networkMonitor.getState().isBackendReachable;
  if (isOnline && isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const filePath = getNoteStoragePath(userId, noteId);

      const { data, error } = await supabase.storage
        .from(NOTES_BUCKET_NAME)
        .download(filePath);

      if (!error && data) {
        const text = await data.text();
        return text;
      }
    } catch (err) {
      console.warn('[NotesStorage] Erro ao baixar nota do Supabase Storage:', err);
    }
  }

  return null;
}

/**
 * Grava/atualiza o arquivo Markdown (.md) de uma nota no Supabase Storage.
 * Utiliza Content-Type: 'text/markdown' e upsert: true para atomicidade.
 */
export async function writeNoteMarkdown(
  userId: string,
  noteId: string,
  markdownContent: string
): Promise<boolean> {
  if (!userId || !noteId) return false;

  const content = markdownContent ?? '';

  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    try {
      const supabase = createClient();
      const filePath = getNoteStoragePath(userId, noteId);
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });

      const { error } = await supabase.storage
        .from(NOTES_BUCKET_NAME)
        .upload(filePath, blob, {
          contentType: 'text/markdown;charset=utf-8',
          upsert: true,
          cacheControl: '0',
        });

      if (error) {
        console.warn(`[NotesStorage] Aviso ao gravar ${filePath} no Supabase Storage:`, error.message);
        return false;
      }

      return true;
    } catch (err) {
      console.warn('[NotesStorage] Exceção ao gravar no Supabase Storage:', err);
      return false;
    }
  }

  return true;
}

/**
 * Remove o arquivo Markdown (.md) de uma nota do Supabase Storage.
 */
export async function deleteNoteMarkdown(userId: string, noteId: string): Promise<boolean> {
  if (!userId || !noteId) return false;

  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    try {
      const supabase = createClient();
      const filePath = getNoteStoragePath(userId, noteId);

      const { error } = await supabase.storage
        .from(NOTES_BUCKET_NAME)
        .remove([filePath]);

      if (error) {
        console.warn(`[NotesStorage] Aviso ao remover ${filePath} do Storage:`, error);
        return false;
      }

      return true;
    } catch (err) {
      console.warn('[NotesStorage] Exceção ao remover arquivo Markdown:', err);
      return false;
    }
  }

  return true;
}
