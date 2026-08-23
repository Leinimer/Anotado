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
  tags?: string[];
  is_archived?: boolean;
  previous_folder_id?: string | null;
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
  tags?: string[];
  isFromSmartFolder?: boolean;
  isArchived?: boolean;
  previousFolderId?: string | null;
}

export type TreeItem = TreeFolderNode | TreeNodeItem;

