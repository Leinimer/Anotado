import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Note, SYSTEM_ARCHIVE_FOLDER_ID } from '../types';
import { readNoteMarkdown } from '../api/notes-storage-api';
import { extractHashtagsFromText } from './hashtag-extractor';
import { indexedDBStorage } from '../db/indexed-db';
import { createClient, isSupabaseConfigured } from '@/src/features/auth/api/supabase-client';
import { ATTACHMENTS_BUCKET_NAME } from '../api/storage-constants';

export type ExportFormat = 'pdf' | 'docx' | 'md';

export function sanitizeFileName(name: string): string {
  const clean = (name || 'Sem título').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').replace(/-+/g, '-');
  return clean || 'Sem título';
}

export interface ExportProgress {
  current: number;
  total: number;
  currentNoteTitle?: string;
  status: 'idle' | 'fetching' | 'processing' | 'zipping' | 'completed' | 'error';
  errorMessage?: string;
}

type ExportBlock = { type: 'text'; text: string } | { type: 'image'; src: string; alt: string };
type PreparedImage = { bytes: Uint8Array; width: number; height: number };

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function decodeHtml(value: string): string {
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
  }
  return value.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

function getHtmlAttribute(tag: string, name: string): string {
  const doubleQuoted = tag.match(new RegExp(name + '="([^"]*)"', 'i'));
  const singleQuoted = tag.match(new RegExp(name + "='([^']*)'", 'i'));
  const unquoted = tag.match(new RegExp(name + '=([^\\s>]+)', 'i'));
  return decodeHtml((doubleQuoted?.[1] ?? singleQuoted?.[1] ?? unquoted?.[1] ?? '').trim());
}

function plainInlineText(value: string): string {
  return decodeHtml(value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|section|article)>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
  )
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+/, '• ')
    .replace(/^\d+\.\s+/, '• ')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\x60([^\x60]*)\x60/g, '$1')
    .trim();
}

/** Interpreta imagens HTML/Markdown e remove tags (como <mark>) do texto exportado. */
function parseExportBlocks(markdown: string): ExportBlock[] {
  const images: Array<{ src: string; alt: string }> = [];
  const addImage = (src: string, alt: string) => {
    const index = images.push({ src: decodeHtml(src.trim()), alt: decodeHtml(alt.trim()) }) - 1;
    return '\u0000EXPORT_IMAGE_' + index + '\u0000';
  };

  let source = markdown || '';
  source = source.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = getHtmlAttribute(tag, 'src') || getHtmlAttribute(tag, 'data-src');
    if (!src) return '';
    const alt = getHtmlAttribute(tag, 'alt') || getHtmlAttribute(tag, 'data-caption') || '';
    return '\n' + addImage(src, alt) + '\n';
  });
  source = source.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (_match, alt: string, src: string) => '\n' + addImage(src, alt) + '\n');
  source = source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|section|article)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\r/g, '');

  const result: ExportBlock[] = [];
  const imageToken = /\u0000EXPORT_IMAGE_(\d+)\u0000/g;
  for (const rawLine of source.split('\n')) {
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    imageToken.lastIndex = 0;
    while ((match = imageToken.exec(rawLine)) !== null) {
      const before = plainInlineText(rawLine.slice(lastIndex, match.index));
      if (before) result.push({ type: 'text', text: before });
      const image = images[Number(match[1])];
      if (image) result.push({ type: 'image', src: image.src, alt: image.alt });
      lastIndex = match.index + match[0].length;
    }
    const after = plainInlineText(rawLine.slice(lastIndex));
    if (after) result.push({ type: 'text', text: after });
    if (!rawLine.trim() && result.length && result[result.length - 1].type === 'text') {
      result.push({ type: 'text', text: '' });
    }
  }
  return result;
}

function safePdfText(value: string, font: { encodeText: (text: string) => unknown }): string {
  const substitutions: Record<string, string> = {
    '→': '->', '➜': '->', '➝': '->', '⟶': '->', '⟹': '=>', '⇒': '=>',
    '←': '<-', '⇐': '<=', '↔': '<->', '↕': '^',
    '↗': '/', '↘': '\\', '↙': '\\', '↖': '/',
    '✓': '[x]', '✔': '[x]', '✗': '[ ]', '✘': '[ ]',
    '★': '*', '☆': '*', '⚠': '!', 'ℹ': 'i',
    '…': '...', '−': '-', '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-',
    '\u00a0': ' ',
  };
  return Array.from(value).map((character) => {
    if (Object.prototype.hasOwnProperty.call(substitutions, character)) return substitutions[character];
    try { font.encodeText(character); return character; } catch { return '?'; }
  }).join('');
}

const imageBlobCache = new Map<string, Promise<Blob>>();

async function findAttachmentBlob(userId: string, attachmentId: string): Promise<Blob | null> {
  for (const ownerId of [userId, 'anonymous']) {
    try {
      const local = await indexedDBStorage.getAttachment(ownerId, attachmentId);
      if (local?.blob) return local.blob;
      if (local?.data_url) {
        const response = await fetch(local.data_url);
        if (response.ok) return response.blob();
      }
      if (local?.remote_url) {
        const response = await fetch(local.remote_url);
        if (response.ok) return response.blob();
      }
    } catch (error) {
      console.warn('[Export] Não foi possível ler o anexo local ' + attachmentId, error);
    }
  }

  if (!isSupabaseConfigured()) return null;
  const supabase = createClient();
  const { data, error } = await supabase.from('note_attachments')
    .select('storage_path, bucket_id, mime_type')
    .eq('id', attachmentId)
    .maybeSingle();
  if (error || !data?.storage_path) return null;

  const buckets = Array.from(new Set([data.bucket_id, ATTACHMENTS_BUCKET_NAME, 'attachments'].filter(Boolean))) as string[];
  for (const bucket of buckets) {
    const { data: file, error: downloadError } = await supabase.storage.from(bucket).download(data.storage_path);
    if (!downloadError && file) return file;
  }
  return null;
}

function getSupabaseObjectPath(src: string): { bucket: string; path: string } | null {
  try {
    const url = new URL(src, window.location.origin);
    const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2].split('?')[0]) };
  } catch {
    return null;
  }
}

async function resolveImageBlob(userId: string, src: string): Promise<Blob> {
  if (imageBlobCache.has(src)) return imageBlobCache.get(src)!;
  const task = (async () => {
    const attachmentMatch = src.match(/^(?:attachment|local-attachment):\/\/([a-zA-Z0-9_-]+)/);
    if (attachmentMatch) {
      const blob = await findAttachmentBlob(userId, attachmentMatch[1]);
      if (blob) return blob;
      throw new Error('A imagem referenciada não foi encontrada no armazenamento: ' + attachmentMatch[1]);
    }

    if (src.startsWith('data:') || src.startsWith('blob:')) {
      const response = await fetch(src);
      if (!response.ok) throw new Error('Não foi possível ler a imagem incorporada.');
      return response.blob();
    }

    const objectPath = getSupabaseObjectPath(src);
    if (objectPath && isSupabaseConfigured()) {
      const { data, error } = await createClient().storage.from(objectPath.bucket).download(objectPath.path);
      if (!error && data) return data;
    }

    const response = await fetch(src);
    if (!response.ok) throw new Error('Falha ao baixar a imagem (' + response.status + '): ' + src);
    return response.blob();
  })();
  imageBlobCache.set(src, task);
  try { return await task; } catch (error) { imageBlobCache.delete(src); throw error; }
}

async function convertImageToPng(blob: Blob): Promise<PreparedImage> {
  let bitmap: ImageBitmap | null = null;
  try { bitmap = await createImageBitmap(blob); } catch {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Não foi possível preparar a imagem para exportação.');
      context.drawImage(image, 0, 0);
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Falha ao converter imagem para PNG.')), 'image/png'));
      return { bytes: new Uint8Array(await png.arrayBuffer()), width: canvas.width, height: canvas.height };
    } finally { URL.revokeObjectURL(url); }
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a imagem para exportação.');
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Falha ao converter imagem para PNG.')), 'image/png'));
    return { bytes: new Uint8Array(await png.arrayBuffer()), width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); }
}

async function makePdf(userId: string, title: string, markdown: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 50, width = 595.28, height = 841.89;
  let page = pdf.addPage([width, height]);
  let y = height - margin;
  const addPage = () => { page = pdf.addPage([width, height]); y = height - margin; };
  const drawText = (value: string, size: number, strong = false) => {
    const font = strong ? bold : regular;
    const safeValue = safePdfText(value, font);
    const max = width - margin * 2;
    let current = '';
    const wrapped: string[] = [];
    for (const word of safeValue.split(/\s+/)) {
      const next = current ? current + ' ' + word : word;
      if (font.widthOfTextAtSize(next, size) > max && current) { wrapped.push(current); current = word; }
      else current = next;
    }
    if (current) wrapped.push(current);
    for (const part of wrapped) {
      if (y < margin + size + 4) addPage();
      page.drawText(part, { x: margin, y, size, font, color: rgb(0.12, 0.11, 0.10) });
      y -= size + 5;
    }
  };

  drawText(title || 'Sem título', 18, true);
  y -= 10;
  for (const block of parseExportBlocks(markdown)) {
    if (block.type === 'text') {
      if (block.text) drawText(block.text, 10);
      else y -= 7;
      continue;
    }
    const prepared = await convertImageToPng(await resolveImageBlob(userId, block.src));
    const embedded = await pdf.embedPng(prepared.bytes);
    const maxWidth = width - margin * 2, maxHeight = 360;
    const scale = Math.min(maxWidth / prepared.width, maxHeight / prepared.height, 1);
    const imageWidth = prepared.width * scale, imageHeight = prepared.height * scale;
    if (y - imageHeight < margin) addPage();
    page.drawImage(embedded, { x: (width - imageWidth) / 2, y: y - imageHeight, width: imageWidth, height: imageHeight });
    y -= imageHeight + 10;
    if (block.alt) { drawText(block.alt, 9); y -= 5; }
  }
  return pdf.save();
}

async function makeDocx(userId: string, title: string, markdown: string): Promise<Blob> {
  const zip = new JSZip();
  const bodyParts: string[] = [];
  const relationships: string[] = [];
  const contentTypes = new Set<string>([
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
  ]);
  const maxWidthEmu = Math.round(6.1 * 914400);
  let imageIndex = 0;
  bodyParts.push('<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">' + xml(title || 'Sem título') + '</w:t></w:r></w:p>');

  for (const block of parseExportBlocks(markdown)) {
    if (block.type === 'text') {
      bodyParts.push(block.text
        ? '<w:p><w:r><w:t xml:space="preserve">' + xml(block.text) + '</w:t></w:r></w:p>'
        : '<w:p/>');
      continue;
    }

    const prepared = await convertImageToPng(await resolveImageBlob(userId, block.src));
    imageIndex += 1;
    const imageName = 'image' + imageIndex + '.png';
    const relationshipId = 'rIdImage' + imageIndex;
    const maxHeightEmu = Math.round(8.2 * 914400);
    const imageScale = Math.min(maxWidthEmu / prepared.width, maxHeightEmu / prepared.height);
    const cx = Math.round(prepared.width * imageScale);
    const cy = Math.round(prepared.height * imageScale);
    zip.folder('word')!.folder('media')!.file(imageName, prepared.bytes);
    contentTypes.add('<Default Extension="png" ContentType="image/png"/>');
    relationships.push('<Relationship Id="' + relationshipId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + imageName + '"/>');

    bodyParts.push(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:docPr id="' + imageIndex + '" name="' + imageName + '" descr="' + xml(block.alt) + '"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + imageIndex + '" name="' + imageName + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + relationshipId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
    );
    if (block.alt) bodyParts.push('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>' + xml(block.alt) + '</w:t></w:r></w:p>');
  }

  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + Array.from(contentTypes).join('') + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.folder('_rels')!.file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.folder('word')!.file('document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + bodyParts.join('') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>');
  zip.folder('word')!.folder('_rels')!.file('document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relationships.join('') + '</Relationships>');
  zip.folder('word')!.file('styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>');
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function download(blob: Blob, fileName = 'anotado-exportacao.zip') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Exporta a seleção da sidebar. Notas individuais baixam no próprio formato;
 * exportações de pastas são agrupadas em ZIP, mesmo quando contêm apenas uma nota.
 */
export async function exportNotesFromContext(
  userId: string,
  selectedNotes: Note[],
  format: ExportFormat,
  zipOutput: boolean,
  archiveName = 'anotado',
  onProgress?: (progress: ExportProgress) => void
): Promise<{ success: boolean; count: number; error?: string }> {
  imageBlobCache.clear();
  try {
    if (!selectedNotes.length) throw new Error('Não há notas para exportar.');
    onProgress?.({ current: 0, total: selectedNotes.length, status: 'fetching' });
    const zip = zipOutput ? new JSZip() : null;
    const usedNames = new Map<string, number>();
    const extension = format === 'docx' ? 'docx' : format;
    const mimeType = format === 'pdf'
      ? 'application/pdf'
      : format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'text/markdown;charset=utf-8';

    for (let index = 0; index < selectedNotes.length; index++) {
      const note = selectedNotes[index];
      onProgress?.({
        current: index + 1,
        total: selectedNotes.length,
        currentNoteTitle: note.title,
        status: 'processing',
      });

      let markdown = note.content || '';
      try {
        const stored = await readNoteMarkdown(userId, note.id);
        if (stored !== null && stored !== undefined) markdown = stored;
      } catch (error) {
        console.warn('[Export] Não foi possível ler o Markdown da nota; usando o conteúdo carregado.', error);
      }

      if (note.tags?.length) {
        const existingTags = new Set(extractHashtagsFromText(markdown).map((tag) => tag.toLowerCase()));
        const missingTags = note.tags.filter((tag) => !existingTags.has(tag.toLowerCase().replace(/^#+/, '')));
        if (missingTags.length) {
          markdown = [markdown.trim(), missingTags.map((tag) => tag.startsWith('#') ? tag : '#' + tag).join(' ')].filter(Boolean).join('\n\n');
        }
      }

      const baseName = sanitizeFileName(note.title);
      const key = baseName.toLowerCase();
      const occurrence = (usedNames.get(key) || 0) + 1;
      usedNames.set(key, occurrence);
      const fileName = (occurrence === 1 ? baseName : baseName + ' (' + occurrence + ')') + '.' + extension;

      let fileContent: Blob | Uint8Array | string;
      if (format === 'pdf') {
        fileContent = await makePdf(userId, note.title, markdown);
      } else if (format === 'docx') {
        fileContent = await makeDocx(userId, note.title, markdown);
      } else {
        fileContent = markdown;
      }

      if (zip) {
        zip.file(fileName, fileContent);
      } else {
        const fileBlob = fileContent instanceof Blob
          ? fileContent
          : new Blob([fileContent as BlobPart], { type: mimeType });
        download(fileBlob, fileName);
      }
    }

    if (zip) {
      onProgress?.({ current: selectedNotes.length, total: selectedNotes.length, status: 'zipping' });
      const archive = await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/zip',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      download(archive, sanitizeFileName(archiveName) + '-' + format + '.zip');
    }

    onProgress?.({ current: selectedNotes.length, total: selectedNotes.length, status: 'completed' });
    return { success: true, count: selectedNotes.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido ao exportar.';
    console.error('[Export] Falha na exportação da seleção:', error);
    onProgress?.({ current: 0, total: selectedNotes.length, status: 'error', errorMessage: message });
    return { success: false, count: 0, error: message };
  } finally {
    imageBlobCache.clear();
  }
}

export async function exportNonArchivedNotesToZip(
  userId: string,
  allNotes: Note[],
  formats: ExportFormat[],
  onProgress?: (progress: ExportProgress) => void
): Promise<{ success: boolean; count: number; error?: string }> {
  imageBlobCache.clear();
  try {
    if (!formats.length) throw new Error('Selecione pelo menos um formato.');
    onProgress?.({ current: 0, total: 0, status: 'fetching' });
    const notes = allNotes.filter((note) => !note.is_archived && note.folder_id !== SYSTEM_ARCHIVE_FOLDER_ID);
    if (!notes.length) {
      onProgress?.({ current: 0, total: 0, status: 'completed' });
      return { success: true, count: 0 };
    }

    const zip = new JSZip();
    const used = new Map<string, number>();
    for (let index = 0; index < notes.length; index++) {
      const note = notes[index];
      onProgress?.({ current: index + 1, total: notes.length, currentNoteTitle: note.title, status: 'processing' });
      let markdown = note.content || '';
      try {
        const stored = await readNoteMarkdown(userId, note.id);
        if (stored != null) markdown = stored;
      } catch (error) {
        console.warn('[Export] Storage indisponível; usando conteúdo local.', error);
      }
      if (note.tags?.length) {
        const existing = new Set(extractHashtagsFromText(markdown).map((tag) => tag.toLowerCase()));
        const missing = note.tags.filter((tag) => !existing.has(tag.toLowerCase().replace(/^#+/, '')));
        if (missing.length) markdown = [markdown.trim(), missing.map((tag) => tag.startsWith('#') ? tag : '#' + tag).join(' ')].filter(Boolean).join('\n\n');
      }

      const base = sanitizeFileName(note.title);
      const key = base.toLowerCase();
      const occurrence = (used.get(key) || 0) + 1;
      used.set(key, occurrence);
      const name = occurrence === 1 ? base : base + ' (' + occurrence + ')';

      if (formats.includes('md')) zip.folder('Markdown')!.file(name + '.md', markdown);
      if (formats.includes('pdf')) zip.folder('PDF')!.file(name + '.pdf', await makePdf(userId, note.title, markdown));
      if (formats.includes('docx')) zip.folder('Word')!.file(name + '.docx', await makeDocx(userId, note.title, markdown));
    }

    onProgress?.({ current: notes.length, total: notes.length, status: 'zipping' });
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    download(blob);
    onProgress?.({ current: notes.length, total: notes.length, status: 'completed' });
    return { success: true, count: notes.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido ao exportar.';
    console.error('[Export] Falha na exportação:', error);
    onProgress?.({ current: 0, total: 0, status: 'error', errorMessage: message });
    return { success: false, count: 0, error: message };
  } finally {
    imageBlobCache.clear();
  }
}
