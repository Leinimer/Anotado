-- ==============================================================================
-- MIGRATION: REMOÇÃO E LIMPEZA DE TAGS AUTOMÁTICAS DO DIÁRIO (#diary, #diary:*, #day:*)
-- Arquivo: migration_cleanup_diary_automatic_tags.sql
-- ==============================================================================

-- 1. Remove tags automáticas do array de tags nas notas do Diário
-- Preserva rigorosamente todas as tags manuais criadas pelos usuários
UPDATE public.notes
SET tags = ARRAY(
    SELECT tag_elem
    FROM unnest(tags) AS tag_elem
    WHERE lower(tag_elem) <> 'diary'
      AND lower(tag_elem) <> 'diario'
      AND NOT (lower(tag_elem) LIKE 'diary:%')
      AND NOT (lower(tag_elem) LIKE 'diario:%')
      AND NOT (lower(tag_elem) LIKE 'day:%')
      AND NOT (lower(tag_elem) LIKE 'dia:%')
      AND lower(tag_elem) NOT IN ('ano', 'mes', 'mês', 'data')
      AND NOT (tag_elem ~ '^\d{4}-\d{2}-\d{2}$')
      AND NOT (tag_elem ~ '^\d{2}/\d{2}/\d{4}$')
      AND NOT (tag_elem ~ '^\d{2}/\d{4}$')
)
WHERE workspace_type = 'diary' OR entry_date IS NOT NULL;

-- 2. Remove associações de tags automáticas da tabela public.note_tags
DELETE FROM public.note_tags
WHERE tag_id IN (
    SELECT id FROM public.tags
    WHERE lower(name) = 'diary'
       OR lower(name) = 'diario'
       OR lower(name) LIKE 'diary:%'
       OR lower(name) LIKE 'diario:%'
       OR lower(name) LIKE 'day:%'
       OR lower(name) LIKE 'dia:%'
       OR lower(name) IN ('ano', 'mes', 'mês', 'data')
       OR name ~ '^\d{4}-\d{2}-\d{2}$'
       OR name ~ '^\d{2}/\d{2}/\d{4}$'
       OR name ~ '^\d{2}/\d{4}$'
);

-- 3. Remove registros órfãos de tags automáticas da tabela public.tags
DELETE FROM public.tags
WHERE lower(name) = 'diary'
   OR lower(name) = 'diario'
   OR lower(name) LIKE 'diary:%'
   OR lower(name) LIKE 'diario:%'
   OR lower(name) LIKE 'day:%'
   OR lower(name) LIKE 'dia:%'
   OR lower(name) IN ('ano', 'mes', 'mês', 'data')
   OR name ~ '^\d{4}-\d{2}-\d{2}$'
   OR name ~ '^\d{2}/\d{2}/\d{4}$'
   OR name ~ '^\d{2}/\d{4}$';
