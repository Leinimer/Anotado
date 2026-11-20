'use client';
import React from 'react';
import {AlertCircle,Bold,Check,CheckSquare,Highlighter,Italic,LayoutGrid,Link2,List,Loader2,Plus,Redo2,Underline,Undo2} from 'lucide-react';
import {useTheme} from '@/src/features/theme/theme-context';
import {STICKY_COLORS,StickyNoteColorKey} from '../types';
import {StickyEditorAction} from './StickyNoteCard';
export type StickySaveState='idle'|'saving'|'saved'|'error';
export type StickyToolbarLayoutMode='default'|'tablet-primary'|'tablet-status'|'tablet-editing';
interface Props{activeColor:StickyNoteColorKey;selectedNoteColor?:string|null;hasSelectedNote:boolean;notesCount:number;saveState:StickySaveState;errorMessage?:string|null;layoutMode?:StickyToolbarLayoutMode;onCreateNote:()=>void;onToggleGroups?:()=>void;groupsOpen?:boolean;onSelectColor:(c:StickyNoteColorKey)=>void;onFormat?:(a:StickyEditorAction)=>void;highlightMode?:boolean;onInsertNoteLink?:()=>void;}
export function StickyNotesToolbar({activeColor,selectedNoteColor,hasSelectedNote,notesCount,saveState,errorMessage,layoutMode='default',onCreateNote,onToggleGroups,groupsOpen,onSelectColor,onFormat,highlightMode=false,onInsertNoteLink}:Props){
 const toggleHighlight=()=>onFormat?.('highlight');
 const {theme,isMounted}=useTheme();const dark=isMounted&&theme==='dark';const active=(hasSelectedNote&&selectedNoteColor?selectedNoteColor:activeColor).toLowerCase();
 const btn=(label:string,icon:React.ReactNode,fn:()=>void,disabled=false,sizeClass='w-7 h-7')=><button key={label} type="button" onMouseDown={e=>e.preventDefault()} onClick={fn} disabled={disabled} title={label} aria-label={label} className={`inline-flex items-center justify-center ${sizeClass} shrink-0 rounded-md text-[#5d5148] hover:bg-[#eee9e1] disabled:opacity-35 disabled:cursor-not-allowed dark:text-[#d1c4bc] dark:hover:bg-[#202020]`}>{icon}</button>;
 const groupsButton=onToggleGroups&&<button id="sticky-groups-toggle-btn" type="button" onClick={onToggleGroups} aria-label="Mostrar campos criados" aria-pressed={Boolean(groupsOpen)} title="Campos criados" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#d8cfc4] bg-[#f4efe7] text-[#68594d] shadow-sm transition-colors hover:bg-[#eae1d6] dark:border-[#494038] dark:bg-[#211e1b] dark:text-[#e2d4c8] dark:hover:bg-[#302922]"><LayoutGrid className="h-4 w-4"/></button>;
 const createButton=<button id="sticky-create-note-btn" type="button" onClick={onCreateNote} className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#68594d] hover:bg-[#53463c] dark:bg-[#2e2620] text-white text-xs font-medium whitespace-nowrap shrink-0"><Plus className="w-3.5 h-3.5"/>Novo Stick</button>;
 const saveStatus=(alwaysShowCount=false)=><div className="ml-auto flex items-center gap-2 shrink-0 text-[11px] whitespace-nowrap text-[#7f756e] dark:text-[#a1a1aa]">{saveState==='saving'&&<span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin"/>Salvando</span>}{saveState==='saved'&&<span className="inline-flex items-center gap-1 text-[#5f6f52]"><Check className="w-3 h-3"/>Salvo</span>}{saveState==='error'&&<span title={errorMessage||'Erro ao salvar'} className="inline-flex items-center gap-1 text-red-600"><AlertCircle className="w-3 h-3"/>Erro ao salvar</span>}<span className={alwaysShowCount?'inline':'hidden sm:inline'}>{notesCount} {notesCount===1?'Stick':'Sticks'}</span></div>;

 if(layoutMode==='tablet-primary') return <div className="flex items-center gap-1.5 shrink-0">{onToggleGroups&&<button id="sticky-groups-toggle-btn" type="button" onClick={onToggleGroups} aria-label="Mostrar campos criados" aria-pressed={Boolean(groupsOpen)} title="Campos criados" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#d8cfc4] bg-[#f4efe7] text-[#68594d] shadow-sm active:scale-95 dark:border-[#494038] dark:bg-[#211e1b] dark:text-[#e2d4c8]"><LayoutGrid className="h-4 w-4"/></button>}<button id="sticky-create-note-btn" type="button" onClick={onCreateNote} className="inline-flex h-8 items-center gap-1 px-2.5 rounded-lg bg-[#68594d] text-white text-[11px] font-medium whitespace-nowrap shrink-0 active:scale-95"><Plus className="w-3.5 h-3.5"/>Novo Stick</button></div>;
 if(layoutMode==='tablet-status') return <div id="sticky-notes-toolbar-status" className="flex items-center gap-2 shrink-0 text-[11px] whitespace-nowrap text-[#7f756e] dark:text-[#a1a1aa]">
  {saveState==='saving'&&<span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin"/>Salvando</span>}
  {saveState==='saved'&&<span className="inline-flex items-center gap-1 text-[#5f6f52]"><Check className="w-3 h-3"/>Salvo</span>}
  {saveState==='error'&&<span title={errorMessage||'Erro ao salvar'} className="inline-flex items-center gap-1 text-red-600"><AlertCircle className="w-3 h-3"/>Erro</span>}
  <span>{notesCount} {notesCount===1?'Stick':'Sticks'}</span>
 </div>;

 if(layoutMode==='tablet-editing'){
  const tabletGroupsBtn=onToggleGroups&&<button id="sticky-groups-toggle-btn" type="button" onClick={onToggleGroups} aria-label="Mostrar campos criados" aria-pressed={Boolean(groupsOpen)} title="Campos criados" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#d8cfc4] bg-[#f4efe7] text-[#68594d] shadow-sm transition-colors active:scale-95 hover:bg-[#eae1d6] dark:border-[#494038] dark:bg-[#211e1b] dark:text-[#e2d4c8] dark:hover:bg-[#302922]"><LayoutGrid className="h-4 w-4"/></button>;
  const tabletCreateBtn=<button id="sticky-create-note-btn" type="button" onClick={onCreateNote} className="inline-flex h-8 items-center gap-1 px-2.5 rounded-lg bg-[#68594d] active:scale-[0.98] hover:bg-[#53463c] dark:bg-[#2e2620] text-white text-[11px] font-medium whitespace-nowrap shrink-0"><Plus className="w-3.5 h-3.5"/>Novo Stick</button>;
  return <div id="sticky-notes-toolbar-editing" className="w-full min-w-0 flex flex-col items-stretch gap-1.5 overflow-hidden select-none">
   <div id="sticky-tablet-primary-actions" className="flex w-full items-center justify-start gap-2 shrink-0">
    {tabletGroupsBtn}{tabletCreateBtn}
   </div>
   <div className="w-full min-w-0 flex flex-nowrap items-center justify-start gap-2 overflow-x-auto no-scrollbar touch-pan-x">
   <div className="flex items-center gap-0.5 shrink-0" role="group" aria-label="Cores das notas">{STICKY_COLORS.map(c=><button key={c.key} type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>onSelectColor(c.key)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full active:scale-95" title={c.label} aria-label={c.label} aria-pressed={active===c.key}><span style={{backgroundColor:dark?c.swatchDark:c.swatchLight}} className={`block w-5 h-5 rounded-full border transition-transform ${active===c.key?'ring-2 ring-[#68594d] dark:ring-[#f4dfcb] ring-offset-2 ring-offset-[#fbf9f4] dark:ring-offset-[#0a0a0a] border-transparent scale-105':'border-black/15 dark:border-white/20'}`}/></button>)}</div>
   <span className="h-6 w-px bg-[#e4e2dd] dark:bg-[#303030] shrink-0"/>
   <div className="flex items-center gap-1 shrink-0">
    {btn('Negrito',<Bold className="w-4 h-4"/>,()=>onFormat?.('bold'),!hasSelectedNote,'w-8 h-8 rounded-md')}
    {btn('Itálico',<Italic className="w-4 h-4"/>,()=>onFormat?.('italic'),!hasSelectedNote,'w-8 h-8 rounded-md')}
    {btn('Sublinhado',<Underline className="w-4 h-4"/>,()=>onFormat?.('underline'),!hasSelectedNote,'w-8 h-8 rounded-md')}
    <button key="Marca-texto" type="button" onMouseDown={e=>e.preventDefault()} onClick={toggleHighlight} title={highlightMode?'Desativar marca-texto':'Ativar marca-texto'} aria-label="Marca-texto" aria-pressed={highlightMode} className={`inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-md text-[#5d5148] dark:text-[#d1c4bc] disabled:opacity-35 disabled:cursor-not-allowed ${highlightMode?'bg-[#ded4c7] text-[#4b3e33] ring-1 ring-[#9d8874] dark:bg-[#514438] dark:text-[#fff]':'hover:bg-[#eee9e1] dark:hover:bg-[#202020]'}`}><Highlighter className="w-4 h-4"/></button>
   </div>
   <span className="h-6 w-px bg-[#e4e2dd] dark:bg-[#303030] shrink-0"/>
   <div className="flex items-center gap-1 shrink-0">
    {btn('Marcadores',<List className="w-4 h-4"/>,()=>onFormat?.('bullet'),!hasSelectedNote,'w-8 h-8 rounded-md')}
    {btn('Checklist',<CheckSquare className="w-4 h-4"/>,()=>onFormat?.('checklist'),!hasSelectedNote,'w-8 h-8 rounded-md')}
   </div>
   <span className="h-6 w-px bg-[#e4e2dd] dark:bg-[#303030] shrink-0"/>
   <div className="flex items-center gap-1 shrink-0">
    {btn('Desfazer',<Undo2 className="w-4 h-4"/>,()=>onFormat?.('undo'),!hasSelectedNote,'w-8 h-8 rounded-md')}
    {btn('Refazer',<Redo2 className="w-4 h-4"/>,()=>onFormat?.('redo'),!hasSelectedNote,'w-8 h-8 rounded-md')}
    {btn('Referenciar nota',<Link2 className="w-4 h-4"/>,()=>onInsertNoteLink?.(),!hasSelectedNote,'w-8 h-8 rounded-md')}
   </div>
   </div>
  </div>;
 }

 return <div id="sticky-notes-toolbar" className="w-full min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 select-none">
 <div className="flex items-center gap-2 shrink-0">{groupsButton}{createButton}<div className="h-6 w-px bg-[#e4e2dd] dark:bg-[#303030]"/><div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Cores das notas">{STICKY_COLORS.map(c=><button key={c.key} type="button" onClick={()=>onSelectColor(c.key)} style={{backgroundColor:dark?c.swatchDark:c.swatchLight}} className={`w-5 h-5 sm:w-5.5 sm:h-5.5 rounded-full border hover:scale-110 ${active===c.key?'ring-2 ring-[#68594d] dark:ring-[#f4dfcb] ring-offset-2 ring-offset-[#fbf9f4] dark:ring-offset-[#0a0a0a] border-transparent':'border-black/15 dark:border-white/20'}`} title={c.label} aria-label={c.label} aria-pressed={active===c.key}/>)}</div></div>
 <div className="h-6 w-px bg-[#e4e2dd] dark:bg-[#303030] mx-1"/>
 <div className="flex items-center gap-0.5">
 {btn('Negrito',<Bold className="w-4 h-4"/>,()=>onFormat?.('bold'),!hasSelectedNote)}{btn('Itálico',<Italic className="w-4 h-4"/>,()=>onFormat?.('italic'),!hasSelectedNote)}{btn('Sublinhado',<Underline className="w-4 h-4"/>,()=>onFormat?.('underline'),!hasSelectedNote)}<button key="Marca-texto" type="button" onMouseDown={e=>e.preventDefault()} onClick={toggleHighlight} title={highlightMode?'Desativar marca-texto':'Ativar marca-texto'} aria-label="Marca-texto" aria-pressed={highlightMode} className={`inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-md text-[#5d5148] dark:text-[#d1c4bc] disabled:opacity-35 disabled:cursor-not-allowed ${highlightMode?'bg-[#ded4c7] text-[#4b3e33] ring-1 ring-[#9d8874] dark:bg-[#514438] dark:text-[#fff]':'hover:bg-[#eee9e1] dark:hover:bg-[#202020]'}`}><Highlighter className="w-4 h-4"/></button>
 <span className="h-5 w-px bg-[#e4e2dd] dark:bg-[#303030] mx-1"/>{btn('Marcadores',<List className="w-4 h-4"/>,()=>onFormat?.('bullet'),!hasSelectedNote)}{btn('Checklist',<CheckSquare className="w-4 h-4"/>,()=>onFormat?.('checklist'),!hasSelectedNote)}

 <span className="h-5 w-px bg-[#e4e2dd] dark:bg-[#303030] mx-1"/>{btn('Desfazer',<Undo2 className="w-4 h-4"/>,()=>onFormat?.('undo'),!hasSelectedNote)}{btn('Refazer',<Redo2 className="w-4 h-4"/>,()=>onFormat?.('redo'),!hasSelectedNote)}{btn('Referenciar nota',<Link2 className="w-4 h-4"/>,()=>onInsertNoteLink?.(),!hasSelectedNote)}
 </div>
 {saveStatus(false)}</div>;
}