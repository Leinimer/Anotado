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
 * Utiliza diretamente a URL pública original do Supabase Storage (/storage/v1/object/public/).
 * Não depende de serviços pagos ou transformações proprietárias (/render/image/public/).
 */
export function getOptimizedImageUrl(src: string, _targetWidth: number = 850): string {
  if (!src) return '';
  
  // Retorna a URL original diretamente (sem reescrita para /render/image/public/)
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
