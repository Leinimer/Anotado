import { Folder, Note } from '../types';

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  workspace: 'notes' | 'diary';
  folderId: string | null;
  folderPath: string;
  isFavorite: boolean;
  isArchived: boolean;
  inbound: number;
  outbound: number;
  degree: number;
  updatedAt: string;
  x?: number;
  y?: number;
}

export interface KnowledgeGraphLink {
  source: string;
  target: string;
}

export interface KnowledgeGraphData {
  nodes: KnowledgeGraphNode[];
  links: KnowledgeGraphLink[];
}

const UUID =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const INTERNAL_ID_REGEXES = [
  new RegExp(`data-internal-note-id=["'](${UUID})["']`, 'gi'),
  new RegExp(`data-note-id=["'](${UUID})["']`, 'gi'),
  new RegExp(`href=["']note:(?://)?(${UUID})["']`, 'gi'),
];

export function extractInternalNoteIds(content?: string | null): string[] {
  if (!content) return [];
  const ids = new Set<string>();

  for (const regex of INTERNAL_ID_REGEXES) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match[1]) ids.add(match[1]);
    }
  }

  return Array.from(ids);
}

export function folderPathFor(folderId: string | null, folders: Folder[]): string {
  if (!folderId) return 'Raiz';

  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let current = folderId;

  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    parts.unshift(folder.name);
    current = folder.parent_id;
  }

  return parts.length ? parts.join(' / ') : 'Raiz';
}

export function isDiaryLikeNote(note: Note): boolean {
  return (
    note.workspace_type === 'diary' ||
    Boolean(note.entry_date) ||
    Boolean(note.diary_year)
  );
}

export function buildKnowledgeGraph(notes: Note[], folders: Folder[]): KnowledgeGraphData {
  const activeNotes = notes.filter((n) => !n.is_archived);
  const byId = new Map(activeNotes.map((n) => [n.id, n]));

  const links: KnowledgeGraphLink[] = [];
  const seen = new Set<string>();

  for (const note of activeNotes) {
    for (const targetId of extractInternalNoteIds(note.content)) {
      if (!byId.has(targetId) || targetId === note.id) continue;
      const key = note.id + '>' + targetId;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: note.id, target: targetId });
    }
  }

  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const note of activeNotes) {
    inbound.set(note.id, 0);
    outbound.set(note.id, 0);
  }

  for (const link of links) {
    outbound.set(link.source, (outbound.get(link.source) || 0) + 1);
    inbound.set(link.target, (inbound.get(link.target) || 0) + 1);
  }

  const nodes: KnowledgeGraphNode[] = activeNotes.map((note) => ({
    id: note.id,
    label:
      note.title?.trim() ||
      (note.entry_date ? note.entry_date.split('-').reverse().join('/') : 'Sem título'),
    workspace: isDiaryLikeNote(note) ? 'diary' : 'notes',
    folderId: note.folder_id || null,
    folderPath: folderPathFor(note.folder_id, folders),
    isFavorite: Boolean(note.is_favorite),
    isArchived: Boolean(note.is_archived),
    inbound: inbound.get(note.id) || 0,
    outbound: outbound.get(note.id) || 0,
    degree: (inbound.get(note.id) || 0) + (outbound.get(note.id) || 0),
    updatedAt: note.updated_at || note.created_at || '',
  }));

  return { nodes, links };
}

export function getBacklinks(
  noteId: string,
  notes: Note[],
  folders: Folder[] = []
): KnowledgeGraphNode[] {
  const graph = buildKnowledgeGraph(notes, folders);
  const sourceIds = new Set(
    graph.links.filter((l) => l.target === noteId).map((l) => l.source)
  );
  return graph.nodes.filter((n) => sourceIds.has(n.id));
}

export function getLocalGraph(
  data: KnowledgeGraphData,
  rootId: string,
  depth: number
): KnowledgeGraphData {
  if (!rootId || depth <= 0) {
    return {
      nodes: data.nodes.filter((n) => n.id === rootId),
      links: [],
    };
  }

  const adjacency = new Map<string, Set<string>>();
  for (const node of data.nodes) adjacency.set(node.id, new Set());
  for (const link of data.links) {
    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
  }

  const allowed = new Set<string>([rootId]);
  let frontier = new Set<string>([rootId]);

  for (let level = 0; level < depth; level += 1) {
    const next = new Set<string>();
    for (const current of frontier) {
      for (const neighbor of adjacency.get(current) || []) {
        if (!allowed.has(neighbor)) {
          allowed.add(neighbor);
          next.add(neighbor);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  return {
    nodes: data.nodes.filter((n) => allowed.has(n.id)),
    links: data.links.filter((l) => allowed.has(l.source) && allowed.has(l.target)),
  };
}
