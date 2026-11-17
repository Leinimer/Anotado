'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Search, X } from 'lucide-react';
import { indexedDBStorage, ExtendedFolder, ExtendedNote } from '@/src/features/notes/db/indexed-db';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectNote: (note: ExtendedNote) => void;
  userId: string;
  selectedText?: string;
}

export function StickyNoteReferenceModal({ isOpen, onClose, onSelectNote, userId, selectedText }: Props) {
  const [folders, setFolders] = useState<ExtendedFolder[]>([]);
  const [notes, setNotes] = useState<ExtendedNote[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !userId || userId === 'demo-user') return;
    let active = true;
    setLoading(true);
    Promise.all([indexedDBStorage.getAllFolders(userId), indexedDBStorage.getAllNotes(userId)])
      .then(([folderRows, noteRows]) => {
        if (!active) return;
        setFolders(folderRows || []);
        setNotes((noteRows || []).filter(note => !note.is_archived));
        setExpanded(new Set((folderRows || []).filter(folder => !folder.parent_id).map(folder => folder.id)));
      })
      .catch(error => console.error('[StickyNoteReferenceModal] Erro ao carregar árvore:', error))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isOpen, userId]);

  const folderChildren = (parentId: string | null) => folders.filter(folder => folder.parent_id === parentId).sort((a,b) => a.position-b.position || a.name.localeCompare(b.name));
  const notesInFolder = (folderId: string | null) => notes.filter(note => note.folder_id === folderId).sort((a,b) => a.position-b.position || (a.title || '').localeCompare(b.title || ''));
  const matches = (note: ExtendedNote) => !query.trim() || (note.title || '').toLowerCase().includes(query.trim().toLowerCase()) || (note.content || '').toLowerCase().includes(query.trim().toLowerCase());
  const folderHasMatch = (folder: ExtendedFolder): boolean => notesInFolder(folder.id).some(matches) || folderChildren(folder.id).some(folderHasMatch);
  const toggle = (id: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const renderNote = (note: ExtendedNote) => matches(note) ? (
    <button key={note.id} type="button" onClick={() => onSelectNote(note)} className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-[#39332e] dark:text-[#e8e4df] hover:bg-[#f4dfcb]/60 dark:hover:bg-[#51463e]">
      <FileText className="w-4 h-4 shrink-0 text-[#8a7768]" />
      <span className="truncate">{note.title || 'Sem título'}</span>
    </button>
  ) : null;

  const renderFolder = (folder: ExtendedFolder, depth = 0): React.ReactNode => {
    const children = folderChildren(folder.id);
    const childNotes = notesInFolder(folder.id);
    if (query.trim() && !childNotes.some(matches) && !children.some(folderHasMatch)) return null;
    const isOpen = expanded.has(folder.id) || Boolean(query.trim());
    return <div key={folder.id}>
      <button type="button" onClick={() => toggle(folder.id)} className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-[#55483f] dark:text-[#e2d6cc] hover:bg-[#f4f0e9] dark:hover:bg-[#39322d]" style={{ paddingLeft: 8 + depth * 17 }}>
        {isOpen ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronRight className="w-3.5 h-3.5"/>}
        {isOpen ? <FolderOpen className="w-4 h-4"/> : <Folder className="w-4 h-4"/>}
        <span className="truncate">{folder.name}</span>
      </button>
      {isOpen && <div className="ml-3 border-l border-[#e8e0d7] dark:border-[#51463e] pl-2">
        {childNotes.map(renderNote)}
        {children.map(child => renderFolder(child, depth + 1))}
      </div>}
    </div>;
  };

  const visibleNotesCount = useMemo(() => notes.filter(matches).length, [notes, query]);
  if (!isOpen) return null;

  return <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-3" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label="Selecionar nota para referência" onClick={event => event.stopPropagation()} className="w-full max-w-xl max-h-[82vh] overflow-hidden rounded-2xl border border-[#e5ddd4] dark:border-[#51463e] bg-white dark:bg-[#26221f] shadow-2xl flex flex-col">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-[#eee8e1] dark:border-[#51463e]">
        <div className="min-w-0"><h2 className="font-semibold text-base text-[#29231f] dark:text-[#f0e9e2]">Referenciar nota</h2><p className="text-xs text-[#82766d] dark:text-[#b6aaa0] truncate">{selectedText ? <>Vincular “{selectedText}” a uma nota:</> : 'Escolha uma nota na árvore de pastas'}</p></div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="p-2 rounded-lg hover:bg-[#f1ece6] dark:hover:bg-[#403832]"><X className="w-4 h-4"/></button>
      </div>
      <div className="p-3 border-b border-[#eee8e1] dark:border-[#51463e]"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94877d]"/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar nota por título ou conteúdo..." className="w-full rounded-xl border border-[#e5ddd4] dark:border-[#51463e] bg-[#faf8f5] dark:bg-[#342e29] pl-9 pr-3 py-2 text-sm outline-none focus:border-[#9b806b]"/></div></div>
      <div className="overflow-y-auto p-3 min-h-[240px]">
        {loading ? <p className="py-10 text-center text-sm text-[#82766d]">Carregando árvore de notas...</p> : <>
          {notesInFolder(null).map(renderNote)}
          {folderChildren(null).map(folder => renderFolder(folder))}
          {visibleNotesCount === 0 && <p className="py-8 text-center text-sm text-[#82766d]">Nenhuma nota encontrada.</p>}
        </>}
      </div>
      <div className="px-4 py-3 border-t border-[#eee8e1] dark:border-[#51463e] text-[11px] text-[#91857b] dark:text-[#a99d93]">Selecione uma nota para vincular o texto selecionado.</div>
    </div>
  </div>;
}
