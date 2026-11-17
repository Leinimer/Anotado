import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Note, SYSTEM_ARCHIVE_FOLDER_ID } from '../types';
import { readNoteMarkdown } from '../api/notes-storage-api';
import { extractHashtagsFromText } from './hashtag-extractor';
export type ExportFormat = 'pdf' | 'docx' | 'md';
export function sanitizeFileName(name: string): string {
  const clean = (name || 'Sem título').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').replace(/-+/g, '-');
  return clean || 'Sem título';
}
export interface ExportProgress {
  current: number; total: number; currentNoteTitle?: string;
  status: 'idle' | 'fetching' | 'processing' | 'zipping' | 'completed' | 'error'; errorMessage?: string;
}
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
function lines(md: string): string[] {
  return md.replace(/\r/g, '').split('\n').map(s => s.trim().replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/^[-*+]\s+/, '• ').replace(/^\d+\.\s+/, '• ').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/_(.*?)_/g, '$1').replace(/~~(.*?)~~/g, '$1'));
}
// Helvetica/WinAnsi não suporta todos os caracteres Unicode. Convertemos
// setas e símbolos comuns para equivalentes ASCII e substituímos apenas
// caracteres que a fonte realmente não consegue codificar.
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
    try {
      font.encodeText(character);
      return character;
    } catch {
      return '?';
    }
  }).join('');
}

async function makePdf(title: string, md: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(), regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 50, width = 595.28, height = 841.89;
  let page = pdf.addPage([width, height]), y = height - margin;
  const draw = (value: string, size: number, strong = false) => {
    const font = strong ? bold : regular, max = width - margin * 2; let current = ''; const wrapped: string[] = [];
    const compatibleValue = safePdfText(value, font);
    for (const word of compatibleValue.split(/\s+/)) { const next = current ? current + ' ' + word : word; if (font.widthOfTextAtSize(next, size) > max && current) { wrapped.push(current); current = word; } else current = next; }
    if (current) wrapped.push(current);
    for (const part of wrapped) { if (y < margin + size + 4) { page = pdf.addPage([width, height]); y = height - margin; } page.drawText(part, { x: margin, y, size, font, color: rgb(0.12, 0.11, 0.10) }); y -= size + 5; }
  };
  draw(title || 'Sem título', 18, true); y -= 10;
  for (const line of lines(md)) { if (!line) y -= 7; else draw(line, 10); }
  return pdf.save();
}
async function makeDocx(title: string, md: string): Promise<Blob> {
  const zip = new JSZip();
  const body = [title, ...lines(md)].map((s, i) => s ? '<w:p>' + (i === 0 ? '<w:pPr><w:pStyle w:val="Title"/></w:pPr>' : '') + '<w:r><w:t xml:space="preserve">' + xml(s) + '</w:t></w:r></w:p>' : '<w:p/>').join('');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.folder('_rels')!.file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.folder('word')!.file('document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>');
  zip.folder('word')!.file('styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>');
  zip.folder('word')!.folder('_rels')!.file('document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
function download(blob: Blob) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'anotado-exportacao.zip'; document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1500); }
export async function exportNonArchivedNotesToZip(userId: string, allNotes: Note[], formats: ExportFormat[], onProgress?: (p: ExportProgress) => void): Promise<{success: boolean; count: number; error?: string}> {
  try {
    if (!formats.length) throw new Error('Selecione pelo menos um formato.');
    onProgress?.({ current: 0, total: 0, status: 'fetching' });
    const notes = allNotes.filter(n => !n.is_archived && n.folder_id !== SYSTEM_ARCHIVE_FOLDER_ID);
    if (!notes.length) { onProgress?.({ current: 0, total: 0, status: 'completed' }); return { success: true, count: 0 }; }
    const zip = new JSZip(), used = new Map<string, number>();
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i]; onProgress?.({ current: i + 1, total: notes.length, currentNoteTitle: note.title, status: 'processing' });
      let md = note.content || '';
      try { const stored = await readNoteMarkdown(userId, note.id); if (stored != null) md = stored; } catch (e) { console.warn('[Export] Storage indisponível; usando conteúdo local.', e); }
      if (note.tags?.length) { const existing = new Set(extractHashtagsFromText(md).map(t => t.toLowerCase())); const missing = note.tags.filter(t => !existing.has(t.toLowerCase().replace(/^#+/, ''))); if (missing.length) md = [md.trim(), missing.map(t => t.startsWith('#') ? t : '#' + t).join(' ')].filter(Boolean).join('\n\n'); }
      const base = sanitizeFileName(note.title), key = base.toLowerCase(), count = (used.get(key) || 0) + 1; used.set(key, count);
      const name = count === 1 ? base : base + ' (' + count + ')';
      if (formats.includes('md')) zip.folder('Markdown')!.file(name + '.md', md);
      if (formats.includes('pdf')) zip.folder('PDF')!.file(name + '.pdf', await makePdf(note.title, md));
      if (formats.includes('docx')) zip.folder('Word')!.file(name + '.docx', await makeDocx(note.title, md));
    }
    onProgress?.({ current: notes.length, total: notes.length, status: 'zipping' });
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    download(blob); onProgress?.({ current: notes.length, total: notes.length, status: 'completed' });
    return { success: true, count: notes.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro desconhecido ao exportar.'; console.error('[Export] Falha:', e);
    onProgress?.({ current: 0, total: 0, status: 'error', errorMessage: message }); return { success: false, count: 0, error: message };
  }
}