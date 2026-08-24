import JSZip from 'jszip';
import { Note, SYSTEM_ARCHIVE_FOLDER_ID } from '../types';
import { readNoteMarkdown } from '../api/notes-storage-api';
import { extractHashtagsFromText } from './hashtag-extractor';

/**
 * Sanitiza o título de uma nota para um nome de arquivo válido no sistema de arquivos.
 * Substitui caracteres proibidos por '-', remove múltiplos espaços e caracteres de controle.
 */
export function sanitizeFileName(name: string): string {
  if (!name || !name.trim()) return 'Sem título';
  const clean = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim();
  return clean || 'Sem título';
}

export interface ExportProgress {
  current: number;
  total: number;
  currentNoteTitle?: string;
  status: 'idle' | 'fetching' | 'processing' | 'zipping' | 'completed' | 'error';
  errorMessage?: string;
}

/**
 * Exporta todas as notas NÃO arquivadas do usuário autenticado para um arquivo .ZIP
 * contendo arquivos .md individuais.
 */
export async function exportNonArchivedNotesToZip(
  userId: string,
  allNotes: Note[],
  onProgress?: (progress: ExportProgress) => void
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    onProgress?.({
      current: 0,
      total: 0,
      status: 'fetching',
    });

    // 1. Filtrar estritamente notas NÃO arquivadas
    const nonArchivedNotes = allNotes.filter(
      (note) => !note.is_archived && note.folder_id !== SYSTEM_ARCHIVE_FOLDER_ID
    );

    const total = nonArchivedNotes.length;
    if (total === 0) {
      onProgress?.({
        current: 0,
        total: 0,
        status: 'completed',
      });
      return { success: true, count: 0 };
    }

    onProgress?.({
      current: 0,
      total,
      status: 'processing',
    });

    const zip = new JSZip();
    const usedFileNames = new Map<string, number>();

    // 2. Iterar sobre cada nota não arquivada
    for (let i = 0; i < total; i++) {
      const note = nonArchivedNotes[i];
      onProgress?.({
        current: i + 1,
        total,
        currentNoteTitle: note.title,
        status: 'processing',
      });

      // Obter o conteúdo Markdown da nota (Storage -> fallback para note.content)
      let markdown = '';
      try {
        const storageMd = await readNoteMarkdown(userId, note.id);
        if (storageMd !== null && storageMd !== undefined) {
          markdown = storageMd;
        } else {
          markdown = note.content || '';
        }
      } catch (err) {
        console.warn(`[Export] Aviso ao buscar nota ${note.id} no storage, usando note.content:`, err);
        markdown = note.content || '';
      }

      // Preservar título e tags existentes no Markdown
      if (note.tags && Array.isArray(note.tags) && note.tags.length > 0) {
        const existingTagsInBody = new Set(
          extractHashtagsFromText(markdown).map((t) => t.toLowerCase())
        );
        const missingTags = note.tags.filter(
          (t) => !existingTagsInBody.has(t.toLowerCase().replace(/^#+/, ''))
        );
        if (missingTags.length > 0) {
          const tagsSuffix = missingTags
            .map((t) => (t.startsWith('#') ? t : `#${t}`))
            .join(' ');
          markdown = markdown.trim()
            ? `${markdown.trim()}\n\n${tagsSuffix}`
            : tagsSuffix;
        }
      }

      // Sanitizar nome do arquivo e resolver duplicatas
      const baseName = sanitizeFileName(note.title);
      let finalFileName: string;

      const lowerBase = baseName.toLowerCase();
      if (usedFileNames.has(lowerBase)) {
        const currentCount = usedFileNames.get(lowerBase)! + 1;
        usedFileNames.set(lowerBase, currentCount);
        finalFileName = `${baseName} (${currentCount}).md`;
      } else {
        usedFileNames.set(lowerBase, 1);
        finalFileName = `${baseName}.md`;
      }

      zip.file(finalFileName, markdown);
    }

    onProgress?.({
      current: total,
      total,
      status: 'zipping',
    });

    // 3. Gerar o blob ZIP e acionar o download do arquivo anotado-notas.zip
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const downloadUrl = URL.createObjectURL(zipBlob);
    const downloadLink = document.createElement('a');
    downloadLink.href = downloadUrl;
    downloadLink.download = 'anotado-notas.zip';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

    onProgress?.({
      current: total,
      total,
      status: 'completed',
    });

    return { success: true, count: total };
  } catch (err: any) {
    console.error('[Export] Erro na exportação de notas:', err);
    onProgress?.({
      current: 0,
      total: 0,
      status: 'error',
      errorMessage: err?.message || 'Erro desconhecido ao exportar notas.',
    });
    return {
      success: false,
      count: 0,
      error: err?.message || 'Erro ao exportar notas.',
    };
  }
}
