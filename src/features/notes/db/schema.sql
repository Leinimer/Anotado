-- Migration: Create folders, notes, and notes storage bucket with individual RLS policies
-- Created: 2026-08-22

-- 1. Create folders table
CREATE TABLE IF NOT EXISTS public.folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Nova pasta',
    parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Create notes metadata table
CREATE TABLE IF NOT EXISTS public.notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT 'Nova nota',
    content TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Indexes for fast query performance and hierarchical sorting
CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON public.folders(user_id, parent_id, position);
CREATE INDEX IF NOT EXISTS idx_notes_user_folder ON public.notes(user_id, folder_id, position);
CREATE INDEX IF NOT EXISTS idx_notes_user_created ON public.notes(user_id, created_at DESC);

-- 4. Enable Row Level Security (RLS) on Database Tables
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

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
