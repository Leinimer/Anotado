'use client';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AlarmClock,GripHorizontal,Trash2} from 'lucide-react';
import {STICKY_MAX_WIDTH,STICKY_MIN_WIDTH,StickyNote,getStickyColorTheme} from '../types';
export type StickyEditorAction='bold'|'italic'|'underline'|'undo'|'redo'|'bullet'|'checklist'|'outdent'|'indent';
export interface StickyEditorActions{format:(action:StickyEditorAction)=>void;prepareNoteReference:()=>string;insertNoteLink:(id:string,title:string,type?:'note'|'sticky'|'diary')=>void;}
interface SnapTarget{id:string;x:number;y:number;width:number;height:number;}
interface Props{snapTargets?:SnapTarget[];canvasZoom?:number;isPinchingRef?:React.RefObject<boolean>;note:StickyNote;isSelected:boolean;autoFocus?:boolean;onSelect:(id:string)=>void;onChangeTitle:(id:string,title:string)=>void;onChangeContent:(id:string,content:string)=>void;onChangeColor:(id:string,color:any)=>void;onMoveLive:(id:string,x:number,y:number)=>void;onMoveEnd:(id:string,x:number,y:number)=>void;onResizeLive:(id:string,width:number)=>void;onResizeEnd:(id:string,width:number)=>void;onDelete:(id:string)=>void;registerEditorActions?:(id:string,a:StickyEditorActions|null)=>void;onOpenLinkedNote?:(id:string,type:'note'|'sticky'|'diary')=>void;onPreviewLinkedNote?:(id:string,type:'note'|'sticky'|'diary',anchor:HTMLElement)=>void;hasReminder?:boolean;onOpenReminder?:(note:StickyNote)=>void;onContextMenu?:(note:StickyNote,x:number,y:number)=>void;}
const esc=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const looksLikeStickyMarkup=(value:string)=>/<\/?(?:p|br|div|ul|ol|li|strong|b|em|i|u|s|h[1-6]|blockquote|hr)\b[^>]*>/i.test(value);
const normalizePastedMarkup=(value:string)=>{
 const decoder=document.createElement('textarea');
 decoder.innerHTML=value;
 const decoded=decoder.value;
 const candidate=looksLikeStickyMarkup(decoded)?decoded:value;
 const bullet=candidate.match(/^\s*[•·]\s*(?=<p\b)/i);
 return bullet?'<ul class="sticky-bullet-list"><li>'+candidate.replace(/^\s*[•·]\s*/,'')+'</li></ul>':candidate;
};
const toHtml=(v:string)=>{
 if(!v)return '<p><br></p>';
 const normalized=normalizePastedMarkup(v);
 if(looksLikeStickyMarkup(normalized))return normalized;
 return v.split('\n').map(x=>'<p>'+(esc(x)||'<br>')+'</p>').join('');
};
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

export function StickyNoteCard({note,isSelected,autoFocus=false,snapTargets=[],canvasZoom=1,isPinchingRef,onSelect,onChangeTitle,onChangeContent,onMoveLive,onMoveEnd,onResizeLive,onResizeEnd,onDelete,registerEditorActions,onOpenLinkedNote,onPreviewLinkedNote,hasReminder=false,onOpenReminder,onContextMenu}:Props){
 const colors=getStickyColorTheme(note.color);const editor=useRef<HTMLDivElement>(null);const referenceRange=useRef<Range|null>(null);const pasteAsPlainText=useRef(false);
 type EditorHistoryEntry={html:string;caret:number};
 const history=useRef<{entries:EditorHistoryEntry[];index:number;restoring:boolean}>({entries:[],index:-1,restoring:false});const [drag,setDrag]=useState(false);const [resize,setResize]=useState(false);
 useLayoutEffect(()=>{const el=editor.current;if(el&&document.activeElement!==el&&!el.contains(document.activeElement)){const html=toHtml(note.content||'');const changed=el.innerHTML!==html;if(changed)el.innerHTML=html;styleChecklist(el);if(changed||history.current.index<0)history.current={entries:[{html:el.innerHTML,caret:0}],index:0,restoring:false};}},[note.content]);
 useEffect(()=>{if(autoFocus)editor.current?.focus();},[autoFocus]);
 const getCaretOffset=(el:HTMLElement)=>{
  const selection=window.getSelection();
  if(!selection?.rangeCount)return 0;
  const range=selection.getRangeAt(0);
  if(!el.contains(range.startContainer))return 0;
  const prefix=document.createRange();
  prefix.selectNodeContents(el);
  try{prefix.setEnd(range.startContainer,range.startOffset);return prefix.toString().length;}catch{return 0;}
 };
 const recordHistory=()=>{
  const el=editor.current;
  if(!el||history.current.restoring)return;
  const current=history.current;
  const html=el.innerHTML;
  if(current.index<0){current.entries=[{html,caret:getCaretOffset(el)}];current.index=0;return;}
  if(current.entries[current.index]?.html===html){
   current.entries[current.index]={html,caret:getCaretOffset(el)};
   return;
  }
  current.entries=current.entries.slice(0,current.index+1);
  current.entries.push({html,caret:getCaretOffset(el)});
  if(current.entries.length>150)current.entries.shift();
  current.index=current.entries.length-1;
 };
 const restoreCaret=(el:HTMLElement,offset:number)=>{
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  let remaining=Math.max(0,offset);
  let node:Node|null;
  let target:Text|null=null;
  while((node=walker.nextNode())){
   const text=node as Text;
   if(remaining<=text.length){target=text;break;}
   remaining-=text.length;
  }
  const range=document.createRange();
  if(target)range.setStart(target,Math.min(remaining,target.length));
  else{
   const paragraph=el.querySelector<HTMLElement>('p,div')||el;
   if(!paragraph.childNodes.length)paragraph.appendChild(document.createElement('br'));
   range.selectNodeContents(paragraph);
   range.collapse(true);
  }
  range.collapse(true);
  const selection=window.getSelection();
  selection?.removeAllRanges();selection?.addRange(range);
 };
 const moveHistory=(direction:'undo'|'redo')=>{
  const el=editor.current;
  if(!el)return;
  const current=history.current;
  if(current.index<0)recordHistory();
  const nextIndex=direction==='undo'?current.index-1:current.index+1;
  if(nextIndex<0||nextIndex>=current.entries.length)return;
  current.index=nextIndex;
  const entry=current.entries[nextIndex];
  current.restoring=true;
  el.innerHTML=entry.html;
  styleChecklist(el);
  restoreCaret(el,entry.caret);
  onChangeContent(note.id,el.innerHTML);
  requestAnimationFrame(()=>{history.current.restoring=false;});
 };
 const save=()=>{if(editor.current){styleChecklist(editor.current);recordHistory();onChangeContent(note.id,editor.current.innerHTML);}};
 const handleInput=(e:React.FormEvent<HTMLDivElement>)=>{
  const el=editor.current;
  const selection=window.getSelection();
  if(el&&selection?.rangeCount){
   const range=selection.getRangeAt(0);
   const node=range.startContainer;
   const active=node instanceof Element?node:node.parentElement;
   const paragraph=active?.closest('p');
   // Convert a standalone --- line only in regular text, never inside a list.
   // The separator is a block element, so it naturally spans the note's
   // available width and follows any later note resizing.
   if(paragraph&&el.contains(paragraph)&&!paragraph.closest('li')&&
      paragraph.textContent==='---'&&range.collapsed&&
      (node===paragraph||range.startOffset===(node.textContent||'').length)){
    e.preventDefault();
    const separator=document.createElement('hr');
    separator.style.cssText='display:block;width:100%;box-sizing:border-box;border:0;border-top:1px solid currentColor;opacity:.4;margin:8px 0';
    const nextParagraph=document.createElement('p');
    nextParagraph.innerHTML='<br>';
    paragraph.replaceWith(separator,nextParagraph);
    const nextRange=document.createRange();
    nextRange.setStart(nextParagraph,0);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    save();
    return;
   }
  }
  save();
 };
 const command=(cmd:string)=>{if(!editor.current)return;if(cmd==='undo'||cmd==='redo'){editor.current.focus();moveHistory(cmd);return;}editor.current.focus();document.execCommand(cmd,false);save();};
 const placeCaret=(target:HTMLElement)=>{
  const range=document.createRange();
  if(!target.childNodes.length)target.appendChild(document.createElement('br'));
  const hasOnlyBreak=target.childNodes.length===1&&target.firstChild instanceof HTMLBRElement;
  if(hasOnlyBreak){
   range.setStart(target,0);
   range.collapse(true);
  }else if(target.lastChild instanceof HTMLBRElement){
   range.setStartBefore(target.lastChild);
   range.collapse(true);
  }else{
   range.selectNodeContents(target);
   range.collapse(false);
  }
  const selection=window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
 };
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
 const insertList=(kind:'bullet'|'checklist',initialRange?:Range|null)=>{
  const el=editor.current;if(!el)return;
  const selection=window.getSelection();
  let range=initialRange&&el.contains(initialRange.commonAncestorContainer)
   ?initialRange.cloneRange()
   :(selection&&selection.rangeCount?selection.getRangeAt(0).cloneRange():null);
  el.focus({preventScroll:true});
  if(!range||!el.contains(range.commonAncestorContainer)){
   range=document.createRange();range.selectNodeContents(el);range.collapse(false);
  }
  const node=range.startContainer;const anchor=node instanceof Element?node:node.parentElement;
  const existingItem=anchor?.closest('li');
  const existingList=existingItem?.parentElement;
  if(existingList&&el.contains(existingList)&&((kind==='checklist'&&existingList.matches('ul[data-sticky-checklist]'))||(kind==='bullet'&&existingList.matches('ul.sticky-bullet-list')))){
   const item=makeListItem(kind);existingItem.insertAdjacentElement('afterend',item);
   save();setCaretInItem(item,kind);return;
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
  save();setCaretInItem(item,kind);
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
  e.preventDefault();
  const plain=e.clipboardData.getData('text/plain');
  const html=e.clipboardData.getData('text/html');
  const plainContainsMarkup=looksLikeStickyMarkup(plain);
  const clipboardHtml=html||(plainContainsMarkup?normalizePastedMarkup(plain):'');
  const usePlain=pasteAsPlainText.current||!clipboardHtml;
  pasteAsPlainText.current=false;
  const ctx=getListContext();
  const host=ctx?.kind==='checklist'&&ctx.item
   ?ctx.item.querySelector<HTMLElement>(':scope > div > p')
   :null;
  const selection=window.getSelection();
  let range=selection?.rangeCount?selection.getRangeAt(0):null;
  if(host&&(!range||!host.contains(range.startContainer))){
   range=document.createRange();range.selectNodeContents(host);range.collapse(false);
  }else if(!range||!el.contains(range.commonAncestorContainer)){
   range=document.createRange();range.selectNodeContents(el);range.collapse(false);
  }
  if(!range)return;

  let fragment:DocumentFragment;
  if(usePlain){
   const value=(plain||new DOMParser().parseFromString(clipboardHtml,'text/html').body.textContent||'').replace(/\r\n?/g,'\n');
   if(!value)return;
   fragment=document.createDocumentFragment();
   value.split('\n').forEach((line,index)=>{
    if(index)fragment.appendChild(document.createElement('br'));
    if(line)fragment.appendChild(document.createTextNode(line));
   });
  }else{
   const parsed=new DOMParser().parseFromString(clipboardHtml,'text/html');
   parsed.querySelectorAll('script,style,meta,link,iframe,object,embed,form,button,input,textarea,select').forEach(node=>node.remove());
   // Convert inline semantic styling to tags before removing all source colors,
   // backgrounds, fonts and classes.
   parsed.body.querySelectorAll<HTMLElement>('*').forEach(node=>{
    const style=node.getAttribute('style')||'';
    const weight=style.match(/font-weight\s*:\s*([^;]+)/i)?.[1]||'';
    const fontStyle=style.match(/font-style\s*:\s*([^;]+)/i)?.[1]||'';
    const decoration=style.match(/text-decoration(?:-line)?\s*:\s*([^;]+)/i)?.[1]||'';
    const wrappers:string[]=[];
    if(/bold|[6-9]00/i.test(weight))wrappers.push('strong');
    if(/italic|oblique/i.test(fontStyle))wrappers.push('em');
    if(/underline/i.test(decoration))wrappers.push('u');
    if(/line-through/i.test(decoration))wrappers.push('s');
    if(wrappers.length&&node.tagName==='SPAN'){
     let replacement:HTMLElement=node;
     wrappers.forEach(tag=>{
      const wrapper=document.createElement(tag);
      while(replacement.firstChild)wrapper.appendChild(replacement.firstChild);
      replacement.appendChild(wrapper);
     });
     node.replaceWith(...Array.from(replacement.childNodes));
    }
   });
   const allowed=new Set(['P','DIV','BR','STRONG','B','EM','I','U','S','STRIKE','DEL','SUB','SUP','UL','OL','LI','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','CODE','A','HR']);
   parsed.body.querySelectorAll<HTMLElement>('*').forEach(node=>{
    if(node.tagName==='DIV'){
     const p=document.createElement('p');
     while(node.firstChild)p.appendChild(node.firstChild);
     node.replaceWith(p);
     return;
    }
    if(!allowed.has(node.tagName)){
     node.replaceWith(...Array.from(node.childNodes));
     return;
    }
    const originalHref=node.tagName==='A'?node.getAttribute('href'):null;
    Array.from(node.attributes).forEach(attribute=>node.removeAttribute(attribute.name));
    if(node.tagName==='A'&&originalHref&&/^(https?:|mailto:)/i.test(originalHref)){
     node.setAttribute('href',originalHref);
     node.setAttribute('target','_blank');
     node.setAttribute('rel','noopener noreferrer');
    }
   });
   // Never import checkbox widgets or their non-editable wrappers from another editor.
   parsed.body.querySelectorAll('label').forEach(label=>label.replaceWith(...Array.from(label.childNodes)));
   fragment=document.createDocumentFragment();
   while(parsed.body.firstChild)fragment.appendChild(parsed.body.firstChild);
   if(host){
    // A checklist item has a single paragraph as its editable text host.
    // Keep pasted block breaks inside that paragraph without disturbing its
    // checkbox/list structure.
    const flattened=document.createDocumentFragment();
    const appendInline=(node:Node)=>{
     if(node instanceof HTMLBRElement){flattened.appendChild(document.createElement('br'));return;}
     if(node instanceof HTMLParagraphElement||node instanceof HTMLDivElement||
        /^H[1-6]$/.test((node as Element).tagName||'')){
      if(flattened.childNodes.length)flattened.appendChild(document.createElement('br'));
      Array.from(node.childNodes).forEach(appendInline);
      flattened.appendChild(document.createElement('br'));
      return;
     }
     if(node instanceof HTMLUListElement||node instanceof HTMLOListElement){
      Array.from(node.children).forEach(child=>{appendInline(child);flattened.appendChild(document.createElement('br'));});
      return;
     }
     if(node instanceof HTMLLIElement){Array.from(node.childNodes).forEach(appendInline);return;}
     flattened.appendChild(node.cloneNode(true));
    };
    Array.from(fragment.childNodes).forEach(appendInline);
    while(flattened.lastChild instanceof HTMLBRElement)flattened.removeChild(flattened.lastChild);
    fragment=flattened;
   }
  }
  range.deleteContents();
  const last=fragment.lastChild;
  range.insertNode(fragment);
  if(last){
   range.setStartAfter(last);range.collapse(true);
   selection?.removeAllRanges();selection?.addRange(range);
  }
  save();
 };
 const keyDown=(e:React.KeyboardEvent<HTMLDivElement>)=>{
  if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='z'){
   e.preventDefault();moveHistory(e.shiftKey?'redo':'undo');return;
  }
  if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='y'){
   e.preventDefault();moveHistory('redo');return;
  }
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='v')pasteAsPlainText.current=true;
  // When a selection crosses normal text and checklist rows, the browser
  // can delete the text while leaving the non-editable checkbox behind.
  // Remove only checklist rows crossed by a multi-block selection; ordinary
  // deletion inside one checklist paragraph remains native.
  if(e.key==='Backspace'||e.key==='Delete'){
   const selection=window.getSelection();
   const el=editor.current;
   if(selection?.rangeCount&&el){
    const selectedRange=selection.getRangeAt(0);
    if(!selectedRange.collapsed&&el.contains(selectedRange.commonAncestorContainer)){
     const intersectedItems=Array.from(el.querySelectorAll<HTMLLIElement>('ul[data-sticky-checklist] li'))
      .filter(item=>{
       const paragraph=item.querySelector<HTMLElement>(':scope > div > p');
       return Boolean(paragraph&&selectedRange.intersectsNode(paragraph));
      });
     const startParagraph=(selectedRange.startContainer instanceof Element
      ?selectedRange.startContainer
      :selectedRange.startContainer.parentElement)?.closest('p');
     const endParagraph=(selectedRange.endContainer instanceof Element
      ?selectedRange.endContainer
      :selectedRange.endContainer.parentElement)?.closest('p');
     const selectionIsInsideOneChecklistParagraph=Boolean(
      startParagraph&&startParagraph===endParagraph&&
      intersectedItems.some(item=>item.querySelector(':scope > div > p')===startParagraph)
     );
     if(intersectedItems.length&&(!selectionIsInsideOneChecklistParagraph||intersectedItems.length>1)){
      e.preventDefault();
      const deletionRange=selectedRange.cloneRange();
      deletionRange.deleteContents();
      intersectedItems.forEach(item=>item.isConnected&&item.remove());
      deletionRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(deletionRange);
      save();
      return;
     }
    }
   }
  }
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
  let before='';
  if(textHost.contains(range.startContainer)){
   const caret=document.createRange();caret.selectNodeContents(textHost);caret.setEnd(range.startContainer,range.startOffset);
   before=caret.toString();
  }
  const atStart=before.length===0;
  const ownText=kind==='checklist'
   ?Array.from(textHost.childNodes).filter(child=>!(child instanceof HTMLUListElement)).map(child=>child.textContent||'').join('')
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
     save();setCaretInItem(item,kind);return;
    }
    const paragraph=document.createElement('p');paragraph.innerHTML='<br>';paragraph.style.cssText='margin:0;padding:0;line-height:1.45';
    moveItemOutOfList(paragraph);save();placeCaret(paragraph);return;
   }
   // For checklist Enter, deliberately reuse the exact toolbar insertion
   // path with the captured selection range so creation, styling, persistence
   // and caret placement stay identical.
   if(kind==='checklist'){
    insertList('checklist',range);
    return;
   }

   const workingRange=range.cloneRange();
   if(!workingRange.collapsed)workingRange.deleteContents();

   const currentBlock=(workingRange.startContainer instanceof Element?workingRange.startContainer:workingRange.startContainer.parentElement)?.closest('p');
   const splitBlock=currentBlock&&textHost.contains(currentBlock)?currentBlock:textHost;
   const tail=document.createRange();
   tail.setStart(workingRange.startContainer,workingRange.startOffset);
   tail.setEnd(splitBlock,splitBlock.childNodes.length);
   const trailing=tail.extractContents();

   // Move every later paragraph in the current item's content area
   // into the next item's content, preserving structure.
   const followingBlocks:Node[]=[];
   let sibling=splitBlock.nextSibling;
   while(sibling){
    const nextSibling=sibling.nextSibling;
    followingBlocks.push(sibling);
    sibling=nextSibling;
   }
   followingBlocks.forEach(node=>node.parentNode?.removeChild(node));

   const next=makeListItem(kind);
   next.replaceChildren();
   const appendInline=(source:Node)=>{
    Array.from(source.childNodes).forEach(node=>{
     if(node instanceof HTMLParagraphElement||node instanceof HTMLDivElement){
      while(node.firstChild)next.appendChild(node.firstChild);
     }else next.appendChild(node);
    });
   };
   appendInline(trailing);
   followingBlocks.forEach(node=>appendInline(node));
   if(!next.childNodes.length)next.innerHTML='<br>';

   // Insert the next list item directly below the current one.
   list.insertBefore(next,item.nextSibling);
   styleChecklist(el);

   save();
   const focusNewItem=()=>{
    if(!el.isConnected||!next.isConnected)return;
    el.focus({preventScroll:true});
    if(!next.childNodes.length)next.appendChild(document.createElement('br'));
    const nextRange=document.createRange();
    nextRange.setStart(next,0);
    nextRange.collapse(true);
    const selection=window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(nextRange);
   };
   requestAnimationFrame(()=>requestAnimationFrame(focusNewItem));
  }
 };
 const click=(e:React.MouseEvent<HTMLDivElement>)=>{
  const t=e.target as HTMLElement;
  if(t instanceof HTMLInputElement&&t.type==='checkbox'){
   const item=t.closest('li');
   // The checkbox's native click activation has already updated checked here.
   // Persist both the live property and serialized attributes so unchecking
   // survives styleChecklist() and the next content save.
   t.checked=Boolean(t.checked);
   t.toggleAttribute('checked',t.checked);
   if(item)item.dataset.checked=String(t.checked);
   save();
   return;
  }
  const a=t.closest('a[data-sticky-reference-id]') as HTMLAnchorElement|null;
  if(a){
   const id=a.dataset.stickyReferenceId;
   const type=(a.dataset.stickyReferenceType||'note') as 'note'|'sticky'|'diary';
   if(e.ctrlKey){
    e.preventDefault();
    if(id)onOpenLinkedNote?.(id,type);
   }else{
    e.preventDefault();
    if(id)onPreviewLinkedNote?.(id,type,a);
   }
  }
 };
 const dragStart=(e:React.PointerEvent<HTMLDivElement>)=>{
  if(e.button!==0&&e.pointerType==='mouse')return;
  if(isPinchingRef?.current)return;
  e.stopPropagation();
  onSelect(note.id);
  const pointerId=e.pointerId;
  const zoom=canvasZoom||1;
  const sx=e.clientX,sy=e.clientY,px=note.position_x,py=note.position_y;
  let x=px,y=py,moved=false,cancelledByPinch=false;
  const ownHeight=editor.current?.closest<HTMLElement>('[data-sticky-note-id]')?.offsetHeight||280;
  setDrag(true);
  const cleanup=()=>{
   window.removeEventListener('pointermove',move);
   window.removeEventListener('pointerup',up);
   window.removeEventListener('pointercancel',up);
   window.removeEventListener('anotado:sticky-pinch-start',abortForPinch);
  };
  const abortForPinch=()=>{
   if(cancelledByPinch)return;
   cancelledByPinch=true;
   cleanup();
   setDrag(false);
   if(moved)onMoveLive(note.id,px,py);
  };
  const move=(v:PointerEvent)=>{
   if(v.pointerId!==pointerId)return;
   if(isPinchingRef?.current){abortForPinch();return;}
   if(Math.abs(v.clientX-sx)>2||Math.abs(v.clientY-sy)>2)moved=true;
   const rawX=Math.max(12,Math.round(px+(v.clientX-sx)/zoom));
   const rawY=Math.max(12,Math.round(py+(v.clientY-sy)/zoom));
   x=rawX;y=rawY;
   // Gentle magnetic guides: only snap when an edge is already within 6px.
   // Each axis is independent, so fine positioning remains unrestricted.
   const tolerance=6,gap=12;
   const nearest=(value:number,candidates:number[])=>{let best=value,bestDistance=tolerance+1;for(const candidate of candidates){const distance=Math.abs(candidate-value);if(distance<=tolerance&&distance<bestDistance){best=candidate;bestDistance=distance;}}return best;};
   const xGuides:number[]=[];const yGuides:number[]=[];
   for(const target of snapTargets){
    xGuides.push(target.x,target.x+target.width-note.width_px,target.x+target.width+gap,target.x-note.width_px-gap);
    yGuides.push(target.y,target.y+target.height-ownHeight,target.y+target.height+gap,target.y-ownHeight-gap);
   }
   x=Math.max(12,nearest(rawX,xGuides));y=Math.max(12,nearest(rawY,yGuides));
   onMoveLive(note.id,x,y);
  };
  const up=(v:PointerEvent)=>{
   if(v.pointerId!==pointerId)return;
   cleanup();
   setDrag(false);
   if(moved&&!cancelledByPinch)onMoveEnd(note.id,x,y);
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up);
  window.addEventListener('pointercancel',up);
  window.addEventListener('anotado:sticky-pinch-start',abortForPinch);
 };
 const resizeStart=(e:React.PointerEvent<HTMLDivElement>)=>{
  if(e.button!==0&&e.pointerType==='mouse')return;
  if(isPinchingRef?.current)return;
  e.preventDefault();e.stopPropagation();onSelect(note.id);
  const pointerId=e.pointerId;
  const zoom=canvasZoom||1;
  const sx=e.clientX,sw=note.width_px;
  let w=sw,changed=false,cancelledByPinch=false;
  setResize(true);
  const cleanup=()=>{
   window.removeEventListener('pointermove',move);
   window.removeEventListener('pointerup',up);
   window.removeEventListener('pointercancel',up);
   window.removeEventListener('anotado:sticky-pinch-start',abortForPinch);
  };
  const abortForPinch=()=>{
   if(cancelledByPinch)return;
   cancelledByPinch=true;
   cleanup();
   setResize(false);
   if(changed)onResizeLive(note.id,sw);
  };
  const move=(v:PointerEvent)=>{
   if(v.pointerId!==pointerId)return;
   if(isPinchingRef?.current){abortForPinch();return;}
   const raw=Math.max(STICKY_MIN_WIDTH,Math.min(STICKY_MAX_WIDTH,Math.round(sw+(v.clientX-sx)/zoom)));
   const tolerance=6;let n=raw;let best=tolerance+1;
   for(const target of snapTargets){
    const guides=[target.x-note.position_x-12,target.x+target.width-note.position_x];
    for(const guide of guides){const distance=Math.abs(guide-raw);if(guide>=STICKY_MIN_WIDTH&&guide<=STICKY_MAX_WIDTH&&distance<=tolerance&&distance<best){n=guide;best=distance;}}
   }
   if(n!==w){w=n;changed=true;onResizeLive(note.id,w);}
  };
  const up=(v:PointerEvent)=>{
   if(v.pointerId!==pointerId)return;
   cleanup();
   setResize(false);
   if(changed&&!cancelledByPinch)onResizeEnd(note.id,w);
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up);
  window.addEventListener('pointercancel',up);
  window.addEventListener('anotado:sticky-pinch-start',abortForPinch);
 };
 return <div id={`sticky-note-${note.id}`} data-sticky-note-id={note.id} onContextMenu={e=>{e.preventDefault();e.stopPropagation();onSelect(note.id);onContextMenu?.(note,e.clientX,e.clientY);}} onPointerDown={()=>{if(!isPinchingRef?.current)onSelect(note.id);}} style={{position:'absolute',left:note.position_x,top:note.position_y,width:note.width_px,zIndex:note.z_index}} className={`group rounded-xl border transition-shadow duration-150 ${colors.cardClass} ${drag||resize?'shadow-2xl ring-2 ring-[#68594d]/45':isSelected?'shadow-lg ring-2 ring-[#68594d]/35':'shadow-[0_6px_18px_-6px_rgba(40,30,20,0.16)] dark:shadow-[0_8px_22px_-6px_rgba(0,0,0,0.65)] hover:shadow-md'}`}>
 <div onPointerDown={dragStart} className={`flex items-center gap-1.5 px-2.5 py-1.5 border-b rounded-t-xl cursor-grab active:cursor-grabbing touch-none select-none ${colors.headerClass}`}><GripHorizontal className={`w-3.5 h-3.5 shrink-0 opacity-45 ${colors.textClass}`}/><input value={note.title} onPointerDown={e=>{e.stopPropagation();onSelect(note.id);}} onChange={e=>onChangeTitle(note.id,e.target.value)} placeholder="Título..." aria-label="Título do Stick" className={`flex-1 min-w-0 bg-transparent text-[15px] font-semibold focus:outline-none placeholder:opacity-50 ${colors.textClass}`}/><button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onOpenReminder?.(note);}} className={`relative p-1 rounded-md opacity-35 hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-[#8d725d]/10 ${hasReminder?'opacity-100 text-[#b4533c] dark:text-[#f08a72]':colors.mutedTextClass}`} title={hasReminder?'Gerenciar lembretes deste Stick':'Configurar lembrete'} aria-label="Configurar lembrete"><AlarmClock className="w-3.5 h-3.5"/>{hasReminder&&<span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-[#c34f3c] ring-1 ring-white dark:ring-[#222]"/>}</button><button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDelete(note.id);}} className={`p-1 rounded-md opacity-25 hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-red-500/15 ${colors.mutedTextClass}`} title="Excluir Stick" aria-label="Excluir Stick"><Trash2 className="w-3.5 h-3.5"/></button></div>
 <div className="px-3 py-2.5"><div ref={editor} contentEditable suppressContentEditableWarning onFocus={()=>onSelect(note.id)} onInput={handleInput} onKeyDown={keyDown} onPaste={paste} onKeyUp={()=>{pasteAsPlainText.current=false;}} onBlur={()=>{pasteAsPlainText.current=false;}} onClick={click} onChangeCapture={e=>{const target=e.target;if(target instanceof HTMLInputElement&&target.type==='checkbox'){const item=target.closest('li');target.toggleAttribute('checked',target.checked);if(item)item.dataset.checked=String(target.checked);save();}}} data-placeholder="Escreva aqui..." className={`sticky-rich-editor w-full min-h-[72px] break-words text-[13.5px] leading-[1.55] focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:opacity-40 ${colors.textClass}`}/></div>
 <div onPointerDown={resizeStart} role="separator" aria-orientation="vertical" aria-label="Ajustar largura da nota adesiva" title="Arraste para ajustar a largura" className="absolute top-2 bottom-2 -right-1.5 w-3 cursor-ew-resize touch-none flex items-center justify-center group/resize z-10"><span className={`w-1 h-8 rounded-full transition-opacity ${resize?'opacity-100 bg-[#68594d]':'opacity-0 group-hover:opacity-60 group-hover/resize:opacity-100 bg-black/25'}`}/></div></div>;
}