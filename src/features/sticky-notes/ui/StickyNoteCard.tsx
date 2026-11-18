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
 const placeCaretStart=(target:HTMLElement)=>{const range=document.createRange();range.selectNodeContents(target);range.collapse(true);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);};
 const makeChecklistItem=()=>{
  const li=document.createElement('li');
  li.innerHTML='<label><input type="checkbox" aria-label="Marcar item como concluído"></label><div><p><span data-sticky-check-text="true"><br></span></p></div>';
  return li;
 };
 const makeListItem=(kind:'bullet'|'checklist')=>{
  if(kind==='checklist')return makeChecklistItem();
  const li=document.createElement('li');li.innerHTML='<br>';li.style.listStyleType='disc';return li;
 };
 const getListContext=()=>{
  const el=editor.current;const selection=window.getSelection();
  if(!el||!selection?.rangeCount)return null;
  const range=selection.getRangeAt(0);
  if(!el.contains(range.commonAncestorContainer))return null;
  const node=range.startContainer;const anchor=node instanceof Element?node:node.parentElement;
  const item=anchor?.closest('li');
  const list=item?.parentElement;
  const kind=list?.matches('ul[data-sticky-checklist]')?'checklist':list?.matches('ul.sticky-bullet-list')?'bullet':null;
  return {el,selection,range,anchor,item,list,kind};
 };
 const setCaretInItem=(item:HTMLLIElement,kind:'bullet'|'checklist')=>{
  const target=kind==='checklist'?(item.querySelector('[data-sticky-check-text]') as HTMLElement|null):item;
  if(target)placeCaret(target);
 };
 const insertList=(kind:'bullet'|'checklist')=>{
  const el=editor.current;if(!el)return;el.focus();
  const selection=window.getSelection();
  let range=selection&&selection.rangeCount?selection.getRangeAt(0):null;
  if(!range||!el.contains(range.commonAncestorContainer)){
   range=document.createRange();range.selectNodeContents(el);range.collapse(false);
  }
  const node=range.startContainer;const anchor=node instanceof Element?node:node.parentElement;
  const existingItem=anchor?.closest('li');
  const existingList=existingItem?.parentElement;
  if(existingList&&el.contains(existingList)&&((kind==='checklist'&&existingList.matches('ul[data-sticky-checklist]'))||(kind==='bullet'&&existingList.matches('ul.sticky-bullet-list')))){
   const item=makeListItem(kind);existingItem.insertAdjacentElement('afterend',item);
   styleChecklist(el);setCaretInItem(item,kind);save();return;
  }
  // If the cursor is in a text line, split that line at the cursor and put
  // the new list on the following line, preserving text on both sides.
  let block=anchor?.closest('p,div');
  if(block===el)block=null;
  const list=document.createElement('ul');
  if(kind==='checklist'){list.setAttribute('data-sticky-checklist','true');list.style.cssText='list-style:none;padding-left:0;margin:0';}
  else{list.className='sticky-bullet-list';list.style.cssText='list-style-type:disc;padding-left:1.5em;margin:0.15em 0';}
  const item=makeListItem(kind);list.appendChild(item);
  if(block&&el.contains(block)){
   const after=document.createRange();after.setStart(range.startContainer,range.startOffset);after.setEndAfter(block.lastChild||block);
   const trailing=after.extractContents();
   const trailingText=trailing.textContent||'';
   if(trailingText.trim()||trailing.childNodes.length){
    const nextBlock=document.createElement(block.tagName.toLowerCase()==='div'?'div':'p');
    nextBlock.appendChild(trailing);
    block.insertAdjacentElement('afterend',list);
    list.insertAdjacentElement('afterend',nextBlock);
   }else block.insertAdjacentElement('afterend',list);
   if(!block.textContent?.trim()&&!block.querySelector('img,a'))block.remove();
  }else{
   range.collapse(false);range.insertNode(list);
  }
  styleChecklist(el);setCaretInItem(item,kind);save();
 };
 const insertBullet=()=>insertList('bullet');
 const insertChecklist=()=>insertList('checklist');
 const prepareNoteReference=()=>{const el=editor.current;const selection=window.getSelection();referenceRange.current=null;if(!el||!selection||!selection.rangeCount)return '';const range=selection.getRangeAt(0);if(!el.contains(range.commonAncestorContainer))return '';referenceRange.current=range.cloneRange();return selection.toString().trim();};
 const actions:StickyEditorActions={format:(a)=>{if(a==='bold')command('bold');else if(a==='italic')command('italic');else if(a==='underline')command('underline');else if(a==='undo')command('undo');else if(a==='redo')command('redo');else if(a==='bullet')insertBullet();else if(a==='indent')command('indent');else if(a==='outdent')command('outdent');else if(a==='checklist')insertChecklist();},prepareNoteReference,insertNoteLink:(id,title,type='note')=>{const el=editor.current;if(!el)return;const safe=title.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));const range=referenceRange.current;const selectedText=range?.toString()||'';const anchor=document.createElement('a');anchor.href='#anotado-reference-'+type+'-'+id;anchor.dataset.stickyReferenceId=id;anchor.dataset.stickyReferenceType=type;anchor.textContent=selectedText||title;anchor.style.cssText='color:#80634f;text-decoration:underline;text-decoration-color:#b69b83;cursor:pointer';el.focus();if(range&&el.contains(range.commonAncestorContainer)){range.deleteContents();range.insertNode(anchor);range.setStartAfter(anchor);range.collapse(true);const sel=window.getSelection();sel?.removeAllRanges();sel?.addRange(range);}else{document.execCommand('insertHTML',false,`<a href="#anotado-reference-${type}-${id}" data-sticky-reference-id="${id}" data-sticky-reference-type="${type}" style="color:#80634f;text-decoration:underline;text-decoration-color:#b69b83;cursor:pointer">${safe}</a>`);}referenceRange.current=null;save();}};
 useEffect(()=>{registerEditorActions?.(note.id,actions);return()=>registerEditorActions?.(note.id,null);});
 const keyDown=(e:React.KeyboardEvent<HTMLDivElement>)=>{
  if(e.key==='Tab'){e.preventDefault();command(e.shiftKey?'outdent':'indent');return;}
  if(e.key!=='Enter'&&e.key!=='Backspace')return;
  const ctx=getListContext();if(!ctx?.item||!ctx.kind||!ctx.list)return;
  const {el,range,item,list,kind}=ctx;
  const textHost=kind==='checklist'?(item.querySelector('[data-sticky-check-text]') as HTMLElement|null):(item as HTMLElement);
  if(!textHost)return;
  const caret=document.createRange();caret.selectNodeContents(textHost);caret.setEnd(range.startContainer,range.startOffset);
  const before=caret.toString();
  const afterRange=document.createRange();afterRange.setStart(range.startContainer,range.startOffset);afterRange.setEnd(textHost,textHost.childNodes.length);
  const atStart=before.length===0;
  const empty=!(textHost.textContent||'').trim();
  if(e.key==='Backspace'&&atStart){
   e.preventDefault();
   const paragraph=document.createElement('p');
   paragraph.style.cssText='margin:0;padding:0;line-height:1.45';
   if(kind==='checklist'){
    const text=item.querySelector('[data-sticky-check-text]');
    if(text){while(text.firstChild)paragraph.appendChild(text.firstChild);}
   }else{while(item.firstChild)paragraph.appendChild(item.firstChild);}
   if(!paragraph.childNodes.length)paragraph.innerHTML='<br>';
   item.replaceWith(paragraph);
   if(!list.querySelector('li'))list.remove();
   placeCaretStart(paragraph);
   save();return;
  }
  if(e.key==='Enter'){
   e.preventDefault();
   if(empty){
    const paragraph=document.createElement('p');paragraph.innerHTML='<br>';paragraph.style.cssText='margin:0;padding:0;line-height:1.45';
    item.replaceWith(paragraph);if(!list.querySelector('li'))list.remove();placeCaret(paragraph);save();return;
   }
   const next=makeListItem(kind);
   // Split the current line at the caret, retaining any text after it in the new item.
   const tail=document.createRange();tail.setStart(range.startContainer,range.startOffset);tail.setEnd(textHost,textHost.childNodes.length);
   const extracted=tail.extractContents();
   const nextHost=kind==='checklist'?(next.querySelector('[data-sticky-check-text]') as HTMLElement|null):next;
   if(nextHost){nextHost.innerHTML='';nextHost.appendChild(extracted);if(!nextHost.childNodes.length)nextHost.innerHTML='<br>';}
   item.insertAdjacentElement('afterend',next);
   styleChecklist(el);
   const nextCaret=kind==='checklist'?(next.querySelector('[data-sticky-check-text]') as HTMLElement|null):next;
   if(nextCaret)placeCaretStart(nextCaret);
   save();
  }
 };
 const click=(e:React.MouseEvent<HTMLDivElement>)=>{const t=e.target as HTMLElement;if(t instanceof HTMLInputElement&&t.type==='checkbox'){const checked=t.checked;t.toggleAttribute('checked',checked);t.checked=checked;const item=t.closest('li');if(item){item.dataset.checked=String(checked);const text=item.querySelector<HTMLElement>('[data-sticky-check-text]');if(text)Object.assign(text.style,{textDecorationLine:'none',textDecoration:'none',opacity:'1'});}requestAnimationFrame(save);}const a=t.closest('a[data-sticky-reference-id]') as HTMLAnchorElement|null;if(a&&e.ctrlKey){e.preventDefault();const id=a.dataset.stickyReferenceId;const type=(a.dataset.stickyReferenceType||'note') as 'note'|'sticky'|'diary';if(id)onOpenLinkedNote?.(id,type);}};
 const dragStart=(e:React.PointerEvent<HTMLDivElement>)=>{if(e.button!==0&&e.pointerType==='mouse')return;e.stopPropagation();onSelect(note.id);const sx=e.clientX,sy=e.clientY,px=note.position_x,py=note.position_y;let x=px,y=py,moved=false;setDrag(true);const move=(v:PointerEvent)=>{if(Math.abs(v.clientX-sx)>2||Math.abs(v.clientY-sy)>2)moved=true;x=Math.max(12,Math.round(px+v.clientX-sx));y=Math.max(12,Math.round(py+v.clientY-sy));onMoveLive(note.id,x,y);};const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);setDrag(false);if(moved)onMoveEnd(note.id,x,y);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);};
 const resizeStart=(e:React.PointerEvent<HTMLDivElement>)=>{if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();e.stopPropagation();onSelect(note.id);const sx=e.clientX,sw=note.width_px;let w=sw,changed=false;setResize(true);const move=(v:PointerEvent)=>{const n=Math.max(STICKY_MIN_WIDTH,Math.min(STICKY_MAX_WIDTH,Math.round(sw+v.clientX-sx)));if(n!==w){w=n;changed=true;onResizeLive(note.id,w);}};const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);setResize(false);if(changed)onResizeEnd(note.id,w);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);};
 return <div id={`sticky-note-${note.id}`} data-sticky-note-id={note.id} onContextMenu={e=>{e.preventDefault();e.stopPropagation();onSelect(note.id);onContextMenu?.(note,e.clientX,e.clientY);}} onPointerDown={()=>onSelect(note.id)} style={{position:'absolute',left:note.position_x,top:note.position_y,width:note.width_px,zIndex:note.z_index}} className={`group rounded-xl border transition-shadow duration-150 ${colors.cardClass} ${drag||resize?'shadow-2xl ring-2 ring-[#68594d]/45':isSelected?'shadow-lg ring-2 ring-[#68594d]/35':'shadow-[0_6px_18px_-6px_rgba(40,30,20,0.16)] dark:shadow-[0_8px_22px_-6px_rgba(0,0,0,0.65)] hover:shadow-md'}`}>
 <div onPointerDown={dragStart} className={`flex items-center gap-1.5 px-2.5 py-1.5 border-b rounded-t-xl cursor-grab active:cursor-grabbing touch-none select-none ${colors.headerClass}`}><GripHorizontal className={`w-3.5 h-3.5 shrink-0 opacity-45 ${colors.textClass}`}/><input value={note.title} onPointerDown={e=>{e.stopPropagation();onSelect(note.id);}} onChange={e=>onChangeTitle(note.id,e.target.value)} placeholder="Título..." aria-label="Título do Stick" className={`flex-1 min-w-0 bg-transparent text-[15px] font-semibold focus:outline-none placeholder:opacity-50 ${colors.textClass}`}/><button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onOpenReminder?.(note);}} className={`relative p-1 rounded-md opacity-35 hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-[#8d725d]/10 ${hasReminder?'opacity-100 text-[#b4533c] dark:text-[#f08a72]':colors.mutedTextClass}`} title={hasReminder?'Gerenciar lembretes deste Stick':'Configurar lembrete'} aria-label="Configurar lembrete"><AlarmClock className="w-3.5 h-3.5"/>{hasReminder&&<span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-[#c34f3c] ring-1 ring-white dark:ring-[#222]"/>}</button><button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDelete(note.id);}} className={`p-1 rounded-md opacity-25 hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-red-500/15 ${colors.mutedTextClass}`} title="Excluir Stick" aria-label="Excluir Stick"><Trash2 className="w-3.5 h-3.5"/></button></div>
 <div className="px-3 py-2.5"><div ref={editor} contentEditable suppressContentEditableWarning onFocus={()=>onSelect(note.id)} onInput={save} onKeyDown={keyDown} onClick={click} data-placeholder="Escreva aqui..." className={`sticky-rich-editor w-full min-h-[72px] break-words text-[13.5px] leading-[1.55] focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:opacity-40 ${colors.textClass}`}/></div>
 <div onPointerDown={resizeStart} role="separator" aria-orientation="vertical" aria-label="Ajustar largura da nota adesiva" title="Arraste para ajustar a largura" className="absolute top-2 bottom-2 -right-1.5 w-3 cursor-ew-resize touch-none flex items-center justify-center group/resize z-10"><span className={`w-1 h-8 rounded-full transition-opacity ${resize?'opacity-100 bg-[#68594d]':'opacity-0 group-hover:opacity-60 group-hover/resize:opacity-100 bg-black/25'}`}/></div></div>;
}