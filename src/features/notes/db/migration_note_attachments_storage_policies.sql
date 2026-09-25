-- Migration: migration_note_attachments_storage_policies.sql
-- Descrição: Configuração completa, segura e idempotente de RLS para o bucket 'note-attachments'
-- e para a tabela de metadados 'public.note_attachments'.
-- Pode ser colada e executada diretamente no Supabase SQL Editor.

-- ============================================================================
-- 1. TABELA public.note_attachments: RLS E POLICIES
-- ============================================================================

-- Garantir que a tabela existe com todas as colunas necessárias
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

-- Ativar Row Level Security
ALTER TABLE public.note_attachments ENABLE ROW LEVEL SECURITY;

-- Limpar policies anteriores para garantir idempotência
DROP POLICY IF EXISTS "Users can view their own note_attachments" ON public.note_attachments;
DROP POLICY IF EXISTS "Users can read their own note_attachments" ON public.note_attachments;
DROP POLICY IF EXISTS "Users can select their own note_attachments" ON public.note_attachments;
CREATE POLICY "Users can view their own note_attachments"
    ON public.note_attachments FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own note_attachments" ON public.note_attachments;
CREATE POLICY "Users can insert their own note_attachments"
    ON public.note_attachments FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own note_attachments" ON public.note_attachments;
CREATE POLICY "Users can update their own note_attachments"
    ON public.note_attachments FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own note_attachments" ON public.note_attachments;
CREATE POLICY "Users can delete their own note_attachments"
    ON public.note_attachments FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_note_attachments_user_note ON public.note_attachments(user_id, note_id);
CREATE INDEX IF NOT EXISTS idx_note_attachments_storage_path ON public.note_attachments(storage_path);

-- ============================================================================
-- 2. BUCKET 'note-attachments' NO STORAGE
-- ============================================================================

-- Garante a criação do bucket com limite de 50MB (52428800 bytes)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('note-attachments', 'note-attachments', true, 52428800)
ON CONFLICT (id) DO UPDATE SET
    file_size_limit = 52428800;

-- ============================================================================
-- 3. POLICIES DE RLS NO storage.objects PARA BUCKET 'note-attachments'
-- Caminho permanente determinístico: {user_id}/{attachment_id}.{extension}
-- Regra mandatória: primeiro segmento do path (prefixo) = auth.uid()
-- ============================================================================

-- Limpeza idempotente de policies legadas do bucket note-attachments
DROP POLICY IF EXISTS "Users can read attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can select their attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can insert their attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their attachments" ON storage.objects;

-- SELECT: Permite ao usuário autenticado consultar/ler exclusivamente seus próprios arquivos
-- Importante: Essencial para retorno de metadados pelo Storage após o upload
CREATE POLICY "Users can read their attachments"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'note-attachments' AND
        (
            split_part(name, '/', 1) = (select auth.uid())::text
            OR (storage.foldername(name))[1] = (select auth.uid())::text
        )
    );

-- INSERT: Permite ao usuário autenticado enviar novos arquivos binários (INSERT nativo com upsert: false)
CREATE POLICY "Users can insert their attachments"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'note-attachments' AND
        (
            split_part(name, '/', 1) = (select auth.uid())::text
            OR (storage.foldername(name))[1] = (select auth.uid())::text
        )
    );

-- UPDATE: Permite atualizar seus próprios arquivos se necessário em reprocessamento
CREATE POLICY "Users can update their attachments"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'note-attachments' AND
        (
            split_part(name, '/', 1) = (select auth.uid())::text
            OR (storage.foldername(name))[1] = (select auth.uid())::text
        )
    )
    WITH CHECK (
        bucket_id = 'note-attachments' AND
        (
            split_part(name, '/', 1) = (select auth.uid())::text
            OR (storage.foldername(name))[1] = (select auth.uid())::text
        )
    );

-- DELETE: Permite ao usuário excluir apenas seus próprios arquivos
CREATE POLICY "Users can delete their attachments"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'note-attachments' AND
        (
            split_part(name, '/', 1) = (select auth.uid())::text
            OR (storage.foldername(name))[1] = (select auth.uid())::text
        )
    );
