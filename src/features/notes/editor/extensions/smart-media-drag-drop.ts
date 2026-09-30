'use client';

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import { Node as PMNode, Slice, Fragment } from '@tiptap/pm/model';

const MEDIA_NODE_NAMES = ['image', 'documentAttachment', 'youtube'];

interface DraggedMediaOrigin {
  pos: number;
  node: PMNode;
  mediaId: string;
  insideGroup: boolean;
  groupPos?: number;
  childIndex?: number;
}

interface DraggedTextOrigin {
  from: number;
  to: number;
  slice: Slice;
}

function getMediaIdentifier(node: PMNode): string {
  return (
    node.attrs.src ||
    node.attrs['data-src'] ||
    node.attrs.attachmentId ||
    node.attrs.name ||
    ''
  );
}

function countMediaOccurrencesInDoc(doc: PMNode, mediaId: string): number {
  if (!mediaId) return 0;
  let count = 0;
  doc.descendants((n) => {
    if (MEDIA_NODE_NAMES.includes(n.type.name)) {
      const id = getMediaIdentifier(n);
      if (id === mediaId) {
        count++;
      }
    }
  });
  return count;
}

function findMediaNodeAtDOM(view: any, element: HTMLElement): { pos: number; node: PMNode } | null {
  try {
    // 1. Tenta pelo nearestDesc do ProseMirror (mais preciso para NodeViews)
    const desc = view.docView?.nearestDesc(element, true);
    if (desc && desc.node && MEDIA_NODE_NAMES.includes(desc.node.type.name)) {
      return { pos: desc.posBefore, node: desc.node };
    }

    // 2. Tenta por posAtDOM
    const pos = view.posAtDOM(element, 0);
    if (typeof pos === 'number') {
      const { doc } = view.state;
      const safePos = Math.max(0, Math.min(pos, doc.content.size));
      const $pos = doc.resolve(safePos);
      const node =
        $pos.nodeAfter ||
        ($pos.parent && MEDIA_NODE_NAMES.includes($pos.parent.type.name) ? $pos.parent : null);
      if (node && MEDIA_NODE_NAMES.includes(node.type.name)) {
        const actualPos = $pos.nodeAfter ? safePos : $pos.before();
        return { pos: actualPos, node };
      }
    }
  } catch (err) {
    console.warn('[MEDIA-DRAG] Warning in findMediaNodeAtDOM:', err);
  }
  return null;
}

export const SmartMediaDragDrop = Extension.create({
  name: 'smartMediaDragDrop',

  addProseMirrorPlugins() {
    let dropIndicatorEl: HTMLDivElement | null = null;
    let draggedOrigin: DraggedMediaOrigin | null = null;
    let draggedTextOrigin: DraggedTextOrigin | null = null;

    const getOrCreateIndicator = () => {
      if (!dropIndicatorEl && typeof document !== 'undefined') {
        dropIndicatorEl = document.createElement('div');
        dropIndicatorEl.className =
          'smart-media-drop-indicator pointer-events-none fixed z-50 transition-all duration-75';
        dropIndicatorEl.style.display = 'none';
        document.body.appendChild(dropIndicatorEl);
      }
      return dropIndicatorEl;
    };

    const hideIndicator = () => {
      if (dropIndicatorEl) {
        dropIndicatorEl.style.display = 'none';
      }
    };

    const showIndicator = (
      rect: { top: number; left: number; width: number; height: number },
      isSide: boolean
    ) => {
      const el = getOrCreateIndicator();
      if (!el) return;

      if (isSide) {
        // Indicador vertical lateral
        el.style.top = `${rect.top}px`;
        el.style.left = `${rect.left}px`;
        el.style.width = '4px';
        el.style.height = `${rect.height}px`;
        el.style.backgroundColor = '#68594d';
        el.style.borderRadius = '2px';
        el.style.boxShadow = '0 0 8px rgba(104, 89, 77, 0.5)';
        el.style.display = 'block';
      } else {
        // Indicador horizontal (entre blocos)
        el.style.top = `${rect.top}px`;
        el.style.left = `${rect.left}px`;
        el.style.width = `${rect.width}px`;
        el.style.height = '3px';
        el.style.backgroundColor = '#68594d';
        el.style.borderRadius = '2px';
        el.style.boxShadow = '0 0 8px rgba(104, 89, 77, 0.5)';
        el.style.display = 'block';
      }
    };

    return [
      new Plugin({
        key: new PluginKey('smartMediaDragDrop'),
        props: {
          handleDOMEvents: {
            dragstart(view, event) {
              draggedOrigin = null;
              draggedTextOrigin = null;

              const targetNode = event.target as Node | null;
              const targetEl = targetNode instanceof Element ? targetNode : targetNode?.parentElement;
              if (!targetEl) return false;

              // Localiza o wrapper do nó de mídia ou o drag handle
              const mediaWrapper = targetEl.closest<HTMLElement>(
                '.image-node-view-wrapper, .document-attachment-wrapper, .youtube-node-view-wrapper'
              );

              if (mediaWrapper && view.dom.contains(mediaWrapper)) {
                try {
                  let found = findMediaNodeAtDOM(view, mediaWrapper);
                  const { selection, doc } = view.state;
                  if (
                    !found &&
                    selection instanceof NodeSelection &&
                    MEDIA_NODE_NAMES.includes(selection.node.type.name)
                  ) {
                    found = { pos: selection.from, node: selection.node };
                  }

                  if (found) {
                    const { pos, node: mediaNode } = found;
                    const $pos = doc.resolve(pos);
                    const insideGroup = $pos.parent.type.name === 'mediaGroup';
                    const groupPos = insideGroup ? $pos.before() : undefined;
                    let childIndex: number | undefined;

                    if (insideGroup) {
                      let idx = 0;
                      $pos.parent.forEach((child, offset) => {
                        if ($pos.before() + 1 + offset === pos) {
                          childIndex = idx;
                        }
                        idx++;
                      });
                    }

                    const mediaId = getMediaIdentifier(mediaNode);

                    // Garante NodeSelection no início do drag
                    try {
                      const sel = NodeSelection.create(doc, pos);
                      const tr = view.state.tr.setSelection(sel);
                      view.dispatch(tr);
                    } catch (err) {
                      console.warn('[MEDIA-DRAG] Warning ao definir NodeSelection:', err);
                    }

                    draggedOrigin = {
                      pos,
                      node: mediaNode,
                      mediaId,
                      insideGroup,
                      groupPos,
                      childIndex,
                    };
                  }
                } catch (err) {
                  console.warn('[MEDIA-DRAG] Erro ao registrar origem do drag de mídia:', err);
                }
                return false;
              }

              // Se não for mídia, verifica se há seleção de texto ativa sendo arrastada
              const { state } = view;
              const { selection } = state;
              if (!selection.empty && !(selection instanceof NodeSelection)) {
                draggedTextOrigin = {
                  from: selection.from,
                  to: selection.to,
                  slice: selection.content(),
                };
              }

              return false;
            },

            dragend() {
              hideIndicator();
              // Mantém por breve intervalo para o evento drop receber os dados com segurança
              setTimeout(() => {
                draggedOrigin = null;
                draggedTextOrigin = null;
              }, 200);
              return false;
            },

            dragleave(view, event) {
              if (!view.dom.contains(event.relatedTarget as Node)) {
                hideIndicator();
              }
              return false;
            },

            dragover(view, event) {
              const clientX = event.clientX;
              const clientY = event.clientY;

              const elementUnder = document.elementFromPoint(clientX, clientY);
              if (!elementUnder) {
                hideIndicator();
                return false;
              }

              // Localiza wrapper de nó de mídia ou grupo
              const mediaWrapper = elementUnder.closest<HTMLElement>(
                '.image-node-view-wrapper, .document-attachment-wrapper, .youtube-node-view-wrapper, [data-media-group]'
              );

              if (mediaWrapper && view.dom.contains(mediaWrapper)) {
                const rect = mediaWrapper.getBoundingClientRect();
                const relY = clientY - rect.top;

                // Indicador de referência horizontal acima ou abaixo do bloco alvo
                const isTop = relY < rect.height * 0.5;
                showIndicator(
                  {
                    top: isTop ? rect.top - 2 : rect.bottom + 2,
                    left: rect.left,
                    width: rect.width,
                    height: 3,
                  },
                  false
                );
                return false;
              }

              hideIndicator();
              return false;
            },
          },

          handleDrop(view, event, slice) {
            hideIndicator();

            if (!view.editable) return false;

            const clientX = event.clientX;
            const clientY = event.clientY;

            // Extrai o nó de mídia sendo arrastado do slice ou da origem capturada
            let nodeToMove: PMNode | null = draggedOrigin?.node || null;

            if (!nodeToMove && slice && slice.content) {
              slice.content.forEach((node) => {
                if (MEDIA_NODE_NAMES.includes(node.type.name)) {
                  nodeToMove = node;
                } else if (node.type.name === 'mediaGroup') {
                  node.forEach((child) => {
                    if (MEDIA_NODE_NAMES.includes(child.type.name) && !nodeToMove) {
                      nodeToMove = child;
                    }
                  });
                }
              });
            }

            // ==========================================
            // CASO 1: ARRASTAR TEXTO SELECIONADO (MOVE REAL)
            // ==========================================
            if (!nodeToMove) {
              draggedOrigin = null;

              if (draggedTextOrigin) {
                const textOrigin = draggedTextOrigin;
                draggedTextOrigin = null;

                const isMac =
                  typeof navigator !== 'undefined' &&
                  /Mac|iPod|iPhone|iPad/.test(navigator.platform);
                const isCopy = isMac ? event.altKey : event.ctrlKey;

                const coords = view.posAtCoords({ left: clientX, top: clientY });
                if (!coords) return false;

                const sliceToInsert =
                  slice && slice.content.size > 0 ? slice : textOrigin.slice;

                const { from, to } = textOrigin;
                const rawDropPos = coords.pos;

                // Se o usuário soltar dentro da própria seleção original, mantém intacto sem duplicar
                if (rawDropPos >= from && rawDropPos <= to) {
                  event.preventDefault();
                  return true;
                }

                const tr = view.state.tr;

                if (isCopy) {
                  // Cópia explícita (Alt no Mac ou Ctrl no Win/Linux mantido pressionado)
                  tr.replaceRange(rawDropPos, rawDropPos, sliceToInsert);
                  const newFrom = rawDropPos;
                  const newTo = newFrom + sliceToInsert.content.size;
                  if (newFrom <= tr.doc.content.size && newTo <= tr.doc.content.size) {
                    try {
                      tr.setSelection(TextSelection.create(tr.doc, newFrom, newTo));
                    } catch {}
                  }
                } else {
                  // COMPORTAMENTO PADRÃO: MOVER O TEXTO (remove da posição original e insere no novo local)
                  // 1. Remove a seleção original da posição anterior
                  tr.delete(from, to);

                  // 2. Mapeia a posição de inserção para refletir o deslocamento
                  const mappedInsertPos = tr.mapping.map(rawDropPos);

                  // 3. Ajusta o ponto de inserção para garantir posição válida no documento
                  let finalInsertPos = mappedInsertPos;
                  try {
                    const calculated = dropPoint(tr.doc, mappedInsertPos, sliceToInsert);
                    if (typeof calculated === 'number') {
                      finalInsertPos = calculated;
                    }
                  } catch {}
                  finalInsertPos = Math.max(0, Math.min(finalInsertPos, tr.doc.content.size));

                  // 4. Insere o trecho no novo local
                  tr.replaceRange(finalInsertPos, finalInsertPos, sliceToInsert);

                  // 5. Seleciona o texto no novo local
                  const newFrom = finalInsertPos;
                  const newTo = newFrom + sliceToInsert.content.size;
                  if (newFrom <= tr.doc.content.size && newTo <= tr.doc.content.size) {
                    try {
                      tr.setSelection(TextSelection.create(tr.doc, newFrom, newTo));
                    } catch {}
                  }
                }

                tr.scrollIntoView();
                view.focus();
                view.dispatch(tr.setMeta('uiEvent', 'drop'));
                event.preventDefault();
                return true;
              }

              return false;
            }

            // ==========================================
            // CASO 2: ARRASTAR MÍDIA (PDF, IMAGEM, YOUTUBE)
            // ==========================================
            const currentOrigin = draggedOrigin;
            draggedOrigin = null;

            const elementUnder = document.elementFromPoint(clientX, clientY);
            if (!elementUnder) return false;

            const mediaWrapper = elementUnder.closest<HTMLElement>(
              '.image-node-view-wrapper, .document-attachment-wrapper, .youtube-node-view-wrapper'
            );

            const { state } = view;
            const { doc, schema } = state;
            const tr = state.tr;

            // 1. Identifica a posição de destino
            let targetPos: number | null = null;
            let targetNodeSize = 0;
            let isTop = false;

            if (mediaWrapper && view.dom.contains(mediaWrapper)) {
              const rect = mediaWrapper.getBoundingClientRect();
              const relY = clientY - rect.top;
              isTop = relY < rect.height * 0.5;

              const found = findMediaNodeAtDOM(view, mediaWrapper);
              if (found) {
                targetPos = found.pos;
                targetNodeSize = found.node.nodeSize;
              }
            }

            // Se for soltar na mesma mídia na mesma posição, cancela
            if (currentOrigin && targetPos !== null && currentOrigin.pos === targetPos) {
              event.preventDefault();
              return true;
            }

            // 2. Remove o nó da posição de ORIGEM (DELETE ORIGINAL)
            if (currentOrigin) {
              const originPos = currentOrigin.pos;
              const $originPos = doc.resolve(Math.min(originPos, doc.content.size));

              if (currentOrigin.insideGroup && $originPos.parent.type.name === 'mediaGroup') {
                const groupPos = $originPos.before();
                const groupNode = $originPos.parent;
                const remainingChildren: PMNode[] = [];

                let idx = 0;
                groupNode.forEach((child) => {
                  if (currentOrigin?.childIndex !== undefined) {
                    if (idx !== currentOrigin.childIndex) {
                      remainingChildren.push(child);
                    }
                  } else if (child !== currentOrigin?.node) {
                    remainingChildren.push(child);
                  }
                  idx++;
                });

                if (remainingChildren.length === 0) {
                  tr.delete(groupPos, groupPos + groupNode.nodeSize);
                } else if (remainingChildren.length === 1) {
                  tr.replaceWith(groupPos, groupPos + groupNode.nodeSize, remainingChildren[0]);
                } else {
                  const mediaGroupType = schema.nodes.mediaGroup;
                  if (mediaGroupType) {
                    const updatedGroup = mediaGroupType.create(groupNode.attrs, remainingChildren);
                    tr.replaceWith(groupPos, groupPos + groupNode.nodeSize, updatedGroup);
                  }
                }
              } else {
                // Standalone: deleta da origem
                const originNodeSize = currentOrigin.node.nodeSize;
                tr.delete(originPos, originPos + originNodeSize);
              }
            }

            // 3. Insere o nó no DESTINO
            if (targetPos !== null) {
              // Destino é outra mídia:
              // Se isTop: insere ANTES da targetPos
              // Se !isTop: insere DEPOIS da targetPos (targetPos + targetNodeSize)
              const rawTargetPos = isTop ? targetPos : targetPos + targetNodeSize;
              const mappedTargetPos = Math.max(
                0,
                Math.min(tr.mapping.map(rawTargetPos), tr.doc.content.size)
              );

              tr.insert(mappedTargetPos, nodeToMove);
              try {
                tr.setSelection(NodeSelection.create(tr.doc, mappedTargetPos));
              } catch {}
            } else {
              // Soltou entre blocos de texto ou no documento
              const coords = view.posAtCoords({ left: clientX, top: clientY });
              const rawDropPos = coords ? coords.pos : tr.doc.content.size;
              const mappedDropPos = Math.max(
                0,
                Math.min(tr.mapping.map(rawDropPos), tr.doc.content.size)
              );

              let insertPos = mappedDropPos;
              try {
                const mediaSlice = new Slice(Fragment.from(nodeToMove), 0, 0);
                const calculated = dropPoint(tr.doc, mappedDropPos, mediaSlice);
                if (typeof calculated === 'number') {
                  insertPos = calculated;
                } else {
                  const $pos = tr.doc.resolve(mappedDropPos);
                  if ($pos.depth > 0) {
                    const isCloserToEnd = $pos.parentOffset > $pos.parent.content.size / 2;
                    insertPos = isCloserToEnd ? $pos.after() : $pos.before();
                  }
                }
              } catch {
                const $pos = tr.doc.resolve(mappedDropPos);
                if ($pos.depth > 0) {
                  insertPos = $pos.after();
                }
              }

              insertPos = Math.max(0, Math.min(insertPos, tr.doc.content.size));
              tr.insert(insertPos, nodeToMove);

              // Se inseriu no final absoluto do documento, garante parágrafo para digitação
              const afterPos = insertPos + nodeToMove.nodeSize;
              if (afterPos >= tr.doc.content.size) {
                const paragraphType = schema.nodes.paragraph;
                if (paragraphType) {
                  tr.insert(afterPos, paragraphType.create());
                }
              }

              try {
                tr.setSelection(NodeSelection.create(tr.doc, insertPos));
              } catch {}
            }

            // 4. Validação anti-duplicação
            const mediaId = getMediaIdentifier(nodeToMove);
            if (mediaId && currentOrigin) {
              const occurrences = countMediaOccurrencesInDoc(tr.doc, mediaId);
              if (occurrences > 1) {
                console.warn('[MEDIA-DRAG] Duplicação evitada:', { mediaId, occurrences });
              }
            }

            tr.scrollIntoView();
            view.focus();
            view.dispatch(tr);
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});
