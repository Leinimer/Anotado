/**
 * API e Lógica de Domínio do DIÁRIO no ANOTADO!
 *
 * Implementa a estrutura hierárquica rigorosa:
 * ANO -> MÊS (12 meses em ordem cronológica) -> ENTRADA DIÁRIA (Dia 01, Dia 02...)
 *
 * Regras:
 * 1. ANO: Pasta raiz com nome YYYY (ex: "2026") - exatamente UMA por ano.
 * 2. MÊS: Pastas filhas do ano (Janeiro a Dezembro) - exatamente 12 por ano.
 * 3. DIAS VIRTUAIS: Dias não são notas pré-criadas. Apenas exibidos na interface.
 * 4. NOTA DIÁRIA: Criada sob demanda ao clicar no dia (máximo 1 nota por dia). Idempotente.
 * 5. SEM DEPENDÊNCIA de workspace_type: A hierarquia real é a única fonte da verdade.
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
import {
  isDiaryYearFolder,
  extractDiaryYear,
  isDiaryMonthFolder,
  extractDiaryMonth,
  isDiaryFolder,
  isDiaryNote,
} from '../utils/diary-hierarchy';
import {
  generateUUID,
  getDeterministicDiaryYearFolderId,
  getDeterministicDiaryMonthFolderId,
  getDeterministicDiaryNoteId,
} from '../utils/uuid';
import { Note } from '../types';

// Mutex em memória para evitar concorrência e duplicidade por cliques rápidos ou renderizações paralelas
const inFlightYearCreations = new Map<string, Promise<{ yearFolder: ExtendedFolder; monthFolders: ExtendedFolder[] }>>();
const inFlightEntryCreations = new Map<string, Promise<{ note: ExtendedNote; isNew: boolean }>>();

/**
 * Garante que a estrutura de pastas para um determinado ano exista no Diário.
 * Cria a pasta do Ano (ex: "2026") e exatamente as 12 subpastas dos meses (Janeiro a Dezembro)
 * sem NUNCA duplicar pastas existentes e utilizando chaves determinísticas.
 */
export async function ensureDiaryYearFolders(
  userId: string,
  year: number
): Promise<{ yearFolder: ExtendedFolder; monthFolders: ExtendedFolder[] }> {
  if (!userId) {
    throw new Error('UserId obrigatório para criar pastas do Diário.');
  }

  const mutexKey = `${userId}:${year}`;
  const existingInFlight = inFlightYearCreations.get(mutexKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const promise = (async () => {
    try {
      const yearStr = String(year);
      const canonicalYearId = getDeterministicDiaryYearFolderId(userId, year);
      const allLocalFolders = await indexedDBStorage.getAllFolders(userId);

      // 1. Procura pasta de ano existente localmente (baseado na hierarquia real ou ID determinístico)
      let yearFolders = allLocalFolders.filter(
        (f) => f.id === canonicalYearId || (isDiaryYearFolder(f) && extractDiaryYear(f) === year)
      );

      let yearFolder: ExtendedFolder | null = null;

      // Se houver pasta(s) para o mesmo ano, prioriza o ID determinístico ou a mais antiga
      if (yearFolders.length > 0) {
        const exactDeterministic = yearFolders.find((f) => f.id === canonicalYearId);
        if (exactDeterministic) {
          yearFolder = exactDeterministic;
        } else {
          yearFolders.sort((a, b) => {
            const tA = new Date(a.created_at || 0).getTime();
            const tB = new Date(b.created_at || 0).getTime();
            return tA - tB;
          });
          yearFolder = yearFolders[0];
        }
      }

      // Se não encontrou no IndexedDB local, verifica se existe no Supabase antes de criar
      if (!yearFolder && isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
        try {
          const supabase = createClient();
          // Busca primeiro pelo ID determinístico
          const { data: remoteById } = await supabase
            .from('folders')
            .select('*')
            .eq('id', canonicalYearId)
            .limit(1);

          if (remoteById && remoteById.length > 0) {
            const matched: ExtendedFolder = {
              ...remoteById[0],
              workspace_type: 'diary',
              diary_year: year,
              syncRequired: false,
              syncStatus: 'synced',
              sync_status: 'synced',
              needs_sync: false,
            };
            yearFolder = matched;
            await indexedDBStorage.putFolder(userId, matched);
          } else {
            const { data: remoteYearFolders } = await supabase
              .from('folders')
              .select('*')
              .eq('user_id', userId)
              .is('parent_id', null)
              .order('created_at', { ascending: true });

            if (remoteYearFolders && remoteYearFolders.length > 0) {
              const match = remoteYearFolders.find(
                (rf: any) => isDiaryYearFolder(rf) && extractDiaryYear(rf) === year
              );
              if (match) {
                const matchedFolder: ExtendedFolder = {
                  ...match,
                  workspace_type: 'diary',
                  diary_year: year,
                  syncRequired: false,
                  syncStatus: 'synced',
                  sync_status: 'synced',
                  needs_sync: false,
                };
                yearFolder = matchedFolder;
                await indexedDBStorage.putFolder(userId, matchedFolder);
              }
            }
          }
        } catch (remoteErr) {
          console.warn('[Diary] Verificação remota de ano falhou:', remoteErr);
        }
      }

      // Se realmente não existir, cria a única pasta canônica do ano usando ID determinístico
      if (!yearFolder) {
        const newFolder: ExtendedFolder = {
          id: canonicalYearId,
          user_id: userId,
          name: yearStr,
          parent_id: null,
          position: year,
          color: '#68594d',
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

        yearFolder = newFolder;
        await indexedDBStorage.putFolder(userId, newFolder);
        await indexedDBStorage.enqueueSyncItem(userId, {
          action: 'CREATE_FOLDER',
          entity_type: 'folder',
          entity_id: newFolder.id,
          payload: newFolder,
          revision: 1,
        });
      }

      const activeYearFolder: ExtendedFolder = yearFolder;

      // 2. Garante exatamente os 12 meses sob a pasta do Ano
      const currentFolders = await indexedDBStorage.getAllFolders(userId);
      const existingMonths = currentFolders.filter((f) => f.parent_id === activeYearFolder.id);

      const monthFolders: ExtendedFolder[] = [];

      for (let m = 1; m <= 12; m++) {
        const monthName = MONTH_NAMES[m - 1];
        const canonicalMonthId = getDeterministicDiaryMonthFolderId(userId, year, m);

        // Procura mês pelo ID determinístico, número ou nome (case-insensitive)
        let monthFolder = existingMonths.find((f) => {
          if (f.id === canonicalMonthId) return true;
          if (f.diary_month === m) return true;
          if (extractDiaryMonth(f) === m) return true;
          const clean = String(f.name || '').trim().toLowerCase();
          return clean === monthName.toLowerCase();
        });

        // Se não encontrou localmente, verifica se existe remotamente no Supabase
        if (!monthFolder && isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
          try {
            const supabase = createClient();
            const { data: remoteById } = await supabase
              .from('folders')
              .select('*')
              .eq('id', canonicalMonthId)
              .limit(1);

            if (remoteById && remoteById.length > 0) {
              const matchedMonth: ExtendedFolder = {
                ...remoteById[0],
                workspace_type: 'diary',
                diary_year: year,
                diary_month: m,
                syncRequired: false,
                syncStatus: 'synced',
                sync_status: 'synced',
                needs_sync: false,
              };
              monthFolder = matchedMonth;
              await indexedDBStorage.putFolder(userId, matchedMonth);
            } else {
              const { data: remoteMonths } = await supabase
                .from('folders')
                .select('*')
                .eq('user_id', userId)
                .eq('parent_id', activeYearFolder.id);

              if (remoteMonths && remoteMonths.length > 0) {
                const rMatch = remoteMonths.find((rf: any) => {
                  if (rf.diary_month === m) return true;
                  if (extractDiaryMonth(rf) === m) return true;
                  const clean = String(rf.name || '').trim().toLowerCase();
                  return clean === monthName.toLowerCase();
                });
                if (rMatch) {
                  const matchedMonth: ExtendedFolder = {
                    ...rMatch,
                    workspace_type: 'diary',
                    diary_year: year,
                    diary_month: m,
                    syncRequired: false,
                    syncStatus: 'synced',
                    sync_status: 'synced',
                    needs_sync: false,
                  };
                  monthFolder = matchedMonth;
                  await indexedDBStorage.putFolder(userId, matchedMonth);
                }
              }
            }
          } catch (rErr) {
            console.warn('[Diary] Verificação remota de mês falhou:', rErr);
          }
        }

        // Se não existir, cria a pasta deste mês com ID determinístico
        if (!monthFolder) {
          const newMonth: ExtendedFolder = {
            id: canonicalMonthId,
            user_id: userId,
            name: monthName,
            parent_id: activeYearFolder.id,
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
          monthFolder = newMonth;

          await indexedDBStorage.putFolder(userId, newMonth);
          await indexedDBStorage.enqueueSyncItem(userId, {
            action: 'CREATE_FOLDER',
            entity_type: 'folder',
            entity_id: newMonth.id,
            payload: newMonth,
            revision: 1,
          });
        }

        monthFolders.push(monthFolder);
      }

      syncEngine.scheduleSync(300);
      return { yearFolder: activeYearFolder, monthFolders };
    } finally {
      inFlightYearCreations.delete(mutexKey);
    }
  })();

  inFlightYearCreations.set(mutexKey, promise);
  return promise;
}

/**
 * Reconcilia e deduplica totalmente pastas e notas do Diário.
 * Corrige duplicações existentes no IndexedDB e no Supabase:
 * - Unifica múltiplos anos do mesmo ano (ex: múltiplos "2026") sob uma pasta canônica.
 * - Unifica meses duplicados (ex: múltiplos "Setembro" sob 2026) sob um mês canônico.
 * - Reassocia todas as notas às pastas canônicas correspondentes.
 * - Deduplica notas do mesmo dia DE FORMA NÃO DESTRUTIVA:
 *   * se uma tiver conteúdo e outra vazia, preserva a com conteúdo;
 *   * se ambas tiverem conteúdo distinto, unifica os textos e tags preservando tudo;
 *   * exclui com segurança apenas os registros duplicados redundantes/vazios;
 *   * garante que nenhum anexo ou texto do usuário seja perdido.
 */
export async function reconcileAndDeduplicateDiary(userId: string): Promise<void> {
  if (!userId || userId === 'local-user') return;

  try {
    const allLocalFolders = await indexedDBStorage.getAllFolders(userId);
    const allLocalNotes = await indexedDBStorage.getAllNotes(userId);

    // 1. Identifica todas as pastas de ano
    const yearFoldersMap = new Map<number, ExtendedFolder[]>();
    for (const f of allLocalFolders) {
      if (isDiaryYearFolder(f)) {
        const y = extractDiaryYear(f);
        if (y) {
          const list = yearFoldersMap.get(y) || [];
          list.push(f);
          yearFoldersMap.set(y, list);
        }
      }
    }

    const foldersToDelete = new Set<string>();
    const notesToDelete = new Set<string>();
    const foldersToUpdate: ExtendedFolder[] = [];
    const notesToUpdate: ExtendedNote[] = [];

    // Processa deduplicação de anos
    for (const [yearNum, foldersForYear] of yearFoldersMap.entries()) {
      if (foldersForYear.length <= 1) continue;

      const canonicalId = getDeterministicDiaryYearFolderId(userId, yearNum);
      const exactMatch = foldersForYear.find((f) => f.id === canonicalId);

      let canonicalYear: ExtendedFolder;
      let duplicateYears: ExtendedFolder[];

      if (exactMatch) {
        canonicalYear = exactMatch;
        duplicateYears = foldersForYear.filter((f) => f.id !== canonicalId);
      } else {
        foldersForYear.sort((a, b) => {
          const tA = new Date(a.created_at || 0).getTime();
          const tB = new Date(b.created_at || 0).getTime();
          return tA - tB;
        });
        canonicalYear = foldersForYear[0];
        duplicateYears = foldersForYear.slice(1);
      }

      for (const dupYear of duplicateYears) {
        foldersToDelete.add(dupYear.id);

        // Reatribui meses cujo parent_id é o ano duplicado
        for (const childFolder of allLocalFolders) {
          if (childFolder.parent_id === dupYear.id) {
            childFolder.parent_id = canonicalYear.id;
            foldersToUpdate.push(childFolder);
          }
        }

        // Reatribui notas caso alguma estivesse diretamente no ano duplicado
        for (const note of allLocalNotes) {
          if (note.folder_id === dupYear.id) {
            note.folder_id = canonicalYear.id;
            notesToUpdate.push(note);
          }
        }
      }
    }

    // 2. Processa deduplicação de meses sob cada ano canônico
    const refreshedFolders = allLocalFolders.filter((f) => !foldersToDelete.has(f.id));
    const yearFolders = refreshedFolders.filter((f) => isDiaryYearFolder(f));

    for (const yearF of yearFolders) {
      const yNum = extractDiaryYear(yearF);
      if (!yNum) continue;

      const childMonths = refreshedFolders.filter((f) => f.parent_id === yearF.id);
      const monthsByNum = new Map<number, ExtendedFolder[]>();

      for (const mFolder of childMonths) {
        const mNum = extractDiaryMonth(mFolder);
        if (mNum) {
          const list = monthsByNum.get(mNum) || [];
          list.push(mFolder);
          monthsByNum.set(mNum, list);
        }
      }

      for (const [mNum, foldersForMonth] of monthsByNum.entries()) {
        const canonicalMonthId = getDeterministicDiaryMonthFolderId(userId, yNum, mNum);
        const exactMonth = foldersForMonth.find((f) => f.id === canonicalMonthId);

        let canonicalMonth: ExtendedFolder;
        let duplicateMonths: ExtendedFolder[];

        if (exactMonth) {
          canonicalMonth = exactMonth;
          duplicateMonths = foldersForMonth.filter((f) => f.id !== canonicalMonthId);
        } else {
          foldersForMonth.sort((a, b) => {
            const tA = new Date(a.created_at || 0).getTime();
            const tB = new Date(b.created_at || 0).getTime();
            return tA - tB;
          });
          canonicalMonth = foldersForMonth[0];
          duplicateMonths = foldersForMonth.slice(1);
        }

        // Reatribui notas de meses duplicados para o mês canônico
        for (const dupMonth of duplicateMonths) {
          foldersToDelete.add(dupMonth.id);

          for (const note of allLocalNotes) {
            if (note.folder_id === dupMonth.id) {
              note.folder_id = canonicalMonth.id;
              note.diary_year = yNum;
              note.diary_month = mNum;
              notesToUpdate.push(note);
            }
          }
        }

        // 3. DEDUPLICAÇÃO DEFENSIVA DE NOTAS DO MESMO DIA SOB ESTE MÊS
        const allMonthFolderIds = new Set([canonicalMonth.id, ...duplicateMonths.map((d) => d.id)]);
        const notesInMonth = allLocalNotes.filter(
          (n) => !n.is_archived && (
            (n.folder_id && allMonthFolderIds.has(n.folder_id)) ||
            (n.diary_year === yNum && n.diary_month === mNum)
          )
        );

        // Agrupa notas por dia (1..31)
        const notesByDayMap = new Map<number, ExtendedNote[]>();
        for (const n of notesInMonth) {
          let day = n.diary_day;
          if (!day && n.entry_date) {
            day = parseDiaryDate(n.entry_date).day;
          }
          if (!day && typeof n.position === 'number' && n.position >= 1 && n.position <= 31) {
            day = n.position;
          }
          if (!day && n.title) {
            const match = n.title.match(/(?:Dia\s+|#\s*)0*([1-9]|[12]\d|3[01])\b/i);
            if (match) day = parseInt(match[1], 10);
          }

          if (day && day >= 1 && day <= 31) {
            const list = notesByDayMap.get(day) || [];
            list.push(n);
            notesByDayMap.set(day, list);
          }
        }

        for (const [dayNum, dayNotes] of notesByDayMap.entries()) {
          if (dayNotes.length <= 1) continue;

          // Mais de uma nota para o mesmo dia! Unificação segura e não destrutiva:
          // Ordena priorizando: ID determinístico > conteúdo mais rico > mais recente
          const canonicalNoteId = getDeterministicDiaryNoteId(userId, yNum, mNum, dayNum);
          dayNotes.sort((a, b) => {
            if (a.id === canonicalNoteId) return -1;
            if (b.id === canonicalNoteId) return 1;
            const lenA = (a.content || '').trim().length;
            const lenB = (b.content || '').trim().length;
            if (lenA !== lenB) return lenB - lenA; // Conteúdo mais longo primeiro
            return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
          });

          const canonicalNote = dayNotes[0];
          const duplicateNotes = dayNotes.slice(1);

          const norm = (s?: string) => (s || '').trim();
          let mergedContent = norm(canonicalNote.content);
          let mergedTags = new Set(canonicalNote.tags || []);

          for (const dupNote of duplicateNotes) {
            notesToDelete.add(dupNote.id);

            const dupText = norm(dupNote.content);
            if (dupText && !mergedContent.includes(dupText)) {
              if (mergedContent) {
                mergedContent = `${mergedContent}\n\n---\n\n${dupText}`;
              } else {
                mergedContent = dupText;
              }
            }

            if (Array.isArray(dupNote.tags)) {
              for (const t of dupNote.tags) mergedTags.add(t);
            }

            // Reatribui anexos da nota duplicada para a nota canônica no IndexedDB
            try {
              const dupAttachments = await indexedDBStorage.getAttachmentsByNoteId(userId, dupNote.id);
              for (const att of dupAttachments) {
                await indexedDBStorage.putAttachment(userId, {
                  ...att,
                  note_id: canonicalNote.id,
                });
              }
            } catch (attErr) {
              console.warn('[Diary] Erro ao reassociar anexos de nota duplicada:', attErr);
            }
          }

          const cleanDate = buildDiaryDateString(yNum, mNum, dayNum);
          mergedTags.add('diary');
          mergedTags.add(`diary:${cleanDate}`);
          mergedTags.add(`day:${dayNum}`);

          canonicalNote.content = mergedContent;
          canonicalNote.tags = Array.from(mergedTags);
          canonicalNote.folder_id = canonicalMonth.id;
          canonicalNote.diary_year = yNum;
          canonicalNote.diary_month = mNum;
          canonicalNote.diary_day = dayNum;
          canonicalNote.entry_date = cleanDate;
          canonicalNote.position = dayNum;
          canonicalNote.workspace_type = 'diary';
          canonicalNote.updated_at = new Date().toISOString();
          canonicalNote.syncRequired = true;

          notesToUpdate.push(canonicalNote);
        }
      }
    }

    // Aplica atualizações e deduplicações no IndexedDB
    for (const f of foldersToUpdate) {
      await indexedDBStorage.putFolder(userId, f);
    }
    for (const n of notesToUpdate) {
      await indexedDBStorage.putNote(userId, n);
    }
    for (const delId of foldersToDelete) {
      await indexedDBStorage.deleteFolder(userId, delId);
    }
    for (const delNoteId of notesToDelete) {
      await indexedDBStorage.deleteNote(userId, delNoteId);
    }

    // Se estiver online com o Supabase, sincroniza a exclusão e atualizações no banco remoto
    if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
      const supabase = createClient();

      if (notesToUpdate.length > 0) {
        for (const n of notesToUpdate) {
          await supabase.from('notes').update({
            folder_id: n.folder_id,
            content: n.content,
            tags: n.tags,
            title: n.title,
            position: n.position,
            updated_at: n.updated_at,
          }).eq('id', n.id);
        }
      }

      if (foldersToUpdate.length > 0) {
        for (const f of foldersToUpdate) {
          await supabase.from('folders').update({ parent_id: f.parent_id }).eq('id', f.id);
        }
      }

      if (foldersToDelete.size > 0) {
        const toDeleteArr = Array.from(foldersToDelete);
        await supabase.from('folders').delete().in('id', toDeleteArr);
        console.log(`[Diary] Limpeza remota: ${toDeleteArr.length} pastas duplicadas excluídas do Supabase.`);
      }

      if (notesToDelete.size > 0) {
        const toDeleteNotesArr = Array.from(notesToDelete);
        await supabase.from('notes').delete().in('id', toDeleteNotesArr);
        console.log(`[Diary] Limpeza remota: ${toDeleteNotesArr.length} notas duplicadas excluídas do Supabase.`);
      }
    }
  } catch (err) {
    console.error('[Diary] Erro ao reconciliar e deduplicar diário:', err);
  }
}

/**
 * Obtém ou cria a entrada diária para uma determinada data (YYYY-MM-DD).
 * Regra obrigatória: 1 ANO + 1 MÊS + 1 DIA = NO MÁXIMO 1 NOTA.
 * A criação é rigorosamente idempotente e protegida contra concorrência e cliques rápidos
 * utilizando chave determinística (owner + ano + mês + dia).
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
  const deterministicNoteId = getDeterministicDiaryNoteId(userId, year, month, day);

  const mutexKey = `${userId}:${cleanDate}`;
  const existingInFlight = inFlightEntryCreations.get(mutexKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const promise = (async () => {
    try {
      // 1. Garante que as pastas canônicas do Ano e Mês existam estruturalmente
      const { monthFolders } = await ensureDiaryYearFolders(userId, year);
      const targetMonthFolder =
        monthFolders.find((f) => extractDiaryMonth(f) === month) || monthFolders[month - 1];

      // 2. Verifica no IndexedDB local se já existe nota para este dia
      const allNotes = await indexedDBStorage.getAllNotes(userId);

      // Prioridade 1: ID determinístico
      let existingLocal = allNotes.find((n) => n.id === deterministicNoteId && !n.is_archived);

      // Prioridade 2: Metadados estruturais de data
      if (!existingLocal) {
        existingLocal = allNotes.find((n) => {
          if (n.is_archived) return false;
          if (n.entry_date && n.entry_date.trim() === cleanDate) return true;
          if (n.diary_year === year && n.diary_month === month && n.diary_day === day) return true;
          if (
            targetMonthFolder &&
            n.folder_id === targetMonthFolder.id &&
            (n.diary_day === day || n.position === day)
          ) {
            return true;
          }
          return false;
        });
      }

      if (existingLocal) {
        return { note: existingLocal, isNew: false };
      }

      // 3. Se online, verifica no Supabase se já foi criada em outro lugar
      if (isSupabaseConfigured() && networkMonitor.getState().isBackendReachable) {
        try {
          const supabase = createClient();

          // 3.1 Busca primeiro pelo ID determinístico
          const { data: remoteById } = await supabase
            .from('notes')
            .select('*')
            .eq('id', deterministicNoteId)
            .eq('is_archived', false)
            .limit(1);

          if (remoteById && remoteById.length > 0) {
            const remoteRecord = remoteById[0];
            const remoteNote: ExtendedNote = {
              ...remoteRecord,
              workspace_type: 'diary',
              entry_date: cleanDate,
              diary_year: year,
              diary_month: month,
              diary_day: day,
              position: day,
              syncRequired: false,
              syncStatus: 'synced',
              sync_status: 'synced',
              needs_sync: false,
            };
            await indexedDBStorage.putNote(userId, remoteNote);
            return { note: remoteNote, isNew: false };
          }

          // 3.2 Busca se existe nota na pasta do mês com esta posição
          if (targetMonthFolder) {
            const { data: remoteByFolder } = await supabase
              .from('notes')
              .select('*')
              .eq('user_id', userId)
              .eq('folder_id', targetMonthFolder.id)
              .eq('position', day)
              .eq('is_archived', false)
              .limit(1);

            if (remoteByFolder && remoteByFolder.length > 0) {
              const remoteRecord = remoteByFolder[0];
              const remoteNote: ExtendedNote = {
                ...remoteRecord,
                workspace_type: 'diary',
                entry_date: cleanDate,
                diary_year: year,
                diary_month: month,
                diary_day: day,
                position: day,
                syncRequired: false,
                syncStatus: 'synced',
                sync_status: 'synced',
                needs_sync: false,
              };
              await indexedDBStorage.putNote(userId, remoteNote);
              return { note: remoteNote, isNew: false };
            }
          }
        } catch (err) {
          console.warn('[Diary] Verificação remota de nota falhou, prosseguindo com criação:', err);
        }
      }

      // 4. Cria a nova nota diária usando a chave determinística (LAZY)
      const title = formatDiaryTitle(day, customTitle);

      const newDiaryNote: ExtendedNote = {
        id: deterministicNoteId,
        user_id: userId,
        folder_id: targetMonthFolder ? targetMonthFolder.id : null,
        title,
        content: '',
        position: day,
        tags: ['diary', `diary:${cleanDate}`, `day:${day}`],
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
        entity_id: deterministicNoteId,
        payload: newDiaryNote,
        revision: 1,
      });

      syncEngine.scheduleSync(300);
      return { note: newDiaryNote, isNew: true };
    } finally {
      inFlightEntryCreations.delete(mutexKey);
    }
  })();

  inFlightEntryCreations.set(mutexKey, promise);
  return promise;
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
 * Exclui uma pasta de ano ou mês do Diário com segurança.
 * Se cascadeForNotes for true, exclui todas as notas contidas na hierarquia.
 */
export async function deleteDiaryFolder(
  userId: string,
  folderId: string,
  cascade: boolean = true
): Promise<void> {
  if (!userId || !folderId) return;

  const allFolders = await indexedDBStorage.getAllFolders(userId);
  const targetFolder = allFolders.find((f) => f.id === folderId);
  if (!targetFolder) return;

  const isYear = isDiaryYearFolder(targetFolder);
  const folderIdsToDelete: string[] = [folderId];

  if (isYear) {
    // Se for ano, adiciona todos os seus 12 meses
    const childMonths = allFolders.filter((f) => f.parent_id === folderId);
    for (const cm of childMonths) {
      folderIdsToDelete.push(cm.id);
    }
  }

  // Se cascade, exclui as notas associadas
  if (cascade) {
    const allNotes = await indexedDBStorage.getAllNotes(userId);
    const notesToDelete = allNotes.filter(
      (n) => n.folder_id && folderIdsToDelete.includes(n.folder_id)
    );

    for (const n of notesToDelete) {
      await indexedDBStorage.deleteNote(userId, n.id);
      await indexedDBStorage.enqueueSyncItem(userId, {
        action: 'DELETE_NOTE',
        entity_type: 'note',
        entity_id: n.id,
        payload: { noteId: n.id },
        revision: 1,
      });
    }
  }

  for (const fId of folderIdsToDelete) {
    await indexedDBStorage.deleteFolder(userId, fId);
    await indexedDBStorage.enqueueSyncItem(userId, {
      action: 'DELETE_FOLDER',
      entity_type: 'folder',
      entity_id: fId,
      payload: { folderId: fId },
      revision: 1,
    });
  }

  syncEngine.scheduleSync(300);
}

/**
 * Renomeia uma pasta de Diário (Ano ou Mês).
 */
export async function renameDiaryFolder(
  userId: string,
  folderId: string,
  newName: string
): Promise<void> {
  if (!userId || !folderId || !newName.trim()) return;

  const folder = await indexedDBStorage.getFolderById(userId, folderId);
  if (!folder) return;

  const updated: ExtendedFolder = {
    ...folder,
    name: newName.trim(),
    updated_at: new Date().toISOString(),
    syncRequired: true,
    syncStatus: 'pending',
  };

  await indexedDBStorage.putFolder(userId, updated);
  await indexedDBStorage.enqueueSyncItem(userId, {
    action: 'UPDATE_FOLDER',
    entity_type: 'folder',
    entity_id: folderId,
    payload: updated,
    revision: (folder.revision || 0) + 1,
  });

  syncEngine.scheduleSync(300);
}
