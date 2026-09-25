-- Migration: Correção definitiva de RLS para Storage 'note-attachments' e tabela 'public.note_attachments'
-- Garante que uploads de novos arquivos (via INSERT com upsert: false) e operações de metadados
-- funcionem com isolamento rigoroso por usuário (sem USING true, sem bypass de RLS).

-- 1. Assegurar RLS na tabela public.note_attachments
ALTER TABLE public.note_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own note_attachments" ON public.note_attachments;
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

-- 2. Garantir bucket 'note-attachments' configurado
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('note-attachments', 'note-attachments', true, 52428800)
ON CONFLICT (id) DO UPDATE SET
    file_size_limit = 52428800;

-- 3. Storage Objects RLS Policies para o bucket 'note-attachments'
-- Caminho permanente determinístico: {user_id}/{attachment_id}.{extension}
-- O primeiro segmento do foldername DEVE ser estritamente igual ao auth.uid() do usuário.

-- SELECT: Permite ao usuário ler seus próprios objetos
DROP POLICY IF EXISTS "Users can read attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their attachments" ON storage.objects;
CREATE POLICY "Users can read their attachments"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'note-attachments' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- INSERT: Permite ao usuário enviar novos arquivos binários (INSERT nativo sem depender de upsert)
DROP POLICY IF EXISTS "Users can upload attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can insert their attachments" ON storage.objects;
CREATE POLICY "Users can insert their attachments"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'note-attachments' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- UPDATE: Permite ao usuário atualizar seus próprios objetos caso necessário em reprocessamento
DROP POLICY IF EXISTS "Users can update their attachments" ON storage.objects;
CREATE POLICY "Users can update their attachments"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'note-attachments' AND
        (storage.foldername(name))[1] = auth.uid()::text
    )
    WITH CHECK (
        bucket_id = 'note-attachments' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- DELETE: Permite ao usuário remover apenas seus próprios arquivos
DROP POLICY IF EXISTS "Users can delete their attachments" ON storage.objects;
CREATE POLICY "Users can delete their attachments"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'note-attachments' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );
