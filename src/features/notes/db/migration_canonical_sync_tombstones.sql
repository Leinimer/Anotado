-- ==============================================================================
-- MIGRATION: TABELA DE TOMBSTONES, DISCRIMINADOR WORKSPACE_TYPE E DADOS DO DIÁRIO
-- Arquivo: migration_canonical_sync_tombstones.sql
-- ==============================================================================

-- 1. Garante colunas de workspace_type e diário na tabela folders
ALTER TABLE public.folders 
ADD COLUMN IF NOT EXISTS workspace_type TEXT NOT NULL DEFAULT 'notes';

ALTER TABLE public.folders 
ADD COLUMN IF NOT EXISTS diary_year INTEGER DEFAULT NULL;

ALTER TABLE public.folders 
ADD COLUMN IF NOT EXISTS diary_month INTEGER DEFAULT NULL;

-- 2. Garante colunas de workspace_type e diário na tabela notes
ALTER TABLE public.notes 
ADD COLUMN IF NOT EXISTS workspace_type TEXT NOT NULL DEFAULT 'notes';

ALTER TABLE public.notes 
ADD COLUMN IF NOT EXISTS entry_date DATE DEFAULT NULL;

ALTER TABLE public.notes 
ADD COLUMN IF NOT EXISTS diary_year INTEGER DEFAULT NULL;

ALTER TABLE public.notes 
ADD COLUMN IF NOT EXISTS diary_month INTEGER DEFAULT NULL;

ALTER TABLE public.notes 
ADD COLUMN IF NOT EXISTS diary_day INTEGER DEFAULT NULL;

-- 3. Cria tabela canônica de deleções/tombstones para sincronização confiável
CREATE TABLE IF NOT EXISTS public.sync_tombstones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL, -- 'note' | 'folder'
    entity_id UUID NOT NULL,
    workspace_type TEXT DEFAULT 'notes',
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    revision BIGINT DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Índices de consulta rápida de deleções
CREATE INDEX IF NOT EXISTS idx_sync_tombstones_user_deleted 
ON public.sync_tombstones(user_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_sync_tombstones_user_entity 
ON public.sync_tombstones(user_id, entity_type, entity_id);

-- Configura Row Level Security para sync_tombstones
ALTER TABLE public.sync_tombstones ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'sync_tombstones' AND policyname = 'Users can manage their own tombstones'
  ) THEN
    CREATE POLICY "Users can manage their own tombstones"
      ON public.sync_tombstones
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 4. Habilita Realtime na tabela sync_tombstones se não estiver na publicação
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_tombstones;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$;

-- 5. Índices para isolamento entre 'notes' e 'diary'
CREATE INDEX IF NOT EXISTS idx_folders_user_workspace ON public.folders(user_id, workspace_type);
CREATE INDEX IF NOT EXISTS idx_notes_user_workspace ON public.notes(user_id, workspace_type);
CREATE INDEX IF NOT EXISTS idx_notes_diary_date ON public.notes(user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_notes_diary_year_month ON public.notes(user_id, diary_year, diary_month);

-- 6. Unicidade rigorosa para entradas do Diário: 1 nota por usuário + data
CREATE UNIQUE INDEX IF NOT EXISTS uq_notes_user_diary_date 
ON public.notes(user_id, entry_date) 
WHERE workspace_type = 'diary' AND entry_date IS NOT NULL;

-- 7. Migração de dados existentes:
-- Pastas de Ano do Diário (nome de 4 dígitos sem pai)
UPDATE public.folders 
SET workspace_type = 'diary',
    diary_year = CASE WHEN name ~ '^\d{4}$' THEN name::INTEGER ELSE NULL END
WHERE parent_id IS NULL AND name ~ '^\d{4}$' AND (workspace_type IS NULL OR workspace_type = 'notes');

-- Pastas de Mês do Diário (filhas de pastas de ano do Diário)
UPDATE public.folders child
SET workspace_type = 'diary',
    diary_year = parent.diary_year
FROM public.folders parent
WHERE child.parent_id = parent.id 
  AND parent.workspace_type = 'diary' 
  AND (child.workspace_type IS NULL OR child.workspace_type = 'notes');

-- Notas contidas em pastas do Diário
UPDATE public.notes n
SET workspace_type = 'diary',
    diary_year = f.diary_year,
    diary_month = f.diary_month,
    diary_day = CASE WHEN n.position > 0 AND n.position <= 31 THEN n.position ELSE NULL END
FROM public.folders f
WHERE n.folder_id = f.id 
  AND f.workspace_type = 'diary' 
  AND (n.workspace_type IS NULL OR n.workspace_type = 'notes');
