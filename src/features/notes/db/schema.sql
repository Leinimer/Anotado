-- Migration: Create folders, notes, and notes storage bucket with individual RLS policies
-- Created: 2026-08-22

-- 1. Create folders table (with color, revision and smart folder support)
CREATE TABLE IF NOT EXISTS public.folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Nova pasta',
    parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    color TEXT DEFAULT NULL,
    is_smart BOOLEAN NOT NULL DEFAULT FALSE,
    smart_tags TEXT[] NOT NULL DEFAULT '{}'::text[],
    revision BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure columns exist if table was already created earlier
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS color TEXT DEFAULT NULL;
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS is_smart BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS smart_tags TEXT[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

-- 2. Create notes metadata table
CREATE TABLE IF NOT EXISTS public.notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT 'Nova nota',
    content TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    previous_folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
    revision BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure columns exist if notes table was already created earlier
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS previous_folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

-- Normalized tags and note_tags relation for user-scoped tag persistence
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

-- Media and document attachments metadata table
CREATE TABLE IF NOT EXISTS public.note_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID REFERENCES public.notes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    file_size BIGINT NOT NULL DEFAULT 0,
    storage_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Full-Text Search column generation & Indexing
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS search_vector tsvector 
    GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED;

-- 3. Indexes for fast query performance, hierarchical sorting, archiving and search
CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON public.folders(user_id, parent_id, position);
CREATE INDEX IF NOT EXISTS idx_folders_user_revision ON public.folders(user_id, revision);
CREATE INDEX IF NOT EXISTS idx_notes_user_folder ON public.notes(user_id, folder_id, position);
CREATE INDEX IF NOT EXISTS idx_notes_user_archived ON public.notes(user_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_notes_user_prev_folder ON public.notes(user_id, previous_folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_revision ON public.notes(user_id, revision);
CREATE INDEX IF NOT EXISTS idx_notes_user_tags ON public.notes USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_tags_user ON public.tags(user_id, name);
CREATE INDEX IF NOT EXISTS idx_note_tags_user ON public.note_tags(user_id, note_id, tag_id);
CREATE INDEX IF NOT EXISTS idx_note_attachments_user ON public.note_attachments(user_id, note_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_created ON public.notes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_search_vector ON public.notes USING GIN(search_vector);

-- 4. Enable Row Level Security (RLS) on Database Tables
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_attachments ENABLE ROW LEVEL SECURITY;

-- 5. Atomic RPC function for archiving all notes in a folder and its subfolders
CREATE OR REPLACE FUNCTION public.archive_folder_notes(p_folder_id UUID, p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    affected_count INTEGER;
BEGIN
    -- Recursively find all subfolder IDs belonging to this user
    WITH RECURSIVE subfolders AS (
        SELECT id FROM public.folders WHERE id = p_folder_id AND user_id = p_user_id
        UNION ALL
        SELECT f.id FROM public.folders f
        INNER JOIN subfolders s ON f.parent_id = s.id
        WHERE f.user_id = p_user_id
    )
    UPDATE public.notes
    SET 
        is_archived = TRUE,
        previous_folder_id = folder_id,
        folder_id = NULL,
        updated_at = timezone('utc'::text, now())
    WHERE user_id = p_user_id 
      AND folder_id IN (SELECT id FROM subfolders)
      AND is_archived = FALSE;

    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RETURN affected_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. RLS Policies for Folders (Individual operations)
CREATE POLICY "Users can view their own folders"
    ON public.folders FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own folders"
    ON public.folders FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own folders"
    ON public.folders FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own folders"
    ON public.folders FOR DELETE
    USING (auth.uid() = user_id);

-- 6. RLS Policies for Notes (Individual operations)
CREATE POLICY "Users can view their own notes"
    ON public.notes FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own notes"
    ON public.notes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notes"
    ON public.notes FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notes"
    ON public.notes FOR DELETE
    USING (auth.uid() = user_id);

-- 6.1 RLS Policies for Tags
CREATE POLICY "Users can view their own tags"
    ON public.tags FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tags"
    ON public.tags FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tags"
    ON public.tags FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tags"
    ON public.tags FOR DELETE
    USING (auth.uid() = user_id);

-- 6.2 RLS Policies for Note Tags
CREATE POLICY "Users can view their own note_tags"
    ON public.note_tags FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own note_tags"
    ON public.note_tags FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own note_tags"
    ON public.note_tags FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own note_tags"
    ON public.note_tags FOR DELETE
    USING (auth.uid() = user_id);

-- 6.3 RLS Policies for Note Attachments
CREATE POLICY "Users can view their own note_attachments"
    ON public.note_attachments FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own note_attachments"
    ON public.note_attachments FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own note_attachments"
    ON public.note_attachments FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own note_attachments"
    ON public.note_attachments FOR DELETE
    USING (auth.uid() = user_id);

-- 7. Storage Bucket Setup: 'notes' (Private Markdown Persistence)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'notes',
    'notes',
    false,
    5242880, -- 5MB limit per Markdown note
    ARRAY['text/markdown', 'text/plain']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['text/markdown', 'text/plain']::text[];

-- 8. Storage Bucket Setup: 'note-attachments' (Media and PDF attachments)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('note-attachments', 'note-attachments', true, 52428800) -- 50MB
ON CONFLICT (id) DO NOTHING;

-- 9. Storage Objects RLS Policies for 'notes' bucket (Path: {user_id}/{note_id}.md)
-- Allows users to read their own Markdown note files
CREATE POLICY "Users can read their own notes storage files"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'notes' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- Allows users to insert their own Markdown note files
CREATE POLICY "Users can insert their own notes storage files"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'notes' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- Allows users to update their own Markdown note files
CREATE POLICY "Users can update their own notes storage files"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'notes' AND
        (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'notes' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- Allows users to delete their own Markdown note files
CREATE POLICY "Users can delete their own notes storage files"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'notes' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- 10. Storage Objects RLS Policies for 'note-attachments' bucket
CREATE POLICY "Users can read attachments"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'note-attachments');

CREATE POLICY "Users can upload attachments"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'note-attachments');

CREATE POLICY "Users can delete their attachments"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'note-attachments' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );
