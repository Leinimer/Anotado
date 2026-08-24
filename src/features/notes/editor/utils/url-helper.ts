/**
 * Normaliza uma URL fornecida pelo usuário, adicionando 'https://' caso omitido,
 * respeitando URLs já formatadas (http://, https://, mailto:, tel:, etc.)
 */
export function normalizeUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';

  if (/^(?:https?|mailto|tel|ftp):\/\//i.test(trimmed) || trimmed.startsWith('mailto:')) {
    return trimmed;
  }

  // Se começar com www. ou for um domínio padrão
  return `https://${trimmed}`;
}

/**
 * Verifica se uma string corresponde a uma URL válida do YouTube.
 */
export function isYouTubeUrl(url: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  // Padrão que cobre youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/shorts/, etc.
  const ytRegex = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([\w-]{11})(?:\S*)?$/i;
  return ytRegex.test(trimmed);
}

/**
 * Converte qualquer URL válida do YouTube em uma URL embed padrão.
 */
export function getYouTubeEmbedUrl(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.includes('youtube-nocookie.com/embed/')) return trimmed;

  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
  const match = trimmed.match(regExp);
  if (match && match[2].length === 11) {
    return `https://www.youtube-nocookie.com/embed/${match[2]}`;
  }
  return normalizeUrl(trimmed);
}
