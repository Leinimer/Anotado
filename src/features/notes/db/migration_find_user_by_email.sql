-- ==============================================================================
-- MIGRATION: RPC SEGURA PARA LOCALIZAR USUÁRIOS POR E-MAIL NO SUPABASE AUTH
-- Arquivo: migration_find_user_by_email.sql
-- Data: 2026-09-04
-- ==============================================================================
-- Esta função permite que usuários autenticados encontrem outros usuários pelo
-- endereço de e-mail consultando a tabela auth.users com SECURITY DEFINER.
-- Retorna estritamente id (UUID) e email, sem expor senhas, tokens ou metadados.
-- ==============================================================================

-- 1. Função RPC public.find_user_by_email
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
  -- Validação de segurança: apenas usuários autenticados podem invocar
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Busca direta em auth.users (case-insensitive com trim)
  RETURN QUERY
  SELECT
    u.id,
    u.email::TEXT
  FROM auth.users u
  WHERE lower(trim(u.email)) = lower(trim(email_input))
  LIMIT 1;
END;
$$;

-- Permissões estritas: revoga acesso de anônimos/público e concede a autenticados
REVOKE ALL ON FUNCTION public.find_user_by_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(TEXT) TO authenticated;

-- 2. Atualização da função legado lookup_user_by_email para também consultar auth.users
CREATE OR REPLACE FUNCTION public.lookup_user_by_email(p_email TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT
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
    u.email::TEXT,
    COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1))::TEXT AS display_name
  FROM auth.users u
  WHERE lower(trim(u.email)) = lower(trim(p_email))
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_user_by_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_email(TEXT) TO authenticated;
