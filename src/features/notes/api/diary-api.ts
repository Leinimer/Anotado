/**
 * API e Lógica de Domínio do DIÁRIO no ANOTADO!
 *
 * Implementa a estrutura hierárquica rigorosa:
 * ANO -> MÊS (12 meses em ordem cronológica) -> ENTRADA DIÁRIA (Dia 01, Dia 02...)
 *
 * Regras:
 * 1. Usa a mesma infraestrutura de SyncQueue, IndexedDB, Supabase e SyncEngine.
 * 2. Isolamento via workspace_type: 'diary'.
 * 3. Unicidade: não permite duas entradas para o mesmo (usuário + data + diário).
 * 4. Preservação de fuso horário local.
 */

import { indexedDBStorage, ExtendedFolder, ExtendedNote } from '../db/indexed-db';
import { syncEngine } from './sync-engine';
import { networkMonitor } from './network-monitor';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import {
  MONTH_NAMES,
  parseDiaryDate,
  formatDiaryTitle,
  getLocalDateString,
  buildDiaryDateString,
  getDaysInMonth,
} from '../utils/diary-date';
import { generateUUID } from '../utils/uuid';
import { Note } from '../types';

/**
 * Garante que a estrutura de pastas para um determinado ano exista no Diário.
 * Cria a pasta do Ano (ex: "2026") e as 12 subpastas dos meses (Janeiro a Dezembro)
 * caso ainda não tenham sido criadas.
 */
export async function ensureDiaryYearFolders(
  userId: string,
  year: number
): Promise<{ yearFolder: ExtendedFolder; monthFolders: ExtendedFolder[] }> {
  if (!userId) {
    throw new Error('UserId obrigatório para criar pastas do Diário.');
  }

  const existingFolders = await indexedDBStorage.getAllFolders(userId, 'diary');

  // 1. Procura ou cria a pasta do Ano
  const yearStr = String(year);
  let yearFolder = existingFolders.find(
    (f) => f.workspace_type === 'diary' && f.parent_id === null && f.name === yearStr
  );

  if (!yearFolder) {
    const yearFolderId = generateUUID();
    yearFolder = {
      id: yearFolderId,
      user_id: userId,
      name: yearStr,
      parent_id: null,
      position: year,
      color: '#635b54',
      workspace_type: 'diary',
      diary_year: year,
      is_smart: false,
      smart_tags: [],
      syncRequired: true,
      syncStatus: 'pending',
      revision: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await indexedDBStorage.putFolder(userId, yearFolder);
    await indexedDBStorage.enqueueSyncItem(userId, {
      action: 'CREATE_FOLDER',
      entity_type: 'folder',
      entity_id: yearFolder.id,
      payload: yearFolder,
      revision: 1,
    });
  }

  // 2. Garante os 12 meses sob a pasta do Ano
  const monthFolders: ExtendedFolder[] = [];

  for (let m = 1; m <= 12; m++) {
    const monthName = MONTH_NAMES[m - 1];
    let monthFolder = existingFolders.find(
      (f) =>
        f.workspace_type === 'diary' &&
        f.parent_id === yearFolder!.id &&
        (f.diary_month === m || f.name === monthName)
    );

    if (!monthFolder) {
      const monthFolderId = generateUUID();
      monthFolder = {
        id: monthFolderId,
        user_id: userId,
        name: monthName,
        parent_id: yearFolder.id,
        position: m,
        workspace_type: 'diary',
        diary_year: year,
        diary_month: m,
        is_smart: false,
        smart_tags: [],
        syncRequired: true,
        syncStatus: 'pending',
        revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await indexedDBStorage.putFolder(userId, monthFolder);
      await indexedDBStorage.enqueueSyncItem(userId, {
        action: 'CREATE_FOLDER',
        entity_type: 'folder',
        entity_id: monthFolder.id,
        payload: monthFolder,
        revision: 1,
      });
    }

    monthFolders.push(monthFolder);
  }

  syncEngine.scheduleSync(300);
  return { yearFolder, monthFolders };
}

/**
 * Obtém ou cria a entrada diária para uma determinada data (YYYY-MM-DD).
 * Regra: Cada dia é uma entidade única. Não permite duplicidade para (usuário + data + diário).
 */
export async function getOrCreateDiaryEntry(
  userId: string,
  dateStr: string,
  customTitle?: string
): Promise<{ note: ExtendedNote; isNew: boolean }> {
  if (!userId) {
    throw new Error('UserId obrigatório para entrada do Diário.');
  }

  const { year, month, day } = parseDiaryDate(dateStr);
  const cleanDate = buildDiaryDateString(year, month, day);

  // 1. Verifica se já existe entrada para este dia no IndexedDB local
  const existingLocal = await indexedDBStorage.getDiaryEntryByDate(userId, cleanDate);
  if (existingLocal) {
    console.log(`[Diary] Entrada local existente encontrada para data=${cleanDate}, noteId=${existingLocal.id}`);
    return { note: existingLocal, isNew: false };
  }

  // 2. Se online e Supabase estiver configurado, verifica se outro dispositivo criou a entrada
  if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
    try {
      const supabase = createClient();
      const { data: remoteNotes } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', userId)
        .eq('workspace_type', 'diary')
        .eq('entry_date', cleanDate)
        .eq('is_archived', false)
        .limit(1);

      if (remoteNotes && remoteNotes.length > 0) {
        const remoteRecord = remoteNotes[0];
        const remoteNote: ExtendedNote = {
          ...remoteRecord,
          syncRequired: false,
          syncStatus: 'synced',
          sync_status: 'synced',
          needs_sync: false,
        };
        await indexedDBStorage.putNote(userId, remoteNote);
        console.log(`[Diary] Entrada remota existente importada para data=${cleanDate}, noteId=${remoteNote.id}`);
        return { note: remoteNote, isNew: false };
      }
    } catch (err) {
      console.warn('[Diary] Verificação remota de duplicidade falhou, prosseguindo com criação local:', err);
    }
  }

  // 3. Garante que as pastas do Ano e Mês existam estruturalmente
  const { monthFolders } = await ensureDiaryYearFolders(userId, year);
  const targetMonthFolder = monthFolders.find((f) => f.diary_month === month) || monthFolders[month - 1];

  // 4. Cria a nova entrada diária LAZY (apenas este dia, sem criar os 365 dias)
  const noteId = generateUUID();
  const title = formatDiaryTitle(day, customTitle);

  const newDiaryNote: ExtendedNote = {
    id: noteId,
    user_id: userId,
    folder_id: targetMonthFolder ? targetMonthFolder.id : null,
    title,
    content: '',
    position: day,
    tags: [],
    workspace_type: 'diary',
    entry_date: cleanDate,
    diary_year: year,
    diary_month: month,
    diary_day: day,
    is_archived: false,
    syncRequired: true,
    syncStatus: 'pending',
    revision: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await indexedDBStorage.putNote(userId, newDiaryNote);
  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'CREATE_NOTE',
    entity_type: 'note',
    entity_id: noteId,
    payload: newDiaryNote,
    revision: 1,
  });

  console.log(`[Diary] Nova entrada criada com sucesso: date=${cleanDate}, noteId=${noteId}, title="${title}"`);
  syncEngine.scheduleSync(300);

  return { note: newDiaryNote, isNew: true };
}

/**
 * Cria explicitamente um novo ano no Diário (ex: 2027, 2028).
 */
export async function createDiaryYear(userId: string, year: number): Promise<ExtendedFolder> {
  const { yearFolder } = await ensureDiaryYearFolders(userId, year);
  return yearFolder;
}

/**
 * Atalho para obter ou criar a entrada de HOJE na data local do usuário.
 */
export async function getOrCreateTodayDiaryEntry(userId: string): Promise<{ note: ExtendedNote; isNew: boolean }> {
  const todayStr = getLocalDateString();
  return getOrCreateDiaryEntry(userId, todayStr);
}

/**
 * Status individual de um dia do mês para o Diário.
 */
export interface DiaryDayStatus {
  day: number;
  dateStr: string;
  hasEntry: boolean;
  hasContent: boolean;
  note: Note | null;
}

/**
 * Sumário estrutural de um mês do Diário.
 * Prepara o modelo de dados para calendários e métricas futuras:
 * - quais dias possuem entrada
 * - quais dias não possuem
 * - quantidade de entradas
 * - dias com conteúdo
 * - dias sem conteúdo
 */
export interface DiaryMonthSummary {
  year: number;
  month: number;
  daysInMonth: number;
  totalEntries: number;
  daysWithContentCount: number;
  daysEmptyCount: number;
  daysWithoutEntryCount: number;
  daysWithContent: number[];
  daysEmpty: number[];
  daysWithoutEntry: number[];
  days: DiaryDayStatus[];
  entriesByDay: Record<number, Note>;
}

/**
 * Computa o resumo estrutural completo de um mês do Diário a partir das notas em memória/armazenamento.
 */
export function computeDiaryMonthSummary(
  notes: Note[],
  year: number,
  month: number
): DiaryMonthSummary {
  const daysInMonth = getDaysInMonth(year, month);
  const monthNotes = notes.filter((n) => {
    if (n.workspace_type !== 'diary') return false;
    if (n.is_archived) return false;
    if (n.diary_year === year && n.diary_month === month) return true;
    if (n.entry_date) {
      const p = parseDiaryDate(n.entry_date);
      return p.year === year && p.month === month;
    }
    return false;
  });

  const entriesByDay: Record<number, Note> = {};
  monthNotes.forEach((note) => {
    let day = note.diary_day;
    if (!day && note.entry_date) {
      day = parseDiaryDate(note.entry_date).day;
    }
    if (day && day >= 1 && day <= daysInMonth && !entriesByDay[day]) {
      entriesByDay[day] = note;
    }
  });

  const daysWithContent: number[] = [];
  const daysEmpty: number[] = [];
  const daysWithoutEntry: number[] = [];
  const days: DiaryDayStatus[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const entry = entriesByDay[d] || null;
    const dateStr = buildDiaryDateString(year, month, d);
    const hasEntry = Boolean(entry);
    const hasContent = Boolean(entry && (entry.content || '').trim().length > 0);

    if (!entry) {
      daysWithoutEntry.push(d);
    } else if (hasContent) {
      daysWithContent.push(d);
    } else {
      daysEmpty.push(d);
    }

    days.push({
      day: d,
      dateStr,
      hasEntry,
      hasContent,
      note: entry,
    });
  }

  return {
    year,
    month,
    daysInMonth,
    totalEntries: Object.keys(entriesByDay).length,
    daysWithContentCount: daysWithContent.length,
    daysEmptyCount: daysEmpty.length,
    daysWithoutEntryCount: daysWithoutEntry.length,
    daysWithContent,
    daysEmpty,
    daysWithoutEntry,
    days,
    entriesByDay,
  };
}
