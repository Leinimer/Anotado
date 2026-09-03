-- ==============================================================================
-- MIGRATION: SEPARAÇÃO DE ESPAÇOS 'NOTES' E 'DIARY' COM MODELO ESTRUTURAL
-- Arquivo: migration_workspace_diary.sql
-- Data: 2026-09-03
-- ==============================================================================

-- 1. Adiciona coluna discriminadora de espaço em public.folders
-- Toda pasta existente recebe 'notes' por padrão
ALTER TABLE public.folders 
ADD COLUMN IF NOT EXISTS workspace_type TEXT NOT NULL DEFAULT 'notes';

ALTER TABLE public.folders 
ADD COLUMN IF NOT EXISTS diary_year INTEGER DEFAULT NULL;

ALTER TABLE public.folders 
ADD COLUMN IF NOT EXISTS diary_month INTEGER DEFAULT NULL;

-- 2. Adiciona coluna discriminadora de espaço e dados de calendário em public.notes
-- Toda nota existente recebe 'notes' por padrão
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

-- 3. Adiciona workspace_type em public.note_attachments para integridade de contexto
ALTER TABLE public.note_attachments 
ADD COLUMN IF NOT EXISTS workspace_type TEXT NOT NULL DEFAULT 'notes';

-- 4. Criação de índices para consultas eficientes e isoladas por espaço
CREATE INDEX IF NOT EXISTS idx_folders_user_workspace ON public.folders(user_id, workspace_type);
CREATE INDEX IF NOT EXISTS idx_notes_user_workspace ON public.notes(user_id, workspace_type);
CREATE INDEX IF NOT EXISTS idx_notes_diary_date ON public.notes(user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_notes_diary_year_month ON public.notes(user_id, diary_year, diary_month);

-- 5. Regra de unicidade rigorosa: cada dia deve ser uma entidade única
-- Não permitir duas entradas para o mesmo: usuário + data + diário
CREATE UNIQUE INDEX IF NOT EXISTS uq_notes_user_diary_date 
ON public.notes(user_id, entry_date) 
WHERE workspace_type = 'diary' AND entry_date IS NOT NULL;
