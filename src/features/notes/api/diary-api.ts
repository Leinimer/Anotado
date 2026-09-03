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
import { MONTH_NAMES, parseDiaryDate, formatDiaryTitle, getLocalDateString } from '../utils/diary-date';

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
    const yearFolderId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `diary-year-${year}-${Date.now()}`;
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
      const monthFolderId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `diary-month-${year}-${m}-${Date.now()}`;
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

  const cleanDate = dateStr.trim();
  const { year, month, day } = parseDiaryDate(cleanDate);

  // 1. Verifica se já existe entrada para este dia no Diário
  const existing = await indexedDBStorage.getDiaryEntryByDate(userId, cleanDate);
  if (existing) {
    console.log(`[Diary] Entrada existente encontrada para data=${cleanDate}, noteId=${existing.id}`);
    return { note: existing, isNew: false };
  }

  // 2. Garante que as pastas do Ano e Mês existam
  const { monthFolders } = await ensureDiaryYearFolders(userId, year);
  const targetMonthFolder = monthFolders.find((f) => f.diary_month === month) || monthFolders[month - 1];

  // 3. Cria a nova entrada diária
  const noteId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `diary-note-${cleanDate}-${Date.now()}`;
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
