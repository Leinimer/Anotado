/**
 * API e Lógica de Compartilhamento do Diário (Somente Leitura)
 *
 * Suporta convites, busca de usuários cadastrados por e-mail,
 * aceitação/rejeição, revogação pelo proprietário e carregamento
 * em tempo real do Diário compartilhado.
 */

import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { Folder, Note } from '@/src/features/notes/types';

export type ShareStatus = 'pending' | 'accepted' | 'rejected' | 'revoked';
export type SharePermission = 'viewer';

export interface DiaryShare {
  id: string;
  owner_id: string;
  viewer_id: string;
  owner_email?: string;
  viewer_email?: string;
  owner_name?: string;
  viewer_name?: string;
  status: ShareStatus;
  permission: SharePermission;
  created_at: string;
  updated_at: string;
  accepted_at?: string | null;
  revoked_at?: string | null;
}

const LOCAL_STORAGE_SHARES_KEY = 'anotado_local_diary_shares';

function getLocalShares(): DiaryShare[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SHARES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalShares(shares: DiaryShare[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_SHARES_KEY, JSON.stringify(shares));
  } catch {}
}

/**
 * Garante que o perfil do usuário logado exista na tabela public.profiles
 */
export async function ensureUserProfile(
  userId: string,
  email: string,
  displayName?: string
): Promise<void> {
  if (!isSupabaseConfigured() || !userId || !email) return;

  try {
    const supabase = createClient();
    const cleanEmail = email.trim().toLowerCase();
    const name = displayName || cleanEmail.split('@')[0];

    await supabase.from('profiles').upsert(
      {
        id: userId,
        email: cleanEmail,
        display_name: name,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
  } catch (err) {
    console.warn('[DiaryShare] Aviso ao sincronizar perfil do usuário:', err);
  }
}

/**
 * Busca compartilhamentos enviados pelo proprietário (owner_id = userId)
 */
export async function fetchOutgoingShares(userId: string): Promise<DiaryShare[]> {
  if (!userId) return [];

  if (!isSupabaseConfigured()) {
    return getLocalShares().filter((s) => s.owner_id === userId);
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('diary_shares')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[DiaryShare] Erro ao buscar compartilhamentos enviados:', error.message);
      return [];
    }

    return (data || []) as DiaryShare[];
  } catch (err) {
    console.error('[DiaryShare] Falha ao listar compartilhamentos enviados:', err);
    return [];
  }
}

/**
 * Busca convites e compartilhamentos recebidos pelo usuário (viewer_id = userId)
 */
export async function fetchIncomingShares(userId: string): Promise<DiaryShare[]> {
  if (!userId) return [];

  if (!isSupabaseConfigured()) {
    return getLocalShares().filter((s) => s.viewer_id === userId);
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('diary_shares')
      .select('*')
      .eq('viewer_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[DiaryShare] Erro ao buscar compartilhamentos recebidos:', error.message);
      return [];
    }

    return (data || []) as DiaryShare[];
  } catch (err) {
    console.error('[DiaryShare] Falha ao listar compartilhamentos recebidos:', err);
    return [];
  }
}

/**
 * Localiza um usuário cadastrado pelo endereço de e-mail (case-insensitive)
 */
export async function lookupUserByEmail(
  email: string
): Promise<{ id: string; email: string; display_name?: string } | null> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return null;

  if (!isSupabaseConfigured()) {
    // Modo demo local
    if (cleanEmail.includes('@')) {
      return {
        id: `mock-user-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
        email: cleanEmail,
        display_name: cleanEmail.split('@')[0],
      };
    }
    return null;
  }

  const supabase = createClient();

  // 1. Tenta via RPC lookup_user_by_email
  try {
    const { data, error } = await supabase.rpc('lookup_user_by_email', { p_email: cleanEmail });
    if (!error && data && data.length > 0) {
      return {
        id: data[0].id,
        email: data[0].email,
        display_name: data[0].display_name || data[0].email.split('@')[0],
      };
    }
  } catch (rpcErr) {
    console.warn('[DiaryShare] RPC lookup_user_by_email indisponível, tentando fallback em profiles:', rpcErr);
  }

  // 2. Fallback direto na tabela public.profiles
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .ilike('email', cleanEmail)
      .maybeSingle();

    if (!error && data) {
      return {
        id: data.id,
        email: data.email,
        display_name: data.display_name || data.email.split('@')[0],
      };
    }
  } catch (profilesErr) {
    console.warn('[DiaryShare] Erro ao consultar profiles:', profilesErr);
  }

  return null;
}

/**
 * Cria um novo convite de compartilhamento ou reativa um revogado
 */
export async function createDiaryShare(
  ownerId: string,
  ownerEmail: string,
  targetEmail: string
): Promise<{ success: boolean; share?: DiaryShare; error?: string }> {
  const cleanTargetEmail = targetEmail.trim().toLowerCase();
  const cleanOwnerEmail = ownerEmail.trim().toLowerCase();

  if (!cleanTargetEmail) {
    return { success: false, error: 'Por favor, informe o e-mail da pessoa.' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanTargetEmail)) {
    return { success: false, error: 'E-mail em formato inválido.' };
  }

  if (cleanTargetEmail === cleanOwnerEmail) {
    return { success: false, error: 'Você não pode compartilhar o Diário com você mesmo.' };
  }

  // Localiza o usuário convidado
  const targetUser = await lookupUserByEmail(cleanTargetEmail);
  if (!targetUser) {
    return {
      success: false,
      error: 'Nenhum usuário cadastrado foi encontrado com este endereço de e-mail.',
    };
  }

  if (targetUser.id === ownerId) {
    return { success: false, error: 'Você não pode compartilhar o Diário com você mesmo.' };
  }

  if (!isSupabaseConfigured()) {
    // Modo local
    const localShares = getLocalShares();
    const existingIndex = localShares.findIndex(
      (s) => s.owner_id === ownerId && s.viewer_id === targetUser.id
    );

    const now = new Date().toISOString();
    const newShare: DiaryShare = {
      id: `local-share-${Date.now()}`,
      owner_id: ownerId,
      viewer_id: targetUser.id,
      owner_email: cleanOwnerEmail,
      viewer_email: cleanTargetEmail,
      status: 'pending',
      permission: 'viewer',
      created_at: now,
      updated_at: now,
    };

    if (existingIndex >= 0) {
      const existing = localShares[existingIndex];
      if (existing.status === 'accepted') {
        return { success: false, error: 'Este Diário já está compartilhado com este usuário.' };
      }
      if (existing.status === 'pending') {
        return { success: false, error: 'Já existe um convite pendente para este usuário.' };
      }
      localShares[existingIndex] = { ...newShare, id: existing.id };
    } else {
      localShares.push(newShare);
    }

    saveLocalShares(localShares);
    return { success: true, share: newShare };
  }

  const supabase = createClient();

  try {
    // Verifica se já existe registro prévio entre este owner e viewer
    const { data: existing, error: checkError } = await supabase
      .from('diary_shares')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('viewer_id', targetUser.id)
      .maybeSingle();

    if (checkError) {
      console.warn('[DiaryShare] Erro ao verificar compartilhamento existente:', checkError.message);
    }

    const now = new Date().toISOString();

    if (existing) {
      if (existing.status === 'accepted') {
        return { success: false, error: 'Este Diário já está compartilhado com este usuário.' };
      }
      if (existing.status === 'pending') {
        return { success: false, error: 'Já existe um convite pendente para este usuário.' };
      }

      // Se foi rejected ou revoked, reativa como pending
      const { data: updated, error: updateError } = await supabase
        .from('diary_shares')
        .update({
          status: 'pending',
          owner_email: cleanOwnerEmail,
          viewer_email: cleanTargetEmail,
          updated_at: now,
          accepted_at: null,
          revoked_at: null,
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (updateError) {
        return { success: false, error: updateError.message || 'Falha ao reativar convite.' };
      }

      return { success: true, share: updated as DiaryShare };
    }

    // Insere novo convite
    const { data: created, error: insertError } = await supabase
      .from('diary_shares')
      .insert({
        owner_id: ownerId,
        viewer_id: targetUser.id,
        owner_email: cleanOwnerEmail,
        viewer_email: cleanTargetEmail,
        status: 'pending',
        permission: 'viewer',
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return { success: false, error: 'Já existe um convite ou compartilhamento ativo com este usuário.' };
      }
      return { success: false, error: insertError.message || 'Falha ao criar compartilhamento.' };
    }

    return { success: true, share: created as DiaryShare };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro inesperado ao compartilhar Diário.';
    return { success: false, error: msg };
  }
}

/**
 * Aceita um convite de compartilhamento recebido
 */
export async function acceptDiaryInvitation(
  shareId: string
): Promise<{ success: boolean; error?: string }> {
  if (!shareId) return { success: false, error: 'ID de compartilhamento inválido.' };

  const now = new Date().toISOString();

  if (!isSupabaseConfigured()) {
    const shares = getLocalShares();
    const share = shares.find((s) => s.id === shareId);
    if (share) {
      share.status = 'accepted';
      share.accepted_at = now;
      share.updated_at = now;
      saveLocalShares(shares);
    }
    return { success: true };
  }

  try {
    const supabase = createClient();
    const { error } = await supabase
      .from('diary_shares')
      .update({
        status: 'accepted',
        accepted_at: now,
        updated_at: now,
      })
      .eq('id', shareId);

    if (error) {
      return { success: false, error: error.message || 'Falha ao aceitar convite.' };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao aceitar convite.';
    return { success: false, error: msg };
  }
}

/**
 * Rejeita um convite de compartilhamento recebido
 */
export async function rejectDiaryInvitation(
  shareId: string
): Promise<{ success: boolean; error?: string }> {
  if (!shareId) return { success: false, error: 'ID de compartilhamento inválido.' };

  const now = new Date().toISOString();

  if (!isSupabaseConfigured()) {
    const shares = getLocalShares();
    const share = shares.find((s) => s.id === shareId);
    if (share) {
      share.status = 'rejected';
      share.updated_at = now;
      saveLocalShares(shares);
    }
    return { success: true };
  }

  try {
    const supabase = createClient();
    const { error } = await supabase
      .from('diary_shares')
      .update({
        status: 'rejected',
        updated_at: now,
      })
      .eq('id', shareId);

    if (error) {
      return { success: false, error: error.message || 'Falha ao rejeitar convite.' };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao rejeitar convite.';
    return { success: false, error: msg };
  }
}

/**
 * Revoga um compartilhamento ativo (executado pelo proprietário)
 */
export async function revokeDiaryShare(
  shareId: string
): Promise<{ success: boolean; error?: string }> {
  if (!shareId) return { success: false, error: 'ID de compartilhamento inválido.' };

  const now = new Date().toISOString();

  if (!isSupabaseConfigured()) {
    const shares = getLocalShares();
    const share = shares.find((s) => s.id === shareId);
    if (share) {
      share.status = 'revoked';
      share.revoked_at = now;
      share.updated_at = now;
      saveLocalShares(shares);
    }
    return { success: true };
  }

  try {
    const supabase = createClient();
    const { error } = await supabase
      .from('diary_shares')
      .update({
        status: 'revoked',
        revoked_at: now,
        updated_at: now,
      })
      .eq('id', shareId);

    if (error) {
      return { success: false, error: error.message || 'Falha ao revogar compartilhamento.' };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao revogar compartilhamento.';
    return { success: false, error: msg };
  }
}

/**
 * Carrega os dados de um Diário compartilhado (pastas e notas do owner com workspace_type = 'diary')
 */
export async function fetchSharedDiaryData(
  shareId: string
): Promise<{ share: DiaryShare | null; folders: Folder[]; notes: Note[]; error?: string }> {
  if (!shareId) return { share: null, folders: [], notes: [], error: 'ID inválido.' };

  if (!isSupabaseConfigured()) {
    const shares = getLocalShares();
    const share = shares.find((s) => s.id === shareId && s.status === 'accepted') || null;
    return { share, folders: [], notes: [] };
  }

  const supabase = createClient();

  try {
    // 1. Obtém metadados do compartilhamento
    const { data: share, error: shareError } = await supabase
      .from('diary_shares')
      .select('*')
      .eq('id', shareId)
      .maybeSingle();

    if (shareError || !share) {
      return {
        share: null,
        folders: [],
        notes: [],
        error: 'Compartilhamento não encontrado ou acesso negado.',
      };
    }

    if (share.status !== 'accepted') {
      return {
        share: share as DiaryShare,
        folders: [],
        notes: [],
        error:
          share.status === 'revoked'
            ? 'O acesso a este Diário compartilhado foi revogado pelo proprietário.'
            : 'Este convite de compartilhamento ainda não foi aceito.',
      };
    }

    const ownerId = share.owner_id;

    // 2. Busca pastas do Diário do proprietário
    const { data: foldersData, error: foldersError } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', ownerId)
      .eq('workspace_type', 'diary')
      .order('position', { ascending: true });

    if (foldersError) {
      console.error('[DiaryShare] Erro ao carregar pastas do Diário compartilhado:', foldersError);
    }

    // 3. Busca notas do Diário do proprietário
    const { data: notesData, error: notesError } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', ownerId)
      .eq('workspace_type', 'diary')
      .eq('is_archived', false)
      .order('position', { ascending: true });

    if (notesError) {
      console.error('[DiaryShare] Erro ao carregar notas do Diário compartilhado:', notesError);
    }

    return {
      share: share as DiaryShare,
      folders: (foldersData || []) as Folder[],
      notes: (notesData || []) as Note[],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha ao carregar Diário compartilhado.';
    return { share: null, folders: [], notes: [], error: msg };
  }
}

/**
 * Carrega o conteúdo Markdown de uma nota específica de um Diário compartilhado
 */
export async function fetchSharedNoteContent(
  ownerId: string,
  noteId: string
): Promise<{ content: string; tags: string[] }> {
  if (!isSupabaseConfigured() || !ownerId || !noteId) {
    return { content: '', tags: [] };
  }

  const supabase = createClient();

  try {
    // 1. Busca do banco
    const { data: noteRow } = await supabase
      .from('notes')
      .select('content, tags')
      .eq('id', noteId)
      .eq('user_id', ownerId)
      .maybeSingle();

    if (noteRow?.content) {
      return {
        content: noteRow.content,
        tags: Array.isArray(noteRow.tags) ? noteRow.tags : [],
      };
    }

    // 2. Tenta download do storage se estiver vazio na tabela
    const filePath = `${ownerId}/${noteId}.md`;
    const { data: blob, error } = await supabase.storage.from('notes').download(filePath);
    if (!error && blob) {
      const text = await blob.text();
      return {
        content: text,
        tags: Array.isArray(noteRow?.tags) ? noteRow.tags : [],
      };
    }

    return {
      content: noteRow?.content || '',
      tags: Array.isArray(noteRow?.tags) ? noteRow.tags : [],
    };
  } catch (err) {
    console.warn('[DiaryShare] Erro ao baixar conteúdo da nota compartilhada:', err);
    return { content: '', tags: [] };
  }
}
