-- ==============================================================================
-- MIGRATION: ISOLAMENTO RIGOROSO DE TAGS POR WORKSPACE ('notes' vs 'diary')
-- Arquivo: migration_tags_workspace_isolation.sql
-- ==============================================================================

-- 1. Garante que public.tags possua a coluna workspace_type
ALTER TABLE public.tags 
ADD COLUMN IF NOT EXISTS workspace_type TEXT NOT NULL DEFAULT 'notes';

-- 2. Atualiza constraint única para permitir a mesma tag em workspaces diferentes
-- e garantir que tags de 'notes' e 'diary' sejam registros isolados
DO $$
BEGIN
    -- Remove restrição antiga se existir
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'tags_user_id_name_key'
    ) THEN
        ALTER TABLE public.tags DROP CONSTRAINT tags_user_id_name_key;
    END IF;

    -- Cria nova restrição composta se ainda não existir
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'tags_user_id_name_workspace_key'
    ) THEN
        ALTER TABLE public.tags 
        ADD CONSTRAINT tags_user_id_name_workspace_key UNIQUE (user_id, name, workspace_type);
    END IF;
END $$;

-- 3. Índices para performance e consultas filtradas por workspace
CREATE INDEX IF NOT EXISTS idx_tags_user_workspace 
ON public.tags(user_id, workspace_type, name);

-- 4. Atualiza workspace_type de tags associadas a notas do diário existentes
UPDATE public.tags t
SET workspace_type = 'diary'
FROM public.note_tags nt
JOIN public.notes n ON nt.note_id = n.id
WHERE t.id = nt.tag_id
  AND (n.workspace_type = 'diary' OR n.entry_date IS NOT NULL);
