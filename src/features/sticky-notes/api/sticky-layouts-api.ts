import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import {
  DEFAULT_STICKY_BOARD_ID,
  StickyBoardLayoutData,
  StickyGroupLayoutEntry,
  StickyLayoutType,
  StickyNoteLayoutEntry,
} from '../types';

const LOCAL_LAYOUT_KEY_PREFIX = 'anotado_sticky_layout_v1';

export interface FetchStickyBoardLayoutResult {
  data: StickyBoardLayoutData | null;
  source: 'supabase' | 'local' | 'none';
  tableMissing: boolean;
}

export interface SaveStickyBoardLayoutResult {
  data: StickyBoardLayoutData;
  savedRemote: boolean;
  tableMissing: boolean;
}

export function getLocalLayoutStorageKey(
  userId: string,
  layoutType: StickyLayoutType,
  boardId: string = DEFAULT_STICKY_BOARD_ID
): string {
  return `${LOCAL_LAYOUT_KEY_PREFIX}:${userId || 'demo-user'}:${boardId}:${layoutType}`;
}

export function createEmptyBoardLayoutData(layoutType: StickyLayoutType): StickyBoardLayoutData {
  return {
    version: 1,
    layout_type: layoutType,
    notes: {},
    groups: {},
    updated_at: '',
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function normalizeBoardLayoutData(
  raw: unknown,
  layoutType: StickyLayoutType
): StickyBoardLayoutData | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  const rawNotes = candidate.notes && typeof candidate.notes === 'object'
    ? (candidate.notes as Record<string, unknown>)
    : {};
  const rawGroups = candidate.groups && typeof candidate.groups === 'object'
    ? (candidate.groups as Record<string, unknown>)
    : {};

  const notes: Record<string, StickyNoteLayoutEntry> = {};
  for (const [noteId, entry] of Object.entries(rawNotes)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) continue;
    notes[noteId] = {
      x: Math.round(item.x),
      y: Math.round(item.y),
      ...(isFiniteNumber(item.width) ? { width: Math.round(item.width) } : {}),
      ...(item.height === null
        ? { height: null }
        : isFiniteNumber(item.height)
          ? { height: Math.round(item.height) }
          : {}),
      ...(item.group_id === null || typeof item.group_id === 'string'
        ? { group_id: item.group_id }
        : {}),
      ...(typeof item.manual === 'boolean' ? { manual: item.manual } : {}),
      ...(typeof item.updated_at === 'string' ? { updated_at: item.updated_at } : {}),
    };
  }

  const groups: Record<string, StickyGroupLayoutEntry> = {};
  for (const [groupId, entry] of Object.entries(rawGroups)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) continue;
    groups[groupId] = {
      x: Math.round(item.x),
      y: Math.round(item.y),
      ...(typeof item.manual === 'boolean' ? { manual: item.manual } : {}),
      ...(typeof item.updated_at === 'string' ? { updated_at: item.updated_at } : {}),
    };
  }

  return {
    version: 1,
    layout_type: layoutType,
    notes,
    groups,
    ...(isFiniteNumber(candidate.viewport_width)
      ? { viewport_width: Math.round(candidate.viewport_width) }
      : {}),
    updated_at: typeof candidate.updated_at === 'string' ? candidate.updated_at : '',
  };
}

export function isMissingLayoutsTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  const code = err.code ? String(err.code) : '';
  const message = err.message ? String(err.message).toLowerCase() : '';
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (message.includes('sticky_board_layouts') &&
      (message.includes('does not exist') ||
        message.includes('could not find the table') ||
        message.includes('schema cache')))
  );
}

export function readLocalStickyBoardLayout(
  userId: string,
  layoutType: StickyLayoutType,
  boardId: string = DEFAULT_STICKY_BOARD_ID
): StickyBoardLayoutData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(
      getLocalLayoutStorageKey(userId, layoutType, boardId)
    );
    if (!raw) return null;
    return normalizeBoardLayoutData(JSON.parse(raw), layoutType);
  } catch {
    return null;
  }
}

export function writeLocalStickyBoardLayout(
  userId: string,
  layoutType: StickyLayoutType,
  data: StickyBoardLayoutData,
  boardId: string = DEFAULT_STICKY_BOARD_ID
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      getLocalLayoutStorageKey(userId, layoutType, boardId),
      JSON.stringify({ ...data, version: 1, layout_type: layoutType })
    );
  } catch {
    // Armazenamento local indisponível ou cheio; segue com persistência remota.
  }
}

function parseTimestamp(iso?: string): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Carrega o layout independente de um dispositivo específico (desktop | tablet | mobile)
 * identificado por (user_id + board_id + layout_type), reconciliando Supabase e cache local
 * sem nunca tocar os layouts dos outros dispositivos.
 */
export async function fetchStickyBoardLayout(
  userId: string,
  layoutType: StickyLayoutType,
  boardId: string = DEFAULT_STICKY_BOARD_ID
): Promise<FetchStickyBoardLayoutResult> {
  const local = readLocalStickyBoardLayout(userId, layoutType, boardId);

  if (!isSupabaseConfigured() || !userId || userId === 'demo-user') {
    return {
      data: local,
      source: local ? 'local' : 'none',
      tableMissing: false,
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('sticky_board_layouts')
    .select('layout_data, updated_at')
    .eq('user_id', userId)
    .eq('board_id', boardId)
    .eq('layout_type', layoutType)
    .maybeSingle();

  if (error) {
    if (isMissingLayoutsTableError(error)) {
      console.warn(
        '[Stick] Tabela sticky_board_layouts ainda não encontrada no Supabase; usando cache local isolado até a migration ser aplicada.'
      );
      return {
        data: local,
        source: local ? 'local' : 'none',
        tableMissing: true,
      };
    }
    console.warn('[Stick] Erro ao carregar layout do dispositivo no Supabase:', error);
    return {
      data: local,
      source: local ? 'local' : 'none',
      tableMissing: false,
    };
  }

  const remote = data?.layout_data
    ? normalizeBoardLayoutData(
        {
          ...(typeof data.layout_data === 'object' && data.layout_data !== null
            ? data.layout_data
            : {}),
          updated_at:
            (data.layout_data as Record<string, unknown>)?.updated_at || data.updated_at || '',
        },
        layoutType
      )
    : null;

  if (remote && (!local || parseTimestamp(remote.updated_at) >= parseTimestamp(local.updated_at))) {
    writeLocalStickyBoardLayout(userId, layoutType, remote, boardId);
    return { data: remote, source: 'supabase', tableMissing: false };
  }

  if (local) {
    // Cache local mais recente (por exemplo, edição feita offline): sincroniza apenas este layout_type.
    void saveStickyBoardLayout(userId, layoutType, local, boardId).catch((syncError) => {
      console.warn('[Stick] Não foi possível sincronizar layout local pendente:', syncError);
    });
    return { data: local, source: 'local', tableMissing: false };
  }

  return { data: null, source: 'none', tableMissing: false };
}

/**
 * Salva o layout exclusivamente para a chave (user_id + board_id + layout_type),
 * garantindo persistência instantânea no cache local e sincronização no Supabase.
 */
export async function saveStickyBoardLayout(
  userId: string,
  layoutType: StickyLayoutType,
  layoutData: StickyBoardLayoutData,
  boardId: string = DEFAULT_STICKY_BOARD_ID
): Promise<SaveStickyBoardLayoutResult> {
  const stamped: StickyBoardLayoutData = {
    ...layoutData,
    version: 1,
    layout_type: layoutType,
    updated_at: layoutData.updated_at || new Date().toISOString(),
  };

  writeLocalStickyBoardLayout(userId, layoutType, stamped, boardId);

  if (!isSupabaseConfigured() || !userId || userId === 'demo-user') {
    return { data: stamped, savedRemote: false, tableMissing: false };
  }

  const supabase = createClient();
  const { error } = await supabase.from('sticky_board_layouts').upsert(
    {
      user_id: userId,
      board_id: boardId,
      layout_type: layoutType,
      layout_data: stamped,
      version: 1,
      updated_at: stamped.updated_at,
    },
    { onConflict: 'user_id,board_id,layout_type' }
  );

  if (error) {
    if (isMissingLayoutsTableError(error)) {
      console.warn(
        '[Stick] Tabela sticky_board_layouts ainda não aplicada no Supabase; alterações mantidas no cache local do dispositivo.'
      );
      return { data: stamped, savedRemote: false, tableMissing: true };
    }
    throw new Error(error.message || 'Erro ao salvar layout do dispositivo.');
  }

  return { data: stamped, savedRemote: true, tableMissing: false };
}
