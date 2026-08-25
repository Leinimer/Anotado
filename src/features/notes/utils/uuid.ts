/**
 * Gerador de UUID v4 compatível com RFC 4122 para todas as plataformas e navegadores móveis.
 * Garante que chaves primárias UUID no PostgreSQL / Supabase nunca recebam strings inválidas.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {}
  }

  // Fallback RFC4122 v4 estrito caso crypto.randomUUID não esteja disponível
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
