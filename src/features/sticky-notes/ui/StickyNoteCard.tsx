'use client';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AlarmClock,GripHorizontal,MoreVertical,Trash2} from 'lucide-react';
import {StickyNote,getStickyColorTheme} from '../types';
import {StickyResizeAxis,StickyResizePatch,StickySnapTarget,computeNextStickySize} from '../lib/sticky-interactions';
export type StickyEditorAction='bold'|'italic'|'underline'|'highlight'|'undo'|'redo'|'bullet'|'checklist'|'outdent'|'indent';
export interface StickyEditorActions{format:(action:StickyEditorAction)=>void;prepareNoteReference:()=>string;insertNoteLink:(id:string,title:string,type?:'note'|'sticky'|'diary')=>void;}
interface Props{isTablet?:boolean;isMobile?:boolean;visualFrame?:{x:number;y:number;width:number;heightPx?:number|null};onTabletPanStart?:(pointerId:number,x:number,y:number)=>void;snapTargets?:StickySnapTarget[];canvasZoom?:number;isPinchingRef?:React.RefObject<boolean>;isMovingWithGroup?:boolean;note:StickyNote;isSelected:boolean;highlightMode?:boolean;autoFocus?:boolean;onSelect:(id:string)=>void;onChangeTitle:(id:string,title:string)=>void;onChangeContent:(id:string,content:string)=>void;onChangeColor:(id:string,color:any)=>void;onMoveStart?:(id:string)=>void;onMoveLive:(id:string,x:number,y:number)=>void;onMoveEnd:(id:string,x:number,y:number)=>void;onResizeStart?:(id:string)=>void;onResizeLive:(id:string,size:StickyResizePatch)=>void;onResizeEnd:(id:string,size:StickyResizePatch)=>void;onDelete:(id:string)=>void;registerEditorActions?:(id:string,a:StickyEditorActions|null)=>void;onOpenLinkedNote?:(id:string,type:'note'|'sticky'|'diary')=>void;onPreviewLinkedNote?:(id:string,type:'note'|'sticky'|'diary',anchor:HTMLElement)=>void;hasReminder?:boolean;onOpenReminder?:(note:StickyNote)=>void;onContextMenu?:(note:StickyNote,x:number,y:number)=>void;onOpenTabletNoteMenu?:(note:StickyNote,x:number,y:number)=>void;}
const esc=(v:string)=>v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const getStickyHighlightColor=(color?:string|null)=>{
 const hex=getStickyColorTheme(color).swatchLight.replace('#','');
 const channels=[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16));
 const darker=channels.map(channel=>Math.round(channel*0.96));
 return `rgb(${darker.join(', ')})`;
};
const hasMarkdownBold=(value:string)=>/(?:\*\*[^*\n]+\*\*|\*[^*\n]+\*)/.test(value);
const markdownPlainToHtml=(value:string)=>{
 const paragraphs=value.replace(/\r\n?/g,'\n').trim().split(/\n\s*\n/);
 const inline=(text:string)=>esc(text).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<strong>$1</strong>');
 return paragraphs.map(paragraph=>'<p>'+paragraph.split('\n').map(inline).join('<br>')+'</p>').join('');
};
const looksLikeStickyMarkup=(value:string)=>/<\/?(?:p|br|div|ul|ol|li|strong|b|em|i|u|s|del|mark|h[1-6]|blockquote|hr|pre|code|table|tr|td|th|a|img)\b[^>]*>/i.test(value);
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

export function StickyNoteCard({isTablet=false,isMobile=false,visualFrame,onTabletPanStart,note,isSelected,highlightMode=false,autoFocus=false,snapTargets=[],canvasZoom=1,isPinchingRef,isMovingWithGroup=false,onSelect,onChangeTitle,onChangeContent,onMoveStart,onMoveLive,onMoveEnd,onResizeStart,onResizeLive,onResizeEnd,onDelete,registerEditorActions,onOpenLinkedNote,onPreviewLinkedNote,hasReminder=false,onOpenReminder,onContextMenu,onOpenTabletNoteMenu}:Props){
 const isTouchLayout=isTablet||isMobile;
 const colors=getStickyColorTheme(note.color);const cardRef=useRef<HTMLDivElement>(null);const editor=useRef<HTMLDivElement>(null);const referenceRange=useRef<Range|null>(null);const pasteAsPlainText=useRef(false);const highlightModeRef=useRef(highlightMode);const applyingHighlight=useRef(false);const tabletHighlightTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
 type EditorHistoryEntry={html:string;caret:number};
 const history=useRef<{entries:EditorHistoryEntry[];index:number;restoring:boolean}>({entries:[],index:-1,restoring:false});const [drag,setDrag]=useState(false);const [resizeAxis,setResizeAxis]=useState<StickyResizeAxis|null>(null);const resize=resizeAxis!==null;const [highlightDeleteTarget,setHighlightDeleteTarget]=useState<{element:HTMLElement;left:number;top:number}|null>(null);
 useLayoutEffect(()=>{const el=editor.current;if(el&&document.activeElement!==el&&!el.contains(document.activeElement)){const html=toHtml(note.content||'');const changed=el.innerHTML!==html;if(changed)el.innerHTML=html;styleChecklist(el);if(changed||history.current.index<0)history.current={entries:[{html:el.innerHTML,caret:0}],index:0,restoring:false};}},[note.content]);
 useEffect(()=>{if(autoFocus)editor.current?.focus();},[autoFocus]);
 useEffect(()=>{highlightModeRef.current=highlightMode;},[highlightMode]);
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
 const applySelectionHighlight=(rangeOverride?:Range|null)=>{
  const el=editor.current;
  const selection=window.getSelection();
  if(!highlightModeRef.current||!el||applyingHighlight.current)return;
  const range=rangeOverride?.cloneRange()||(selection?.rangeCount?selection.getRangeAt(0).cloneRange():null);
  if(!range||range.collapsed||!el.contains(range.commonAncestorContainer))return;
  const selectedText=range.toString();
  if(!selectedText.trim())return;

  const desiredColor=getStickyHighlightColor(note.color).replace(/\\s/g,'').toLowerCase();
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  const pending:Array<{node:Text;start:number;end:number}>=[];
  let current:Node|null;
  while((current=walker.nextNode())){
   const textNode=current as Text;
   if(!textNode.data.length)continue;
   try{
    if(!range.intersectsNode(textNode))continue;
   }catch{continue;}
   const startOffset=range.startContainer===textNode?range.startOffset:0;
   const endOffset=range.endContainer===textNode?range.endOffset:textNode.data.length;
   if(endOffset<=startOffset)continue;
   const parent=textNode.parentElement;
   const existing=parent?.closest<HTMLElement>('span[style],mark');
   const existingColor=existing?.style.backgroundColor.replace(/\\s/g,'').toLowerCase();
   if(existingColor===desiredColor)continue;
   pending.push({node:textNode,start:startOffset,end:endOffset});
  }
  if(!pending.length)return;

  applyingHighlight.current=true;
  try{
   // Envolve apenas os nós de texto selecionados, do fim para o início.
   // Isso preserva links, negrito, listas e blocos, sem depender do
   // document.execCommand('hiliteColor'), que perde a seleção em alguns browsers.
   for(let i=pending.length-1;i>=0;i--){
    const item=pending[i];
    if(!item.node.isConnected)continue;
    let selectedNode=item.node;
    if(item.end<selectedNode.length)selectedNode.splitText(item.end);
    if(item.start>0)selectedNode=selectedNode.splitText(item.start);
    const span=document.createElement('span');
    span.style.backgroundColor=getStickyHighlightColor(note.color);
    selectedNode.parentNode?.insertBefore(span,selectedNode);
    span.appendChild(selectedNode);
   }
   save();
   requestAnimationFrame(()=>window.getSelection()?.removeAllRanges());
  }finally{
   requestAnimationFrame(()=>{applyingHighlight.current=false;});
  }
 };
 const findHighlightElement=(target:EventTarget|null):HTMLElement|null=>{
  if(!(target instanceof Element))return null;
  const candidate=target.closest<HTMLElement>('mark,span[style]');
  if(!candidate||!editor.current?.contains(candidate))return null;
  const background=candidate.style.backgroundColor||candidate.getAttribute('data-sticky-highlight');
  return background&&background!=='transparent'?candidate:null;
 };
 const showHighlightDelete=(target:EventTarget|null)=>{
  const direct=findHighlightElement(target);
  if(!direct||!cardRef.current)return;
  const rect=direct.getBoundingClientRect();
  const card=cardRef.current.getBoundingClientRect();
  // Place the control close to the marked text, with enough room to move onto it.
  setHighlightDeleteTarget({element:direct,left:Math.max(4,Math.min(card.width-38,rect.right-card.left-8)),top:Math.max(34,rect.top-card.top-17)});
 };
 const showNearbyHighlightDelete=(clientX:number,clientY:number)=>{
  const el=editor.current;
  if(!el||!cardRef.current)return;
  const marks=Array.from(el.querySelectorAll<HTMLElement>('span[style],mark')).filter(node=>{
   const bg=node.style.backgroundColor;
   return !!bg&&bg!=='transparent';
  });
  let closest:HTMLElement|null=null;
  let best=20;
  for(const mark of marks){
   const rect=mark.getBoundingClientRect();
   const dx=Math.max(rect.left-clientX,0,clientX-rect.right);
   const dy=Math.max(rect.top-clientY,0,clientY-rect.bottom);
   const distance=Math.hypot(dx,dy);
   if(distance<best){best=distance;closest=mark;}
  }
  if(closest)showHighlightDelete(closest);
  else setHighlightDeleteTarget(null);
 };
 const removeHighlight=()=>{
  const element=highlightDeleteTarget?.element;
  if(!element||!editor.current?.contains(element))return;
  const parent=element.parentNode;
  if(!parent)return;
  while(element.firstChild)parent.insertBefore(element.firstChild,element);
  parent.removeChild(element);
  setHighlightDeleteTarget(null);
  save();
 };
 const scheduleSelectionHighlight=()=>{
  if(!highlightModeRef.current)return;
  // Captura o Range no próprio evento de soltura: o navegador pode limpar ou
  // mover a seleção antes do próximo frame.
  const selection=window.getSelection();
  const range=selection?.rangeCount?selection.getRangeAt(0).cloneRange():null;
  if(!range||range.collapsed||!editor.current?.contains(range.commonAncestorContainer))return;
  requestAnimationFrame(()=>applySelectionHighlight(range));
 };
 // No tablet, alças de seleção por toque disparam selectionchange sem mouseup.
 // Aplica o marca-texto após breve estabilização da seleção dentro deste Stick.
 useEffect(()=>{
  if(!isTablet||!highlightMode)return;
  const onSelectionChange=()=>{
   if(!highlightModeRef.current||applyingHighlight.current)return;
   const el=editor.current;
   const selection=window.getSelection();
   if(!el||!selection?.rangeCount||selection.isCollapsed)return;
   const range=selection.getRangeAt(0);
   if(!el.contains(range.commonAncestorContainer))return;
   if(tabletHighlightTimerRef.current)clearTimeout(tabletHighlightTimerRef.current);
   tabletHighlightTimerRef.current=setTimeout(()=>{
    applySelectionHighlight();
   },280);
  };
  document.addEventListener('selectionchange',onSelectionChange);
  return ()=>{
   document.removeEventListener('selectionchange',onSelectionChange);
   if(tabletHighlightTimerRef.current){
    clearTimeout(tabletHighlightTimerRef.current);
    tabletHighlightTimerRef.current=null;
   }
  };
 });
 const command=(cmd:string)=>{if(!editor.current)return;if(cmd==='undo'||cmd==='redo'){editor.current.focus();moveHistory(cmd);return;}editor.current.focus();if(cmd==='highlight'){scheduleSelectionHighlight();return;}document.execCommand(cmd,false);save();};
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
 const actions:StickyEditorActions={format:(a)=>{if(a==='bold')command('bold');else if(a==='italic')command('italic');else if(a==='underline')command('underline');else if(a==='highlight')command('highlight');else if(a==='undo')command('undo');else if(a==='redo')command('redo');else if(a==='bullet')insertBullet();else if(a==='indent')command('indent');else if(a==='outdent')command('outdent');else if(a==='checklist')insertChecklist();},prepareNoteReference,insertNoteLink:(id,title,type='note')=>{const el=editor.current;if(!el)return;const safe=title.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));const range=referenceRange.current;const selectedText=range?.toString()||'';const anchor=document.createElement('a');anchor.href='#anotado-reference-'+type+'-'+id;anchor.dataset.stickyReferenceId=id;anchor.dataset.stickyReferenceType=type;anchor.textContent=selectedText||title;anchor.style.cssText='color:#80634f;text-decoration:underline;text-decoration-color:#b69b83;cursor:pointer';el.focus();if(range&&el.contains(range.commonAncestorContainer)){range.deleteContents();range.insertNode(anchor);range.setStartAfter(anchor);range.collapse(true);const sel=window.getSelection();sel?.removeAllRanges();sel?.addRange(range);}else{document.execCommand('insertHTML',false,`<a href="#anotado-reference-${type}-${id}" data-sticky-reference-id="${id}" data-sticky-reference-type="${type}" style="color:#80634f;text-decoration:underline;text-decoration-color:#b69b83;cursor:pointer">${safe}</a>`);}referenceRange.current=null;save();}};
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
  const forcePlain=pasteAsPlainText.current;
  const plainContainsMarkup=looksLikeStickyMarkup(plain);
  const plainHasMarkdownBold=hasMarkdownBold(plain);
  let clipboardHtml=html;
  if(!forcePlain&&plainHasMarkdownBold){
   // Alguns aplicativos copiam Markdown como texto literal em vez de HTML semântico.
   // Converte *negrito* / **negrito** em <strong>, removendo os asteriscos.
   clipboardHtml=markdownPlainToHtml(plain);
  }else if(clipboardHtml){
   const clipboardDocument=new DOMParser().parseFromString(clipboardHtml,'text/html');
   const embeddedMarkup=clipboardDocument.body.textContent||'';
   if(looksLikeStickyMarkup(embeddedMarkup))clipboardHtml=normalizePastedMarkup(embeddedMarkup);
  }else if(plainContainsMarkup){
   clipboardHtml=normalizePastedMarkup(plain);
  }
  const usePlain=forcePlain||!clipboardHtml;
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
  if(findHighlightElement(t))showHighlightDelete(t);
  else if(isTablet)setHighlightDeleteTarget(null);
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
  const targetEl=e.target as HTMLElement|null;
  const startedOnTitleInput=targetEl instanceof HTMLInputElement;
  if(startedOnTitleInput&&(isTouchLayout||document.activeElement===targetEl))return;
  if(!startedOnTitleInput){
   e.preventDefault();
  }
  e.stopPropagation();
  onSelect(note.id);
  const pointerId=e.pointerId;
  const isTouchPointer=e.pointerType!=='mouse';
  const dragThreshold=startedOnTitleInput?5:(isTouchLayout&&isTouchPointer?6:2);
  const captureEl=e.currentTarget;
  if(!startedOnTitleInput){
   try{captureEl.setPointerCapture?.(pointerId);}catch{}
  }
  const prevUserSelect=document.body.style.userSelect;
  if(!startedOnTitleInput)document.body.style.userSelect='none';
  const zoom=canvasZoom||1;
  const sx=e.clientX,sy=e.clientY;
  const px=visualFrame?visualFrame.x:note.position_x;
  const py=visualFrame?visualFrame.y:note.position_y;
  const cardWidth=visualFrame?visualFrame.width:note.width_px;
  const effectiveHeightPx=visualFrame&&visualFrame.heightPx!==undefined?visualFrame.heightPx:(note.height_px??null);
  let x=px,y=py,dx=0,dy=0,moved=false,cancelledByPinch=false;
  const ownHeight=cardRef.current?.offsetHeight||effectiveHeightPx||280;
  if(!isTouchLayout&&!isTouchPointer&&!startedOnTitleInput){
   setDrag(true);
   onMoveStart?.(note.id);
  }
  const cleanup=()=>{
   try{if(captureEl.hasPointerCapture?.(pointerId))captureEl.releasePointerCapture(pointerId);}catch{}
   document.body.style.userSelect=prevUserSelect;
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
   if(moved){
    onMoveLive(note.id,px,py);
   }
  };
  const move=(v:PointerEvent)=>{
   if(v.pointerId!==pointerId)return;
   if(isPinchingRef?.current){abortForPinch();return;}
   if(!moved){
    if(Math.hypot(v.clientX-sx,v.clientY-sy)<=dragThreshold)return;
    moved=true;
    if(startedOnTitleInput){
     document.body.style.userSelect='none';
     if(document.activeElement===targetEl)targetEl.blur();
     window.getSelection()?.removeAllRanges();
     try{captureEl.setPointerCapture?.(pointerId);}catch{}
    }
    setDrag(true);
    onMoveStart?.(note.id);
   }
   dx=(v.clientX-sx)/zoom;
   dy=(v.clientY-sy)/zoom;
   // Desktop: quadro sem limites artificiais, inclusive em coordenadas negativas.
   // Tablet/mobile continuam respeitando a margem mínima do layout responsivo.
   const rawX=isTouchLayout?Math.max(12,Math.round(px+dx)):Math.round(px+dx);
   const rawY=isTouchLayout?Math.max(12,Math.round(py+dy)):Math.round(py+dy);
   x=rawX;y=rawY;
   if((!isTouchLayout||isTablet)&&snapTargets.length>0){
    // Magnetic guides help align cards without restricting free placement.
    // Tablet uses a wider tolerance because finger placement is less precise.
    const tolerance=isTablet?14:6,gap=12;
    const nearest=(value:number,candidates:number[])=>{let best=value,bestDistance=tolerance+1;for(const candidate of candidates){const distance=Math.abs(candidate-value);if(distance<=tolerance&&distance<bestDistance){best=candidate;bestDistance=distance;}}return best;};
    const xGuides:number[]=[];const yGuides:number[]=[];
    for(const target of snapTargets){
     xGuides.push(target.x,target.x+target.width-cardWidth,target.x+target.width+gap,target.x-cardWidth-gap);
     yGuides.push(target.y,target.y+target.height-ownHeight,target.y+target.height+gap,target.y-ownHeight-gap);
    }
    const snappedX=nearest(rawX,xGuides);
    const snappedY=nearest(rawY,yGuides);
    x=isTouchLayout?Math.max(12,snappedX):snappedX;
    y=isTouchLayout?Math.max(12,snappedY):snappedY;
   }
   onMoveLive(note.id,x,y);
  };
  const up=(v:PointerEvent)=>{
   if(v.pointerId!==pointerId)return;
   cleanup();
   setDrag(false);
   if(moved&&!cancelledByPinch){
    onMoveEnd(note.id,x,y);
   }
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up);
  window.addEventListener('pointercancel',up);
  window.addEventListener('anotado:sticky-pinch-start',abortForPinch);
 };
 const startResize=(axis:StickyResizeAxis,e:React.PointerEvent<HTMLDivElement>)=>{
  if(e.button!==0&&e.pointerType==='mouse')return;
  if(isPinchingRef?.current)return;
  e.preventDefault();
  e.stopPropagation();
  onSelect(note.id);
  onResizeStart?.(note.id);
  const pointerId=e.pointerId;
  const captureEl=e.currentTarget;
  try{captureEl.setPointerCapture?.(pointerId);}catch{}
  const prevUserSelect=document.body.style.userSelect;
  document.body.style.userSelect='none';
  const zoom=canvasZoom||1;
  const sx=e.clientX,sy=e.clientY;
  const sw=visualFrame?visualFrame.width:note.width_px;
  const startPosX=visualFrame?visualFrame.x:note.position_x;
  const startPosY=visualFrame?visualFrame.y:note.position_y;
  const initialHeightPx=visualFrame&&visualFrame.heightPx!==undefined?visualFrame.heightPx:(note.height_px??null);
  const sh=Math.round(initialHeightPx??cardRef.current?.offsetHeight??180);
  let currentSize:StickyResizePatch={width_px:sw,height_px:initialHeightPx,position_x:startPosX,position_y:startPosY};
  let changed=false,cancelledByPinch=false;
  setResizeAxis(axis);
  const cleanup=()=>{
   try{if(captureEl.hasPointerCapture?.(pointerId))captureEl.releasePointerCapture(pointerId);}catch{}
   document.body.style.userSelect=prevUserSelect;
   window.removeEventListener('pointermove',move);
   window.removeEventListener('pointerup',up);
   window.removeEventListener('pointercancel',up);
   window.removeEventListener('anotado:sticky-pinch-start',abortForPinch);
  };
  const abortForPinch=()=>{
   if(cancelledByPinch)return;
   cancelledByPinch=true;
   cleanup();
   setResizeAxis(null);
   if(changed)onResizeLive(note.id,{width_px:sw,height_px:initialHeightPx,position_x:startPosX,position_y:startPosY});
   onResizeEnd(note.id,{width_px:sw,height_px:initialHeightPx,position_x:startPosX,position_y:startPosY});
  };
  const move=(v:PointerEvent)=>{
   if(v.pointerId!==pointerId)return;
   if(isPinchingRef?.current){abortForPinch();return;}
   const next=computeNextStickySize({
    axis,
    startWidth:sw,
    startHeight:sh,
    initialHeightPx,
    deltaX:v.clientX-sx,
    deltaY:v.clientY-sy,
    zoom,
    positionX:startPosX,
    positionY:startPosY,
    snapTargets:isTouchLayout?[]:snapTargets,
   });
   if(next.width_px!==currentSize.width_px||next.height_px!==currentSize.height_px||next.position_x!==currentSize.position_x||next.position_y!==currentSize.position_y){
    currentSize=next;
    changed=true;
    onResizeLive(note.id,next);
   }
  };
  const up=(v:PointerEvent)=>{
   if(v.pointerId!==pointerId)return;
   cleanup();
   setResizeAxis(null);
   if(!cancelledByPinch){
    onResizeEnd(note.id,changed?currentSize:{width_px:sw,height_px:initialHeightPx,position_x:startPosX,position_y:startPosY});
   }
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up);
  window.addEventListener('pointercancel',up);
  window.addEventListener('anotado:sticky-pinch-start',abortForPinch);
 };
 const effectiveHeightPx=visualFrame&&visualFrame.heightPx!==undefined?visualFrame.heightPx:(note.height_px??null);
 const hasManualHeight=effectiveHeightPx!=null;
 const renderLeft=visualFrame?visualFrame.x:note.position_x;
 const renderTop=visualFrame?visualFrame.y:note.position_y;
 const renderWidth=visualFrame?visualFrame.width:note.width_px;
 const edgeVClass=isTouchLayout?'w-6':'w-3';
 const edgeHClass=isTouchLayout?'h-6':'h-3';
 return <div ref={cardRef} id={`sticky-note-${note.id}`} data-sticky-note-id={note.id} onContextMenu={e=>{e.preventDefault();e.stopPropagation();onSelect(note.id);onContextMenu?.(note,e.clientX,e.clientY);}} onPointerDown={e=>{if(isTouchLayout){e.stopPropagation();if(isTablet&&e.pointerType!=='mouse'&&!isPinchingRef?.current){const target=e.target as HTMLElement;if(!target.closest('input,button,textarea,a,[role="separator"],[data-sticky-note-move-handle]'))onTabletPanStart?.(e.pointerId,e.clientX,e.clientY);}}if(!isPinchingRef?.current)onSelect(note.id);}} onMouseLeave={e=>{const next=e.relatedTarget;if(next instanceof Element&&next.closest('[data-sticky-highlight-delete]'))return;setHighlightDeleteTarget(null);}} style={{position:'absolute',left:renderLeft,top:renderTop,width:renderWidth,height:hasManualHeight?effectiveHeightPx??undefined:undefined,zIndex:drag?Math.max(note.z_index,9999):note.z_index,transition:drag||resize||isMovingWithGroup?'none':'left 200ms ease, top 200ms ease, box-shadow 150ms ease, transform 150ms ease'}} className={`group flex flex-col rounded-xl border ${colors.cardClass} ${drag||resize?'scale-[1.015] shadow-2xl ring-2 ring-[#68594d]/45':isSelected?'shadow-lg ring-2 ring-[#68594d]/35':'shadow-[0_6px_18px_-6px_rgba(40,30,20,0.16)] dark:shadow-[0_8px_22px_-6px_rgba(0,0,0,0.65)] hover:shadow-md'}`}>
 <div onPointerDown={isTouchLayout?undefined:dragStart} className={`flex shrink-0 items-center ${isTouchLayout?'min-h-[44px] gap-1 px-2.5 py-1.5':'gap-1.5 px-2.5 py-1.5'} border-b rounded-t-xl ${isTouchLayout?'':'cursor-grab active:cursor-grabbing'} touch-none select-none ${colors.headerClass}`}>
  <div data-sticky-note-move-handle={isTouchLayout?'true':undefined} onPointerDown={isTouchLayout?dragStart:undefined} role={isTouchLayout?'button':undefined} aria-label={isTouchLayout?'Segure e arraste para mover o Stick':undefined} title={isTouchLayout?'Arraste pelos seis pontos para mover o Stick':undefined} className={`${isTouchLayout?'flex h-9 w-9 shrink-0 items-center justify-center rounded-md active:bg-black/10 dark:active:bg-white/10 cursor-grab active:cursor-grabbing':'contents'} touch-none`}>
   <GripHorizontal className={`${isTouchLayout?'w-5 h-5 opacity-70':'w-3.5 h-3.5 opacity-45'} shrink-0 ${colors.textClass}`}/>
  </div>
  <input value={note.title} onPointerDown={e=>{if(isTouchLayout||document.activeElement===e.currentTarget){e.stopPropagation();}onSelect(note.id);}} onChange={e=>onChangeTitle(note.id,e.target.value)} placeholder="Título..." aria-label="Título do Stick" className={`flex-1 min-w-0 bg-transparent ${isTouchLayout?'text-[15.5px] py-1':'text-[15px]'} font-semibold focus:outline-none placeholder:opacity-50 ${colors.textClass}`}/>
  <button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onOpenReminder?.(note);}} className={`relative flex items-center justify-center rounded-md transition-opacity hover:bg-[#8d725d]/10 ${isTouchLayout?'h-9 w-9 opacity-75 active:scale-95':'p-1 opacity-35 hover:opacity-100 focus-visible:opacity-100'} ${hasReminder?'opacity-100 text-[#b4533c] dark:text-[#f08a72]':colors.mutedTextClass}`} title={hasReminder?'Gerenciar lembretes deste Stick':'Configurar lembrete'} aria-label="Configurar lembrete"><AlarmClock className={isTouchLayout?'w-4 h-4':'w-3.5 h-3.5'}/>{hasReminder&&<span className={`absolute ${isTouchLayout?'right-1.5 top-1.5':'right-0 top-0'} h-1.5 w-1.5 rounded-full bg-[#c34f3c] ring-1 ring-white dark:ring-[#222]`}/>}</button>
  {isTouchLayout&&<button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onSelect(note.id);const rect=e.currentTarget.getBoundingClientRect();onOpenTabletNoteMenu?.(note,rect.left,rect.bottom+6);}} className={`flex h-9 w-9 items-center justify-center rounded-md opacity-75 active:scale-95 hover:bg-[#8d725d]/10 ${colors.mutedTextClass}`} title="Opções do Stick" aria-label="Opções do Stick"><MoreVertical className="w-4 h-4"/></button>}
  <button type="button" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onDelete(note.id);}} className={`flex items-center justify-center rounded-md transition-opacity hover:bg-red-500/15 ${isTouchLayout?'h-9 w-9 opacity-70 active:scale-95':'p-1 opacity-25 hover:opacity-100 focus-visible:opacity-100'} ${colors.mutedTextClass}`} title="Excluir Stick" aria-label="Excluir Stick"><Trash2 className={isTouchLayout?'w-4 h-4':'w-3.5 h-3.5'}/></button>
 </div>
 <div data-sticky-scroll-color={note.color} onClick={e=>{if(e.target===e.currentTarget)editor.current?.focus();}} className={`sticky-note-scroll-area ${isTouchLayout?'px-3.5 py-3':'px-3 py-2.5'} ${hasManualHeight?'flex-1 min-h-0 overflow-y-auto':''}`} style={isTablet?{touchAction:'none'}:isMobile?{touchAction:hasManualHeight?'pan-y':'manipulation'}:undefined}>
  <div ref={editor} contentEditable suppressContentEditableWarning onFocus={()=>onSelect(note.id)} onInput={handleInput} onKeyDown={keyDown} onPaste={paste} onKeyUp={()=>{pasteAsPlainText.current=false;scheduleSelectionHighlight();}} onMouseUp={scheduleSelectionHighlight} onPointerUp={scheduleSelectionHighlight} onTouchEnd={isTouchLayout?scheduleSelectionHighlight:undefined} onMouseOver={e=>{if(!isTouchLayout&&findHighlightElement(e.target))showHighlightDelete(e.target);}} onMouseMove={e=>{if(!isTouchLayout)showNearbyHighlightDelete(e.clientX,e.clientY);}} onMouseOut={e=>{const next=e.relatedTarget;if(next instanceof Element&&next.closest('[data-sticky-highlight-delete]'))return;}} onBlur={()=>{pasteAsPlainText.current=false;}} onClick={click} onChangeCapture={e=>{const target=e.target;if(target instanceof HTMLInputElement&&target.type==='checkbox'){const item=target.closest('li');target.toggleAttribute('checked',target.checked);if(item)item.dataset.checked=String(target.checked);save();}}} style={{'--sticky-selection-color':getStickyHighlightColor(note.color),...(isTablet?{touchAction:'none'}:isMobile?{touchAction:'manipulation'}:{})} as React.CSSProperties & {'--sticky-selection-color': string}} data-placeholder="Escreva aqui..." className={`sticky-rich-editor w-full min-h-[72px] break-words ${isTouchLayout?'text-[14.5px] leading-[1.6]':'text-[13.5px] leading-[1.55]'} focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:opacity-40 ${colors.textClass}`}/>
 </div>
 {/* Oito zonas de arraste: quatro bordas e quatro quinas. */}
 {highlightDeleteTarget&&<button type="button" data-sticky-highlight-delete onMouseDown={e=>e.preventDefault()} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();removeHighlight();}} title="Remover marcação" aria-label="Remover marcação" style={{position:'absolute',left:highlightDeleteTarget.left,top:highlightDeleteTarget.top,zIndex:40}} className={`flex ${isTouchLayout?'h-10 w-10':'h-8 w-8'} items-center justify-center rounded-full border border-[#d8c9b8] bg-[#fffaf4] text-[#8b5548] shadow-md hover:bg-[#f8e6df] dark:border-[#665448] dark:bg-[#2b241f] dark:text-[#f0b5a7] dark:hover:bg-[#49302a]`}><Trash2 className="h-4 w-4"/></button>}
 <div onPointerDown={e=>startResize('left',e)} role="separator" aria-orientation="vertical" aria-label="Redimensionar pela borda esquerda" className={`absolute left-0 top-4 bottom-4 ${edgeVClass} -translate-x-1/2 cursor-ew-resize touch-none z-20`}/>
 <div onPointerDown={e=>startResize('right',e)} role="separator" aria-orientation="vertical" aria-label="Redimensionar pela borda direita" className={`absolute right-0 top-4 bottom-4 ${edgeVClass} translate-x-1/2 cursor-ew-resize touch-none z-20`}/>
 <div onPointerDown={e=>startResize('top',e)} role="separator" aria-orientation="horizontal" aria-label="Redimensionar pela borda superior" className={`absolute top-0 left-4 right-4 ${edgeHClass} -translate-y-1/2 cursor-ns-resize touch-none z-20`}/>
 <div onPointerDown={e=>startResize('bottom',e)} role="separator" aria-orientation="horizontal" aria-label="Redimensionar pela borda inferior" className={`absolute bottom-0 left-4 right-4 ${edgeHClass} translate-y-1/2 cursor-ns-resize touch-none z-20`}/>
 <div onPointerDown={e=>startResize('top-left',e)} role="separator" aria-label="Redimensionar pela quina superior esquerda" className={`absolute ${isTouchLayout?'-left-3 -top-3 w-9 h-9':'-left-1.5 -top-1.5 w-5 h-5'} cursor-nwse-resize touch-none z-30`}/>
 <div onPointerDown={e=>startResize('top-right',e)} role="separator" aria-label="Redimensionar pela quina superior direita" className={`absolute ${isTouchLayout?'-right-3 -top-3 w-9 h-9':'-right-1.5 -top-1.5 w-5 h-5'} cursor-nesw-resize touch-none z-30`}/>
 <div onPointerDown={e=>startResize('bottom-left',e)} role="separator" aria-label="Redimensionar pela quina inferior esquerda" className={`absolute ${isTouchLayout?'-left-3 -bottom-3 w-9 h-9':'-left-1.5 -bottom-1.5 w-5 h-5'} cursor-nesw-resize touch-none z-30`}/>
 <div onPointerDown={e=>startResize('bottom-right',e)} role="separator" aria-label="Redimensionar pela quina inferior direita" className={`absolute ${isTouchLayout?'-right-3 -bottom-3 w-9 h-9':'-right-1.5 -bottom-1.5 w-5 h-5'} cursor-nwse-resize touch-none z-30 flex items-end justify-end p-2`}>
  {isTouchLayout&&isSelected&&<span aria-hidden="true" className="block h-2.5 w-2.5 rounded-br-sm border-r-2 border-b-2 border-[#68594d]/55 dark:border-[#e2d4c8]/55 pointer-events-none"/>}
 </div>
 </div>;
}