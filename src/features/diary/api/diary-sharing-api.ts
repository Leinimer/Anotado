/**
 * API e Lógica de Compartilhamento do Diário (Somente Leitura)
 *
 * Suporta convites, busca de usuários cadastrados por e-mail,
 * aceitação/rejeição, revogação pelo proprietário e carregamento
 * em tempo real do Diário compartilhado.
 */

import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { Folder, Note } from '@/src/features/notes/types';
import {
  MONTH_NAMES_PT,
  parseDiaryDate,
  buildDiaryDateString,
} from '@/src/features/notes/utils/diary-date';

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

export interface FoundUser {
  id: string;
  email: string;
}

export type FindUserResult =
  | { success: true; user: FoundUser; error?: null }
  | { success: false; user: null; notFound: boolean; error: string };

/**
 * Localiza um usuário cadastrado no Supabase Auth pelo endereço de e-mail através da RPC segura public.find_user_by_email.
 *
 * Requisitos de Negócio:
 * - A identidade oficial reside estritamente em auth.users.id.
 * - A busca é executada via RPC SECURITY DEFINER find_user_by_email diretamente em auth.users.
 * - Somente usuários autenticados podem invocar a função (validado por auth.uid()).
 * - Retorna exclusivamente: id (UUID) e email (TEXT).
 * - Tratamento de erros rigoroso:
 *     * 0 usuários encontrados: "Nenhum usuário cadastrado foi encontrado com este endereço de e-mail."
 *     * Erro de RPC, RLS, rede, banco ou Supabase: "Não foi possível verificar este usuário. Tente novamente."
 *     * NUNCA converte falhas de conexão/banco em "usuário não encontrado".
 */
export async function findUserByEmail(email: string): Promise<FindUserResult> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    return {
      success: false,
      user: null,
      notFound: false,
      error: 'Por favor, informe o e-mail da pessoa.',
    };
  }

  if (!isSupabaseConfigured()) {
    // Modo demo local offline (quando variáveis de ambiente do Supabase não foram fornecidas)
    if (cleanEmail.includes('@')) {
      return {
        success: true,
        user: {
          id: `mock-user-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`,
          email: cleanEmail,
        },
      };
    }
    return {
      success: false,
      user: null,
      notFound: true,
      error: 'Nenhum usuário cadastrado foi encontrado com este endereço de e-mail.',
    };
  }

  const supabase = createClient();

  try {
    // 0. Verifica se o usuário atual possui sessão autenticada antes de chamar a RPC
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      return {
        success: false,
        user: null,
        notFound: false,
        error: 'Você precisa estar autenticado para compartilhar o Diário.',
      };
    }

    // 1. Invoca a RPC segura public.find_user_by_email(email_input text)
    const { data, error } = await supabase.rpc('find_user_by_email', {
      email_input: cleanEmail,
    });

    if (error) {
      console.error('[Compartilhamento] Erro ao buscar usuário:', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
      });

      if (error.code === '42501' || (error as any).status === 401) {
        return {
          success: false,
          user: null,
          notFound: false,
          error: 'Sessão não autorizada ou expirada. Faça login novamente.',
        };
      }

      if (error.code === 'PGRST202') {
        console.warn(
          '[Compartilhamento] ATENÇÃO: A função RPC public.find_user_by_email(email_input) não foi encontrada no banco do Supabase (PGRST202). ' +
          'Execute o arquivo migration_find_user_by_email.sql no SQL Editor do painel do Supabase.'
        );
      }

      // NUNCA transforma erro de banco/RLS/conexão em "usuário não encontrado"
      return {
        success: false,
        user: null,
        notFound: false,
        error: 'Não foi possível verificar este usuário. Tente novamente.',
      };
    }

    const rows = Array.isArray(data) ? data : data ? [data] : [];

    if (rows.length === 0) {
      return {
        success: false,
        user: null,
        notFound: true,
        error: 'Nenhum usuário cadastrado foi encontrado com este endereço de e-mail.',
      };
    }

    const matched = rows[0];
    if (!matched?.id) {
      return {
        success: false,
        user: null,
        notFound: true,
        error: 'Nenhum usuário cadastrado foi encontrado com este endereço de e-mail.',
      };
    }

    return {
      success: true,
      user: {
        id: matched.id,
        email: matched.email || cleanEmail,
      },
    };
  } catch (err) {
    console.error('[Compartilhamento] Falha de comunicação com o Supabase:', err);
    // Erros de rede, exceções ou falhas de conexão
    return {
      success: false,
      user: null,
      notFound: false,
      error: 'Não foi possível verificar este usuário. Tente novamente.',
    };
  }
}

/**
 * Função legado para manter compatibilidade, delegando para a RPC segura findUserByEmail.
 */
export async function lookupUserByEmail(
  email: string
): Promise<{ id: string; email: string; display_name?: string } | null> {
  const res = await findUserByEmail(email);
  if (!res.success || !res.user) return null;
  return {
    id: res.user.id,
    email: res.user.email,
    display_name: res.user.email.split('@')[0],
  };
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

  if (!isSupabaseConfigured()) {
    // Modo local offline
    const searchRes = await findUserByEmail(cleanTargetEmail);
    if (!searchRes.success || !searchRes.user) {
      return { success: false, error: searchRes.error };
    }
    const targetUser = searchRes.user;
    if (targetUser.id === ownerId) {
      return { success: false, error: 'Você não pode compartilhar o Diário com você mesmo.' };
    }

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

  // 1. Obter usuário autenticado real do Supabase Auth para validar a identidade oficial
  let realOwnerId = ownerId;
  let realOwnerEmail = cleanOwnerEmail;

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user?.id) {
      console.error('[createDiaryShare] Usuário não autenticado:', authError);
      return {
        success: false,
        error: 'Você precisa estar autenticado para compartilhar seu Diário.',
      };
    }
    realOwnerId = user.id;
    if (user.email) {
      realOwnerEmail = user.email.trim().toLowerCase();
    }
  } catch (authErr) {
    console.error('[createDiaryShare] Erro ao obter auth.users.id:', authErr);
    return {
      success: false,
      error: 'Não foi possível verificar sua sessão de usuário. Tente novamente.',
    };
  }

  if (cleanTargetEmail === realOwnerEmail) {
    return { success: false, error: 'Você não pode compartilhar o Diário com você mesmo.' };
  }

  // 2. Busca o usuário real do Supabase Auth através da RPC segura find_user_by_email
  const findResult = await findUserByEmail(cleanTargetEmail);
  if (!findResult.success || !findResult.user) {
    // Retorna a mensagem correta sem mascarar erro como "não encontrado":
    // "Nenhum usuário cadastrado foi encontrado com este endereço de e-mail." OU
    // "Não foi possível verificar este usuário. Tente novamente."
    return {
      success: false,
      error: findResult.error,
    };
  }

  const targetUser = findResult.user;

  // Garante que o viewer_id não é o próprio owner_id
  if (targetUser.id === realOwnerId) {
    return { success: false, error: 'Você não pode compartilhar o Diário com você mesmo.' };
  }

  // 3. Criação do convite na tabela diary_shares usando o UUID exato de auth.users.id
  try {
    const { data: existing, error: checkError } = await supabase
      .from('diary_shares')
      .select('*')
      .eq('owner_id', realOwnerId)
      .eq('viewer_id', targetUser.id)
      .maybeSingle();

    if (checkError) {
      console.warn('[createDiaryShare] Aviso ao verificar compartilhamento existente:', checkError.message);
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
          owner_email: realOwnerEmail,
          viewer_email: cleanTargetEmail,
          updated_at: now,
          accepted_at: null,
          revoked_at: null,
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (updateError) {
        console.error('[createDiaryShare] Erro ao reativar convite:', updateError);
        return { success: false, error: 'Não foi possível reativar o convite. Tente novamente.' };
      }

      return { success: true, share: updated as DiaryShare };
    }

    // Insere novo convite com viewer_id = UUID real de auth.users.id
    const { data: created, error: insertError } = await supabase
      .from('diary_shares')
      .insert({
        owner_id: realOwnerId,
        viewer_id: targetUser.id,
        owner_email: realOwnerEmail,
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
      console.error('[createDiaryShare] Erro ao criar convite:', insertError);
      return { success: false, error: 'Não foi possível enviar o convite. Tente novamente.' };
    }

    return { success: true, share: created as DiaryShare };
  } catch (err) {
    console.error('[createDiaryShare] Erro inesperado ao compartilhar Diário:', err);
    return { success: false, error: 'Não foi possível enviar o convite. Tente novamente.' };
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

    // 2. Busca pastas do proprietário permitidas pelas policies do Diário
    const { data: foldersData, error: foldersError } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', ownerId)
      .order('position', { ascending: true });

    if (foldersError) {
      console.error('[DiaryShare] Erro ao carregar pastas do Diário compartilhado:', foldersError);
    }

    // 3. Busca notas do proprietário permitidas pelas policies do Diário (não arquivadas)
    const { data: notesData, error: notesError } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', ownerId)
      .eq('is_archived', false)
      .order('position', { ascending: true });

    if (notesError) {
      console.error('[DiaryShare] Erro ao carregar notas do Diário compartilhado:', notesError);
    }

    // 1. Deduplicação por ID para garantir listas limpas
    const rawFoldersMap = new Map<string, Folder>();
    for (const f of (foldersData || []) as Folder[]) {
      if (f?.id && !rawFoldersMap.has(f.id)) {
        rawFoldersMap.set(f.id, f);
      }
    }
    const rawFolders = Array.from(rawFoldersMap.values());

    const rawNotesMap = new Map<string, Note>();
    for (const n of (notesData || []) as Note[]) {
      if (n?.id && !rawNotesMap.has(n.id)) {
        rawNotesMap.set(n.id, n);
      }
    }
    const rawNotes = Array.from(rawNotesMap.values());

    // Identifica as pastas de Ano (pastas raiz com nome de 4 dígitos ou diary_year preenchido)
    const yearFolders = rawFolders.filter(
      (f) => !f.parent_id && (f.diary_year || /^\d{4}$/.test(f.name.trim()))
    );
    const yearFolderIds = new Set(yearFolders.map((f) => f.id));

    // Identifica as pastas de Mês (pastas filhas das pastas de Ano)
    const monthFolders = rawFolders.filter(
      (f) => f.parent_id && yearFolderIds.has(f.parent_id)
    );
    const monthFolderIds = new Set(monthFolders.map((f) => f.id));

    // Normaliza metadados do Diário para todas as pastas de ano e mês
    const normalizedFolders: Folder[] = [...yearFolders, ...monthFolders].map((f) => {
      const isYear = !f.parent_id;
      const yearVal = isYear
        ? f.diary_year || parseInt(f.name.trim(), 10) || f.position
        : rawFolders.find((y) => y.id === f.parent_id)?.diary_year ||
          parseInt(rawFolders.find((y) => y.id === f.parent_id)?.name.trim() || '', 10) ||
          new Date().getFullYear();

      let monthVal: number | null = null;
      if (!isYear) {
        if (typeof f.diary_month === 'number' && f.diary_month >= 1 && f.diary_month <= 12) {
          monthVal = f.diary_month;
        } else {
          const ptIdx = MONTH_NAMES_PT.findIndex((m) => m.toLowerCase() === f.name.trim().toLowerCase());
          if (ptIdx !== -1) {
            monthVal = ptIdx + 1;
          } else {
            const parsedNum = parseInt(f.name.trim(), 10);
            if (!isNaN(parsedNum) && parsedNum >= 1 && parsedNum <= 12) {
              monthVal = parsedNum;
            } else {
              monthVal = typeof f.position === 'number' && f.position >= 1 && f.position <= 12 ? f.position : 1;
            }
          }
        }
      }

      return {
        ...f,
        workspace_type: 'diary' as const,
        diary_year: yearVal,
        diary_month: monthVal,
      };
    });

    // Normaliza metadados do Diário para as notas pertencentes aos meses do Diário
    const normalizedNotes: Note[] = rawNotes
      .filter((n) => (n.folder_id && monthFolderIds.has(n.folder_id)) || Boolean(n.entry_date) || Boolean(n.diary_year))
      .map((n) => {
        const parentMonth = monthFolders.find((m) => m.id === n.folder_id);
        const parentYear = parentMonth
          ? yearFolders.find((y) => y.id === parentMonth.parent_id)
          : null;
        const yearVal =
          n.diary_year ||
          (parentYear ? parseInt(parentYear.name.trim(), 10) : new Date().getFullYear());
        
        let monthVal = n.diary_month;
        if (!monthVal && parentMonth) {
          const ptIdx = MONTH_NAMES_PT.findIndex((m) => m.toLowerCase() === parentMonth.name.trim().toLowerCase());
          monthVal = ptIdx !== -1 ? ptIdx + 1 : parentMonth.diary_month || parentMonth.position || 1;
        }
        if (!monthVal) {
          monthVal = 1;
        }

        let dayVal = n.diary_day;
        if (!dayVal && n.entry_date) {
          dayVal = parseDiaryDate(n.entry_date).day;
        }
        if (!dayVal && n.title) {
          const match = n.title.match(/^dia\s+(\d{1,2})/i);
          if (match) dayVal = parseInt(match[1], 10);
        }
        if (!dayVal) {
          dayVal = n.position || 1;
        }

        const entryDate = n.entry_date || buildDiaryDateString(yearVal, monthVal, dayVal);

        return {
          ...n,
          workspace_type: 'diary' as const,
          diary_year: yearVal,
          diary_month: monthVal,
          diary_day: dayVal,
          entry_date: entryDate,
        };
      });

    return {
      share: share as DiaryShare,
      folders: normalizedFolders,
      notes: normalizedNotes,
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
