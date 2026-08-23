import { Folder, Note, SearchMode, SYSTEM_ARCHIVE_FOLDER_ID, TreeFolderNode, TreeNodeItem } from '../types';
import { extractHashtagsFromText, noteHasTag, stripToPlainText } from './hashtag-extractor';

/**
 * Constrói a árvore hierárquica de pastas e notas a partir de listas planas,
 * segregando notas ativas da pasta especial do sistema "Notas arquivadas".
 */
export function buildFolderTree(
  folders: Folder[],
  notes: Note[],
  parentId: string | null = null,
  depth = 0
): { folders: TreeFolderNode[]; rootNotes: TreeNodeItem[]; archivedFolder: TreeFolderNode } {
  // Segrega notas ativas de notas arquivadas
  const activeNotes = notes.filter((n) => !n.is_archived);
  const archivedNotes = notes.filter((n) => Boolean(n.is_archived));

  // Filtra pastas filhas do parentId atual
  const childFolders = folders
    .filter((f) => f.parent_id === parentId)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

  // Filtra notas filhas do parentId atual (se parentId === null, notas ativas na raiz)
  const childNotes = activeNotes
    .filter((n) => n.folder_id === parentId)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

  const treeFolders: TreeFolderNode[] = childFolders.map((folder) => {
    const { folders: subfolders, rootNotes: recursiveNotes } = buildFolderTree(
      folders,
      notes,
      folder.id,
      depth + 1
    );

    const isSmartFolder = Boolean(folder.is_smart && folder.smart_tags && folder.smart_tags.length > 0);

    let folderNotes: TreeNodeItem[];
    if (isSmartFolder) {
      // Pasta Inteligente: visualização dinâmica das notas ativas com qualquer uma das tags configuradas (OR)
      const matchingNotes = activeNotes
        .filter((n) => folder.smart_tags!.some((tag) => noteHasTag(n, tag)))
        .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

      folderNotes = matchingNotes.map((note) => ({
        type: 'note',
        id: note.id,
        title: note.title,
        content: note.content,
        folderId: note.folder_id, // Preserva a pasta física de origem
        position: note.position,
        depth: depth + 1,
        tags: note.tags || [],
        isFromSmartFolder: true,
        isArchived: false,
        previousFolderId: note.previous_folder_id ?? null,
      }));
    } else {
      folderNotes = recursiveNotes;
    }

    return {
      type: 'folder',
      id: folder.id,
      name: folder.name,
      parentId: folder.parent_id,
      position: folder.position,
      color: folder.color,
      isSmart: folder.is_smart,
      smartTags: folder.smart_tags,
      isSystem: false,
      subfolders,
      notes: folderNotes,
      depth,
    };
  });

  const treeNotes: TreeNodeItem[] = childNotes.map((note) => ({
    type: 'note',
    id: note.id,
    title: note.title,
    content: note.content,
    folderId: note.folder_id,
    position: note.position,
    depth,
    tags: note.tags || [],
    isArchived: false,
    previousFolderId: note.previous_folder_id ?? null,
  }));

  // Cria a pasta especial do sistema "Notas arquivadas"
  const archivedFolder: TreeFolderNode = {
    type: 'folder',
    id: SYSTEM_ARCHIVE_FOLDER_ID,
    name: 'Notas arquivadas',
    parentId: null,
    position: 999999,
    isSystem: true,
    subfolders: [],
    notes: archivedNotes
      .sort((a, b) => a.position - b.position || b.updated_at.localeCompare(a.updated_at))
      .map((note) => ({
        type: 'note',
        id: note.id,
        title: note.title,
        content: note.content,
        folderId: SYSTEM_ARCHIVE_FOLDER_ID,
        position: note.position,
        depth: 1,
        tags: note.tags || [],
        isArchived: true,
        previousFolderId: note.previous_folder_id ?? null,
      })),
    depth: 0,
  };

  return { folders: treeFolders, rootNotes: treeNotes, archivedFolder };
}

/**
 * Previne ciclos na árvore de pastas.
 * Retorna true se `targetParentId` for a própria pasta ou um descendente direto/indireto de `folderId`.
 */
export function wouldCreateCycle(
  folderId: string,
  targetParentId: string | null,
  allFolders: Folder[]
): boolean {
  if (!targetParentId) return false;
  if (folderId === targetParentId) return true;

  let currentId: string | null = targetParentId;
  const visited = new Set<string>();

  while (currentId) {
    if (currentId === folderId) {
      return true;
    }
    if (visited.has(currentId)) {
      return true;
    }
    visited.add(currentId);

    const parentFolder = allFolders.find((f) => f.id === currentId);
    currentId = parentFolder ? parentFolder.parent_id : null;
  }

  return false;
}

/**
 * Filtra a árvore por busca avançada (6 modos) e/ou tag ativa preservando o caminho de ancestrais.
 */
export function filterTree(
  rootFolders: TreeFolderNode[],
  rootNotes: TreeNodeItem[],
  archivedFolder: TreeFolderNode,
  searchQuery: string,
  activeTag: string | null,
  searchMode: SearchMode = 'all'
): {
  filteredFolders: TreeFolderNode[];
  filteredNotes: TreeNodeItem[];
  filteredArchivedFolder: TreeFolderNode | null;
  hasResults: boolean;
  matchingIds: Set<string>;
} {
  const query = searchQuery.trim().toLowerCase();
  const matchingIds = new Set<string>();

  function matchesNote(note: TreeNodeItem, isArchivedContext = false): boolean {
    const rawNote = {
      id: note.id,
      user_id: '',
      folder_id: note.folderId,
      title: note.title,
      content: note.content,
      position: note.position,
      tags: note.tags || [],
      created_at: '',
      updated_at: '',
    };

    // 1. Verificação de Tag Ativa
    const matchesTagFilter = !activeTag || noteHasTag(rawNote, activeTag);
    if (!matchesTagFilter) return false;

    // Se não há texto de busca e passou no filtro de tag
    if (!query) return true;

    const titleLower = (note.title || '').toLowerCase();
    const plainTextContent = stripToPlainText(note.content || '').toLowerCase();
    const explicitTags = (note.tags || []).map((t) => (t || '').replace(/^#+/, '').toLowerCase());
    const contentHashtags = extractHashtagsFromText(note.content || '').map((t) => t.replace(/^#+/, '').toLowerCase());
    const allNoteTags = Array.from(new Set([...explicitTags, ...contentHashtags]));

    const titleMatches = titleLower.includes(query);
    const contentMatches = plainTextContent.includes(query);
    const tagMatches = allNoteTags.some((t) => t.includes(query.replace(/^#+/, '')));

    switch (searchMode) {
      case 'title':
        return titleMatches;

      case 'content':
        return contentMatches;

      case 'tags':
        return tagMatches;

      case 'archived':
        return isArchivedContext && (titleMatches || contentMatches || tagMatches);

      case 'folders':
        return false;

      case 'all':
      default:
        return titleMatches || contentMatches || tagMatches;
    }
  }

  function matchesFolderDirectly(folder: TreeFolderNode): boolean {
    if (searchMode === 'title' || searchMode === 'content' || searchMode === 'tags' || searchMode === 'archived') {
      return false;
    }
    if (activeTag) {
      return false;
    }
    if (!query) return true;
    return (folder.name || '').toLowerCase().includes(query);
  }

  function filterFolderNode(folder: TreeFolderNode): TreeFolderNode | null {
    const isDirectMatch = matchesFolderDirectly(folder);
    if (isDirectMatch) {
      matchingIds.add(folder.id);
    }

    const filteredSubfolders: TreeFolderNode[] = [];
    for (const sub of folder.subfolders) {
      const filteredSub = filterFolderNode(sub);
      if (filteredSub) {
        filteredSubfolders.push(filteredSub);
      }
    }

    const filteredNotes: TreeNodeItem[] = [];
    for (const note of folder.notes) {
      if (matchesNote(note, false)) {
        filteredNotes.push(note);
        matchingIds.add(note.id);
      }
    }

    if (isDirectMatch || filteredSubfolders.length > 0 || filteredNotes.length > 0) {
      matchingIds.add(folder.id);
      return {
        ...folder,
        subfolders: filteredSubfolders,
        notes: filteredNotes,
      };
    }

    return null;
  }

  // Se o modo for estritamente 'archived', não processa pastas normais nem notas ativas
  const filteredFolders: TreeFolderNode[] = [];
  const filteredNotes: TreeNodeItem[] = [];

  if (searchMode !== 'archived') {
    for (const folder of rootFolders) {
      const res = filterFolderNode(folder);
      if (res) filteredFolders.push(res);
    }

    if (searchMode !== 'folders') {
      for (const note of rootNotes) {
        if (matchesNote(note, false)) {
          matchingIds.add(note.id);
          filteredNotes.push(note);
        }
      }
    }
  }

  // Filtragem da Pasta Especial "Notas arquivadas"
  let filteredArchivedFolder: TreeFolderNode | null = null;
  if (searchMode === 'all' || searchMode === 'archived' || searchMode === 'title' || searchMode === 'content' || searchMode === 'tags') {
    const archivedMatchingNotes = archivedFolder.notes.filter((note) => matchesNote(note, true));
    
    // No modo "all" sem busca, ou quando há notas arquivadas correspondentes, mantém visível
    if (!query && !activeTag) {
      filteredArchivedFolder = archivedFolder;
    } else if (archivedMatchingNotes.length > 0) {
      matchingIds.add(archivedFolder.id);
      archivedMatchingNotes.forEach((n) => matchingIds.add(n.id));
      filteredArchivedFolder = {
        ...archivedFolder,
        notes: archivedMatchingNotes,
      };
    } else if (searchMode === 'archived' && (!query && !activeTag)) {
      filteredArchivedFolder = archivedFolder;
    }
  }

  const hasResults =
    filteredFolders.length > 0 ||
    filteredNotes.length > 0 ||
    Boolean(filteredArchivedFolder && filteredArchivedFolder.notes.length > 0);

  return {
    filteredFolders,
    filteredNotes,
    filteredArchivedFolder,
    hasResults,
    matchingIds,
  };
}

