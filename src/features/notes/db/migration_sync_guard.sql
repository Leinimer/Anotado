-- Migration: Add needs_sync and revision columns to public.notes and public.folders with indexing
-- Created: 2026-08-26
-- Description: Incremental migration to support resilient offline-first sync verification, revision tracking, and SyncGuard routine.

-- 1. Add columns to public.notes
ALTER TABLE public.notes 
ADD COLUMN IF NOT EXISTS needs_sync BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.notes 
ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

-- 2. Add columns to public.folders
ALTER TABLE public.folders 
ADD COLUMN IF NOT EXISTS needs_sync BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.folders 
ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

-- 3. Create composite indexes for fast user-scoped sync queries
CREATE INDEX IF NOT EXISTS idx_notes_user_needs_sync ON public.notes(user_id, needs_sync);
CREATE INDEX IF NOT EXISTS idx_folders_user_needs_sync ON public.folders(user_id, needs_sync);

-- 4. Create revision indexes for version comparison
CREATE INDEX IF NOT EXISTS idx_notes_user_revision ON public.notes(user_id, revision);
CREATE INDEX IF NOT EXISTS idx_folders_user_revision ON public.folders(user_id, revision);
