-- Migration: Remove needs_sync column and indexes from Supabase public.notes and public.folders
-- Created: 2026-08-26
-- Description:
-- In ANOTADO! offline-first architecture, the sync status is managed EXCLUSIVELY by the local device's IndexedDB.
-- Remote Supabase database is the official source of truth for persisted data, but does not track local device pending state.
-- The 'revision' column is strictly preserved for version comparison and non-destructive conflict handling.

-- 1. Drop needs_sync indexes if they exist
DROP INDEX IF EXISTS public.idx_notes_user_needs_sync;
DROP INDEX IF EXISTS public.idx_folders_user_needs_sync;

-- 2. Remove needs_sync column from public.notes if it exists
ALTER TABLE public.notes DROP COLUMN IF EXISTS needs_sync;

-- 3. Remove needs_sync column from public.folders if it exists
ALTER TABLE public.folders DROP COLUMN IF EXISTS needs_sync;

-- 4. Ensure revision column and its index remain intact on public.notes and public.folders
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_notes_user_revision ON public.notes(user_id, revision);
CREATE INDEX IF NOT EXISTS idx_folders_user_revision ON public.folders(user_id, revision);
