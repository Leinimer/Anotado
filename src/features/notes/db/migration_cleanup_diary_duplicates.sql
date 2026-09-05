-- ==============================================================================
-- MIGRATION: Limpeza e Deduplicação Definitiva do Diário (ANOTADO!)
--
-- Padrão obrigatório:
-- ANO -> 12 MESES -> DIAS VIRTUAIS -> NOTAS SOMENTE QUANDO CRIADAS
--
-- Regras desta migração:
-- 1. Identifica e une pastas de ano duplicadas (ex: múltiplos "2026"), elegendo
--    uma canônica (a mais antiga) e reassociando as pastas filhas (meses).
-- 2. Identifica e une pastas de meses duplicadas sob cada ano, movendo todas as
--    notas para a pasta de mês canônica.
-- 3. Exclui com segurança apenas as pastas duplicadas que ficarem vazias.
-- 4. Preserva 100% do conteúdo, anexos e dados das notas do usuário.
-- 5. Cria restrições únicas para impedir a criação de anos ou meses duplicados.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- PASSO 1: UNIFICAÇÃO DE PASTAS DE ANO DUPLICADAS
-- ------------------------------------------------------------------------------

-- Tabela temporária com o mapeamento: [pasta_ano_duplicada_id] -> [pasta_ano_canonica_id]
CREATE TEMP TABLE temp_canonical_years AS
WITH ranked_years AS (
  SELECT
    id,
    user_id,
    TRIM(name) AS clean_name,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, TRIM(name)
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, TRIM(name)
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id
  FROM public.folders
  WHERE parent_id IS NULL
    AND TRIM(name) ~ '^\d{4}$'
)
SELECT
  id AS duplicate_id,
  canonical_id,
  user_id,
  clean_name
FROM ranked_years
WHERE id <> canonical_id;

-- 1.1 Reatribui todas as pastas de meses (e filhas) cujo parent_id aponta para uma duplicada de ano
UPDATE public.folders f
SET parent_id = tcy.canonical_id
FROM temp_canonical_years tcy
WHERE f.parent_id = tcy.duplicate_id;

-- 1.2 Reatribui quaisquer notas que porventura estivessem associadas diretamente à pasta do ano
UPDATE public.notes n
SET folder_id = tcy.canonical_id
FROM temp_canonical_years tcy
WHERE n.folder_id = tcy.duplicate_id;

-- 1.3 Exclui as pastas de ano duplicadas que agora ficaram vazias (sem filhas e sem notas)
DELETE FROM public.folders
WHERE id IN (SELECT duplicate_id FROM temp_canonical_years)
  AND id NOT IN (SELECT DISTINCT parent_id FROM public.folders WHERE parent_id IS NOT NULL)
  AND id NOT IN (SELECT DISTINCT folder_id FROM public.notes WHERE folder_id IS NOT NULL);

DROP TABLE temp_canonical_years;


-- ------------------------------------------------------------------------------
-- PASSO 2: UNIFICAÇÃO DE PASTAS DE MESES DUPLICADAS
-- ------------------------------------------------------------------------------

-- Tabela temporária mapeando [pasta_mes_duplicada_id] -> [pasta_mes_canonica_id]
CREATE TEMP TABLE temp_canonical_months AS
WITH ranked_months AS (
  SELECT
    id,
    user_id,
    parent_id,
    TRIM(LOWER(name)) AS clean_month_name,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, parent_id, TRIM(LOWER(name))
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, parent_id, TRIM(LOWER(name))
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id
  FROM public.folders
  WHERE parent_id IS NOT NULL
)
SELECT
  id AS duplicate_id,
  canonical_id,
  user_id
FROM ranked_months
WHERE id <> canonical_id;

-- 2.1 Move todas as notas das pastas de meses duplicadas para a pasta canônica correspondente
UPDATE public.notes n
SET folder_id = tcm.canonical_id
FROM temp_canonical_months tcm
WHERE n.folder_id = tcm.duplicate_id;

-- 2.2 Reatribui quaisquer subpastas se houver
UPDATE public.folders f
SET parent_id = tcm.canonical_id
FROM temp_canonical_months tcm
WHERE f.parent_id = tcm.duplicate_id;

-- 2.3 Exclui as pastas de mês duplicadas que agora estão vazias
DELETE FROM public.folders
WHERE id IN (SELECT duplicate_id FROM temp_canonical_months)
  AND id NOT IN (SELECT DISTINCT parent_id FROM public.folders WHERE parent_id IS NOT NULL)
  AND id NOT IN (SELECT DISTINCT folder_id FROM public.notes WHERE folder_id IS NOT NULL);

DROP TABLE temp_canonical_months;


-- ------------------------------------------------------------------------------
-- PASSO 3: DEDUPLICAÇÃO DEFENSIVA DE NOTAS DIÁRIAS (SE HOUVER REPETIÇÃO DO MESMO DIA)
-- ------------------------------------------------------------------------------
-- Se existirem notas duplicadas para o mesmo user_id + entry_date (ex: dois registros
-- criados por duplo clique antes da correção), elege a que tiver maior conteúdo ou mais recente
-- e remove somente notas sem conteúdo. Se ambas tiverem conteúdo, preserva ambas.
WITH duplicate_empty_notes AS (
  SELECT
    n1.id
  FROM public.notes n1
  JOIN public.notes n2
    ON n1.user_id = n2.user_id
   AND n1.entry_date = n2.entry_date
   AND n1.id <> n2.id
  WHERE n1.entry_date IS NOT NULL
    AND (n1.content IS NULL OR TRIM(n1.content) = '')
    AND (n2.content IS NOT NULL AND TRIM(n2.content) <> '')
)
DELETE FROM public.notes
WHERE id IN (SELECT id FROM duplicate_empty_notes);


-- ------------------------------------------------------------------------------
-- PASSO 4: ÍNDICES E RESTRIÇÕES DE UNICIDADE PARA EVITAR FUTURAS DUPLICAÇÕES
-- ------------------------------------------------------------------------------

-- Impede que o mesmo usuário tenha duas pastas raiz de ano com o mesmo nome (ex: dois "2026")
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_diary_year_folder
  ON public.folders (user_id, TRIM(name))
  WHERE parent_id IS NULL AND TRIM(name) ~ '^\d{4}$';

-- Impede que o mesmo usuário tenha duas pastas com o mesmo nome sob o mesmo ano/pasta pai
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_diary_month_folder
  ON public.folders (user_id, parent_id, TRIM(LOWER(name)))
  WHERE parent_id IS NOT NULL;

COMMIT;
