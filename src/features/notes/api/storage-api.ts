import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';

export interface UploadedMediaResult {
  url: string;
  name: string;
  size: number;
  type: string;
}

/**
 * Faz upload de imagem ou documento para o Supabase Storage (bucket 'note-attachments' ou 'media').
 * Caso o bucket não exista no Supabase ou a chamada falhe, utiliza DataURL como fallback resiliente.
 */
export async function uploadNoteFile(
  userId: string | null,
  file: File
): Promise<UploadedMediaResult> {
  const effectiveUserId = userId || 'anonymous';
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const fileExt = sanitizedName.split('.').pop() || 'dat';
  const filePath = `${effectiveUserId}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;

  if (isSupabaseConfigured()) {
    try {
      const supabase = createClient();
      const bucketName = 'note-attachments';

      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath);

        if (publicUrlData?.publicUrl) {
          return {
            url: publicUrlData.publicUrl,
            name: file.name,
            size: file.size,
            type: file.type,
          };
        }
      } else {
        console.warn('Supabase storage upload error, using local data fallback:', uploadError);
      }
    } catch (err) {
      console.warn('Falha no upload do Supabase Storage:', err);
    }
  }

  // Fallback resiliente usando FileReader (Data URL)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        url: reader.result as string,
        name: file.name,
        size: file.size,
        type: file.type,
      });
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}
