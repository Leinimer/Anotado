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
