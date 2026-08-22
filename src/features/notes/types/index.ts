export interface Folder {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  position: number;
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
  created_at: string;
  updated_at: string;
}

export interface TreeFolderNode {
  type: 'folder';
  id: string;
  name: string;
  parentId: string | null;
  position: number;
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
}

export type TreeItem = TreeFolderNode | TreeNodeItem;
