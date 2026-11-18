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
  z_index?: number;
  group_id?: string | null;
}

function formatSupabaseStickyError(error: any, fallback: string): Error {
  const code = error?.code ? String(error.code) : '';
  const message = error?.message ? String(error.message) : '';

  if (code === '42P01' || message.includes('sticky_notes') && message.includes('does not exist')) {
    return new Error(
      'A tabela sticky_notes ainda não existe no Supabase. Execute a migration SQL no Supabase SQL Editor.'
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
    .select('id, user_id, title, content, color, position_x, position_y, width_px, z_index, group_id, created_at, updated_at')
    .eq('user_id', userId)
    .order('z_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw formatSupabaseStickyError(error, 'Erro ao carregar notas adesivas.');
  }

  return (data || []).map((row: any) => ({
    ...row,
    position_x: Number(row.position_x ?? 80),
    position_y: Number(row.position_y ?? 80),
    width_px: Number(row.width_px ?? STICKY_DEFAULT_WIDTH),
    z_index: Number(row.z_index ?? 1),
  }));
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
      z_index: Math.round(input.z_index),
      group_id: input.group_id ?? null,
      created_at: now,
      updated_at: now,
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('sticky_notes')
    .insert({
      user_id: userId,
      title: input.title ?? '',
      content: input.content ?? '',
      color: input.color ?? 'yellow',
      position_x: Math.round(input.position_x),
      position_y: Math.round(input.position_y),
      width_px: Math.round(input.width_px ?? STICKY_DEFAULT_WIDTH),
      z_index: Math.round(input.z_index),
    })
    .select('id, user_id, title, content, color, position_x, position_y, width_px, z_index, group_id, created_at, updated_at')
    .single();

  if (error || !data) {
    throw formatSupabaseStickyError(error, 'Erro ao criar nota adesiva.');
  }

  return {
    ...data,
    position_x: Number(data.position_x ?? 80),
    position_y: Number(data.position_y ?? 80),
    width_px: Number(data.width_px ?? STICKY_DEFAULT_WIDTH),
    z_index: Number(data.z_index ?? 1),
  };
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
  if (patch.z_index !== undefined) sanitizedPatch.z_index = Math.round(patch.z_index);
  if (patch.group_id !== undefined) sanitizedPatch.group_id = patch.group_id;

  if (Object.keys(sanitizedPatch).length === 0) return null;

  const supabase = createClient();
  const { data, error } = await supabase
    .from('sticky_notes')
    .update(sanitizedPatch)
    .eq('id', noteId)
    .eq('user_id', userId)
    .select('id, user_id, title, content, color, position_x, position_y, width_px, z_index, group_id, created_at, updated_at')
    .single();

  if (error) {
    throw formatSupabaseStickyError(error, 'Erro ao salvar nota adesiva.');
  }

  return data
    ? {
        ...data,
        position_x: Number(data.position_x ?? 80),
        position_y: Number(data.position_y ?? 80),
        width_px: Number(data.width_px ?? STICKY_DEFAULT_WIDTH),
        z_index: Number(data.z_index ?? 1),
      }
    : null;
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
    .select('id, user_id, color, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw formatSupabaseStickyError(error, 'Erro ao carregar agrupamentos.');
  return (data || []) as StickyNoteGroup[];
}

export async function createStickyNoteGroup(userId: string, color: StickyNoteColorKey): Promise<StickyNoteGroup> {
  if (!isSupabaseConfigured()) {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), user_id: userId, color, created_at: now, updated_at: now };
  }
  const { data, error } = await createClient()
    .from('sticky_note_groups')
    .insert({ user_id: userId, color })
    .select('id, user_id, color, created_at, updated_at')
    .single();
  if (error || !data) throw formatSupabaseStickyError(error, 'Erro ao criar agrupamento.');
  return data as StickyNoteGroup;
}

export async function updateStickyNoteGroup(userId: string, groupId: string, patch: { color?: StickyNoteColorKey }): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await createClient().from('sticky_note_groups')
    .update(patch).eq('id', groupId).eq('user_id', userId);
  if (error) throw formatSupabaseStickyError(error, 'Erro ao atualizar agrupamento.');
}

export async function deleteStickyNoteGroup(userId: string, groupId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const client = createClient();
  const { error: detachError } = await client.from('sticky_notes')
    .update({ group_id: null }).eq('group_id', groupId).eq('user_id', userId);
  if (detachError) throw formatSupabaseStickyError(detachError, 'Erro ao desagrupar Sticks.');
  const { error } = await client.from('sticky_note_groups').delete().eq('id', groupId).eq('user_id', userId);
  if (error) throw formatSupabaseStickyError(error, 'Erro ao excluir agrupamento.');
}
