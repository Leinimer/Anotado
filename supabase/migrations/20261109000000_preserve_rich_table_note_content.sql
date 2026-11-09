-- Preserve rich TipTap table data inside the canonical note content.
-- Tables are stored as HTML blocks embedded in Markdown, not as separate rows.
--
-- IMPORTANT:
-- public.notes.search_vector is a STORED generated column that depends on
-- public.notes.content. The base schema already defines content as TEXT.
-- Do not ALTER COLUMN content TYPE here: PostgreSQL rejects changing the
-- type of a column referenced by a generated column unless that dependency
-- is dropped and recreated. No type conversion is needed for this feature.

DO $$
DECLARE
  v_data_type text;
BEGIN
  IF to_regclass('public.notes') IS NULL THEN
    RAISE EXCEPTION 'A tabela public.notes não existe. Execute primeiro a migration base das notas.';
  END IF;

  SELECT data_type
    INTO v_data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'notes'
    AND column_name = 'content';

  IF v_data_type IS NULL THEN
    ALTER TABLE public.notes ADD COLUMN content TEXT NOT NULL DEFAULT '';
  ELSIF v_data_type <> 'text' THEN
    RAISE EXCEPTION
      'public.notes.content está como %, mas deveria ser TEXT. A migration foi interrompida para preservar a coluna gerada search_vector.',
      v_data_type;
  ELSE
    -- A coluna já é TEXT. Apenas garante as propriedades sem alterar seu tipo.
    ALTER TABLE public.notes
      ALTER COLUMN content SET DEFAULT '',
      ALTER COLUMN content SET NOT NULL;
  END IF;
END;
$$;

COMMENT ON COLUMN public.notes.content IS
  'Conteúdo canônico da nota em Markdown, incluindo blocos HTML embutidos para tabelas TipTap. Preserva texto das células, cores, larguras de colunas e alturas de linhas.';
