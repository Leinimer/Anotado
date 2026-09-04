-- ==============================================================================
-- MIGRATION: COMPARTILHAMENTO DO DIÁRIO EM MODO SOMENTE LEITURA
-- Arquivo: migration_diary_sharing.sql
-- ==============================================================================
-- Esta migration configura todo o ecossistema do Diário Compartilhado:
-- 1. Tabela public.diary_shares (gerencia convites e permissões)
-- 2. Função RPC public.find_user_by_email (busca segura por e-mail em auth.users)
-- 3. Função RPC public.lookup_user_by_email (compatibilidade)
-- 4. Função public.has_diary_access (validação de permissão)
-- 5. Policies de RLS (garantem leitura estrita apenas ao Diário com status accepted)
-- 6. Publicação Realtime para sincronização imediata
-- ==============================================================================

-- 1. Tabela de Compartilhamentos do Diário
CREATE TABLE IF NOT EXISTS public.diary_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    viewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    owner_email TEXT,
    viewer_email TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked')),
    permission TEXT NOT NULL DEFAULT 'viewer' CHECK (permission IN ('viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    accepted_at TIMESTAMPTZ DEFAULT NULL,
    revoked_at TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT uq_diary_shares_owner_viewer UNIQUE (owner_id, viewer_id),
    CONSTRAINT chk_diary_shares_not_self CHECK (owner_id != viewer_id)
);

-- Índices essenciais para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_diary_shares_owner_id ON public.diary_shares(owner_id);
CREATE INDEX IF NOT EXISTS idx_diary_shares_viewer_id ON public.diary_shares(viewer_id);
CREATE INDEX IF NOT EXISTS idx_diary_shares_status ON public.diary_shares(status);
CREATE INDEX IF NOT EXISTS idx_diary_shares_lookup ON public.diary_shares(owner_id, viewer_id, status);

-- 2. Habilita RLS em public.diary_shares
ALTER TABLE public.diary_shares ENABLE ROW LEVEL SECURITY;

-- Policies para diary_shares (não-recursivas, checam apenas auth.uid() direto)
DROP POLICY IF EXISTS "Users can view their related shares" ON public.diary_shares;
CREATE POLICY "Users can view their related shares"
    ON public.diary_shares FOR SELECT
    TO authenticated
    USING (auth.uid() = owner_id OR auth.uid() = viewer_id);

DROP POLICY IF EXISTS "Owners can create shares" ON public.diary_shares;
CREATE POLICY "Owners can create shares"
    ON public.diary_shares FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = owner_id AND auth.uid() != viewer_id);

DROP POLICY IF EXISTS "Owners and viewers can update their shares" ON public.diary_shares;
CREATE POLICY "Owners and viewers can update their shares"
    ON public.diary_shares FOR UPDATE
    TO authenticated
    USING (auth.uid() = owner_id OR auth.uid() = viewer_id)
    WITH CHECK (auth.uid() = owner_id OR auth.uid() = viewer_id);

DROP POLICY IF EXISTS "Owners can delete their shares" ON public.diary_shares;
CREATE POLICY "Owners can delete their shares"
    ON public.diary_shares FOR DELETE
    TO authenticated
    USING (auth.uid() = owner_id);

-- 3. Função Segura para Localizar Usuário Registrado por E-mail no Supabase Auth
CREATE OR REPLACE FUNCTION public.find_user_by_email(email_input text)
RETURNS TABLE (
  id uuid,
  email text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.id,
    u.email::text
  FROM auth.users u
  WHERE auth.uid() IS NOT NULL
    AND lower(trim(u.email)) = lower(trim(email_input))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_user_by_email(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(text) TO authenticated;

-- Função auxiliar compatível lookup_user_by_email
CREATE OR REPLACE FUNCTION public.lookup_user_by_email(p_email text)
RETURNS TABLE (
  id uuid,
  email text,
  display_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.id,
    u.email::text,
    COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))::text AS display_name
  FROM auth.users u
  WHERE auth.uid() IS NOT NULL
    AND lower(trim(u.email)) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_user_by_email(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_email(text) TO authenticated;

-- 4. Função Segura (SECURITY DEFINER) para verificar acesso ao Diário
CREATE OR REPLACE FUNCTION public.has_diary_access(target_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR target_owner_id IS NULL THEN FALSE
    WHEN auth.uid() = target_owner_id THEN TRUE
    ELSE EXISTS (
      SELECT 1
      FROM public.diary_shares
      WHERE owner_id = target_owner_id
        AND viewer_id = auth.uid()
        AND status = 'accepted'
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.has_diary_access(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_diary_access(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_diary_access(UUID) TO authenticated;

-- 5. Funções Seguras para identificar a estrutura real do Diário (Anos e Meses) sem depender de workspace_type
CREATE OR REPLACE FUNCTION public.is_shared_diary_folder(p_folder_id UUID, p_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_folder_id IS NULL OR p_owner_id IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1 FROM public.folders f
      WHERE f.id = p_folder_id
        AND f.user_id = p_owner_id
        AND (
          -- Pasta de Ano: raiz com nome de 4 dígitos (ex: 2026)
          (f.parent_id IS NULL AND f.name ~ '^\d{4}$')
          OR
          -- Pasta de Mês: filha de uma pasta de ano
          (f.parent_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.folders y
            WHERE y.id = f.parent_id
              AND y.user_id = p_owner_id
              AND y.parent_id IS NULL
              AND y.name ~ '^\d{4}$'
          ))
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_shared_diary_folder(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_shared_diary_folder(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_shared_diary_folder(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_shared_diary_note(p_folder_id UUID, p_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_folder_id IS NULL OR p_owner_id IS NULL THEN FALSE
    ELSE EXISTS (
      -- Nota dentro de uma pasta de Mês do Diário
      SELECT 1 FROM public.folders m
      JOIN public.folders y ON m.parent_id = y.id
      WHERE m.id = p_folder_id
        AND m.user_id = p_owner_id
        AND y.parent_id IS NULL
        AND y.name ~ '^\d{4}$'
        AND y.user_id = p_owner_id
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_shared_diary_note(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_shared_diary_note(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_shared_diary_note(UUID, UUID) TO authenticated;

-- 6. Funções Seguras para autorização estrita de arquivos no Storage (Markdown e Anexos)
CREATE OR REPLACE FUNCTION public.can_access_shared_diary_note_storage(p_name text, p_viewer_id uuid)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid;
  v_note_id uuid;
  v_parts text[];
BEGIN
  IF p_name IS NULL OR p_viewer_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Valida estritamente o formato do caminho: {owner_id}/{note_id}.md
  IF NOT (p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.md$') THEN
    RETURN FALSE;
  END IF;

  v_parts := string_to_array(p_name, '/');
  v_owner_id := v_parts[1]::uuid;
  v_note_id := (regexp_replace(v_parts[2], '\.md$', ''))::uuid;

  -- Usuário proprietário acessa via suas próprias policies do storage
  IF v_owner_id = p_viewer_id THEN
    RETURN FALSE;
  END IF;

  -- 1. Verifica se existe compartilhamento aceito para esse proprietário
  IF NOT EXISTS (
    SELECT 1 FROM public.diary_shares ds
    WHERE ds.owner_id = v_owner_id
      AND ds.viewer_id = p_viewer_id
      AND ds.status = 'accepted'
  ) THEN
    RETURN FALSE;
  END IF;

  -- 2. Verifica se a nota existe, pertence ao proprietário, não está arquivada e pertence ao Diário
  RETURN EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.id = v_note_id
      AND n.user_id = v_owner_id
      AND n.is_archived = FALSE
      AND public.is_shared_diary_note(n.folder_id, n.user_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_shared_diary_note_storage(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_shared_diary_note_storage(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_shared_diary_note_storage(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_shared_diary_attachment_storage(p_name text, p_viewer_id uuid)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_parts text[];
  v_att_id_candidate text;
  v_att_id uuid;
BEGIN
  IF p_name IS NULL OR p_viewer_id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_parts := string_to_array(p_name, '/');

  -- Tenta extrair candidate UUID do anexo caso o path seja {userId}/{attachmentId}.{ext}
  IF array_length(v_parts, 1) >= 2 THEN
    v_att_id_candidate := regexp_replace(v_parts[2], '\.[^.]+$', '');
    IF v_att_id_candidate ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      v_att_id := v_att_id_candidate::uuid;
    END IF;
  END IF;

  -- Cadeia estrita de relacionamento:
  -- storage.objects -> public.note_attachments -> note_id -> public.notes -> pasta do mês -> pasta do ano -> Diário -> diary_shares aceito
  RETURN EXISTS (
    SELECT 1
    FROM public.note_attachments na
    JOIN public.notes n ON na.note_id = n.id AND na.user_id = n.user_id
    JOIN public.diary_shares ds ON ds.owner_id = na.user_id
    WHERE (
        na.storage_path = p_name
        OR na.storage_path = '/' || p_name
        OR (v_att_id IS NOT NULL AND na.id = v_att_id)
      )
      AND na.note_id IS NOT NULL
      AND ds.viewer_id = p_viewer_id
      AND ds.owner_id != p_viewer_id
      AND ds.status = 'accepted'
      AND n.is_archived = FALSE
      AND public.is_shared_diary_note(n.folder_id, n.user_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_shared_diary_attachment_storage(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_shared_diary_attachment_storage(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_shared_diary_attachment_storage(text, uuid) TO authenticated;

-- 7. Policies de Leitura para Folders, Notes, Tags, Note_Tags e Note_Attachments
DROP POLICY IF EXISTS "Viewers can view shared diary folders" ON public.folders;
CREATE POLICY "Viewers can view shared diary folders"
    ON public.folders FOR SELECT
    TO authenticated
    USING (
      auth.uid() != user_id
      AND EXISTS (
        SELECT 1 FROM public.diary_shares ds
        WHERE ds.owner_id = folders.user_id
          AND ds.viewer_id = auth.uid()
          AND ds.status = 'accepted'
      )
      AND public.is_shared_diary_folder(id, user_id)
    );

DROP POLICY IF EXISTS "Viewers can view shared diary notes" ON public.notes;
CREATE POLICY "Viewers can view shared diary notes"
    ON public.notes FOR SELECT
    TO authenticated
    USING (
      auth.uid() != user_id
      AND is_archived = FALSE
      AND EXISTS (
        SELECT 1 FROM public.diary_shares ds
        WHERE ds.owner_id = notes.user_id
          AND ds.viewer_id = auth.uid()
          AND ds.status = 'accepted'
      )
      AND public.is_shared_diary_note(folder_id, user_id)
    );

DROP POLICY IF EXISTS "Viewers can view tags of shared diary notes" ON public.tags;
CREATE POLICY "Viewers can view tags of shared diary notes"
    ON public.tags FOR SELECT
    TO authenticated
    USING (
      auth.uid() != user_id
      AND EXISTS (
        SELECT 1
        FROM public.note_tags nt
        JOIN public.notes n ON nt.note_id = n.id AND nt.user_id = n.user_id
        JOIN public.diary_shares ds ON ds.owner_id = tags.user_id
        WHERE nt.tag_id = tags.id
          AND ds.viewer_id = auth.uid()
          AND ds.status = 'accepted'
          AND n.is_archived = FALSE
          AND public.is_shared_diary_note(n.folder_id, n.user_id)
      )
    );

DROP POLICY IF EXISTS "Viewers can view note_tags of shared diary notes" ON public.note_tags;
CREATE POLICY "Viewers can view note_tags of shared diary notes"
    ON public.note_tags FOR SELECT
    TO authenticated
    USING (
      auth.uid() != user_id
      AND EXISTS (
        SELECT 1
        FROM public.notes n
        JOIN public.diary_shares ds ON ds.owner_id = note_tags.user_id
        WHERE n.id = note_tags.note_id
          AND n.user_id = note_tags.user_id
          AND ds.viewer_id = auth.uid()
          AND ds.status = 'accepted'
          AND n.is_archived = FALSE
          AND public.is_shared_diary_note(n.folder_id, n.user_id)
      )
    );

DROP POLICY IF EXISTS "Viewers can view attachments of shared diary notes" ON public.note_attachments;
CREATE POLICY "Viewers can view attachments of shared diary notes"
    ON public.note_attachments FOR SELECT
    TO authenticated
    USING (
      auth.uid() != user_id
      AND note_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.diary_shares ds
        WHERE ds.owner_id = note_attachments.user_id
          AND ds.viewer_id = auth.uid()
          AND ds.status = 'accepted'
      )
      AND EXISTS (
        SELECT 1 FROM public.notes n
        WHERE n.id = note_attachments.note_id
          AND n.user_id = note_attachments.user_id
          AND n.is_archived = FALSE
          AND public.is_shared_diary_note(n.folder_id, n.user_id)
      )
    );

-- 8. Policies Estritas de Leitura no Supabase Storage para Markdown e Anexos Compartilhados
DROP POLICY IF EXISTS "Viewers can read shared diary markdown notes" ON storage.objects;
CREATE POLICY "Viewers can read shared diary markdown notes"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'notes'
      AND public.can_access_shared_diary_note_storage(name, auth.uid())
    );

DROP POLICY IF EXISTS "Viewers can read shared diary attachments" ON storage.objects;
CREATE POLICY "Viewers can read shared diary attachments"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id IN ('note-attachments', 'attachments')
      AND public.can_access_shared_diary_attachment_storage(name, auth.uid())
    );

-- 9. Habilitar Realtime para a tabela diary_shares
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'diary_shares'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.diary_shares;
  END IF;
END;
$$;
