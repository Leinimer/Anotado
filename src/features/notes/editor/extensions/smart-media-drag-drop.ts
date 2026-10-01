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
    // Para React NodeViews, prefira identificar o DOM real do nó.
    const { doc } = view.state;
    let found: { pos: number; node: PMNode } | null = null;

    doc.descendants((node: PMNode, pos: number) => {
      if (found || !MEDIA_NODE_NAMES.includes(node.type.name)) return false;

      const nodeDOM = typeof view.nodeDOM === 'function' ? view.nodeDOM(pos) : null;
      if (nodeDOM instanceof HTMLElement && (nodeDOM === element || nodeDOM.contains(element) || element.contains(nodeDOM))) {
        found = { pos, node };
        return false;
      }

      return true;
    });

    if (found) return found;

    // Fallback para a árvore interna do ProseMirror.
    const desc = view.docView?.nearestDesc(element, true);
    if (desc && desc.node && MEDIA_NODE_NAMES.includes(desc.node.type.name)) {
      return { pos: desc.posBefore, node: desc.node };
    }

    // Último fallback: posAtDOM.
    const pos = view.posAtDOM(element, 0);
    if (typeof pos === 'number') {
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
    let activeMediaDropTarget: {
      mediaWrapper: HTMLElement;
      isTop: boolean;
      timestamp: number;
    } | null = null;

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
              activeMediaDropTarget = null;

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

                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/x-anotado-media-id', mediaId);
                      event.dataTransfer.setData('text/x-anotado-media-pos', String(pos));
                      event.dataTransfer.setData('text/x-anotado-media-type', mediaNode.type.name);
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
              setTimeout(() => {
                draggedOrigin = null;
                draggedTextOrigin = null;
                activeMediaDropTarget = null;
              }, 400);
              return false;
            },

            dragleave(view, event) {
              if (!view.dom.contains(event.relatedTarget as Node)) {
                hideIndicator();
                activeMediaDropTarget = null;
              }
              return false;
            },

            dragover(view, event) {
              const clientX = event.clientX;
              const clientY = event.clientY;

              const elementUnder = document.elementFromPoint(clientX, clientY);
              const targetNode = event.target as Node | null;
              const targetEl = targetNode instanceof Element ? targetNode : targetNode?.parentElement;

              // Localiza wrapper de nó de mídia ou grupo
              const mediaWrapper =
                elementUnder?.closest<HTMLElement>(
                  '.image-node-view-wrapper, .document-attachment-wrapper, .youtube-node-view-wrapper, [data-media-group]'
                ) ||
                targetEl?.closest<HTMLElement>(
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

                activeMediaDropTarget = {
                  mediaWrapper,
                  isTop,
                  timestamp: Date.now(),
                };

                event.preventDefault();
                return true;
              }

              hideIndicator();
              activeMediaDropTarget = null;
              return false;
            },
          },

          handleDrop(view, event, slice) {
            hideIndicator();

            if (!view.editable) return false;

            const clientX = event.clientX;
            const clientY = event.clientY;

            // Extrai o nó de mídia sendo arrastado do slice, da origem capturada ou do dataTransfer
            let nodeToMove: PMNode | null = draggedOrigin?.node || null;

            if (!nodeToMove && event.dataTransfer) {
              const posStr = event.dataTransfer.getData('text/x-anotado-media-pos');
              if (posStr) {
                const p = parseInt(posStr, 10);
                if (!isNaN(p) && p >= 0 && p < view.state.doc.content.size) {
                  const n = view.state.doc.nodeAt(p);
                  if (n && MEDIA_NODE_NAMES.includes(n.type.name)) {
                    nodeToMove = n;
                    if (!draggedOrigin) {
                      draggedOrigin = {
                        pos: p,
                        node: n,
                        mediaId: getMediaIdentifier(n),
                        insideGroup: false,
                      };
                    }
                  }
                }
              }
            }

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
                  tr.delete(from, to);

                  const mappedInsertPos = tr.mapping.map(rawDropPos);

                  let finalInsertPos = mappedInsertPos;
                  try {
                    const calculated = dropPoint(tr.doc, mappedInsertPos, sliceToInsert);
                    if (typeof calculated === 'number') {
                      finalInsertPos = calculated;
                    }
                  } catch {}
                  finalInsertPos = Math.max(0, Math.min(finalInsertPos, tr.doc.content.size));

                  tr.replaceRange(finalInsertPos, finalInsertPos, sliceToInsert);

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

            // Prioriza o alvo ativo capturado durante o dragover (onde a linha visual foi desenhada)
            let targetMediaWrapper: HTMLElement | null = null;
            let isTop = false;

            if (
              activeMediaDropTarget &&
              Date.now() - activeMediaDropTarget.timestamp < 1000 &&
              view.dom.contains(activeMediaDropTarget.mediaWrapper)
            ) {
              targetMediaWrapper = activeMediaDropTarget.mediaWrapper;
              isTop = activeMediaDropTarget.isTop;
            }

            if (!targetMediaWrapper) {
              const elementUnder = document.elementFromPoint(clientX, clientY);
              const targetNode = event.target as Node | null;
              const targetEl = targetNode instanceof Element ? targetNode : targetNode?.parentElement;
              targetMediaWrapper =
                elementUnder?.closest<HTMLElement>(
                  '.image-node-view-wrapper, .document-attachment-wrapper, .youtube-node-view-wrapper'
                ) ||
                targetEl?.closest<HTMLElement>(
                  '.image-node-view-wrapper, .document-attachment-wrapper, .youtube-node-view-wrapper'
                ) ||
                null;

              if (targetMediaWrapper) {
                const rect = targetMediaWrapper.getBoundingClientRect();
                const relY = clientY - rect.top;
                isTop = relY < rect.height * 0.5;
              }
            }

            activeMediaDropTarget = null;

            const { state } = view;
            const { doc, schema } = state;
            const tr = state.tr;

            // 1. Identifica a posição de destino no documento
            let targetPos: number | null = null;
            let targetNodeSize = 0;

            if (targetMediaWrapper && view.dom.contains(targetMediaWrapper)) {
              const found = findMediaNodeAtDOM(view, targetMediaWrapper);
              if (found) {
                targetPos = found.pos;
                targetNodeSize = found.node.nodeSize;
              }
            }

            // 2. Se a origem não foi encontrada via state, localiza pelo ID da mídia no doc
            let effectiveOriginPos = currentOrigin?.pos;
            if (effectiveOriginPos === undefined && nodeToMove) {
              const mediaId = getMediaIdentifier(nodeToMove);
              if (mediaId) {
                doc.descendants((node, pos) => {
                  if (effectiveOriginPos !== undefined) return false;
                  if (MEDIA_NODE_NAMES.includes(node.type.name)) {
                    if (getMediaIdentifier(node) === mediaId) {
                      effectiveOriginPos = pos;
                      return false;
                    }
                  }
                });
              }
            }

            // Se for soltar na mesma mídia na mesma posição, cancela
            if (effectiveOriginPos !== undefined && targetPos !== null && effectiveOriginPos === targetPos) {
              event.preventDefault();
              return true;
            }

            // 3. Remove a origem e insere o MESMO nó no destino na mesma transação.
            // O alvo é mapeado novamente depois do delete para não perder a posição quando
            // a origem estiver acima do destino.
            const originPos = typeof effectiveOriginPos === 'number' ? effectiveOriginPos : null;
            const sourceNode = originPos !== null ? doc.nodeAt(originPos) : nodeToMove;

            if (!sourceNode || !MEDIA_NODE_NAMES.includes(sourceNode.type.name)) {
              event.preventDefault();
              event.stopPropagation();
              return true;
            }

            nodeToMove = sourceNode;

            if (originPos !== null && targetPos !== null && originPos === targetPos) {
              event.preventDefault();
              event.stopPropagation();
              return true;
            }

            // Não deixe o drop nativo executar uma segunda operação.
            event.preventDefault();
            event.stopPropagation();

            if (originPos !== null) {
              tr.delete(originPos, originPos + nodeToMove.nodeSize);
            }

            let insertPos: number;

            if (targetPos !== null) {
              const rawTargetPos = isTop ? targetPos : targetPos + targetNodeSize;
              insertPos = tr.mapping.map(rawTargetPos, isTop ? -1 : 1);
            } else {
              const coords = view.posAtCoords({ left: clientX, top: clientY });
              const rawDropPos = coords ? coords.pos : tr.doc.content.size;
              const mappedDropPos = tr.mapping.map(rawDropPos, 1);

              insertPos = mappedDropPos;

              try {
                const mediaSlice = new Slice(Fragment.from(nodeToMove), 0, 0);
                const calculated = dropPoint(tr.doc, mappedDropPos, mediaSlice);
                if (typeof calculated === 'number') {
                  insertPos = calculated;
                }
              } catch {
                // Usa mappedDropPos como fallback.
              }
            }

            insertPos = Math.max(0, Math.min(insertPos, tr.doc.content.size));

            try {
              tr.insert(insertPos, nodeToMove);
            } catch {
              const mediaSlice = new Slice(Fragment.from(nodeToMove), 0, 0);
              const fallbackPos = dropPoint(tr.doc, insertPos, mediaSlice);

              if (typeof fallbackPos !== 'number') {
                console.warn('[MEDIA-DRAG] Não foi possível inserir a mídia no destino.', {
                  originPos,
                  targetPos,
                  insertPos,
                });
                return true;
              }

              insertPos = fallbackPos;
              tr.insert(insertPos, nodeToMove);
            }

            try {
              tr.setSelection(NodeSelection.create(tr.doc, insertPos));
            } catch {}

            const afterPos = insertPos + nodeToMove.nodeSize;
            if (afterPos >= tr.doc.content.size) {
              const paragraphType = schema.nodes.paragraph;
              if (paragraphType) {
                tr.insert(afterPos, paragraphType.create());
              }
            }

            // 5. Validação anti-duplicação
            const mediaId = getMediaIdentifier(nodeToMove);
            if (mediaId && effectiveOriginPos !== undefined) {
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
