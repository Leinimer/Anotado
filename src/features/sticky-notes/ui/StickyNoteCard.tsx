'use client';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AlarmClock,GripHorizontal,Trash2} from 'lucide-react';
import {STICKY_MAX_WIDTH,STICKY_MIN_WIDTH,StickyNote,getStickyColorTheme} from '../types';
export type StickyEditorAction='bold'|'italic'|'underline'|'undo'|'redo'|'bullet'|'checklist'|'outdent'|'indent';
export interface StickyEditorActions{format:(action:StickyEditorAction)=>void;prepareNoteReference:()=>string;insertNoteLink:(id:string,title:string,type?:'note'|'sticky'|'diary')=>void;}
interface Props{note:StickyNote;isSelected:boolean;autoFocus?:boolean;onSelect:(id:string)=>void;onChangeTitle:(id:string,title:string)=>void;onChangeContent:(id:string,content:string)=>void;onChangeColor:(id:string,color:any)=>void;onMoveLive:(id:string,x:number,y:number)=>void;onMoveEnd:(id:string,x:number,y:number)=>void;onResizeLive:(id:string,width:number)=>void;onResizeEnd:(id:string,width:number)=>void;onDelete:(id:string)=>void;registerEditorActions?:(id:string,a:StickyEditorActions|null)=>void;onOpenLinkedNote?:(id:string,type:'note'|'sticky'|'diary')=>void;hasReminder?:boolean;onOpenReminder?:(note:StickyNote)=>void;onContextMenu?:(note:StickyNote,x:number,y:number)=>void;}
const esc=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const toHtml=(v:string)=>!v?'<p><br></p>':/^\s*</.test(v)?v:v.split('\n').map(x=>'<p>'+(esc(x)||'<br>')+'</p>').join('');
const styleChecklist=(editor:HTMLElement)=>{
 editor.querySelectorAll<HTMLUListElement>('ul[data-sticky-checklist]').forEach(list=>{
  Object.assign(list.style,{listStyle:'none',paddingLeft:'0',margin:'0'});
  list.querySelectorAll<HTMLLIElement>(':scope > li').forEach(item=>{
   Object.assign(item.style,{display:'flex',alignItems:'center',gap:'6px',fontSize:'14px',listStyle:'none',margin:'0',padding:'0',lineHeight:'1.45'});
   const label=item.querySelector<HTMLElement>('label');
   if(label) Object.assign(label.style,{display:'inline-flex',alignItems:'center',justifyContent:'center',flex:'0 0 14px',width:'14px',height:'14px',margin:'0',padding:'0',lineHeight:'1'});
   const checkbox=item.querySelector<HTMLInputElement>('input[type="checkbox"]');
   if(checkbox) Object.assign(checkbox.style,{width:'14px',height:'14px',margin:'0',padding:'0',verticalAlign:'middle',flex:'0 0 14px',accentColor:'#eab308'});
   const content=item.querySelector<HTMLElement>(':scope > div');
   if(content) Object.assign(content.style,{flex:'1 1 auto',minWidth:'0',margin:'0',padding:'0',lineHeight:'1.45'});
   item.querySelectorAll<HTMLParagraphElement>('p').forEach(p=>Object.assign(p.style,{margin:'0',padding:'0',lineHeight:'1.45'}));
   const text=item.querySelector<HTMLElement>('[data-sticky-check-text]');
   if(text) Object.assign(text.style,{textDecorationLine:'none',textDecoration:'none',opacity:'1'});
  });
 });
 editor.querySelectorAll<HTMLParagraphElement>('p[data-sticky-after-checklist]').forEach(p=>Object.assign(p.style,{margin:'0',padding:'0',lineHeight:'1.2',minHeight:'0',height:'auto'}));
};

export function StickyNoteCard({note,isSelected,autoFocus=false,onSelect,onChangeTitle,onChangeContent,onMoveLive,onMoveEnd,onResizeLive,onResizeEnd,onDelete,registerEditorActions,onOpenLinkedNote,hasReminder=false,onOpenReminder,onContextMenu}:Props){
 const colors=getStickyColorTheme(note.color);const editor=useRef<HTMLDivElement>(null);const referenceRange=useRef<Range|null>(null);const [drag,setDrag]=useState(false);const [resize,setResize]=useState(false);
 useLayoutEffect(()=>{const el=editor.current;if(el&&document.activeElement!==el&&!el.contains(document.activeElement)){const html=toHtml(note.content||'');if(el.innerHTML!==html)el.innerHTML=html;styleChecklist(el);}},[note.content]);
 useEffect(()=>{if(autoFocus)editor.current?.focus();},[autoFocus]);
 const save=()=>{if(editor.current){styleChecklist(editor.current);onChangeContent(note.id,editor.current.innerHTML);}};
 const command=(cmd:string)=>{if(!editor.current)return;editor.current.focus();document.execCommand(cmd,false);save();};
 const placeCaret=(target:HTMLElement)=>{const range=document.createRange();range.selectNodeContents(target);range.collapse(false);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);};
 const insertBullet=()=>{
  const el=editor.current;if(!el)return;el.focus();
  const selection=window.getSelection();
  let range=selection&&selection.rangeCount?selection.getRangeAt(0):null;
  if(!range||!el.contains(range.commonAncestorContainer)){
   range=document.createRange();range.selectNodeContents(el);range.collapse(false);
  }
  const node=range.startContainer;
  const anchor=node instanceof Element?node:node.parentElement;
  const current=anchor?.closest('li');
  const list=anchor?.closest('ul.sticky-bullet-list');
  if(list&&el.contains(list)){
   const item=document.createElement('li');item.innerHTML='<br>';
   current?.parentElement===list?current.insertAdjacentElement('afterend',item):list.appendChild(item);
   placeCaret(item);
  }else{
   const block=anchor?.closest('p,div');
   const ul=document.createElement('ul');ul.className='sticky-bullet-list';
   ul.style.cssText='list-style-type:disc;padding-left:1.5em;margin:0.15em 0';
   const li=document.createElement('li');li.style.listStyleType='disc';li.innerHTML='<br>';ul.appendChild(li);
   if(block&&el.contains(block)){
    const existingText=block.textContent||'';
    if(existingText.trim()){li.textContent=existingText;}
    block.replaceWith(ul);
   }else{range.collapse(false);range.insertNode(ul);}
   placeCaret(li);
  }
  save();
 };
 const insertChecklist=()=>{
  const el=editor.current;if(!el)return;el.focus();
  const selection=window.getSelection();
  const range=selection&&selection.rangeCount?selection.getRangeAt(0):null;
  const anchor=range?.startContainer instanceof Element?range.startContainer:range?.startContainer.parentElement;
  const currentItem=anchor?.closest('li');
  const currentList=anchor?.closest('ul[data-sticky-checklist]');
  const makeItem=()=>{
   const li=document.createElement('li');
   li.innerHTML='<label style="display:inline-flex;align-items:center;justify-content:center;flex:0 0 13px;margin:0;padding:0;line-height:1"><input type="checkbox" aria-label="Marcar item como concluído" style="width:14px;height:14px;margin:0;padding:0;vertical-align:middle;flex:0 0 13px;accent-color:#eab308"></label><div style="flex:1 1 auto;min-width:0;margin:0;padding:0;line-height:1.45"><p style="margin:0;padding:0;line-height:1.45"><span data-sticky-check-text="true"><br></span></p></div>';
   return li;
  };
  if(currentList&&el.contains(currentList)){
   const item=makeItem();
   if(currentItem&&currentItem.parentElement===currentList)currentItem.insertAdjacentElement('afterend',item);
   else currentList.appendChild(item);
   styleChecklist(el);
   const text=item.querySelector<HTMLElement>('[data-sticky-check-text]');if(text)placeCaret(text);
   save();return;
  }
  const after=anchor?.closest('p[data-sticky-after-checklist]');
  const previousList=after?.previousElementSibling;
  if(previousList instanceof HTMLUListElement&&previousList.matches('ul[data-sticky-checklist]')){
   const item=makeItem();previousList.appendChild(item);styleChecklist(el);
   const text=item.querySelector<HTMLElement>('[data-sticky-check-text]');if(text)placeCaret(text);
   save();return;
  }
  if(!range||!el.contains(range.commonAncestorContainer)){
   const end=document.createRange();end.selectNodeContents(el);end.collapse(false);
   selection?.removeAllRanges();selection?.addRange(end);
  }
  document.execCommand('insertHTML',false,'<ul data-sticky-checklist="true" style="list-style:none;padding-left:0;margin:0"><li style="display:flex;align-items:center;gap:6px;list-style:none;margin:0;padding:0;line-height:1.45"><label style="display:inline-flex;align-items:center;justify-content:center;flex:0 0 13px;margin:0;padding:0;line-height:1"><input type="checkbox" aria-label="Marcar item como concluído" style="width:14px;height:14px;margin:0;padding:0;vertical-align:middle;flex:0 0 13px;accent-color:#eab308"></label><div style="flex:1 1 auto;min-width:0;margin:0;padding:0;line-height:1.45"><p style="margin:0;padding:0;line-height:1.45"><span data-sticky-check-text="true"><br></span></p></div></li></ul><p data-sticky-after-checklist="true" style="margin:0;padding:0;line-height:1.2"><br></p>');
  styleChecklist(el);
  const lists=el.querySelectorAll<HTMLUListElement>('ul[data-sticky-checklist]');
  const lastList=lists[lists.length-1];
  const text=lastList?.querySelector<HTMLElement>('li:last-child [data-sticky-check-text]');
  if(text)placeCaret(text);
  save();
 };
 const prepareNoteReference=()=>{const el=editor.current;const selection=window.getSelection();referenceRange.current=null;if(!el||!selection||!selection.rangeCount)return '';const range=selection.getRangeAt(0);if(!el.contains(range.commonAncestorContainer))return '';referenceRange.current=range.cloneRange();return selection.toString().trim();};
 const actions:StickyEditorActions={format:(a)=>{if(a==='bold')command('bold');else if(a==='italic')command('italic');else if(a==='underline')command('underline');else if(a==='undo')command('undo');else if(a==='redo')command('redo');else if(a==='bullet')insertBullet();else if(a==='indent')command('indent');else if(a==='outdent')command('outdent');else if(a==='checklist')insertChecklist();},prepareNoteReference,insertNoteLink:(id,title,type='note')=>{const el=editor.current;if(!el)return;const safe=title.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));const range=referenceRange.current;const selectedText=range?.toString()||'';const anchor=document.createElement('a');anchor.href='#anotado-reference-'+type+'-'+id;anchor.dataset.stickyReferenceId=id;anchor.dataset.stickyReferenceType=type;anchor.textContent=selectedText||title;anchor.style.cssText='color:#80634f;text-decoration:underline;text-decoration-color:#b69b83;cursor:pointer';el.focus();if(range&&el.contains(range.commonAncestorContainer)){range.deleteContents();range.insertNode(anchor);range.setStartAfter(anchor);range.collapse(true);const sel=window.getSelection();sel?.removeAllRanges();sel?.addRange(range);}else{document.execCommand('insertHTML',false,`<a href="#anotado-reference-${type}-${id}" data-sticky-reference-id="${id}" data-sticky-reference-type="${type}" style="color:#80634f;text-decoration:underline;text-decoration-color:#b69b83;cursor:pointer">${safe}</a>`);}referenceRange.current=null;save();}};
 useEffect(()=>{registerEditorActions?.(note.id,actions);return()=>registerEditorActions?.(note.id,null);});
 const keyDown=(e:React.KeyboardEvent<HTMLDivElement>)=>{
  if(e.key==='Tab'){e.preventDefault();command(e.shiftKey?'outdent':'indent');return;}
  if(e.key!=='Enter'||e.shiftKey)return;
  const el=editor.current;const selection=window.getSelection();
  if(!el||!selection?.rangeCount)return;
  const range=selection.getRangeAt(0);if(!el.contains(range.commonAncestorContainer))return;
  const node=range.startContainer;const anchor=node instanceof Element?node:node.parentElement;
  const item=anchor?.closest('li');if(!item)return;
  const checklist=item.closest('ul[data-sticky-checklist]');
  const bullets=item.closest('ul.sticky-bullet-list');
  if(!checklist&&!bullets)return;
  e.preventDefault();
  const next=document.createElement('li');
  if(checklist){
   next.innerHTML='<label style="display:inline-flex;align-items:center;justify-content:center;flex:0 0 14px;margin:0;padding:0;line-height:1"><input type="checkbox" aria-label="Marcar item como concluído" style="width:14px;height:14px;margin:0;padding:0;vertical-align:middle;flex:0 0 14px;accent-color:#eab308"></label><div style="flex:1 1 auto;min-width:0;margin:0;padding:0;line-height:1.45"><p style="margin:0;padding:0;line-height:1.45"><span data-sticky-check-text="true"><br></span></p></div>';
  }else{next.innerHTML='<br>';next.style.listStyleType='disc';}
  item.insertAdjacentElement('afterend',next);
  styleChecklist(el);
  const caretTarget=checklist?next.querySelector<HTMLElement>('[data-sticky-check-text]'):next;
  if(caretTarget)placeCaret(caretTarget);
  save();
 };
 const click=(e:React.MouseEvent<HTMLDivElement>)=>{const t=e.target as HTMLElement;if(t instanceof HTMLInputElement&&t.type==='checkbox'){const checked=t.checked;t.toggleAttribute('checked',checked);t.checked=checked;const item=t.closest('li');if(item){item.dataset.checked=String(checked);const text=item.querySelector<HTMLElement>('[data-sticky-check-text]');if(text)Object.assign(text.style,{textDecorationLine:'none',textDecoration:'none',opacity:'1'});}requestAnimationFrame(save);}const a=t.closest('a[data-sticky-reference-id]') as HTMLAnchorElement|null;if(a&&e.ctrlKey){e.preventDefault();const id=a.dataset.stickyReferenceId;const type=(a.dataset.stickyReferenceType||'note') as 'note'|'sticky'|'diary';if(id)onOpenLinkedNote?.(id,type);}};
 const dragStart=(e:React.PointerEvent<HTMLDivElement>)=>{if(e.button!==0&&e.pointerType==='mouse')return;e.stopPropagation();onSelect(note.id);const sx=e.clientX,sy=e.clientY,px=note.position_x,py=note.position_y;let x=px,y=py,moved=false;setDrag(true);const move=(v:PointerEvent)=>{if(Math.abs(v.clientX-sx)>2||Math.abs(v.clientY-sy)>2)moved=true;x=Math.max(12,Math.round(px+v.clientX-sx));y=Math.max(12,Math.round(py+v.clientY-sy));onMoveLive(note.id,x,y);};const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);setDrag(false);if(moved)onMoveEnd(note.id,x,y);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);};
 const resizeStart=(e:React.PointerEvent<HTMLDivElement>)=>{if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();e.stopPropagation();onSelect(note.id);const sx=e.clientX,sw=note.width_px;let w=sw,changed=false;setResize(true);const move=(v:PointerEvent)=>{const n=Math.max(STICKY_MIN_WIDTH,Math.min(STICKY_MAX_WIDTH,Math.round(sw+v.clientX-sx)));if(n!==w){w=n;changed=true;onResizeLive(note.id,w);}};const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);setResize(false);if(changed)onResizeEnd(note.id,w);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);};
 return <div id={`sticky-note-${note.id}`} data-sticky-note-id={note.id} onContextMenu={e=>{e.preventDefault();e.stopPropagation();onSelect(note.id);onContextMenu?.(note,e.clientX,e.clientY);}} onPointerDown={()=>onSelect(note.id)} style={{position:'absolute',left:note.position_x,top:note.position_y,width:note.width_px,zIndex:note.z_index}} className={`group rounded-xl border transition-shadow duration-150 ${colors.cardClass} ${drag||resize?'shadow-2xl ring-2 ring-[#68594d]/45':isSelected?'shadow-lg ring-2 ring-[#68594d]/35':'shadow-[0_6px_18px_-6px_rgba(40,30,20,0.16)] dark:shadow-[0_8px_22px_-6px_rgba(0,0,0,0.65)] hover:shadow-md'}`}>
 <div onPointerDown={dragStart} className={`flex items-center gap-1.5 px-2.5 py-1.5 border-b rounded-t-xl cursor-grab active:cursor-grabbing touch-none select-none ${colors.headerClass}`}><GripHorizontal className={`w-3.5 h-3.5 shrink-0 opacity-45 ${colors.textClass}`}/><input value={note.title} onPointerDown={e=>{e.stopPropagation();onSelect(note.id);}} onChange={e=>onChangeTitle(note.id,e.target.value)} placeholder="Título..." aria-label="Título do Stick" className={`flex-1 min-w-0 bg-transparent text-[15px] font-semibold focus:outline-none placeholder:opacity-50 ${colors.textClass}`}/><button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onOpenReminder?.(note);}} className={`relative p-1 rounded-md opacity-35 hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-[#8d725d]/10 ${hasReminder?'opacity-100 text-[#b4533c] dark:text-[#f08a72]':colors.mutedTextClass}`} title={hasReminder?'Gerenciar lembretes deste Stick':'Configurar lembrete'} aria-label="Configurar lembrete"><AlarmClock className="w-3.5 h-3.5"/>{hasReminder&&<span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-[#c34f3c] ring-1 ring-white dark:ring-[#222]"/>}</button><button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDelete(note.id);}} className={`p-1 rounded-md opacity-25 hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-red-500/15 ${colors.mutedTextClass}`} title="Excluir Stick" aria-label="Excluir Stick"><Trash2 className="w-3.5 h-3.5"/></button></div>
 <div className="px-3 py-2.5"><div ref={editor} contentEditable suppressContentEditableWarning onFocus={()=>onSelect(note.id)} onInput={save} onKeyDown={keyDown} onClick={click} data-placeholder="Escreva aqui..." className={`sticky-rich-editor w-full min-h-[72px] break-words text-[13.5px] leading-[1.55] focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:opacity-40 ${colors.textClass}`}/></div>
 <div onPointerDown={resizeStart} role="separator" aria-orientation="vertical" aria-label="Ajustar largura da nota adesiva" title="Arraste para ajustar a largura" className="absolute top-2 bottom-2 -right-1.5 w-3 cursor-ew-resize touch-none flex items-center justify-center group/resize z-10"><span className={`w-1 h-8 rounded-full transition-opacity ${resize?'opacity-100 bg-[#68594d]':'opacity-0 group-hover:opacity-60 group-hover/resize:opacity-100 bg-black/25'}`}/></div></div>;
}