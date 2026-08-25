import { Note } from '../types';

/**
 * Normaliza um array de tags:
 * - Remove espaços e caracteres de controle
 * - Remove o símbolo '#' inicial para armazenamento consistente
 * - Remove entradas vazias
 * - Remove duplicatas ignorando maiúsculas/minúsculas
 */
export function normalizeTags(rawTags: string[]): string[] {
  if (!Array.isArray(rawTags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of rawTags) {
    if (!raw || typeof raw !== 'string') continue;
    const clean = raw.trim().replace(/\s+/g, '').replace(/^#+/, '');
    if (!clean) continue;
    const lower = clean.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(clean);
    }
  }

  return result;
}

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
 * Agrega todas as tags únicas existentes em um array de notas,
 * unificando tanto as tags explícitas da nota (note.tags) quanto as hashtags no corpo do texto.
 */
export function extractAllUniqueTags(notes: Note[]): string[] {
  const map = new Map<string, string>(); // lower -> '#Original'

  for (const note of notes) {
    // 1. Tags explícitas gerenciadas na barra de tags
    if (Array.isArray(note.tags)) {
      for (const rawTag of note.tags) {
        const clean = (rawTag || '').replace(/^#+/, '').trim();
        if (clean) {
          const lower = clean.toLowerCase();
          if (!map.has(lower)) {
            map.set(lower, `#${clean}`);
          }
        }
      }
    }

    // 2. Hashtags no corpo do texto (Markdown/HTML)
    const noteContentTags = extractHashtagsFromText(note.content);
    for (const rawTag of noteContentTags) {
      const clean = (rawTag || '').replace(/^#+/, '').trim();
      if (clean) {
        const lower = clean.toLowerCase();
        if (!map.has(lower)) {
          map.set(lower, `#${clean}`);
        }
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Verifica se uma nota contém uma tag específica (case-insensitive),
 * checando tanto as tags explícitas quanto as hashtags do texto.
 */
export function noteHasTag(note: Note, targetTag: string): boolean {
  if (!targetTag) return true;
  const cleanTarget = targetTag.replace(/^#+/, '').trim().toLowerCase();
  if (!cleanTarget) return true;

  // 1. Tags explícitas
  if (Array.isArray(note.tags)) {
    const hasExplicit = note.tags.some((t) => (t || '').replace(/^#+/, '').trim().toLowerCase() === cleanTarget);
    if (hasExplicit) return true;
  }

  // 2. Hashtags no texto
  const tags = extractHashtagsFromText(note.content);
  return tags.some((t) => (t || '').replace(/^#+/, '').trim().toLowerCase() === cleanTarget);
}
