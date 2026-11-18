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
  Array.from(list.children).forEach(child=>{
   if(!(child instanceof HTMLLIElement))return;
   const item=child;
   let label=item.querySelector<HTMLElement>(':scope > label');
   let checkbox=label?.querySelector<HTMLInputElement>('input[type="checkbox"]')||null;
   if(!label){
    label=document.createElement('label');
    checkbox=item.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if(checkbox)checkbox.replaceWith(label);
    item.insertBefore(label,item.firstChild);
   }
   if(!checkbox){
    checkbox=document.createElement('input');
    checkbox.type='checkbox';
    checkbox.setAttribute('aria-label','Marcar item como concluído');
   }
   if(checkbox.parentElement!==label)label.appendChild(checkbox);
   label.contentEditable='false';
   checkbox.contentEditable='false';
   checkbox.tabIndex=-1;

   // Canonical markup mirrors the Notes TaskItem node view:
   // LI > LABEL(INPUT) + DIV(P(text)).
   let content=item.querySelector<HTMLElement>(':scope > div');
   if(!content){
    content=document.createElement('div');
    const legacyText=item.querySelector<HTMLElement>(':scope > [data-sticky-check-text]');
    if(legacyText){
     const paragraph=document.createElement('p');
     while(legacyText.firstChild)paragraph.appendChild(legacyText.firstChild);
     legacyText.replaceWith(content);
     content.appendChild(paragraph);
    }else{
     const paragraph=document.createElement('p');
     Array.from(item.childNodes).forEach(node=>{
      if(node===label||node instanceof HTMLUListElement)return;
      paragraph.appendChild(node);
     });
     content.appendChild(paragraph);
    }
    item.insertBefore(content,Array.from(item.children).find(el=>el instanceof HTMLUListElement)||null);
   }
   if(!content.querySelector(':scope > p')){
    const paragraph=document.createElement('p');
    while(content.firstChild)paragraph.appendChild(content.firstChild);
    content.appendChild(paragraph);
   }
   const paragraph=content.querySelector<HTMLElement>(':scope > p');
   if(paragraph&&!paragraph.childNodes.length)paragraph.innerHTML='<br>';

   const nested=Array.from(content.children).filter(el=>el instanceof HTMLUListElement);
   Object.assign(item.style,{display:'flex',alignItems:'flex-start',gap:'0.45rem',fontSize:'14px',listStyle:'none',margin:'0 0 0.075rem',padding:'0',lineHeight:'1.45'});
   Object.assign(label.style,{display:'inline-flex',alignItems:'center',justifyContent:'center',flex:'0 0 14px',width:'14px',height:'14px',margin:'0.15rem 0 0',padding:'0',lineHeight:'1',userSelect:'none',WebkitUserSelect:'none',touchAction:'manipulation'});
   Object.assign(checkbox.style,{appearance:'none',width:'14px',height:'14px',margin:'0',padding:'0',verticalAlign:'middle',flex:'0 0 14px',accentColor:'#eab308',borderRadius:'9999px'});
   Object.assign(content.style,{display:'block',flex:'1 1 auto',minWidth:'0',margin:'0',padding:'0',lineHeight:'1.45',outline:'none'});
   if(paragraph)Object.assign(paragraph.style,{margin:'0',padding:'0',lineHeight:'1.45',fontSize:'14px'});
   const checked=checkbox.checked||checkbox.hasAttribute('checked')||item.dataset.checked==='true';
   checkbox.checked=checked;
   if(checked){checkbox.setAttribute('checked','');item.dataset.checked='true';}
   else{checkbox.removeAttribute('checked');item.dataset.checked='false';}
   nested.forEach(list=>Object.assign((list as HTMLElement).style,{display:'block',margin:'0.05rem 0 0 0',paddingLeft:'0'}));
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
  li.innerHTML='<label contenteditable="false"><input type="checkbox" aria-label="Marcar item como concluído"></label><div><p><br></p></div>';
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
  const kind:'bullet'|'checklist'|null=list?.matches('ul[data-sticky-checklist]')?'checklist':list?.matches('ul.sticky-bullet-list')?'bullet':null;
  return {el,selection,range,anchor,item,list,kind};
 };
 const setCaretInItem=(item:HTMLLIElement,kind:'bullet'|'checklist')=>{
  const target=kind==='checklist'?(item.querySelector(':scope > div > p') as HTMLElement|null):item;
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
 const changeListLevel=(item:HTMLLIElement,list:HTMLUListElement,kind:'bullet'|'checklist',direction:'in'|'out')=>{
  if(direction==='in'){
   // Each Tab adds exactly one nesting level relative to the previous item.
   // This remains available at every depth; only an item without a previous
   // sibling at its current level cannot be indented.
   const previous=item.previousElementSibling as HTMLLIElement|null;
   if(!previous||previous.parentElement!==list)return;
   const previousContent=kind==='checklist'
    ?previous.querySelector<HTMLElement>(':scope > div')
    :previous;
   if(!previousContent)return;
   let nested=Array.from(previousContent.children).find(child=>child instanceof HTMLUListElement&&(
    kind==='checklist'?child.matches('ul[data-sticky-checklist]'):child.matches('ul.sticky-bullet-list')
   )) as HTMLUListElement|undefined;
   if(!nested){
    nested=document.createElement('ul');
    if(kind==='checklist'){
     nested.setAttribute('data-sticky-checklist','true');
     nested.style.cssText='list-style:none;padding-left:0;margin:0';
    }else{
     nested.className='sticky-bullet-list';
     nested.style.cssText='list-style-type:disc;padding-left:1.5em;margin:0.15em 0';
    }
    previousContent.appendChild(nested);
   }
   nested.appendChild(item);
  }else{
   const parentContent=list.parentElement;
   const parentItem=parentContent instanceof HTMLDivElement?parentContent.parentElement:parentContent;
   const outerList=parentItem?.parentElement;
   if(!(parentItem instanceof HTMLLIElement)||!(outerList instanceof HTMLUListElement))return;
   parentItem.insertAdjacentElement('afterend',item);
   if(!list.querySelector(':scope > li'))list.remove();
  }
 };
 const paste=(e:React.ClipboardEvent<HTMLDivElement>)=>{
  const el=editor.current;
  if(!el)return;
  // Always paste plain text in Sticky Notes. Ignore clipboard HTML so copied
  // background colors, font styles, paragraph wrappers and list markup do
  // not leak from the source Stick into the destination Stick.
  e.preventDefault();
  const plain=e.clipboardData.getData('text/plain');
  const html=e.clipboardData.getData('text/html');
  const fallback=html
   ?new DOMParser().parseFromString(html,'text/html').body.textContent||''
   :'';
  const value=(plain||fallback).replace(/\\r\\n?/g,'\\n');
  if(!value)return;

  const ctx=getListContext();
  const host=ctx?.kind==='checklist'&&ctx.item
   ?ctx.item.querySelector<HTMLElement>(':scope > div')
   :null;
  const selection=window.getSelection();
  let range=selection?.rangeCount?selection.getRangeAt(0):null;
  if(host&&(!range||!host.contains(range.startContainer))){
   range=document.createRange();
   range.selectNodeContents(host);
   range.collapse(false);
  }else if(!range||!el.contains(range.commonAncestorContainer)){
   range=document.createRange();
   range.selectNodeContents(el);
   range.collapse(false);
  }
  if(!range)return;

  range.deleteContents();
  const fragment=document.createDocumentFragment();
  const lines=value.split('\\n');
  lines.forEach((line,index)=>{
   if(index)fragment.appendChild(document.createElement('br'));
   if(line)fragment.appendChild(document.createTextNode(line));
  });
  const last=fragment.lastChild;
  range.insertNode(fragment);
  if(last){
   range.setStartAfter(last);
   range.collapse(true);
   selection?.removeAllRanges();
   selection?.addRange(range);
  }
  save();
 };
 const keyDown=(e:React.KeyboardEvent<HTMLDivElement>)=>{
  if(e.key==='Tab'){
   const ctx=getListContext();
   if(ctx?.item&&ctx.kind&&ctx.list instanceof HTMLUListElement){
    e.preventDefault();
    const selection=window.getSelection();
    const activeRange=selection?.rangeCount?selection.getRangeAt(0):null;
    const checklistContent=ctx.kind==='checklist'
     ?(ctx.item.querySelector(':scope > div') as HTMLElement|null)
     :null;
    const activeNode=activeRange?.startContainer;
    const activeElement=activeNode instanceof Element?activeNode:activeNode?.parentElement;
    const activeParagraph=activeElement?.closest('p');
    const textHost=ctx.kind==='checklist'
     ?(activeParagraph&&checklistContent?.contains(activeParagraph)?activeParagraph:checklistContent?.querySelector(':scope > p')||checklistContent)
     :ctx.item;
    // Save the caret as a character offset, not a DOM Range: moving an LI
    // detaches its nodes and can collapse a cloned Range to the previous line.
    let caretOffset=0;
    if(activeRange&&textHost&&textHost.contains(activeRange.startContainer)){
     const prefix=document.createRange();
     prefix.selectNodeContents(textHost);
     try{prefix.setEnd(activeRange.startContainer,activeRange.startOffset);caretOffset=prefix.toString().length;}catch{caretOffset=(textHost.textContent||'').length;}
    }
    changeListLevel(ctx.item,ctx.list,ctx.kind,e.shiftKey?'out':'in');
    styleChecklist(ctx.el);
    if(textHost&&selection){
     const walker=document.createTreeWalker(textHost,NodeFilter.SHOW_TEXT);
     let remaining=caretOffset;let textNode:Text|null=null;let node:Node|null;
     while((node=walker.nextNode())){
      const current=node as Text;
      if(remaining<=current.length){textNode=current;break;}
      remaining-=current.length;
     }
     const restored=document.createRange();
     if(textNode)restored.setStart(textNode,Math.min(remaining,textNode.length));
     else if(textHost.firstChild)restored.setStartBefore(textHost.firstChild);
     else restored.selectNodeContents(textHost);
     restored.collapse(true);
     selection.removeAllRanges();selection.addRange(restored);
    }
    save();return;
   }
   e.preventDefault();command(e.shiftKey?'outdent':'indent');return;
  }
  if(e.key!=='Enter'&&e.key!=='Backspace')return;
  const ctx=getListContext();if(!ctx?.item||!ctx.kind||!ctx.list)return;
  const {el,range,item,list,kind}=ctx;
  const textHost=kind==='checklist'?(item.querySelector(':scope > div') as HTMLElement|null):(item as HTMLElement);
  if(!textHost)return;
  const caret=document.createRange();caret.selectNodeContents(textHost);caret.setEnd(range.startContainer,range.startOffset);
  const before=caret.toString();
  const atStart=before.length===0;
  const ownText=kind==='checklist'
   ?Array.from(textHost.children).filter(child=>child instanceof HTMLParagraphElement).map(child=>child.textContent||'').join('')
   :(textHost.textContent||'');
  const empty=!ownText.trim();
  const moveItemOutOfList=(paragraph:HTMLParagraphElement)=>{
   // Replace this list item exactly where it is. Split the surrounding list
   // into before/after lists so Backspace never jumps to another line/item.
   const parent=list.parentNode;
   if(!parent)return;
   const items=Array.from(list.children);
   const index=items.indexOf(item);
   const beforeItems=items.slice(0,index);
   const afterItems=items.slice(index+1);
   const makeSiblingList=(children:Element[])=>{
    const clone=list.cloneNode(false) as HTMLUListElement;
    children.forEach(child=>clone.appendChild(child));
    return clone;
   };
   const beforeList=beforeItems.length?makeSiblingList(beforeItems):null;
   const afterList=afterItems.length?makeSiblingList(afterItems):null;
   if(beforeList)parent.insertBefore(beforeList,list);
   parent.insertBefore(paragraph,list);
   if(afterList)parent.insertBefore(afterList,list);
   list.remove();
  };
  if(e.key==='Backspace'&&atStart){
   e.preventDefault();
   const paragraph=document.createElement('p');
   paragraph.style.cssText='margin:0;padding:0;line-height:1.45';
   const nestedList=kind==='checklist'
    ?item.querySelector<HTMLUListElement>(':scope > div > ul[data-sticky-checklist]')||undefined
    :Array.from(item.children).find(child=>child instanceof HTMLUListElement) as HTMLUListElement|undefined;
   if(kind==='checklist'){
    const content=item.querySelector<HTMLElement>(':scope > div');
    if(content){
     Array.from(content.childNodes).forEach(node=>{
      if(node===nestedList)return;
      if(node instanceof HTMLParagraphElement){
       while(node.firstChild)paragraph.appendChild(node.firstChild);
      }else{
       paragraph.appendChild(node);
      }
     });
    }
   }else{
    Array.from(item.childNodes).forEach(node=>{if(node!==nestedList)paragraph.appendChild(node);});
   }
   if(!paragraph.childNodes.length)paragraph.innerHTML='<br>';
   moveItemOutOfList(paragraph);
   if(nestedList)paragraph.insertAdjacentElement('afterend',nestedList);
   placeCaretStart(paragraph);
   save();return;
  }
  if(e.key==='Enter'){
   e.preventDefault();
   if(empty){
    // Match the Notes editor: Enter on an empty nested task lifts it one level;
    // an empty top-level task exits the checklist into a normal paragraph.
    if(kind==='checklist'&&list instanceof HTMLUListElement&&list.parentElement instanceof HTMLDivElement&&list.parentElement.parentElement instanceof HTMLLIElement){
     changeListLevel(item,list,kind,'out');
     const content=item.querySelector<HTMLElement>(':scope > div > p');
     if(content)placeCaretStart(content);
     save();return;
    }
    const paragraph=document.createElement('p');paragraph.innerHTML='<br>';paragraph.style.cssText='margin:0;padding:0;line-height:1.45';
    moveItemOutOfList(paragraph);placeCaret(paragraph);save();return;
   }
   const activeSelection=window.getSelection();
   const workingRange=range.cloneRange();
   if(!workingRange.collapsed)workingRange.deleteContents();

   const currentBlock=(workingRange.startContainer instanceof Element?workingRange.startContainer:workingRange.startContainer.parentElement)?.closest('p');
   const splitBlock=currentBlock&&textHost.contains(currentBlock)?currentBlock:textHost;
   const tail=document.createRange();
   tail.setStart(workingRange.startContainer,workingRange.startOffset);
   tail.setEnd(splitBlock,splitBlock.childNodes.length);
   const trailing=tail.extractContents();

   // Move every later paragraph in the current checklist item's content area
   // into the next item's paragraph, preserving the checkbox/text structure.
   const followingBlocks:Node[]=[];
   let sibling=splitBlock.nextSibling;
   while(sibling){
    const nextSibling=sibling.nextSibling;
    followingBlocks.push(sibling);
    sibling=nextSibling;
   }
   followingBlocks.forEach(node=>node.remove());

   const next=makeListItem(kind);
   const nextParagraph=kind==='checklist'
    ?(next.querySelector(':scope > div > p') as HTMLElement|null)
    :next;
   if(nextParagraph){
    nextParagraph.replaceChildren();
    const appendInline=(source:ParentNode)=>{
     Array.from(source.childNodes).forEach(node=>{
      if(node instanceof HTMLParagraphElement||node instanceof HTMLDivElement){
       while(node.firstChild)nextParagraph.appendChild(node.firstChild);
      }else nextParagraph.appendChild(node);
     });
    };
    appendInline(trailing);
    followingBlocks.forEach(node=>appendInline(node));
    if(!nextParagraph.childNodes.length)nextParagraph.innerHTML='<br>';
   }

   // Insert immediately after the current LI, then put the caret at the end
   // of the new item's own paragraph so typing starts beside its checkbox.
   list.insertBefore(next,item.nextSibling);
   styleChecklist(el);
   const caretTarget=kind==='checklist'
    ?(next.querySelector(':scope > div > p') as HTMLElement|null)
    :next;
   if(caretTarget){
    const nextRange=document.createRange();
    nextRange.selectNodeContents(caretTarget);
    nextRange.collapse(false);
    activeSelection?.removeAllRanges();
    activeSelection?.addRange(nextRange);
   }
   save();
  }
 };
 const click=(e:React.MouseEvent<HTMLDivElement>)=>{const t=e.target as HTMLElement;if(t instanceof HTMLInputElement&&t.type==='checkbox'){e.preventDefault();e.stopPropagation();const checked=!t.checked;t.checked=checked;t.toggleAttribute('checked',checked);const item=t.closest('li');if(item)item.dataset.checked=String(checked);requestAnimationFrame(save);return;}const a=t.closest('a[data-sticky-reference-id]') as HTMLAnchorElement|null;if(a&&e.ctrlKey){e.preventDefault();const id=a.dataset.stickyReferenceId;const type=(a.dataset.stickyReferenceType||'note') as 'note'|'sticky'|'diary';if(id)onOpenLinkedNote?.(id,type);}};
 const dragStart=(e:React.PointerEvent<HTMLDivElement>)=>{if(e.button!==0&&e.pointerType==='mouse')return;e.stopPropagation();onSelect(note.id);const sx=e.clientX,sy=e.clientY,px=note.position_x,py=note.position_y;let x=px,y=py,moved=false;setDrag(true);const move=(v:PointerEvent)=>{if(Math.abs(v.clientX-sx)>2||Math.abs(v.clientY-sy)>2)moved=true;x=Math.max(12,Math.round(px+v.clientX-sx));y=Math.max(12,Math.round(py+v.clientY-sy));onMoveLive(note.id,x,y);};const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);setDrag(false);if(moved)onMoveEnd(note.id,x,y);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);};
 const resizeStart=(e:React.PointerEvent<HTMLDivElement>)=>{if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();e.stopPropagation();onSelect(note.id);const sx=e.clientX,sw=note.width_px;let w=sw,changed=false;setResize(true);const move=(v:PointerEvent)=>{const n=Math.max(STICKY_MIN_WIDTH,Math.min(STICKY_MAX_WIDTH,Math.round(sw+v.clientX-sx)));if(n!==w){w=n;changed=true;onResizeLive(note.id,w);}};const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);setResize(false);if(changed)onResizeEnd(note.id,w);};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);};
 return <div id={`sticky-note-${note.id}`} data-sticky-note-id={note.id} onContextMenu={e=>{e.preventDefault();e.stopPropagation();onSelect(note.id);onContextMenu?.(note,e.clientX,e.clientY);}} onPointerDown={()=>onSelect(note.id)} style={{position:'absolute',left:note.position_x,top:note.position_y,width:note.width_px,zIndex:note.z_index}} className={`group rounded-xl border transition-shadow duration-150 ${colors.cardClass} ${drag||resize?'shadow-2xl ring-2 ring-[#68594d]/45':isSelected?'shadow-lg ring-2 ring-[#68594d]/35':'shadow-[0_6px_18px_-6px_rgba(40,30,20,0.16)] dark:shadow-[0_8px_22px_-6px_rgba(0,0,0,0.65)] hover:shadow-md'}`}>
 <div onPointerDown={dragStart} className={`flex items-center gap-1.5 px-2.5 py-1.5 border-b rounded-t-xl cursor-grab active:cursor-grabbing touch-none select-none ${colors.headerClass}`}><GripHorizontal className={`w-3.5 h-3.5 shrink-0 opacity-45 ${colors.textClass}`}/><input value={note.title} onPointerDown={e=>{e.stopPropagation();onSelect(note.id);}} onChange={e=>onChangeTitle(note.id,e.target.value)} placeholder="Título..." aria-label="Título do Stick" className={`flex-1 min-w-0 bg-transparent text-[15px] font-semibold focus:outline-none placeholder:opacity-50 ${colors.textClass}`}/><button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onOpenReminder?.(note);}} className={`relative p-1 rounded-md opacity-35 hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-[#8d725d]/10 ${hasReminder?'opacity-100 text-[#b4533c] dark:text-[#f08a72]':colors.mutedTextClass}`} title={hasReminder?'Gerenciar lembretes deste Stick':'Configurar lembrete'} aria-label="Configurar lembrete"><AlarmClock className="w-3.5 h-3.5"/>{hasReminder&&<span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-[#c34f3c] ring-1 ring-white dark:ring-[#222]"/>}</button><button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDelete(note.id);}} className={`p-1 rounded-md opacity-25 hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-red-500/15 ${colors.mutedTextClass}`} title="Excluir Stick" aria-label="Excluir Stick"><Trash2 className="w-3.5 h-3.5"/></button></div>
 <div className="px-3 py-2.5"><div ref={editor} contentEditable suppressContentEditableWarning onFocus={()=>onSelect(note.id)} onInput={save} onKeyDown={keyDown} onPaste={paste} onClick={click} onMouseDown={e=>{const target=e.target as HTMLElement;if(target instanceof HTMLInputElement&&target.type==='checkbox'){e.preventDefault();e.stopPropagation();}}} data-placeholder="Escreva aqui..." className={`sticky-rich-editor w-full min-h-[72px] break-words text-[13.5px] leading-[1.55] focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:opacity-40 ${colors.textClass}`}/></div>
 <div onPointerDown={resizeStart} role="separator" aria-orientation="vertical" aria-label="Ajustar largura da nota adesiva" title="Arraste para ajustar a largura" className="absolute top-2 bottom-2 -right-1.5 w-3 cursor-ew-resize touch-none flex items-center justify-center group/resize z-10"><span className={`w-1 h-8 rounded-full transition-opacity ${resize?'opacity-100 bg-[#68594d]':'opacity-0 group-hover:opacity-60 group-hover/resize:opacity-100 bg-black/25'}`}/></div></div>;
}