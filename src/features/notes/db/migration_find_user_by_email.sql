-- ==============================================================================
-- MIGRATION: RPC SEGURA PARA LOCALIZAR USUÁRIOS POR E-MAIL NO SUPABASE AUTH
-- Arquivo: migration_find_user_by_email.sql
-- ==============================================================================
-- Esta função permite que usuários autenticados encontrem outros usuários pelo
-- endereço de e-mail consultando a tabela auth.users com SECURITY DEFINER.
-- Retorna estritamente id (UUID) e email (TEXT), sem expor senhas ou tokens.
-- ==============================================================================

-- 1. Função RPC public.find_user_by_email
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

-- Permissões estritas: revoga acesso de anônimos/público e concede a autenticados
REVOKE ALL ON FUNCTION public.find_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_user_by_email(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(text) TO authenticated;

-- 2. Atualização da função compatível lookup_user_by_email
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

