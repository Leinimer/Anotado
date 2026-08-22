import { Note } from '../types';

/**
 * Remove tags HTML ou faz parse de JSON estruturado para extrair texto legível.
 */
export function stripToPlainText(content: string): string {
  if (!content || typeof content !== 'string') return '';

  // Verifica se é JSON serializado do Tiptap
  if (content.trim().startsWith('{') && content.trim().endsWith('}')) {
    try {
      const parsed = JSON.parse(content);
      const chunks: string[] = [];
      const walk = (node: any) => {
        if (!node) return;
        if (typeof node.text === 'string') {
          chunks.push(node.text);
        }
        if (Array.isArray(node.content)) {
          node.content.forEach(walk);
        }
      };
      walk(parsed);
      return chunks.join(' ');
    } catch {
      // continua para fallback de regex
    }
  }

  // Remove tags HTML substituindo por espaços
  return content.replace(/<[^>]*>/g, ' ');
}

/**
 * Extrai hashtags válidas de um texto (ou conteúdo rico HTML/JSON).
 * Exemplo: "<p>Nota de #Estudo e #Livro</p>" -> ["#Estudo", "#Livro"]
 * Não inclui fragmentos de URLs (ex: https://site.com/#anchor).
 */
export function extractHashtagsFromText(rawText: string): string[] {
  if (!rawText || typeof rawText !== 'string') return [];

  const text = stripToPlainText(rawText);

  // Remove URLs completas para evitar falso-positivo em fragmentos de link (#anchor)
  const sanitizedText = text.replace(/https?:\/\/[^\s"']+/g, '');

  // Regex para capturar palavras precedidas por # (letras, números e caracteres acentuados)
  const matches = sanitizedText.match(/#[a-zA-Z0-9_\u00C0-\u017F]+/g);
  if (!matches) return [];

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const match of matches) {
    const cleanTag = match.trim();
    const lower = cleanTag.toLowerCase();
    if (!seen.has(lower) && cleanTag.length > 1) {
      seen.add(lower);
      tags.push(cleanTag);
    }
  }

  return tags;
}

/**
 * Agrega todas as tags únicas existentes em um array de notas.
 */
export function extractAllUniqueTags(notes: Note[]): string[] {
  const map = new Map<string, string>(); // lower -> original

  for (const note of notes) {
    const noteTags = extractHashtagsFromText(note.content);
    for (const tag of noteTags) {
      const lower = tag.toLowerCase();
      if (!map.has(lower)) {
        map.set(lower, tag);
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Verifica se uma nota contém uma tag específica (case-insensitive).
 */
export function noteHasTag(note: Note, targetTag: string): boolean {
  if (!targetTag) return true;
  const tags = extractHashtagsFromText(note.content);
  const normalizedTarget = targetTag.toLowerCase();
  return tags.some((t) => t.toLowerCase() === normalizedTarget);
}
