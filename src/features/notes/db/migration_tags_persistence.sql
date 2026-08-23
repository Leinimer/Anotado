-- Migration: Ensure tags column persistence on public.notes and sync with storage
-- Created: 2026-08-23

-- 1. Ensure tags column exists in public.notes with proper text array type and default
ALTER TABLE public.notes 
ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::text[];

-- 2. Create GIN index for high-performance tag searches and smart folder filtering
CREATE INDEX IF NOT EXISTS idx_notes_user_tags ON public.notes USING GIN(tags);

-- 3. Ensure normalized tags and note_tags tables exist for user-scoped tag queries if needed
CREATE TABLE IF NOT EXISTS public.tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS public.note_tags (
    note_id UUID NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_tags_user ON public.tags(user_id, name);
CREATE INDEX IF NOT EXISTS idx_note_tags_user ON public.note_tags(user_id, note_id, tag_id);

-- 4. Ensure RLS is active on all related tables
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_tags ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for tags
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tags' AND policyname = 'Users can view their own tags') THEN
        CREATE POLICY "Users can view their own tags" ON public.tags FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tags' AND policyname = 'Users can insert their own tags') THEN
        CREATE POLICY "Users can insert their own tags" ON public.tags FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tags' AND policyname = 'Users can update their own tags') THEN
        CREATE POLICY "Users can update their own tags" ON public.tags FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tags' AND policyname = 'Users can delete their own tags') THEN
        CREATE POLICY "Users can delete their own tags" ON public.tags FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

-- 6. RLS Policies for note_tags
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'note_tags' AND policyname = 'Users can view their own note_tags') THEN
        CREATE POLICY "Users can view their own note_tags" ON public.note_tags FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'note_tags' AND policyname = 'Users can insert their own note_tags') THEN
        CREATE POLICY "Users can insert their own note_tags" ON public.note_tags FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'note_tags' AND policyname = 'Users can update their own note_tags') THEN
        CREATE POLICY "Users can update their own note_tags" ON public.note_tags FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'note_tags' AND policyname = 'Users can delete their own note_tags') THEN
        CREATE POLICY "Users can delete their own note_tags" ON public.note_tags FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;
