import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';

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

const LOCAL_STORAGE_NOTE_FILES_PREFIX = 'anotado_md_file_';

/**
 * Lê o arquivo Markdown de uma nota diretamente do Supabase Storage.
 * Retorna o conteúdo textual ou null se não encontrado/erro.
 */
export async function readNoteMarkdown(userId: string, noteId: string): Promise<string | null> {
  if (!userId || !noteId) return null;

  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const filePath = getNoteStoragePath(userId, noteId);

      const { data, error } = await supabase.storage
        .from(NOTES_BUCKET_NAME)
        .download(filePath);

      if (!error && data) {
        const text = await data.text();
        // Sincroniza cache local
        if (typeof window !== 'undefined') {
          localStorage.setItem(`${LOCAL_STORAGE_NOTE_FILES_PREFIX}${userId}_${noteId}`, text);
        }
        return text;
      }

      if (error) {
        console.warn(`[Storage] Arquivo não encontrado no Supabase Storage (${filePath}):`, error.message);
      }
    } catch (err) {
      console.warn('[Storage] Erro ao ler nota do Supabase Storage:', err);
    }
  }

  // Fallback para armazenamento local
  if (typeof window !== 'undefined') {
    return localStorage.getItem(`${LOCAL_STORAGE_NOTE_FILES_PREFIX}${userId}_${noteId}`);
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

  // Atualiza cache local imediatamente para fluidez
  if (typeof window !== 'undefined') {
    localStorage.setItem(`${LOCAL_STORAGE_NOTE_FILES_PREFIX}${userId}_${noteId}`, content);
  }

  if (isSupabaseConfigured()) {
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
        console.error(`[Storage] Erro ao gravar ${filePath} no bucket ${NOTES_BUCKET_NAME}:`, error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('[Storage] Exceção ao gravar arquivo Markdown no Supabase Storage:', err);
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

  // Limpa cache local
  if (typeof window !== 'undefined') {
    localStorage.removeItem(`${LOCAL_STORAGE_NOTE_FILES_PREFIX}${userId}_${noteId}`);
  }

  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const filePath = getNoteStoragePath(userId, noteId);

      const { error } = await supabase.storage
        .from(NOTES_BUCKET_NAME)
        .remove([filePath]);

      if (error) {
        console.warn(`[Storage] Erro ao remover ${filePath} do Storage:`, error);
        return false;
      }

      return true;
    } catch (err) {
      console.warn('[Storage] Exceção ao remover arquivo Markdown:', err);
      return false;
    }
  }

  return true;
}
