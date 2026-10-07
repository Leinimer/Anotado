import { Note } from '../types';

const RECENT_KEY = 'anotado_recent_notes_v1';
const HISTORY_PREFIX = 'anotado_note_history_v1_';
const MAX_RECENT = 24;
const MAX_HISTORY = 20;

export interface RecentNoteItem {
  id: string;
  title: string;
  workspace: 'notes' | 'diary';
  updatedAt: string;
}

export interface NoteRevision {
  id: string;
  noteId: string;
  title: string;
  content: string;
  createdAt: string;
  reason: string;
}

function canUseStorage() {
  return typeof window !== 'undefined';
}

export function recordRecentNote(note: Note) {
  if (!canUseStorage()) return;
  try {
    const item: RecentNoteItem = {
      id: note.id,
      title: note.title || 'Sem título',
      workspace:
        note.workspace_type === 'diary' || note.entry_date || note.diary_year
          ? 'diary'
          : 'notes',
      updatedAt: note.updated_at || note.created_at || new Date().toISOString(),
    };
    const current = getRecentNotes().filter((x) => x.id !== note.id);
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([item, ...current].slice(0, MAX_RECENT))
    );
  } catch {}
}

export function getRecentNotes(): RecentNoteItem[] {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordNoteRevision(
  note: Note,
  contentOverride?: string,
  titleOverride?: string,
  reason = 'edição'
) {
  if (!canUseStorage()) return;
  try {
    const key = HISTORY_PREFIX + note.id;
    const current = getNoteHistory(note.id);
    const content = contentOverride ?? note.content ?? '';
    const title = titleOverride ?? note.title ?? 'Sem título';
    const last = current[0];
    const now = Date.now();

    if (
      last &&
      now - new Date(last.createdAt).getTime() < 15000 &&
      last.content === content &&
      last.title === title
    ) {
      return;
    }

    const revision: NoteRevision = {
      id: String(now) + '-' + Math.random().toString(36).slice(2, 8),
      noteId: note.id,
      title,
      content: content.slice(0, 120000),
      createdAt: new Date().toISOString(),
      reason,
    };

    localStorage.setItem(
      key,
      JSON.stringify([revision, ...current].slice(0, MAX_HISTORY))
    );
  } catch {}
}

export function getNoteHistory(noteId: string): NoteRevision[] {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(
      localStorage.getItem(HISTORY_PREFIX + noteId) || '[]'
    );
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearNoteHistory(noteId: string) {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(HISTORY_PREFIX + noteId);
  } catch {}
}
