-- Preserve rich TipTap table data inside the canonical note content.
-- Tables are stored as HTML blocks embedded in Markdown, not as separate rows.
-- This migration is idempotent and does not rewrite non-NULL note content.

DO $$
BEGIN
  IF to_regclass('public.notes') IS NULL THEN
    RAISE EXCEPTION 'A tabela public.notes não existe. Execute primeiro a migration base das notas.';
  END IF;
END;
$$;

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS content TEXT;

UPDATE public.notes
SET content = ''
WHERE content IS NULL;

ALTER TABLE public.notes
  ALTER COLUMN content TYPE TEXT USING content::TEXT,
  ALTER COLUMN content SET DEFAULT '',
  ALTER COLUMN content SET NOT NULL;

COMMENT ON COLUMN public.notes.content IS
  'Conteúdo canônico da nota em Markdown, incluindo blocos HTML embutidos para tabelas TipTap. Preserva texto das células, cores, larguras de colunas e alturas de linhas.';
