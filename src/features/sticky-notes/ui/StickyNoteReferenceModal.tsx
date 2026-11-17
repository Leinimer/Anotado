'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Search, StickyNote, X } from 'lucide-react';
import { indexedDBStorage, ExtendedFolder, ExtendedNote } from '@/src/features/notes/db/indexed-db';
import { fetchStickyNotes } from '../api/sticky-notes-api';
import { StickyNote as StickyNoteRecord } from '../types';
import { isDiaryFolder, isDiaryNote } from '@/src/features/notes/utils/diary-hierarchy';
import { formatDateReadable } from '@/src/features/notes/utils/diary-date';

type ReferenceType = 'note' | 'sticky' | 'diary';
type ReferenceTarget = { id: string; title: string; type: ReferenceType };
interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectTarget: (target: ReferenceTarget) => void;
  userId: string;
  selectedText?: string;
}

export function StickyNoteReferenceModal({ isOpen, onClose, onSelectTarget, userId, selectedText }: Props) {
  const [type, setType] = useState<ReferenceType>('note');
  const [folders, setFolders] = useState<ExtendedFolder[]>([]);
  const [notes, setNotes] = useState<ExtendedNote[]>([]);
  const [stickyNotes, setStickyNotes] = useState<StickyNoteRecord[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<ReferenceTarget | null>(null);

  useEffect(() => {
    if (!isOpen || !userId || userId === 'demo-user') return;
    let active = true;
    setLoading(true);
    setLoadError('');
    Promise.all([
      indexedDBStorage.getAllFolders(userId),
      indexedDBStorage.getAllNotes(userId),
      fetchStickyNotes(userId),
    ]).then(([folderRows, noteRows, stickyRows]) => {
      if (!active) return;
      setFolders(folderRows || []);
      setNotes((noteRows || []).filter(note => !note.is_archived));
      setStickyNotes(stickyRows || []);
      setExpanded(new Set());
    }).catch(error => {
      console.error('[StickyNoteReferenceModal] Erro ao carregar referências:', error);
      if (active) setLoadError('Não foi possível carregar os itens. Tente novamente.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isOpen, userId]);

  useEffect(() => {
    if (isOpen) { setType('note'); setQuery(''); setExpanded(new Set()); setSelectedTarget(null); }
  }, [isOpen]);

  const visibleFolders = useMemo(() => folders.filter(folder =>
    type === 'diary' ? isDiaryFolder(folder, folders) : type === 'note' ? !isDiaryFolder(folder, folders) : false
  ), [folders, type]);
  const visibleNotes = useMemo(() => notes.filter(note =>
    type === 'diary' ? isDiaryNote(note, folders) : type === 'note' ? !isDiaryNote(note, folders) : false
  ), [notes, folders, type]);
  const folderChildren = (parentId: string | null) => visibleFolders.filter(folder => folder.parent_id === parentId).sort((a,b) => (a.position||0)-(b.position||0) || a.name.localeCompare(b.name));
  const notesInFolder = (folderId: string | null) => visibleNotes.filter(note => note.folder_id === folderId).sort((a,b) => (a.position||0)-(b.position||0) || (a.title||'').localeCompare(b.title||''));
  const matchesText = (value: string) => !query.trim() || value.toLowerCase().includes(query.trim().toLowerCase());
  const matchesNote = (note: ExtendedNote) => matchesText([note.title || '', note.content || '', note.entry_date || ''].join(' '));
  const folderHasMatch = (folder: ExtendedFolder): boolean => notesInFolder(folder.id).some(matchesNote) || folderChildren(folder.id).some(folderHasMatch);
  const toggle = (id: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const chooseNote = (note: ExtendedNote) => setSelectedTarget({
    id: note.id,
    title: note.title || (note.entry_date ? formatDateReadable(note.entry_date) : 'Sem título'),
    type,
  });
  const renderNote = (note: ExtendedNote) => matchesNote(note) ? (
    <button key={note.id} type="button" onClick={() => chooseNote(note)} className={'w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ' + (selectedTarget?.id===note.id?'bg-[#f1e5d9] text-[#4d392b] dark:bg-[#514237] dark:text-[#f4e9df]':'text-[#39332e] dark:text-[#e8e4df] hover:bg-[#f4dfcb]/60 dark:hover:bg-[#51463e]')}>
      <FileText className="w-4 h-4 shrink-0 text-[#8a7768]" />
      <span className="truncate">{note.title || (note.entry_date ? formatDateReadable(note.entry_date) : 'Sem título')}</span>
    </button>
  ) : null;
  const renderFolder = (folder: ExtendedFolder, depth = 0): React.ReactNode => {
    const children = folderChildren(folder.id);
    const childNotes = notesInFolder(folder.id);
    if (query.trim() && !childNotes.some(matchesNote) && !children.some(folderHasMatch)) return null;
    const isOpen = expanded.has(folder.id);
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

  const visibleSticky = stickyNotes.filter(note => matchesText((note.title || '') + ' ' + (note.content || '')));
  const rootNotes = notesInFolder(null);
  const noItems = type === 'sticky' ? visibleSticky.length === 0 : visibleNotes.length === 0;

  if (!isOpen) return null;
  return <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-3" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label="Selecionar referência" onClick={event => event.stopPropagation()} className="w-full max-w-xl max-h-[82vh] overflow-hidden rounded-2xl border border-[#e5ddd4] dark:border-[#51463e] bg-white dark:bg-[#26221f] shadow-2xl flex flex-col">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-[#eee8e1] dark:border-[#51463e]">
        <div className="min-w-0"><h2 className="font-semibold text-base text-[#29231f] dark:text-[#f0e9e2]">Referenciar</h2><p className="text-xs text-[#82766d] dark:text-[#b6aaa0] truncate">{selectedText ? <>Vincular “{selectedText}” sem alterar o texto:</> : 'Escolha o tipo e selecione o item de destino'}</p></div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="p-2 rounded-lg hover:bg-[#f1ece6] dark:hover:bg-[#403832]"><X className="w-4 h-4"/></button>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3 border-b border-[#eee8e1] dark:border-[#51463e]">
        {[
          {id:'note' as const,label:'Nota',icon:<FileText className="w-4 h-4"/>},
          {id:'sticky' as const,label:'Nota adesiva',icon:<StickyNote className="w-4 h-4"/>},
          {id:'diary' as const,label:'Diário',icon:<CalendarDays className="w-4 h-4"/>},
        ].map(item=><button key={item.id} type="button" onClick={()=>{setType(item.id);setQuery('');setExpanded(new Set());setSelectedTarget(null);}} className={'flex items-center justify-center gap-2 rounded-xl border px-2 py-2.5 text-xs sm:text-sm font-medium transition-colors ' + (type===item.id?'border-[#92745e] bg-[#f1e5d9] text-[#4d392b] dark:bg-[#514237] dark:text-[#f4e9df]':'border-[#e7dfd7] text-[#74675d] hover:bg-[#f7f3ef] dark:border-[#51463e] dark:text-[#c5b8ad] dark:hover:bg-[#39322d]')}>{item.icon}{item.label}</button>)}
      </div>
      <div className="p-3 border-b border-[#eee8e1] dark:border-[#51463e]"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94877d]"/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={type==='sticky'?'Buscar nota adesiva...':type==='diary'?'Buscar no diário...':'Buscar nota...'} className="w-full rounded-xl border border-[#e5ddd4] dark:border-[#51463e] bg-[#faf8f5] dark:bg-[#342e29] pl-9 pr-3 py-2 text-sm outline-none focus:border-[#9b806b]"/></div></div>
      <div className="overflow-y-auto p-3 min-h-[240px]">
        {loading ? <p className="py-10 text-center text-sm text-[#82766d]">Carregando itens...</p> : loadError ? <p className="py-10 text-center text-sm text-red-600">{loadError}</p> : type==='sticky' ? visibleSticky.map(note=><button key={note.id} type="button" onClick={()=>setSelectedTarget({id:note.id,title:note.title||'Nota adesiva sem título',type:'sticky'})} className={'w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ' + (selectedTarget?.id===note.id?'bg-[#f1e5d9] text-[#4d392b] dark:bg-[#514237] dark:text-[#f4e9df]':'text-[#39332e] dark:text-[#e8e4df] hover:bg-[#f4dfcb]/60 dark:hover:bg-[#51463e]')}><StickyNote className="w-4 h-4 text-[#8a7768]"/><span className="truncate">{note.title||'Nota adesiva sem título'}</span></button>) : <>
          {rootNotes.map(renderNote)}
          {folderChildren(null).map(folder=>renderFolder(folder))}
          {noItems && <p className="py-8 text-center text-sm text-[#82766d]">Nenhum item encontrado.</p>}
        </>}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#eee8e1] dark:border-[#51463e]"><span className="text-[11px] text-[#91857b] dark:text-[#a99d93]">{selectedTarget ? 'Referência selecionada. Confirme para aplicar.' : 'Selecione um item e aplique a referência.'}</span><button type="button" disabled={!selectedTarget} onClick={()=>selectedTarget&&onSelectTarget(selectedTarget)} className="inline-flex items-center gap-2 rounded-xl bg-[#80634f] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#6e5544]"><Check className="w-4 h-4"/>Aplicar referência</button></div>
    </div>
  </div>;
}
