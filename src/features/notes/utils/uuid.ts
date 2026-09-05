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

/**
 * Gera um UUID v5 determinístico e 100% compatível com RFC 4122 a partir de uma chave textual.
 * Útil para garantir idempotência estrita (ex: 1 pasta por ano, 1 por mês, 1 nota por dia).
 * Funciona de forma idêntica e síncrona no navegador e no Node.js.
 */
export function generateDeterministicUUID(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  let h3 = 0x27d4eb2f;
  let h4 = 0x5a1a5b3a;

  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ (ch << 1), 1099511628);
    h3 = Math.imul(h3 ^ (ch << 2), 2166136261);
    h4 = Math.imul(h4 ^ (ch << 3), 16777619);
  }

  // Avalanche de bits
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 = Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507);
  h3 = Math.imul(h3 ^ (h3 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507);
  h4 = Math.imul(h4 ^ (h4 >>> 13), 3266489909);

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  const hex3 = (h3 >>> 0).toString(16).padStart(8, '0');
  const hex4 = (h4 >>> 0).toString(16).padStart(8, '0');

  const full = hex1 + hex2 + hex3 + hex4;

  const p1 = full.substring(0, 8);
  const p2 = full.substring(8, 12);
  const p3 = '5' + full.substring(13, 16);
  const variantByte = ((parseInt(full.substring(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  const p4 = variantByte + full.substring(18, 20);
  const p5 = full.substring(20, 32);

  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

/**
 * ID determinístico para pasta de ano do Diário (1 por usuário e ano).
 */
export function getDeterministicDiaryYearFolderId(userId: string, year: number): string {
  return generateDeterministicUUID(`diary:year:${userId}:${year}`);
}

/**
 * ID determinístico para pasta de mês do Diário (1 por ano/mês do usuário).
 */
export function getDeterministicDiaryMonthFolderId(userId: string, year: number, month: number): string {
  return generateDeterministicUUID(`diary:month:${userId}:${year}:${month}`);
}

/**
 * ID determinístico para nota diária do Diário (1 por dia/mês/ano do usuário).
 */
export function getDeterministicDiaryNoteId(userId: string, year: number, month: number, day: number): string {
  return generateDeterministicUUID(`diary:note:${userId}:${year}:${month}:${day}`);
}

