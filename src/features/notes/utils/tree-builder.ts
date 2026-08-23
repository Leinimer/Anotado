import { Folder, Note, TreeFolderNode, TreeNodeItem } from '../types';
import { noteHasTag } from './hashtag-extractor';

/**
 * Constrói a árvore hierárquica de pastas e notas a partir de listas planas.
 */
export function buildFolderTree(
  folders: Folder[],
  notes: Note[],
  parentId: string | null = null,
  depth = 0
): { folders: TreeFolderNode[]; rootNotes: TreeNodeItem[] } {
  // Filtra pastas filhas do parentId atual
  const childFolders = folders
    .filter((f) => f.parent_id === parentId)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

  // Filtra notas filhas do parentId atual (se parentId === null, notas na raiz)
  const childNotes = notes
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
      // Pasta Inteligente: visualização dinâmica das notas com qualquer uma das tags configuradas (OR)
      const matchingNotes = notes
        .filter((n) => folder.smart_tags!.some((tag) => noteHasTag(n, tag)))
        .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

      folderNotes = matchingNotes.map((note) => ({
        type: 'note',
        id: note.id,
        title: note.title,
        content: note.content,
        folderId: note.folder_id, // Preserva a pasta física de origem!
        position: note.position,
        depth: depth + 1,
        isFromSmartFolder: true,
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
  }));

  return { folders: treeFolders, rootNotes: treeNotes };
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
      // Loop já existente detectado
      return true;
    }
    visited.add(currentId);

    const parentFolder = allFolders.find((f) => f.id === currentId);
    currentId = parentFolder ? parentFolder.parent_id : null;
  }

  return false;
}

/**
 * Filtra a árvore por busca de texto e/ou tag ativa preservando o caminho de ancestrais.
 */
export function filterTree(
  rootFolders: TreeFolderNode[],
  rootNotes: TreeNodeItem[],
  searchQuery: string,
  activeTag: string | null
): {
  filteredFolders: TreeFolderNode[];
  filteredNotes: TreeNodeItem[];
  hasResults: boolean;
  matchingIds: Set<string>;
} {
  const query = searchQuery.trim().toLowerCase();
  const matchingIds = new Set<string>();

  function matchesNote(note: TreeNodeItem): boolean {
    const matchesTag =
      !activeTag ||
      noteHasTag(
        {
          id: note.id,
          user_id: '',
          folder_id: note.folderId,
          title: note.title,
          content: note.content,
          position: note.position,
          created_at: '',
          updated_at: '',
        },
        activeTag
      );
    if (!matchesTag) return false;

    if (!query) return true;

    const titleMatches = note.title.toLowerCase().includes(query);
    const contentMatches = note.content.toLowerCase().includes(query);
    return titleMatches || contentMatches;
  }

  function matchesFolderDirectly(folder: TreeFolderNode): boolean {
    if (activeTag) {
      // Pastas só aparecem no filtro de tag se contiverem notas correspondentes
      return false;
    }
    if (!query) return true;
    return folder.name.toLowerCase().includes(query);
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
      if (matchesNote(note)) {
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

  const filteredFolders: TreeFolderNode[] = [];
  for (const folder of rootFolders) {
    const res = filterFolderNode(folder);
    if (res) filteredFolders.push(res);
  }

  const filteredNotes: TreeNodeItem[] = rootNotes.filter((note) => {
    const matches = matchesNote(note);
    if (matches) matchingIds.add(note.id);
    return matches;
  });

  const hasResults = filteredFolders.length > 0 || filteredNotes.length > 0;

  return {
    filteredFolders,
    filteredNotes,
    hasResults,
    matchingIds,
  };
}
