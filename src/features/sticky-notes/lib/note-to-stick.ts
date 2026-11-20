import { isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { fetchNoteContent, flushNoteSaves } from '@/src/features/notes/api/notes-api';
import type { Note } from '@/src/features/notes/types';
import {
  createStickyNote,
  fetchStickyNotes,
  getAuthenticatedStickyUser,
} from '../api/sticky-notes-api';
import {
  STICKY_DEFAULT_WIDTH,
  StickyNote,
  StickyNoteColorKey,
} from '../types';

export const CONVERTED_STICKY_HANDOFF_KEY = 'anotado_newly_converted_sticky';
export const ACTIVE_STICKY_ID_KEY = 'anotado_active_sticky_id';
export const LEGACY_PENDING_CONVERSION_KEY = 'anotado_pending_sticky_conversion';

export const STICKY_PLACEMENT_MIN_GAP = 26;
export const STICKY_BOARD_ORIGIN = 80;
export const STICKY_BOARD_MIN_COORD = 24;

export type NoteToStickErrorStage =
  | 'note_not_found'
  | 'content_load_failed'
  | 'supabase_unconfigured'
  | 'unauthenticated'
  | 'fetch_existing_failed'
  | 'insert_failed'
  | 'record_verification_failed';

export class NoteToStickError extends Error {
  readonly stage: NoteToStickErrorStage;

  constructor(stage: NoteToStickErrorStage, message: string) {
    super(message);
    this.name = 'NoteToStickError';
    this.stage = stage;
  }
}

export interface StickyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StickyPositionResult {
  x: number;
  y: number;
  placement: 'origin' | 'right' | 'left' | 'below' | 'free';
}

export interface ConvertNoteToStickParams {
  userId: string;
  note: Note | null | undefined;
  color?: StickyNoteColorKey;
  widthPx?: number;
  gap?: number;
}

export interface ConvertNoteToStickResult {
  created: StickyNote;
  position: StickyPositionResult;
  estimatedHeight: number;
  formattedContent: string;
}

export interface ConvertNoteToStickDeps {
  isSupabaseConfigured: () => boolean;
  flushNoteSaves: (noteId: string) => Promise<void>;
  fetchNoteContent: (
    userId: string,
    note: Note
  ) => Promise<{ content: string; tags?: string[] }>;
  getAuthenticatedStickyUser: () => Promise<{ userId: string; email: string } | null>;
  fetchStickyNotes: (userId: string) => Promise<StickyNote[]>;
  createStickyNote: typeof createStickyNote;
}

const DEFAULT_DEPS: ConvertNoteToStickDeps = {
  isSupabaseConfigured,
  flushNoteSaves,
  fetchNoteContent,
  getAuthenticatedStickyUser,
  fetchStickyNotes,
  createStickyNote,
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const isSafeHref = (rawUrl: string): boolean => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return true;
  if (/^(?:https?:|mailto:|tel:)/i.test(trimmed)) return true;
  return false;
};

const sanitizeExistingHtml = (html: string): string =>
  html
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*(["'])\s*(?:javascript|vbscript|data:text\/html)[^"']*\1/gi, 'href="#"');

const convertInlineMarkdownToHtml = (rawLine: string): string => {
  const placeholders: string[] = [];
  const stash = (fragment: string): string => {
    const token = `@@STK${placeholders.length}@@`;
    placeholders.push(fragment);
    return token;
  };

  // Preserva tags inline seguras já existentes (ex: <a data-reference-id>, <mark>, <u>, <strong>, <em>, <span>, <img>).
  let text = rawLine.replace(
    /<\/?(?:a|strong|b|em|i|u|s|del|mark|code|span|br|sub|sup|img)\b[^>]*>/gi,
    (tag) => stash(sanitizeExistingHtml(tag))
  );

  // Preserva código inline (`...`) antes de escapar HTML.
  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) =>
    stash(`<code>${escapeHtml(code)}</code>`)
  );

  // Converte links Markdown [rótulo](url) antes de escapar HTML.
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    if (!isSafeHref(url)) {
      return escapeHtml(label);
    }
    const safeUrl = escapeHtml(url.trim());
    const safeLabel = escapeHtml(label);
    const isExternal = /^https?:/i.test(url.trim());
    const attrs = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
    return stash(
      `<a href="${safeUrl}"${attrs} style="color:#80634f;text-decoration:underline;text-decoration-color:#b69b83">${safeLabel}</a>`
    );
  });

  // Escapa texto restante com segurança.
  text = escapeHtml(text);

  // Converte URLs soltas (https://... ou http://...) em links clicáveis.
  text = text.replace(/(https?:\/\/[^\s<>"']+)/gi, (rawUrl) => {
    const trailingPunct = rawUrl.match(/[.,;:!?)]+$/)?.[0] || '';
    const cleanUrl = trailingPunct ? rawUrl.slice(0, -trailingPunct.length) : rawUrl;
    const anchor = stash(
      `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" style="color:#80634f;text-decoration:underline;text-decoration-color:#b69b83">${cleanUrl}</a>`
    );
    return anchor + trailingPunct;
  });

  // Formatação inline compatível com o editor contentEditable do Stick.
  text = text
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');

  return text.replace(/@@STK(\d+)@@/g, (_match, idx: string) => placeholders[Number(idx)] ?? '');
};

const isBlockHtmlLine = (line: string): boolean =>
  /^\s*<\/?(?:p|div|ul|ol|li|h[1-6]|blockquote|pre|table|thead|tbody|tfoot|tr|th|td|hr|figure|img)\b/i.test(
    line
  );

const isCompleteRichHtmlDocument = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('<')) return false;
  return /^<(?:p|div|ul|ol|h[1-6]|blockquote|pre|table|figure|section|article)\b/i.test(trimmed);
};

/**
 * Converte o conteúdo de uma nota do workspace Notas (Markdown ou HTML do Tiptap)
 * para HTML limpo e totalmente compatível com o editor do Stick, preservando
 * integralmente texto, parágrafos, quebras de linha, listas, checklists, links e formatação.
 */
export function convertNoteContentForStick(rawContent: string | null | undefined): string {
  if (!rawContent) return '';
  const normalized = rawContent.replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return '';

  // Se o conteúdo já estiver integralmente estruturado em HTML de bloco (ex.: tabelas/parágrafos do Tiptap),
  // sanitiza apenas scripts/handlers perigosos mantendo toda a formatação e estrutura originais.
  if (isCompleteRichHtmlDocument(normalized) && !/\n\s*(?:#{1,6}\s|[-+*]\s|\d+\.\s|>\s|```)/.test(normalized)) {
    return sanitizeExistingHtml(normalized);
  }

  const lines = normalized.split('\n');
  const output: string[] = [];
  const fence = '```';
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // Bloco HTML já estruturado (ex.: tabela ou parágrafo HTML embutido no Markdown)
    if (isBlockHtmlLine(line)) {
      const htmlBlock: string[] = [];
      while (index < lines.length && lines[index].trim()) {
        htmlBlock.push(lines[index]);
        index += 1;
      }
      output.push(sanitizeExistingHtml(htmlBlock.join('\n')));
      continue;
    }

    // Bloco de código cercado (```)
    if (line.trimStart().startsWith(fence)) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith(fence)) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // Títulos (# a ######)
    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      output.push(`<h${level}>${convertInlineMarkdownToHtml(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    // Linha divisória horizontal
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      output.push('<hr>');
      index += 1;
      continue;
    }

    // Citação (> ...)
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      output.push(
        `<blockquote>${quoteLines
          .map((item) => `<p>${convertInlineMarkdownToHtml(item) || '<br>'}</p>`)
          .join('')}</blockquote>`
      );
      continue;
    }

    // Checklist (- [ ] / - [x]) no formato canônico do StickyNoteCard
    const checklistMatch = line.match(/^\s*[-+*]\s+\[([ xX])\]\s*(.*)$/);
    if (checklistMatch) {
      const items: string[] = [];
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^\s*[-+*]\s+\[([ xX])\]\s*(.*)$/);
        if (!itemMatch) break;
        const checked = itemMatch[1].toLowerCase() === 'x';
        const itemBody = convertInlineMarkdownToHtml(itemMatch[2]) || '<br>';
        items.push(
          `<li data-checked="${checked ? 'true' : 'false'}"><label contenteditable="false"><input type="checkbox"${
            checked ? ' checked' : ''
          } aria-label="Marcar item como concluído"></label><div><p>${itemBody}</p></div></li>`
        );
        index += 1;
      }
      output.push(`<ul data-sticky-checklist="true">${items.join('')}</ul>`);
      continue;
    }

    // Lista com marcadores ou numerada
    const listMatch = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.*)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items: string[] = [];
      while (index < lines.length) {
        if (/^\s*[-+*]\s+\[([ xX])\]\s*/.test(lines[index])) break;
        const itemMatch = lines[index].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.*)$/);
        if (!itemMatch || Boolean(itemMatch[2]) !== ordered) break;
        items.push(`<li>${convertInlineMarkdownToHtml(itemMatch[3]) || '<br>'}</li>`);
        index += 1;
      }
      output.push(
        ordered
          ? `<ol>${items.join('')}</ol>`
          : `<ul class="sticky-bullet-list">${items.join('')}</ul>`
      );
      continue;
    }

    // Parágrafo comum (preserva quebras de linha internas com <br>)
    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockHtmlLine(lines[index]) &&
      !lines[index].trimStart().startsWith(fence) &&
      !/^\s{0,3}#{1,6}\s+/.test(lines[index]) &&
      !/^\s*>/.test(lines[index]) &&
      !/^\s*(?:[-+*]|\d+\.)\s+/.test(lines[index]) &&
      !/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    output.push(`<p>${paragraphLines.map(convertInlineMarkdownToHtml).join('<br>')}</p>`);
  }

  return output.join('');
}

/**
 * Estima a altura visual de um cartão Stick com base no título, conteúdo e largura,
 * evitando sobreposição quando height_px ainda é null (altura automática).
 */
export function estimateStickyCardHeight(
  title: string | null | undefined,
  content: string | null | undefined,
  widthPx: number = STICKY_DEFAULT_WIDTH
): number {
  const safeWidth = Math.max(190, widthPx || STICKY_DEFAULT_WIDTH);
  const charsPerLine = Math.max(18, Math.floor((safeWidth - 32) / 7.4));

  const raw = content || '';
  // Quebra em segmentos visuais aproximados por parágrafo/item/quebra de linha
  const segmented = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|tr|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, 'a');

  const lines = segmented.split('\n');
  let visualLines = 0;
  for (const segment of lines) {
    const len = segment.trim().length;
    if (len === 0) {
      visualLines += 0.6;
    } else {
      visualLines += Math.max(1, Math.ceil(len / charsPerLine));
    }
  }

  const titleExtra = title && title.trim().length > 26 ? 20 : 0;
  const headerAndPadding = 92 + titleExtra;
  const estimated = Math.round(headerAndPadding + Math.max(3, visualLines) * 21);

  return Math.max(200, Math.min(1200, estimated));
}

export function rectsOverlapWithGap(a: StickyRect, b: StickyRect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/**
 * Calcula uma posição livre e sem sobreposição para o novo Stick, respeitando estritamente:
 * 1. À direita de um Stick existente;
 * 2. À esquerda de um Stick existente;
 * 3. Abaixo de um Stick existente;
 * 4. Outra área livre (inclusive expandindo o espaço de trabalho se necessário).
 */
export function findNonOverlappingStickPosition(
  existingNotes: ReadonlyArray<
    Pick<StickyNote, 'id' | 'position_x' | 'position_y' | 'width_px' | 'height_px' | 'title' | 'content'>
  >,
  options?: {
    widthPx?: number;
    estimatedHeight?: number;
    gap?: number;
    minCoord?: number;
    preferredMaxX?: number;
    measuredHeights?: Record<string, number>;
  }
): StickyPositionResult {
  const widthPx = Math.round(options?.widthPx ?? STICKY_DEFAULT_WIDTH);
  const estimatedHeight = Math.round(options?.estimatedHeight ?? 260);
  const gap = Math.max(20, Math.round(options?.gap ?? STICKY_PLACEMENT_MIN_GAP));
  const minCoord = Math.round(options?.minCoord ?? STICKY_BOARD_MIN_COORD);
  const preferredMaxX = options?.preferredMaxX ?? 1520;
  const measuredHeights = options?.measuredHeights ?? {};

  if (existingNotes.length === 0) {
    return { x: STICKY_BOARD_ORIGIN, y: STICKY_BOARD_ORIGIN, placement: 'origin' };
  }

  const rectangles: StickyRect[] = existingNotes
    .map((note) => ({
      x: Math.round(Number(note.position_x) || 0),
      y: Math.round(Number(note.position_y) || 0),
      width: Math.round(Number(note.width_px) || STICKY_DEFAULT_WIDTH),
      height: Math.round(
        note.height_px ??
          measuredHeights[note.id] ??
          estimateStickyCardHeight(note.title, note.content, note.width_px)
      ),
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const isFree = (x: number, y: number, respectMaxX: boolean): boolean => {
    if (x < minCoord || y < minCoord) return false;
    if (respectMaxX && x + widthPx > preferredMaxX) return false;
    const candidate: StickyRect = { x, y, width: widthPx, height: estimatedHeight };
    return !rectangles.some((rect) => rectsOverlapWithGap(candidate, rect, gap));
  };

  // Prioridade 1: espaço livre à direita de um Stick existente
  for (const rect of rectangles) {
    const x = rect.x + rect.width + gap;
    const y = rect.y;
    if (isFree(x, y, true)) {
      return { x, y, placement: 'right' };
    }
  }

  // Prioridade 2: espaço livre à esquerda de um Stick existente
  for (const rect of rectangles) {
    const x = rect.x - widthPx - gap;
    const y = rect.y;
    if (isFree(x, y, true)) {
      return { x, y, placement: 'left' };
    }
  }

  // Prioridade 3: espaço livre abaixo de um Stick existente
  for (const rect of rectangles) {
    const x = rect.x;
    const y = rect.y + rect.height + gap;
    if (isFree(x, y, true)) {
      return { x, y, placement: 'below' };
    }
  }

  // Prioridade 4: outra área livre (acima, lacunas na grade ou expansão do quadro)
  for (const rect of rectangles) {
    const x = rect.x;
    const y = rect.y - estimatedHeight - gap;
    if (isFree(x, y, false)) {
      return { x, y, placement: 'free' };
    }
  }

  const minX = Math.max(minCoord, Math.min(...rectangles.map((r) => r.x)));
  const minY = Math.max(minCoord, Math.min(...rectangles.map((r) => r.y)));
  const maxRight = Math.max(...rectangles.map((r) => r.x + r.width));
  const maxBottom = Math.max(...rectangles.map((r) => r.y + r.height));

  const stepX = widthPx + gap;
  const stepY = Math.max(160, Math.min(estimatedHeight, 320)) + gap;

  for (let y = minY; y <= maxBottom + gap; y += stepY) {
    for (let x = minX; x <= maxRight + gap; x += stepX) {
      if (isFree(x, y, false)) {
        return { x, y, placement: 'free' };
      }
    }
  }

  // Expansão garantida à direita da borda mais extrema
  return {
    x: maxRight + gap,
    y: minY,
    placement: 'free',
  };
}

/**
 * Calcula o deslocamento (canvasPan) para centralizar e tornar imediatamente visível
 * um Stick no viewport transformado do quadro (#sticky-notes-board-viewport).
 */
export function computeCanvasPanToCenterStick(
  note: Pick<StickyNote, 'position_x' | 'position_y' | 'width_px' | 'height_px' | 'title' | 'content'>,
  viewport: { width: number; height: number },
  zoom: number = 1,
  measuredHeight?: number
): { x: number; y: number } {
  const safeZoom = zoom > 0 ? zoom : 1;
  const cardWidth = note.width_px || STICKY_DEFAULT_WIDTH;
  const cardHeight =
    measuredHeight ??
    note.height_px ??
    estimateStickyCardHeight(note.title, note.content, cardWidth);

  const scaledHeight = cardHeight * safeZoom;
  const centerX = note.position_x + cardWidth / 2;

  const panX = Math.round(viewport.width / 2 - centerX * safeZoom);

  // Se o Stick for muito alto em relação à tela, posiciona o topo dele com margem confortável
  // para que o título e o início do conteúdo fiquem imediatamente visíveis.
  const panY =
    scaledHeight > viewport.height - 80
      ? Math.round(40 - note.position_y * safeZoom)
      : Math.round(viewport.height / 2 - (note.position_y + cardHeight / 2) * safeZoom);

  return { x: panX, y: panY };
}

/**
 * Executa o fluxo completo de conversão de uma Nota em Stick com persistência real
 * confirmada no Supabase antes da navegação para /sticky-notes.
 */
export async function convertNoteToStickAndPersist(
  params: ConvertNoteToStickParams,
  overrides?: Partial<ConvertNoteToStickDeps>
): Promise<ConvertNoteToStickResult> {
  const deps: ConvertNoteToStickDeps = { ...DEFAULT_DEPS, ...overrides };
  const { userId, note, color = 'yellow', widthPx = STICKY_DEFAULT_WIDTH, gap = STICKY_PLACEMENT_MIN_GAP } =
    params;

  if (!note || !note.id) {
    throw new NoteToStickError(
      'note_not_found',
      'A nota selecionada não foi encontrada para conversão em Stick.'
    );
  }

  // Etapa 1: garante salvamento pendente e carrega o conteúdo completo da nota original
  // sem modificar ou excluir a nota original.
  let rawContent: string;
  try {
    await deps.flushNoteSaves(note.id);
    const loaded = await deps.fetchNoteContent(userId, note);
    const fetchedContent = typeof loaded?.content === 'string' ? loaded.content : '';
    const memoryContent = typeof note.content === 'string' ? note.content : '';
    // Se a leitura canônica retornou conteúdo, utiliza-o; se veio vazia mas há conteúdo
    // mais recente em memória, preserva-o integralmente.
    rawContent = fetchedContent.trim().length > 0 ? fetchedContent : memoryContent;
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
    throw new NoteToStickError(
      'content_load_failed',
      `Não foi possível carregar o conteúdo completo desta nota.${detail}`
    );
  }

  // Etapa 2: valida configuração do Supabase e usuário autenticado real
  if (!deps.isSupabaseConfigured()) {
    throw new NoteToStickError(
      'supabase_unconfigured',
      'A conexão com o banco de dados Supabase não está configurada. Não foi possível criar o Stick.'
    );
  }

  let authUser: { userId: string; email: string } | null = null;
  try {
    authUser = await deps.getAuthenticatedStickyUser();
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
    throw new NoteToStickError(
      'unauthenticated',
      `Não foi possível validar sua sessão para criar o Stick.${detail}`
    );
  }

  if (!authUser?.userId || authUser.userId === 'demo-user') {
    throw new NoteToStickError(
      'unauthenticated',
      'Sua sessão não está autenticada. Faça login novamente para transformar a nota em Stick.'
    );
  }

  // Etapa 3: carrega Sticks existentes para posicionamento inteligente sem sobreposição
  let existingSticks: StickyNote[];
  try {
    existingSticks = await deps.fetchStickyNotes(authUser.userId);
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    throw new NoteToStickError(
      'fetch_existing_failed',
      `Não foi possível consultar os Sticks existentes para posicionar o novo cartão.${detail}`
    );
  }

  const title = (note.title || '').trim();
  const formattedContent = convertNoteContentForStick(rawContent);
  const estimatedHeight = estimateStickyCardHeight(title, formattedContent || rawContent, widthPx);
  const position = findNonOverlappingStickPosition(existingSticks, {
    widthPx,
    estimatedHeight,
    gap,
  });

  const maxZ = existingSticks.reduce((acc, item) => Math.max(acc, Number(item.z_index) || 0), 0);
  const nextZ = maxZ + 1;

  // Etapa 4: executa o INSERT real em public.sticky_notes
  let created: StickyNote;
  try {
    created = await deps.createStickyNote(authUser.userId, {
      title,
      content: formattedContent,
      color,
      position_x: Math.round(position.x),
      position_y: Math.round(position.y),
      width_px: Math.round(widthPx),
      z_index: nextZ,
    });
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    throw new NoteToStickError(
      'insert_failed',
      `Falha ao salvar o novo Stick no banco de dados.${detail}`
    );
  }

  // Etapa 5: valida integridade do registro retornado pelo Supabase
  if (!created || !created.id || created.user_id !== authUser.userId) {
    throw new NoteToStickError(
      'record_verification_failed',
      'O Stick foi enviado, mas o registro confirmado não foi retornado pelo banco de dados.'
    );
  }

  return {
    created,
    position,
    estimatedHeight,
    formattedContent,
  };
}

export function saveConvertedStickHandoff(note: StickyNote): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CONVERTED_STICKY_HANDOFF_KEY, JSON.stringify(note));
    sessionStorage.setItem(ACTIVE_STICKY_ID_KEY, note.id);
    sessionStorage.removeItem(LEGACY_PENDING_CONVERSION_KEY);
  } catch (error) {
    console.warn('[Stick] Não foi possível salvar o handoff do Stick criado no sessionStorage:', error);
  }
}

export function readConvertedStickHandoff(): StickyNote | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CONVERTED_STICKY_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StickyNote>;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.user_id !== 'string') {
      return null;
    }
    return parsed as StickyNote;
  } catch {
    return null;
  }
}

export function clearConvertedStickHandoff(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CONVERTED_STICKY_HANDOFF_KEY);
    sessionStorage.removeItem(ACTIVE_STICKY_ID_KEY);
  } catch {
    // noop
  }
}
