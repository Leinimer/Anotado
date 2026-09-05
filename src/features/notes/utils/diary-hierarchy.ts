import { MONTH_NAMES } from './diary-date';

/**
 * Utilitários de Hierarquia Real para o Diário no ANOTADO!
 *
 * REGRA ABSOLUTA (Regra 8):
 * NÃO usar workspace_type para definir a estrutura.
 * A hierarquia real é soberana:
 * - Ano = pasta raiz (parent_id === null) com nome YYYY (4 dígitos) ou diary_year.
 * - Mês = pasta filha de um Ano (parent_id === yearFolder.id).
 * - Dia = nota pertencente a um Mês (folder_id === monthFolder.id) ou que possua entry_date (YYYY-MM-DD).
 *
 * Pastas e notas normais do workspace Notas:
 * - Qualquer pasta que NÃO seja Ano ou Mês do Diário pertence exclusivamente às Notas.
 * - Qualquer nota que NÃO pertença ao Diário pertence exclusivamente às Notas.
 */

export interface MinimalFolder {
  id: string;
  name: string;
  parent_id?: string | null;
  diary_year?: number | null;
  diary_month?: number | null;
  position?: number | null;
}

export interface MinimalNote {
  id: string;
  folder_id?: string | null;
  entry_date?: string | null;
  diary_year?: number | null;
  diary_month?: number | null;
  diary_day?: number | null;
  title?: string;
  is_archived?: boolean | null;
  tags?: string[] | null;
  workspace_type?: string | null;
}

/**
 * Determina se uma pasta é uma pasta raiz de ANO do Diário.
 */
export function isDiaryYearFolder(folder: {
  parent_id?: string | null;
  name?: string | null;
  diary_year?: number | null;
}): boolean {
  if (folder.parent_id) return false;
  const name = String(folder.name || '').trim();
  if (/^\d{4}$/.test(name)) return true;
  if (folder.diary_year && folder.diary_year >= 1900 && folder.diary_year <= 2100) return true;
  return false;
}

/**
 * Extrai o número do ano (ex: 2026) a partir de uma pasta de ano.
 */
export function extractDiaryYear(folder: { name?: string | null; diary_year?: number | null }): number | null {
  if (folder.diary_year && folder.diary_year >= 1900 && folder.diary_year <= 2100) {
    return folder.diary_year;
  }
  const name = String(folder.name || '').trim();
  if (/^\d{4}$/.test(name)) {
    const parsed = parseInt(name, 10);
    if (!isNaN(parsed) && parsed >= 1900 && parsed <= 2100) {
      return parsed;
    }
  }
  return null;
}

/**
 * Determina se uma pasta é uma pasta de MÊS do Diário.
 */
export function isDiaryMonthFolder(
  folder: MinimalFolder,
  allFolders: MinimalFolder[] = []
): boolean {
  if (!folder.parent_id) return false;

  // Se tem o parent_id, verifica se o pai é uma pasta de ano
  const parent = allFolders.find((f) => f.id === folder.parent_id);
  if (parent && isDiaryYearFolder(parent)) {
    return true;
  }

  // Se possui diary_month definido
  if (folder.diary_month && folder.diary_month >= 1 && folder.diary_month <= 12) {
    return true;
  }

  // Se o nome é exatamente um dos 12 meses em português
  const cleanName = String(folder.name || '').trim().toLowerCase();
  const isMonthName = MONTH_NAMES.some((m) => m.toLowerCase() === cleanName);
  if (isMonthName) {
    return true;
  }

  return false;
}

/**
 * Extrai o número do mês (1 a 12) a partir de uma pasta de mês.
 */
export function extractDiaryMonth(folder: {
  name?: string | null;
  diary_month?: number | null;
  position?: number | null;
}): number | null {
  if (folder.diary_month && folder.diary_month >= 1 && folder.diary_month <= 12) {
    return folder.diary_month;
  }
  const cleanName = String(folder.name || '').trim().toLowerCase();
  const idx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === cleanName);
  if (idx !== -1) {
    return idx + 1;
  }
  if (folder.position && folder.position >= 1 && folder.position <= 12) {
    return folder.position;
  }
  return null;
}

/**
 * Retorna true se a pasta for do Diário (Ano ou Mês).
 */
export function isDiaryFolder(folder: MinimalFolder, allFolders: MinimalFolder[] = []): boolean {
  return isDiaryYearFolder(folder) || isDiaryMonthFolder(folder, allFolders);
}

/**
 * Retorna true se a nota pertencer ao Diário.
 */
export function isDiaryNote(note: MinimalNote, allFolders: MinimalFolder[] = []): boolean {
  if (note.workspace_type === 'diary') {
    return true;
  }
  if (note.entry_date && /^\d{4}-\d{2}-\d{2}/.test(note.entry_date.trim())) {
    return true;
  }
  if (note.diary_year && note.diary_day) {
    return true;
  }
  if (Array.isArray(note.tags) && note.tags.some((t) => t === 'diary' || t.startsWith('diary:') || t.startsWith('day:'))) {
    return true;
  }
  if (note.folder_id) {
    const parentFolder = allFolders.find((f) => f.id === note.folder_id);
    if (parentFolder && isDiaryFolder(parentFolder, allFolders)) {
      return true;
    }
  }
  return false;
}

/**
 * Retorna true se a pasta pertencer exclusivamente ao workspace Notas.
 */
export function isNotesFolder(folder: MinimalFolder, allFolders: MinimalFolder[] = []): boolean {
  return !isDiaryFolder(folder, allFolders);
}

/**
 * Retorna true se a nota pertencer exclusivamente ao workspace Notas.
 */
export function isNotesNote(note: MinimalNote, allFolders: MinimalFolder[] = []): boolean {
  return !isDiaryNote(note, allFolders);
}

