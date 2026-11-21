import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import {
  StickyNote,
  StickyNoteColorKey,
  STICKY_DEFAULT_WIDTH,
  StickyNoteGroup,
} from '../types';

export interface CreateStickyNoteInput {
  title?: string;
  content?: string;
  color?: StickyNoteColorKey | string;
  position_x: number;
  position_y: number;
  width_px?: number;
  height_px?: number | null;
  z_index: number;
  group_id?: string | null;
}

export interface UpdateStickyNotePatch {
  title?: string;
  content?: string;
  color?: StickyNoteColorKey | string;
  position_x?: number;
  position_y?: number;
  width_px?: number;
  height_px?: number | null;
  z_index?: number;
  group_id?: string | null;
}

const STICKY_NOTE_SELECT =
  'id, user_id, title, content, color, position_x, position_y, width_px, height_px, z_index, group_id, created_at, updated_at';

const STICKY_NOTE_SELECT_LEGACY =
  'id, user_id, title, content, color, position_x, position_y, width_px, z_index, group_id, created_at, updated_at';

function isMissingColumnError(error: any, columnName: string): boolean {
  const code = error?.code ? String(error.code) : '';
  const message = error?.message ? String(error.message).toLowerCase() : '';
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    (message.includes(columnName.toLowerCase()) &&
      (message.includes('does not exist') || message.includes('schema cache')))
  );
}

function isMissingFunctionError(error: any): boolean {
  const code = error?.code ? String(error.code) : '';
  const message = error?.message ? String(error.message).toLowerCase() : '';
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    (message.includes('reorder_sticky_note_groups') &&
      (message.includes('does not exist') || message.includes('could not find')))
  );
}

function normalizeStickyRow(row: any): StickyNote {
  const rawHeight = row.height_px;
  const parsedHeight =
    rawHeight === null || rawHeight === undefined || Number.isNaN(Number(rawHeight))
      ? null
      : Math.round(Number(rawHeight));

  return {
    ...row,
    position_x: Number(row.position_x ?? 80),
    position_y: Number(row.position_y ?? 80),
    width_px: Number(row.width_px ?? STICKY_DEFAULT_WIDTH),
    height_px: parsedHeight,
    z_index: Number(row.z_index ?? 1),
  };
}

function formatSupabaseStickyError(error: any, fallback: string): Error {
  const code = error?.code ? String(error.code) : '';
  const message = error?.message ? String(error.message) : '';

  if (code === '42P01' || (message.includes('sticky_notes') && message.includes('does not exist'))) {
    return new Error(
      'A tabela sticky_notes ainda não existe no Supabase. Execute a migration SQL no Supabase SQL Editor.'
    );
  }
  if (isMissingColumnError(error, 'height_px')) {
    return new Error(
      'A coluna height_px ainda não foi criada no Supabase. Execute a migration 20261120180000_add_sticky_note_height.sql.'
    );
  }
  if (code === '42501' || message.toLowerCase().includes('row-level security')) {
    return new Error(
      'Sem permissão para acessar as notas adesivas (verifique a autenticação e as políticas RLS).'
    );
  }
  return new Error(message || fallback);
}

export async function getAuthenticatedStickyUser(): Promise<{
  userId: string;
  email: string;
} | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session?.user?.id) {
    return {
      userId: sessionData.session.user.id,
      email: sessionData.session.user.email || '',
    };
  }

  const { data: userData } = await supabase.auth.getUser();
  if (userData?.user?.id) {
    return {
      userId: userData.user.id,
      email: userData.user.email || '',
    };
  }

  return null;
}

export async function fetchStickyNotes(userId: string): Promise<StickyNote[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('sticky_notes')
    .select(STICKY_NOTE_SELECT)
    .eq('user_id', userId)
    .order('z_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (error && isMissingColumnError(error, 'height_px')) {
    const legacy = await supabase
      .from('sticky_notes')
      .select(STICKY_NOTE_SELECT_LEGACY)
      .eq('user_id', userId)
      .order('z_index', { ascending: true })
      .order('created_at', { ascending: true });
    if (legacy.error) {
      throw formatSupabaseStickyError(legacy.error, 'Erro ao carregar notas adesivas.');
    }
    return (legacy.data || []).map((row: any) => normalizeStickyRow(row));
  }

  if (error) {
    throw formatSupabaseStickyError(error, 'Erro ao carregar notas adesivas.');
  }

  return (data || []).map((row: any) => normalizeStickyRow(row));
}

export async function createStickyNote(
  userId: string,
  input: CreateStickyNoteInput
): Promise<StickyNote> {
  if (!isSupabaseConfigured()) {
    const now = new Date().toISOString();
    return {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}`,
      user_id: userId,
      title: input.title ?? '',
      content: input.content ?? '',
      color: input.color ?? 'yellow',
      position_x: Math.round(input.position_x),
      position_y: Math.round(input.position_y),
      width_px: Math.round(input.width_px ?? STICKY_DEFAULT_WIDTH),
      height_px: input.height_px != null ? Math.round(input.height_px) : null,
      z_index: Math.round(input.z_index),
      group_id: input.group_id ?? null,
      created_at: now,
      updated_at: now,
    };
  }

  const supabase = createClient();
  const payload: Record<string, unknown> = {
    user_id: userId,
    title: input.title ?? '',
    content: input.content ?? '',
    color: input.color ?? 'yellow',
    position_x: Math.round(input.position_x),
    position_y: Math.round(input.position_y),
    width_px: Math.round(input.width_px ?? STICKY_DEFAULT_WIDTH),
    z_index: Math.round(input.z_index),
    // Persiste o campo escolhido no submenu de conversão Nota -> Stick.
    group_id: input.group_id ?? null,
  };
  if (input.height_px !== undefined) {
    payload.height_px = input.height_px != null ? Math.round(input.height_px) : null;
  }

  const { data, error } = await supabase
    .from('sticky_notes')
    .insert(payload)
    .select(STICKY_NOTE_SELECT)
    .single();

  if (error && isMissingColumnError(error, 'height_px')) {
    delete payload.height_px;
    const legacy = await supabase
      .from('sticky_notes')
      .insert(payload)
      .select(STICKY_NOTE_SELECT_LEGACY)
      .single();
    if (legacy.error || !legacy.data) {
      throw formatSupabaseStickyError(legacy.error, 'Erro ao criar nota adesiva.');
    }
    return normalizeStickyRow(legacy.data);
  }

  if (error || !data) {
    throw formatSupabaseStickyError(error, 'Erro ao criar nota adesiva.');
  }

  return normalizeStickyRow(data);
}

export async function updateStickyNote(
  userId: string,
  noteId: string,
  patch: UpdateStickyNotePatch
): Promise<StickyNote | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const sanitizedPatch: Record<string, unknown> = {};
  if (patch.title !== undefined) sanitizedPatch.title = patch.title;
  if (patch.content !== undefined) sanitizedPatch.content = patch.content;
  if (patch.color !== undefined) sanitizedPatch.color = patch.color;
  if (patch.position_x !== undefined) sanitizedPatch.position_x = Math.round(patch.position_x);
  if (patch.position_y !== undefined) sanitizedPatch.position_y = Math.round(patch.position_y);
  if (patch.width_px !== undefined) sanitizedPatch.width_px = Math.round(patch.width_px);
  if (patch.height_px !== undefined) {
    sanitizedPatch.height_px = patch.height_px != null ? Math.round(patch.height_px) : null;
  }
  if (patch.z_index !== undefined) sanitizedPatch.z_index = Math.round(patch.z_index);
  if (patch.group_id !== undefined) sanitizedPatch.group_id = patch.group_id;

  if (Object.keys(sanitizedPatch).length === 0) return null;

  const supabase = createClient();
  const { data, error } = await supabase
    .from('sticky_notes')
    .update(sanitizedPatch)
    .eq('id', noteId)
    .eq('user_id', userId)
    .select(STICKY_NOTE_SELECT)
    .single();

  if (error && isMissingColumnError(error, 'height_px')) {
    const hadHeight = 'height_px' in sanitizedPatch;
    const restPatch = { ...sanitizedPatch };
    delete restPatch.height_px;
    if (Object.keys(restPatch).length > 0) {
      const legacy = await supabase
        .from('sticky_notes')
        .update(restPatch)
        .eq('id', noteId)
        .eq('user_id', userId)
        .select(STICKY_NOTE_SELECT_LEGACY)
        .single();
      if (legacy.error) {
        throw formatSupabaseStickyError(legacy.error, 'Erro ao salvar nota adesiva.');
      }
      if (!hadHeight) {
        return legacy.data ? normalizeStickyRow(legacy.data) : null;
      }
    }
    throw formatSupabaseStickyError(error, 'Erro ao salvar altura do Stick.');
  }

  if (error) {
    throw formatSupabaseStickyError(error, 'Erro ao salvar nota adesiva.');
  }

  return data ? normalizeStickyRow(data) : null;
}

export async function deleteStickyNote(userId: string, noteId: string): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('sticky_notes')
    .delete()
    .eq('id', noteId)
    .eq('user_id', userId);

  if (error) {
    throw formatSupabaseStickyError(error, 'Erro ao excluir nota adesiva.');
  }
}

export async function fetchStickyNoteGroups(userId: string): Promise<StickyNoteGroup[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await createClient()
    .from('sticky_note_groups')
    .select('id, user_id, color, title, sort_order, created_at, updated_at')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw formatSupabaseStickyError(error, 'Erro ao carregar agrupamentos.');
  return (data || []) as StickyNoteGroup[];
}

export async function createStickyNoteGroup(userId: string, color: StickyNoteColorKey): Promise<StickyNoteGroup> {
  if (!isSupabaseConfigured()) {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), user_id: userId, color, title: '', sort_order: 0, created_at: now, updated_at: now };
  }
  const client = createClient();
  const { data: lastGroup, error: orderError } = await client.from('sticky_note_groups')
    .select('sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (orderError) throw formatSupabaseStickyError(orderError, 'Erro ao determinar a posição do novo campo.');
  const nextOrder = Number(lastGroup?.sort_order ?? -1) + 1;
  const { data, error } = await client
    .from('sticky_note_groups')
    .insert({ user_id: userId, color, title: '', sort_order: nextOrder })
    .select('id, user_id, color, title, sort_order, created_at, updated_at')
    .single();
  if (error || !data) throw formatSupabaseStickyError(error, 'Erro ao criar agrupamento.');
  return data as StickyNoteGroup;
}

export async function updateStickyNoteGroup(userId: string, groupId: string, patch: { color?: StickyNoteColorKey; title?: string }): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await createClient().from('sticky_note_groups')
    .update(patch).eq('id', groupId).eq('user_id', userId);
  if (error) throw formatSupabaseStickyError(error, 'Erro ao atualizar agrupamento.');
}

export async function updateStickyNoteGroupsOrder(groupIds: string[], userId?: string): Promise<void> {
  if (!isSupabaseConfigured() || groupIds.length === 0) return;
  const client = createClient();
  const { error } = await client.rpc('reorder_sticky_note_groups', { p_group_ids: groupIds });
  if (!error) return;

  // Fallback seguro caso a função RPC ainda não tenha sido aplicada, mas a coluna sort_order exista.
  if (isMissingFunctionError(error) && userId) {
    for (let index = 0; index < groupIds.length; index += 1) {
      const { error: updateError } = await client
        .from('sticky_note_groups')
        .update({ sort_order: index })
        .eq('id', groupIds[index])
        .eq('user_id', userId);
      if (updateError) {
        throw formatSupabaseStickyError(updateError, 'Erro ao salvar a ordem dos campos.');
      }
    }
    return;
  }

  throw formatSupabaseStickyError(error, 'Erro ao salvar a ordem dos campos.');
}

export async function deleteStickyNoteGroup(
  userId: string,
  groupId: string,
  deleteSticks = false
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const client = createClient();

  if (deleteSticks) {
    // Exclui somente os Sticks pertencentes ao usuário e vinculados a este campo.
    const { error: notesError } = await client
      .from('sticky_notes')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', userId);
    if (notesError) {
      throw formatSupabaseStickyError(notesError, 'Erro ao excluir os Sticks do campo.');
    }
  } else {
    // Mantém os Sticks e apenas remove o vínculo com o campo.
    const { error: detachError } = await client
      .from('sticky_notes')
      .update({ group_id: null })
      .eq('group_id', groupId)
      .eq('user_id', userId);
    if (detachError) {
      throw formatSupabaseStickyError(detachError, 'Erro ao manter os Sticks e excluir o campo.');
    }
  }

  const { error } = await client
    .from('sticky_note_groups')
    .delete()
    .eq('id', groupId)
    .eq('user_id', userId);
  if (error) throw formatSupabaseStickyError(error, 'Erro ao excluir campo.');
}
