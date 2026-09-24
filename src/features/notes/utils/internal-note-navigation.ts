/**
 * Gerenciador de Navegação Contextual de Referências Internas (ANOTADO)
 *
 * Responsabilidades:
 * - Registrar a origem da navegação interna (Workspace, Note ID, Pasta, Ano/Mês/Dia do Diário, Título)
 * - Garantir que o contexto seja estritamente LOCAL (sessionStorage), sem sincronização no Supabase
 * - Fornecer métodos de navegação de ida e volta preservando o estado exato
 */

import { Note, Folder } from '../types';
import { indexedDBStorage, ExtendedNote } from '../db/indexed-db';
import { flushAllPendingSaves } from '../api/notes-api';
import { isDiaryNote } from './diary-hierarchy';

export interface InternalNavigationContext {
  sourceWorkspace: 'notes' | 'diary';
  sourceNoteId: string;
  sourceNoteTitle?: string;
  sourceFolderId?: string | null;
  sourceDiaryYear?: number | null;
  sourceDiaryMonth?: number | null;
  sourceDiaryDay?: number | null;
  sourceDiaryDate?: string | null;
  targetNoteId: string;
  timestamp: number;
}

const STORAGE_KEY = 'anotado_internal_nav_context';

/**
 * Salva o contexto de navegação interna no sessionStorage
 */
export function saveInternalNavigationContext(ctx: InternalNavigationContext): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
    window.dispatchEvent(
      new CustomEvent('anotado:internal-nav-changed', {
        detail: { context: ctx },
      })
    );
  } catch (err) {
    console.warn('[InternalNavigation] Falha ao salvar contexto:', err);
  }
}

/**
 * Obtém o contexto de navegação interna ativo (se houver)
 */
export function getInternalNavigationContext(): InternalNavigationContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as InternalNavigationContext;
  } catch {
    return null;
  }
}

/**
 * Limpa o contexto de navegação interna (ex: ao clicar em voltar ou ao mudar intencionalmente de nota)
 */
export function clearInternalNavigationContext(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(
      new CustomEvent('anotado:internal-nav-changed', {
        detail: { context: null },
      })
    );
  } catch (err) {
    console.warn('[InternalNavigation] Falha ao limpar contexto:', err);
  }
}

/**
 * Executa a navegação completa para uma nota referenciada:
 * 1. Localiza a nota no IndexedDB
 * 2. Descobre se o destino é Notes ou Diário
 * 3. Registra o contexto de origem (onde o usuário estava)
 * 4. Navega para o destino correspondente
 */
export async function executeInternalNoteNavigation(
  targetNoteId: string,
  userId: string,
  currentNote: Note | null,
  currentWorkspace: 'notes' | 'diary',
  router: { push: (path: string) => void },
  onSelectLocalNote?: (noteId: string) => void
): Promise<boolean> {
  if (!targetNoteId) return false;

  try {
    // 1. Localiza a nota no IndexedDB
    const allNotes = await indexedDBStorage.getAllNotes(userId);
    let targetNote = allNotes.find((n) => n.id === targetNoteId);
    if (!targetNote) {
      targetNote = (await indexedDBStorage.getNoteById(userId, targetNoteId)) || undefined;
    }

    if (!targetNote) {
      console.warn('[InternalNavigation] Nota de destino não encontrada:', targetNoteId);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('anotado:toast-warning', {
            detail: { message: 'Nota referenciada não foi encontrada no dispositivo.' },
          })
        );
      }
      return false;
    }

    // 2. Descobre o workspace_type canônico
    const allFolders = await indexedDBStorage.getAllFolders(userId);
    const isTargetDiary = isDiaryNote(targetNote, allFolders);
    const targetWorkspace: 'notes' | 'diary' = isTargetDiary ? 'diary' : 'notes';

    // 3. Registra o contexto de origem local
    if (currentNote) {
      saveInternalNavigationContext({
        sourceWorkspace: currentWorkspace,
        sourceNoteId: currentNote.id,
        sourceNoteTitle: currentNote.title || 'Sem título',
        sourceFolderId: currentNote.folder_id,
        sourceDiaryYear: currentNote.diary_year,
        sourceDiaryMonth: currentNote.diary_month,
        sourceDiaryDay: currentNote.diary_day,
        sourceDiaryDate: currentNote.entry_date,
        targetNoteId: targetNote.id,
        timestamp: Date.now(),
      });
    }

    // 4. Garante flush de edições pendentes
    flushAllPendingSaves();

    // 5. Navega para o destino
    if (targetWorkspace === currentWorkspace) {
      // Mesmo workspace: apenas seleciona a nota diretamente
      if (targetWorkspace === 'notes') {
        sessionStorage.setItem('anotado_active_notes_id', targetNote.id);
      } else {
        sessionStorage.setItem('anotado_active_diary_id', targetNote.id);
      }

      if (onSelectLocalNote) {
        onSelectLocalNote(targetNote.id);
      } else {
        // Dispara evento para atualização da nota ativa
        window.dispatchEvent(
          new CustomEvent('anotado:select-active-note', {
            detail: { noteId: targetNote.id, workspace: targetWorkspace },
          })
        );
      }
      return true;
    } else {
      // Workspace diferente: direciona via router
      if (targetWorkspace === 'diary') {
        sessionStorage.setItem('anotado_active_diary_id', targetNote.id);
        router.push('/diary');
      } else {
        sessionStorage.setItem('anotado_active_notes_id', targetNote.id);
        router.push('/notes');
      }
      return true;
    }
  } catch (err) {
    console.error('[InternalNavigation] Erro ao navegar para nota interna:', err);
    return false;
  }
}

/**
 * Retorna à nota de origem registrada no contexto
 */
export async function returnToSourceNote(
  router: { push: (path: string) => void },
  currentWorkspace: 'notes' | 'diary',
  onSelectLocalNote?: (noteId: string) => void
): Promise<boolean> {
  const ctx = getInternalNavigationContext();
  if (!ctx) return false;

  // Limpa o contexto para sumir com o botão "Voltar..."
  clearInternalNavigationContext();
  flushAllPendingSaves();

  if (ctx.sourceWorkspace === currentWorkspace) {
    if (currentWorkspace === 'notes') {
      sessionStorage.setItem('anotado_active_notes_id', ctx.sourceNoteId);
    } else {
      sessionStorage.setItem('anotado_active_diary_id', ctx.sourceNoteId);
    }

    if (onSelectLocalNote) {
      onSelectLocalNote(ctx.sourceNoteId);
    } else {
      window.dispatchEvent(
        new CustomEvent('anotado:select-active-note', {
          detail: { noteId: ctx.sourceNoteId, workspace: currentWorkspace },
        })
      );
    }
    return true;
  } else {
    if (ctx.sourceWorkspace === 'diary') {
      sessionStorage.setItem('anotado_active_diary_id', ctx.sourceNoteId);
      router.push('/diary');
    } else {
      sessionStorage.setItem('anotado_active_notes_id', ctx.sourceNoteId);
      router.push('/notes');
    }
    return true;
  }
}
