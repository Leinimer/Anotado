-- ==============================================================================
-- MIGRATION: COMPARTILHAMENTO DO DIÁRIO EM MODO SOMENTE LEITURA
-- Arquivo: migration_diary_sharing.sql
-- Data: 2026-09-04
-- ==============================================================================

-- 1. Tabela de Diretório de Perfis (para consulta de e-mail e exibição de nomes)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(lower(email));
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policies de RLS para perfis
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;
CREATE POLICY "Authenticated users can view profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- 2. Trigger para atualizar public.profiles automaticamente a partir de auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  ON CONFLICT (id) DO UPDATE SET
    email = lower(excluded.email),
    updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Popula perfis existentes se houver
INSERT INTO public.profiles (id, email, display_name)
SELECT 
  id, 
  lower(email), 
  coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
  email = excluded.email;

-- 3. Tabela de Compartilhamentos do Diário
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

-- 4. Função Segura Não-Recursiva (SECURITY DEFINER) para verificar acesso ao Diário
-- Esta função NÃO é chamada por policies da tabela diary_shares, prevenindo qualquer recursão infinita.
CREATE OR REPLACE FUNCTION public.has_diary_access(target_owner_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF auth.uid() = target_owner_id THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.diary_shares
    WHERE owner_id = target_owner_id
      AND viewer_id = auth.uid()
      AND status = 'accepted'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 5. Função Segura para Localizar Usuário Registrado por E-mail no Supabase Auth (Case-Insensitive)
CREATE OR REPLACE FUNCTION public.find_user_by_email(email_input TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::TEXT
  FROM auth.users u
  WHERE lower(trim(u.email)) = lower(trim(email_input))
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.find_user_by_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(TEXT) TO authenticated;

-- Função auxiliar lookup_user_by_email
CREATE OR REPLACE FUNCTION public.lookup_user_by_email(p_email TEXT)
RETURNS TABLE (id UUID, email TEXT, display_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT 
    u.id, 
    u.email::TEXT, 
    COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))::TEXT AS display_name
  FROM auth.users u
  WHERE lower(trim(u.email)) = lower(trim(p_email))
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_user_by_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_email(TEXT) TO authenticated;

-- 6. Habilita RLS em public.diary_shares
ALTER TABLE public.diary_shares ENABLE ROW LEVEL SECURITY;

-- Policies para diary_shares (completamente não-recursivas, checam apenas auth.uid() direto)
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

-- 7. Atualização das Policies de Leitura para Folders e Notes (Somente Diário)
-- O viewer ganha acesso de SELECT EXCLUSIVAMENTE ao Diário do proprietário (workspace_type = 'diary')
DROP POLICY IF EXISTS "Viewers can view shared diary folders" ON public.folders;
CREATE POLICY "Viewers can view shared diary folders"
    ON public.folders FOR SELECT
    TO authenticated
    USING (
      workspace_type = 'diary' AND public.has_diary_access(user_id)
    );

DROP POLICY IF EXISTS "Viewers can view shared diary notes" ON public.notes;
CREATE POLICY "Viewers can view shared diary notes"
    ON public.notes FOR SELECT
    TO authenticated
    USING (
      workspace_type = 'diary' AND public.has_diary_access(user_id)
    );

DROP POLICY IF EXISTS "Viewers can view shared diary note_attachments" ON public.note_attachments;
CREATE POLICY "Viewers can view shared diary note_attachments"
    ON public.note_attachments FOR SELECT
    TO authenticated
    USING (
      workspace_type = 'diary' AND public.has_diary_access(user_id)
    );

DROP POLICY IF EXISTS "Viewers can view tags of shared diary notes" ON public.tags;
CREATE POLICY "Viewers can view tags of shared diary notes"
    ON public.tags FOR SELECT
    TO authenticated
    USING (
      public.has_diary_access(user_id)
    );

DROP POLICY IF EXISTS "Viewers can view note_tags of shared diary notes" ON public.note_tags;
CREATE POLICY "Viewers can view note_tags of shared diary notes"
    ON public.note_tags FOR SELECT
    TO authenticated
    USING (
      public.has_diary_access(user_id)
    );

-- 8. Policies de Leitura Segura para Arquivos Markdown no Storage 'notes'
CREATE OR REPLACE FUNCTION public.can_read_note_file(p_bucket_id TEXT, p_file_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  owner_str TEXT;
  owner_uuid UUID;
BEGIN
  IF p_bucket_id != 'notes' THEN
    RETURN FALSE;
  END IF;

  owner_str := (storage.foldername(p_file_name))[1];
  IF owner_str IS NULL THEN
    RETURN FALSE;
  END IF;

  BEGIN
    owner_uuid := owner_str::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;

  RETURN public.has_diary_access(owner_uuid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

DROP POLICY IF EXISTS "Viewers can read shared diary notes storage files" ON storage.objects;
CREATE POLICY "Viewers can read shared diary notes storage files"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        public.can_read_note_file(bucket_id, name)
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
