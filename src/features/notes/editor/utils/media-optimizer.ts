/**
 * Utilitários de otimização de mídias, cache de URLs e instrumentação de performance.
 */

// Cache em memória de mídias já carregadas e validadas na sessão
const loadedMediaCache = new Set<string>();

/**
 * Registra uma URL de mídia como carregada em cache
 */
export function markMediaAsLoaded(url: string): void {
  if (url) {
    loadedMediaCache.add(url);
  }
}

/**
 * Verifica se a URL já foi carregada previamente nesta sessão
 */
export function isMediaInCache(url: string): boolean {
  if (!url) return false;
  return loadedMediaCache.has(url);
}

/**
 * Extrai o ID do vídeo do YouTube a partir de qualquer formato de link (watch, embed, shorts, youtu.be)
 */
export function extractYouTubeVideoId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
  const match = trimmed.match(regExp);
  if (match && match[2].length === 11) {
    return match[2];
  }
  return null;
}

/**
 * Retorna a URL de thumbnail leve de alta resolução do YouTube
 */
export function getYouTubeThumbnailUrl(videoIdOrUrl: string): string {
  const id = extractYouTubeVideoId(videoIdOrUrl) || videoIdOrUrl;
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/**
 * Otimiza a entrega de imagens do Supabase Storage sem alterar o arquivo original persistido.
 * Caso seja uma imagem do Supabase Storage, adiciona parâmetros de renderização otimizada quando suportado.
 */
export function getOptimizedImageUrl(src: string, targetWidth: number = 850): string {
  if (!src) return '';
  
  // Data URLs ou blobs locais não precisam de transformação de CDN
  if (src.startsWith('data:') || src.startsWith('blob:')) {
    return src;
  }

  // Supabase Storage Image Transformations (se URL for de um bucket Supabase)
  if (src.includes('/storage/v1/object/public/')) {
    // Transforma para render/image/public mantendo cache eficiente
    try {
      const url = new URL(src);
      // Se a CDN do Supabase Image Transformation estiver habilitada
      const renderPath = url.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
      const optimizedUrl = new URL(renderPath, url.origin);
      optimizedUrl.searchParams.set('width', Math.min(Math.max(targetWidth, 320), 1600).toString());
      optimizedUrl.searchParams.set('quality', '85');
      return optimizedUrl.toString();
    } catch {
      return src;
    }
  }

  return src;
}

/**
 * Instrumentação de Performance T0-T7 para diagnóstico de ciclo de vida de notas e renderização de mídias.
 */
class PerformanceProfiler {
  private markers = new Map<string, number>();

  start(noteId: string, label: string = 'open_note') {
    const key = `${noteId}_${label}`;
    const now = performance.now();
    this.markers.set(key, now);
    if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
      console.log(`⏱️ [T0 - Início Seleção de Nota] ID: ${noteId} às ${now.toFixed(2)}ms`);
    }
    return now;
  }

  mark(noteId: string, stepName: string, meta?: Record<string, any>) {
    const now = performance.now();
    const startKey = `${noteId}_open_note`;
    const startTime = this.markers.get(startKey) || now;
    const elapsed = now - startTime;

    if (typeof window !== 'undefined') {
      const metaStr = meta ? ` | Meta: ${JSON.stringify(meta)}` : '';
      console.log(`⚡ [${stepName}] Nota ${noteId} +${elapsed.toFixed(1)}ms${metaStr}`);
    }
    return elapsed;
  }

  end(noteId: string, label: string = 'open_note') {
    const key = `${noteId}_${label}`;
    const startTime = this.markers.get(key);
    const now = performance.now();
    if (startTime !== undefined) {
      const total = now - startTime;
      if (typeof window !== 'undefined') {
        console.log(`🏁 [T7 - Nota Totalmente Carregada e Visível] ID: ${noteId} em ${total.toFixed(2)}ms`);
      }
      this.markers.delete(key);
      return total;
    }
    return 0;
  }
}

export const perfProfiler = new PerformanceProfiler();
