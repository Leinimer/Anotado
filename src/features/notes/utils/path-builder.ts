import { Folder } from '../types';

/**
 * Constrói o caminho textual hierárquico de uma pasta através de seus parent_ids.
 * Exemplo: "Estudos / Direito / Penal" ou "Raiz" se nulo.
 */
export function buildFolderPath(folderId: string | null | undefined, folders: Folder[]): string {
  if (!folderId) return 'Sem pasta';

  const pathParts: string[] = [];
  let current: Folder | undefined = folders.find((f) => f.id === folderId);
  const visited = new Set<string>();

  while (current) {
    if (visited.has(current.id)) break; // Previne ciclos infinitos
    visited.add(current.id);

    pathParts.unshift(current.name || 'Pasta');
    if (!current.parent_id) break;
    current = folders.find((f) => f.id === current?.parent_id);
  }

  return pathParts.length > 0 ? pathParts.join(' / ') : 'Sem pasta';
}

/**
 * Constrói o caminho hierárquico da pasta onde a nota reside.
 * Exemplo: "Estudos / Direito / Penal" ou "Sem pasta" (se estiver na raiz).
 */
export function buildNotePath(
  note: { folder_id?: string | null } | null | undefined,
  folders: Folder[]
): string {
  if (!note || !note.folder_id) return 'Sem pasta';
  return buildFolderPath(note.folder_id, folders);
}

/**
 * Utilitário de limpeza para remover completamente referências a um anexo do texto/HTML da nota.
 */
export function removeAttachmentReferenceFromContent(content: string, attachmentId: string): string {
  if (!content || !attachmentId) return content || '';

  let updated = content;

  // 1. Remove blocos HTML que contenham o attachmentId
  // Ex: <div data-attachment-id="xyz" ...>...</div> ou <img ... data-src="local-attachment://xyz" ... />
  const htmlBlockRegex = new RegExp(
    `<(?:div|figure|p|span)[^>]*?(?:data-attachment-id=["']?${attachmentId}["']?|data-src=["']?(?:attachment|local-attachment):\\/\\/${attachmentId}["']?)[^>]*>[\\s\\S]*?<\\/(?:div|figure|p|span)>`,
    'gi'
  );
  updated = updated.replace(htmlBlockRegex, '');

  const imgTagRegex = new RegExp(
    `<img[^>]*?(?:data-src|src)=["']?(?:attachment|local-attachment):\\/\\/${attachmentId}["']?[^>]*\\/?>`,
    'gi'
  );
  updated = updated.replace(imgTagRegex, '');

  // 2. Remove tags de documento ou media
  const docTagRegex = new RegExp(
    `<(?:document-attachment|div)[^>]*?(?:data-name|data-src)=[^>]*?${attachmentId}[^>]*>[\\s\\S]*?<\\/(?:document-attachment|div)>`,
    'gi'
  );
  updated = updated.replace(docTagRegex, '');

  // 3. Remove Markdown de imagens: ![alt](local-attachment://xyz) ou ![alt](attachment://xyz)
  const mdImgRegex = new RegExp(
    `!\\[[^\\]]*\\]\\((?:attachment|local-attachment):\\/\\/${attachmentId}[^)]*\\)`,
    'gi'
  );
  updated = updated.replace(mdImgRegex, '');

  // 4. Remove Markdown de links: [texto](local-attachment://xyz)
  const mdLinkRegex = new RegExp(
    `\\[[^\\]]*\\]\\((?:attachment|local-attachment):\\/\\/${attachmentId}[^)]*\\)`,
    'gi'
  );
  updated = updated.replace(mdLinkRegex, '');

  // 5. Remove menções textuais isoladas da URI
  const rawUriRegex = new RegExp(`(?:attachment|local-attachment):\\/\\/${attachmentId}`, 'gi');
  updated = updated.replace(rawUriRegex, '');

  // 6. Limpa quebras de linhas consecutivas excessivas (mais de duas quebras)
  updated = updated.replace(/\n{3,}/g, '\n\n');

  return updated.trim();
}
