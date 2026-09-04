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
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS workspace_type TEXT NOT NULL DEFAULT 'notes';
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS diary_year INTEGER DEFAULT NULL;
ALTER TABLE public.folders ADD COLUMN IF NOT EXISTS diary_month INTEGER DEFAULT NULL;

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
    workspace_type TEXT NOT NULL DEFAULT 'notes',
    entry_date DATE DEFAULT NULL,
    diary_year INTEGER DEFAULT NULL,
    diary_month INTEGER DEFAULT NULL,
    diary_day INTEGER DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure columns exist if notes table was already created earlier
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS previous_folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS workspace_type TEXT NOT NULL DEFAULT 'notes';
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS entry_date DATE DEFAULT NULL;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS diary_year INTEGER DEFAULT NULL;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS diary_month INTEGER DEFAULT NULL;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS diary_day INTEGER DEFAULT NULL;

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

-- 11. Read-Only Shared Diary System (diary_shares, find_user_by_email RPC, RLS)
CREATE TABLE IF NOT EXISTS public.diary_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    viewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    owner_email TEXT,
    viewer_email TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked')),
    permission TEXT NOT NULL DEFAULT 'viewer' CHECK (permission IN ('viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    accepted_at TIMESTAMPTZ DEFAULT NULL,
    revoked_at TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT uq_diary_shares_owner_viewer UNIQUE (owner_id, viewer_id),
    CONSTRAINT chk_diary_shares_not_self CHECK (owner_id != viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_diary_shares_owner_id ON public.diary_shares(owner_id);
CREATE INDEX IF NOT EXISTS idx_diary_shares_viewer_id ON public.diary_shares(viewer_id);
CREATE INDEX IF NOT EXISTS idx_diary_shares_status ON public.diary_shares(status);

ALTER TABLE public.diary_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their related shares" ON public.diary_shares;
CREATE POLICY "Users can view their related shares"
    ON public.diary_shares FOR SELECT
    TO authenticated
    USING (auth.uid() = owner_id OR auth.uid() = viewer_id);

DROP POLICY IF EXISTS "Owners can create shares" ON public.diary_shares;
CREATE POLICY "Owners can create shares"
    ON public.diary_shares FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = owner_id AND auth.uid() != viewer_id);

DROP POLICY IF EXISTS "Owners and viewers can update their shares" ON public.diary_shares;
CREATE POLICY "Owners and viewers can update their shares"
    ON public.diary_shares FOR UPDATE
    TO authenticated
    USING (auth.uid() = owner_id OR auth.uid() = viewer_id)
    WITH CHECK (auth.uid() = owner_id OR auth.uid() = viewer_id);

DROP POLICY IF EXISTS "Owners can delete their shares" ON public.diary_shares;
CREATE POLICY "Owners can delete their shares"
    ON public.diary_shares FOR DELETE
    TO authenticated
    USING (auth.uid() = owner_id);

-- Secure RPC to find registered users by email in auth.users
CREATE OR REPLACE FUNCTION public.find_user_by_email(email_input text)
RETURNS TABLE (
  id uuid,
  email text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.id,
    u.email::text
  FROM auth.users u
  WHERE auth.uid() IS NOT NULL
    AND lower(trim(u.email)) = lower(trim(email_input))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_user_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_user_by_email(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(text) TO authenticated;

-- Function to check if viewer has accepted access to owner's diary
CREATE OR REPLACE FUNCTION public.has_diary_access(target_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR target_owner_id IS NULL THEN FALSE
    WHEN auth.uid() = target_owner_id THEN TRUE
    ELSE EXISTS (
      SELECT 1
      FROM public.diary_shares
      WHERE owner_id = target_owner_id
        AND viewer_id = auth.uid()
        AND status = 'accepted'
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.has_diary_access(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_diary_access(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_diary_access(UUID) TO authenticated;

-- Hierarchy validation functions based on real folder structure (Years and Months)
CREATE OR REPLACE FUNCTION public.is_shared_diary_folder(p_folder_id UUID, p_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_folder_id IS NULL OR p_owner_id IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1 FROM public.folders f
      WHERE f.id = p_folder_id
        AND f.user_id = p_owner_id
        AND (
          (f.parent_id IS NULL AND f.name ~ '^\d{4}$')
          OR
          (f.parent_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.folders y
            WHERE y.id = f.parent_id
              AND y.user_id = p_owner_id
              AND y.parent_id IS NULL
              AND y.name ~ '^\d{4}$'
          ))
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_shared_diary_folder(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_shared_diary_folder(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_shared_diary_folder(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_shared_diary_note(p_folder_id UUID, p_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_folder_id IS NULL OR p_owner_id IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1 FROM public.folders m
      JOIN public.folders y ON m.parent_id = y.id
      WHERE m.id = p_folder_id
        AND m.user_id = p_owner_id
        AND y.parent_id IS NULL
        AND y.name ~ '^\d{4}$'
        AND y.user_id = p_owner_id
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_shared_diary_note(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_shared_diary_note(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_shared_diary_note(UUID, UUID) TO authenticated;

-- Strict storage validation functions
CREATE OR REPLACE FUNCTION public.can_access_shared_diary_note_storage(p_name text, p_viewer_id uuid)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid;
  v_note_id uuid;
  v_parts text[];
BEGIN
  IF p_name IS NULL OR p_viewer_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT (p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.md$') THEN
    RETURN FALSE;
  END IF;

  v_parts := string_to_array(p_name, '/');
  v_owner_id := v_parts[1]::uuid;
  v_note_id := (regexp_replace(v_parts[2], '\.md$', ''))::uuid;

  IF v_owner_id = p_viewer_id THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.diary_shares ds
    WHERE ds.owner_id = v_owner_id
      AND ds.viewer_id = p_viewer_id
      AND ds.status = 'accepted'
  ) THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.id = v_note_id
      AND n.user_id = v_owner_id
      AND n.is_archived = FALSE
      AND public.is_shared_diary_note(n.folder_id, n.user_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_shared_diary_note_storage(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_shared_diary_note_storage(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_shared_diary_note_storage(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_shared_diary_attachment_storage(p_name text, p_viewer_id uuid)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_parts text[];
  v_att_id_candidate text;
  v_att_id uuid;
BEGIN
  IF p_name IS NULL OR p_viewer_id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_parts := string_to_array(p_name, '/');

  IF array_length(v_parts, 1) >= 2 THEN
    v_att_id_candidate := regexp_replace(v_parts[2], '\.[^.]+$', '');
    IF v_att_id_candidate ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      v_att_id := v_att_id_candidate::uuid;
    END IF;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.note_attachments na
    JOIN public.notes n ON na.note_id = n.id AND na.user_id = n.user_id
    JOIN public.diary_shares ds ON ds.owner_id = na.user_id
    WHERE (
        na.storage_path = p_name
        OR na.storage_path = '/' || p_name
        OR (v_att_id IS NOT NULL AND na.id = v_att_id)
      )
      AND na.note_id IS NOT NULL
      AND ds.viewer_id = p_viewer_id
      AND ds.owner_id != p_viewer_id
      AND ds.status = 'accepted'
      AND n.is_archived = FALSE
      AND public.is_shared_diary_note(n.folder_id, n.user_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_shared_diary_attachment_storage(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_shared_diary_attachment_storage(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_shared_diary_attachment_storage(text, uuid) TO authenticated;

-- Viewer SELECT policies for shared diary notes and folders
DROP POLICY IF EXISTS "Viewers can view shared diary folders" ON public.folders;
CREATE POLICY "Viewers can view shared diary folders"
    ON public.folders FOR SELECT
    TO authenticated
    USING (
      auth.uid() != user_id
      AND EXISTS (
        SELECT 1 FROM public.diary_shares ds
        WHERE ds.owner_id = folders.user_id
          AND ds.viewer_id = auth.uid()
          AND ds.status = 'accepted'
      )
      AND public.is_shared_diary_folder(id, user_id)
    );

DROP POLICY IF EXISTS "Viewers can view shared diary notes" ON public.notes;
CREATE POLICY "Viewers can view shared diary notes"
    ON public.notes FOR SELECT
    TO authenticated
    USING (
      auth.uid() != user_id
      AND is_archived = FALSE
      AND EXISTS (
        SELECT 1 FROM public.diary_shares ds
        WHERE ds.owner_id = notes.user_id
          AND ds.viewer_id = auth.uid()
          AND ds.status = 'accepted'
      )
      AND public.is_shared_diary_note(folder_id, user_id)
    );

DROP POLICY IF EXISTS "Viewers can view tags of shared diary notes" ON public.tags;
CREATE POLICY "Viewers can view tags of shared diary notes"
    ON public.tags FOR SELECT
    TO authenticated
    USING (
      auth.uid() != user_id
      AND EXISTS (
        SELECT 1
        FROM public.note_tags nt
        JOIN public.notes n ON nt.note_id = n.id AND nt.user_id = n.user_id
        JOIN public.diary_shares ds ON ds.owner_id = tags.user_id
        WHERE nt.tag_id = tags.id
          AND ds.viewer_id = auth.uid()
          AND ds.status = 'accepted'
          AND n.is_archived = FALSE
          AND public.is_shared_diary_note(n.folder_id, n.user_id)
      )
    );

DROP POLICY IF EXISTS "Viewers can view note_tags of shared diary notes" ON public.note_tags;
CREATE POLICY "Viewers can view note_tags of shared diary notes"
    ON public.note_tags FOR SELECT
    TO authenticated
    USING (
      auth.uid() != user_id
      AND EXISTS (
        SELECT 1
        FROM public.notes n
        JOIN public.diary_shares ds ON ds.owner_id = note_tags.user_id
        WHERE n.id = note_tags.note_id
          AND n.user_id = note_tags.user_id
          AND ds.viewer_id = auth.uid()
          AND ds.status = 'accepted'
          AND n.is_archived = FALSE
          AND public.is_shared_diary_note(n.folder_id, n.user_id)
      )
    );

DROP POLICY IF EXISTS "Viewers can view attachments of shared diary notes" ON public.note_attachments;
CREATE POLICY "Viewers can view attachments of shared diary notes"
    ON public.note_attachments FOR SELECT
    TO authenticated
    USING (
      auth.uid() != user_id
      AND note_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.diary_shares ds
        WHERE ds.owner_id = note_attachments.user_id
          AND ds.viewer_id = auth.uid()
          AND ds.status = 'accepted'
      )
      AND EXISTS (
        SELECT 1 FROM public.notes n
        WHERE n.id = note_attachments.note_id
          AND n.user_id = note_attachments.user_id
          AND n.is_archived = FALSE
          AND public.is_shared_diary_note(n.folder_id, n.user_id)
      )
    );

DROP POLICY IF EXISTS "Viewers can read shared diary markdown notes" ON storage.objects;
CREATE POLICY "Viewers can read shared diary markdown notes"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'notes'
      AND public.can_access_shared_diary_note_storage(name, auth.uid())
    );

DROP POLICY IF EXISTS "Viewers can read shared diary attachments" ON storage.objects;
CREATE POLICY "Viewers can read shared diary attachments"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id IN ('note-attachments', 'attachments')
      AND public.can_access_shared_diary_attachment_storage(name, auth.uid())
    );

