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

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const safeImageHtml = (tag: string) => {
  const src = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const url = src?.[1] || src?.[2] || src?.[3] || '';
  if (!/^https?:\/\//i.test(url)) return '';
  const altMatch = tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const alt = altMatch?.[1] || altMatch?.[2] || altMatch?.[3] || 'Imagem da nota';
  const widthMatch = tag.match(/\bdata-width\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const width = widthMatch?.[1] || widthMatch?.[2] || '100%';
  const alignmentMatch = tag.match(/\bdata-alignment\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const alignment = alignmentMatch?.[1] || alignmentMatch?.[2] || 'center';
  const safeWidth = /^\d+(?:\.\d+)?%?$/.test(width) ? width : '100%';
  const justify = alignment === 'left' ? 'flex-start' : alignment === 'right' ? 'flex-end' : 'center';
  return '<span style="display:flex;justify-content:' + justify + ';width:100%;margin:.75rem 0"><img src="' +
    escapeHtml(url) + '" alt="' + escapeHtml(alt) +
    '" style="display:block;width:' + safeWidth + ';max-width:100%;height:auto;object-fit:contain;border-radius:.5rem" loading="lazy" /></span>';
};

const contentAsHtml = (value?: string | null) => {
  if (!value) return '<p class="text-stone-400 italic">Esta nota ainda não tem conteúdo.</p>';

  // Algumas notas armazenam a tag de imagem escapada como texto (&lt;img...&gt;).
  // Convertemos apenas esse padrão de volta em tag antes de renderizar.
  const normalized = value.replace(/&lt;(img\b[\s\S]*?)\/?&gt;/gi, (_match, imageTag: string) => '<' + imageTag.replace(/\/\s*$/, '') + ' />');

  // Se o conteúdo já é HTML estruturado, preserva sua estrutura e substitui
  // as imagens por versões seguras e responsivas.
  if (/^\s*</.test(normalized)) {
    return normalized.replace(/<img\b[\s\S]*?>/gi, (tag) => safeImageHtml(tag));
  }

  // Em conteúdo misto/Markdown, reconhece tags de imagem mesmo quando seus
  // atributos foram quebrados em várias linhas.
  const imagePattern = /<img\b[\s\S]*?>/gi;
  let html = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(normalized))) {
    const before = normalized.slice(cursor, match.index);
    if (before.trim()) {
      html += before.split(/\r?\n/).map(line => '<p>' + (escapeHtml(line) || '<br>') + '</p>').join('');
    }
    html += safeImageHtml(match[0]);
    cursor = match.index + match[0].length;
  }
  const remainder = normalized.slice(cursor);
  if (remainder.trim()) {
    html += remainder.split(/\r?\n/).map(line => '<p>' + (escapeHtml(line) || '<br>') + '</p>').join('');
  }
  return html || '<p><br></p>';
};

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
  const selectedNote = selectedTarget?.type === 'sticky'
    ? stickyNotes.find(note => note.id === selectedTarget.id) || null
    : notes.find(note => note.id === selectedTarget?.id) || null;
  const selectedPreviewTitle = selectedTarget?.title || 'Pré-visualização';
  const selectedPreviewContent = selectedNote?.content || '';
  const selectedPreviewDate = selectedTarget?.type === 'sticky'
    ? null
    : (selectedNote as ExtendedNote | null)?.entry_date || null;

  const renderNote = (note: ExtendedNote) => matchesNote(note) ? (
    <button key={note.id} type="button" onClick={() => chooseNote(note)} aria-pressed={selectedTarget?.id===note.id} className={'w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ' + (selectedTarget?.id===note.id?'bg-[#f1e5d9] text-[#4d392b] dark:bg-[#514237] dark:text-[#f4e9df]':'text-[#39332e] dark:text-[#e8e4df] hover:bg-[#f4dfcb]/60 dark:hover:bg-[#51463e]')}>
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
    <div role="dialog" aria-modal="true" aria-label="Selecionar referência" onClick={event => event.stopPropagation()} className="w-full max-w-6xl h-[min(86vh,820px)] overflow-hidden rounded-2xl border border-[#e5ddd4] dark:border-[#51463e] bg-white dark:bg-[#26221f] shadow-2xl flex flex-col">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-[#eee8e1] dark:border-[#51463e] shrink-0">
        <div className="min-w-0"><h2 className="font-semibold text-base text-[#29231f] dark:text-[#f0e9e2]">Referenciar</h2><p className="text-xs text-[#82766d] dark:text-[#b6aaa0] truncate">{selectedText ? <>Vincular “{selectedText}” sem alterar o texto:</> : 'Escolha o tipo e selecione o item de destino'}</p></div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="p-2 rounded-lg hover:bg-[#f1ece6] dark:hover:bg-[#403832]"><X className="w-4 h-4"/></button>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3 border-b border-[#eee8e1] dark:border-[#51463e] shrink-0">
        {[
          {id:'note' as const,label:'Nota',icon:<FileText className="w-4 h-4"/>},
          {id:'sticky' as const,label:'Stick',icon:<StickyNote className="w-4 h-4"/>},
          {id:'diary' as const,label:'Diário',icon:<CalendarDays className="w-4 h-4"/>},
        ].map(item=><button key={item.id} type="button" onClick={()=>{setType(item.id);setQuery('');setExpanded(new Set());setSelectedTarget(null);}} className={'flex items-center justify-center gap-2 rounded-xl border px-2 py-2.5 text-xs sm:text-sm font-medium transition-colors ' + (type===item.id?'border-[#92745e] bg-[#f1e5d9] text-[#4d392b] dark:bg-[#514237] dark:text-[#f4e9df]':'border-[#e7dfd7] text-[#74675d] hover:bg-[#f7f3ef] dark:border-[#51463e] dark:text-[#c5b8ad] dark:hover:bg-[#39322d]')}>{item.icon}{item.label}</button>)}
      </div>
      <div className="p-3 border-b border-[#eee8e1] dark:border-[#51463e] shrink-0"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94877d]"/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={type==='sticky'?'Buscar Stick...':type==='diary'?'Buscar no diário...':'Buscar nota...'} className="w-full rounded-xl border border-[#e5ddd4] dark:border-[#51463e] bg-[#faf8f5] dark:bg-[#342e29] pl-9 pr-3 py-2 text-sm outline-none focus:border-[#9b806b]"/></div></div>
      <div className="flex flex-1 min-h-0">
        <section aria-label="Lista de notas" className="w-full md:w-[42%] min-w-0 border-r border-[#eee8e1] dark:border-[#51463e] flex flex-col">
          <div className="px-3 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[#94877d] dark:text-[#b6aaa0] shrink-0">Selecione uma nota</div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 pt-0">
            {loading ? <p className="py-10 text-center text-sm text-[#82766d]">Carregando itens...</p> : loadError ? <p className="py-10 text-center text-sm text-red-600">{loadError}</p> : type==='sticky' ? visibleSticky.map(note=><button key={note.id} type="button" onClick={()=>setSelectedTarget({id:note.id,title:note.title||'Stick sem título',type:'sticky'})} aria-pressed={selectedTarget?.id===note.id} className={'w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ' + (selectedTarget?.id===note.id?'bg-[#f1e5d9] text-[#4d392b] dark:bg-[#514237] dark:text-[#f4e9df]':'text-[#39332e] dark:text-[#e8e4df] hover:bg-[#f4dfcb]/60 dark:hover:bg-[#51463e]')}><StickyNote className="w-4 h-4 shrink-0 text-[#8a7768]"/><span className="truncate">{note.title||'Nota adesiva sem título'}</span></button>) : <>
              {rootNotes.map(renderNote)}
              {folderChildren(null).map(folder=>renderFolder(folder))}
              {noItems && <p className="py-8 text-center text-sm text-[#82766d]">Nenhum item encontrado.</p>}
            </>}
          </div>
        </section>
        <section aria-label="Pré-visualização da nota selecionada" className="hidden md:flex flex-1 min-w-0 flex-col bg-[#faf8f5] dark:bg-[#211e1b]">
          {selectedTarget ? <>
            <div className="px-5 py-4 border-b border-[#eee8e1] dark:border-[#51463e] shrink-0">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-[#988777] dark:text-[#a99d93]">Visualização da nota</p>
              <h3 className="mt-1 text-base font-semibold text-[#29231f] dark:text-[#f0e9e2] break-words">{selectedPreviewTitle}</h3>
              {selectedPreviewDate && <p className="mt-1 text-xs text-[#82766d] dark:text-[#b6aaa0]">{formatDateReadable(selectedPreviewDate)}</p>}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5">
              <article className="sticky-reference-preview max-w-none break-words text-sm leading-7 text-[#39332e] dark:text-[#e8e4df]" dangerouslySetInnerHTML={{__html:contentAsHtml(selectedPreviewContent)}} />
            </div>
          </> : <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-[#988b80] dark:text-[#a99d93]"><div><FileText className="w-8 h-8 mx-auto mb-3 opacity-40"/><p>Selecione uma nota para visualizar seu conteúdo completo aqui.</p><p className="mt-1 text-xs opacity-75">A visualização permite rolar até o final da nota.</p></div></div>}
        </section>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#eee8e1] dark:border-[#51463e] shrink-0"><span className="text-[11px] text-[#91857b] dark:text-[#a99d93]">{selectedTarget ? 'Referência selecionada. Confira a visualização e confirme para aplicar.' : 'Selecione um item e aplique a referência.'}</span><button type="button" disabled={!selectedTarget} onClick={()=>selectedTarget&&onSelectTarget(selectedTarget)} className="inline-flex items-center gap-2 rounded-xl bg-[#80634f] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#6e5544]"><Check className="w-4 h-4"/>Aplicar referência</button></div>
    </div>
    <style jsx>{`
      .sticky-reference-preview :global(p) { margin: 0 0 .75rem; }
      .sticky-reference-preview :global(h1),
      .sticky-reference-preview :global(h2),
      .sticky-reference-preview :global(h3) { font-weight: 650; line-height: 1.35; margin: 1rem 0 .5rem; }
      .sticky-reference-preview :global(ul),
      .sticky-reference-preview :global(ol) { padding-left: 1.5rem; margin: .5rem 0; }
      .sticky-reference-preview :global(ul) { list-style: disc; }
      .sticky-reference-preview :global(ol) { list-style: decimal; }
      .sticky-reference-preview :global(li) { margin: .2rem 0; }
      .sticky-reference-preview :global(img) { max-width: 100%; height: auto; border-radius: .5rem; }
      .sticky-reference-preview :global(a) { color: #92745e; text-decoration: underline; }
      .sticky-reference-preview :global(blockquote) { border-left: 3px solid #b9a18c; padding-left: .8rem; color: #82766d; }
      .sticky-reference-preview :global(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
      .sticky-reference-preview :global(td),
      .sticky-reference-preview :global(th) { border: 1px solid #d9cec3; padding: .35rem .5rem; }
      @media (max-width: 767px) { .sticky-reference-preview { display: none; } }
    `}</style>
  </div>;
}
