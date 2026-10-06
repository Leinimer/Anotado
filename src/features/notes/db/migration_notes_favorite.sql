-- Migration: Add is_favorite column and partial index to notes
-- Created: 2026-10-06
-- Purpose: Support favorite notes feature with offline-first persistence

-- 1. Add is_favorite column to notes table (idempotent)
ALTER TABLE public.notes 
ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Create partial index for ultra-fast query performance
CREATE INDEX IF NOT EXISTS idx_notes_user_favorite 
ON public.notes(user_id, is_favorite) 
WHERE is_favorite = TRUE;
