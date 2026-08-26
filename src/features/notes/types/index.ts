export const SYSTEM_ARCHIVE_FOLDER_ID = 'system-archive-folder';

export type SearchMode = 'all' | 'title' | 'content' | 'tags' | 'folders' | 'archived';

export interface Folder {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  position: number;
  color?: string | null;
  is_smart?: boolean;
  smart_tags?: string[];
  is_system?: boolean;
  syncRequired?: boolean;
  syncStatus?: 'synced' | 'pending' | 'syncing' | 'error';
  revision?: number;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  content: string;
  position: number;
  tags: string[];
  is_archived?: boolean;
  previous_folder_id?: string | null;
  syncRequired?: boolean;
  syncStatus?: 'synced' | 'pending' | 'syncing' | 'error';
  revision?: number;
  created_at: string;
  updated_at: string;
}

export interface TreeFolderNode {
  type: 'folder';
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  color?: string | null;
  effectiveColor?: string | null;
  isSmart?: boolean;
  smartTags?: string[];
  isSystem?: boolean;
  subfolders: TreeFolderNode[];
  notes: TreeNodeItem[];
  depth: number;
}

export interface TreeNodeItem {
  type: 'note';
  id: string;
  title: string;
  content: string;
  folderId: string | null;
  position: number;
  depth: number;
  tags: string[];
  isFromSmartFolder?: boolean;
  isArchived?: boolean;
  previousFolderId?: string | null;
}

export type TreeItem = TreeFolderNode | TreeNodeItem;

export interface NoteAttachment {
  id: string; // UUID
  note_id?: string | null; // UUID
  user_id: string; // UUID
  file_name: string;
  mime_type: string;
  file_size: number;
  storage_path: string; // `${user_id}/${id}.${extension}`
  created_at: string;
  updated_at: string;
}


