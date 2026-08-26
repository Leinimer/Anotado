'use client';

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { Node as PMNode } from '@tiptap/pm/model';

const MEDIA_NODE_NAMES = ['image', 'documentAttachment', 'youtube'];

interface DraggedMediaOrigin {
  pos: number;
  node: PMNode;
  mediaId: string;
  insideGroup: boolean;
  groupPos?: number;
  childIndex?: number;
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

export const SmartMediaDragDrop = Extension.create({
  name: 'smartMediaDragDrop',

  addProseMirrorPlugins() {
    let dropIndicatorEl: HTMLDivElement | null = null;
    let draggedOrigin: DraggedMediaOrigin | null = null;

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
        // Indicador vertical lateral (agrupamento lado a lado)
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
              const targetEl = event.target as HTMLElement | null;
              if (!targetEl) return false;

              // Localiza o wrapper do nó de mídia ou o drag handle
              const mediaWrapper = targetEl.closest<HTMLElement>(
                '.image-node-view-wrapper, .document-attachment-wrapper, .youtube-node-view-wrapper'
              );

              if (mediaWrapper && view.dom.contains(mediaWrapper)) {
                try {
                  const pos = view.posAtDOM(mediaWrapper, 0);
                  if (typeof pos === 'number') {
                    const { doc } = view.state;
                    const $pos = doc.resolve(pos);
                    const node =
                      $pos.nodeAfter ||
                      ($pos.parent && MEDIA_NODE_NAMES.includes($pos.parent.type.name)
                        ? $pos.parent
                        : null);

                    const mediaNode =
                      node && MEDIA_NODE_NAMES.includes(node.type.name) ? node : null;

                    if (mediaNode) {
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

                      // OBRIGATÓRIO: Converte o nó em NodeSelection no início do drag
                      try {
                        const selection = NodeSelection.create(doc, pos);
                        const tr = view.state.tr.setSelection(selection);
                        view.dispatch(tr);

                        console.log('[MEDIA-DRAG] START', {
                          originPos: pos,
                          nodeType: mediaNode.type.name,
                          mediaId,
                          selectionInstance: view.state.selection instanceof NodeSelection,
                          selectionFrom: selection.from,
                          selectionTo: selection.to,
                        });
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

                      console.log('[MEDIA-DRAG] ORIGIN', draggedOrigin);
                      console.log('[MEDIA-DRAG] NODE TYPE', mediaNode.type.name);
                      console.log('[MEDIA-DRAG] ATTACHMENT ID', mediaId);
                      console.log('[MEDIA-DRAG] SELECTION', {
                        isNodeSelection: view.state.selection instanceof NodeSelection,
                        from: view.state.selection.from,
                        to: view.state.selection.to,
                      });
                    }
                  }
                } catch (err) {
                  console.warn('[MEDIA-DRAG] Erro ao registrar origem do drag de mídia:', err);
                }
              }
              return false;
            },

            dragend() {
              hideIndicator();
              draggedOrigin = null;
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
                const relX = clientX - rect.left;
                const relY = clientY - rect.top;

                // Se estiver na metade esquerda ou direita da mídia
                const isLeftSide = relX < rect.width * 0.45;
                const isRightSide = relX > rect.width * 0.55;

                if (isLeftSide) {
                  showIndicator(
                    {
                      top: rect.top,
                      left: rect.left - 4,
                      width: 4,
                      height: rect.height,
                    },
                    true
                  );
                  return false;
                } else if (isRightSide) {
                  showIndicator(
                    {
                      top: rect.top,
                      left: rect.right,
                      width: 4,
                      height: rect.height,
                    },
                    true
                  );
                  return false;
                } else {
                  // Top ou Bottom da mídia
                  const isTop = relY < rect.height / 2;
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

            if (!nodeToMove) {
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

            if (!nodeToMove) {
              draggedOrigin = null;
              return false; // Deixa o ProseMirror tratar outros drops normalmente
            }

            const mediaId = getMediaIdentifier(nodeToMove);
            const beforeOccurrences = countMediaOccurrencesInDoc(view.state.doc, mediaId);

            console.log('[MEDIA-DRAG] DROP', {
              mediaId,
              nodeType: nodeToMove.type.name,
              beforeOccurrences,
            });

            const elementUnder = document.elementFromPoint(clientX, clientY);
            if (!elementUnder) {
              draggedOrigin = null;
              return false;
            }

            const mediaWrapper = elementUnder.closest<HTMLElement>(
              '.image-node-view-wrapper, .document-attachment-wrapper, .youtube-node-view-wrapper'
            );
            const mediaGroupWrapper = elementUnder.closest<HTMLElement>('[data-media-group]');

            const { state } = view;
            const { doc, schema } = state;
            const mediaGroupType = schema.nodes.mediaGroup;

            if (!mediaGroupType) {
              draggedOrigin = null;
              return false;
            }

            // Inicia uma única transação atômica do ProseMirror para a operação MOVE REAL
            const tr = state.tr;

            // 1. Identifica a posição de destino antes de qualquer mutação
            let targetPos: number | null = null;
            let isLeftSide = false;
            let targetIsGroup = false;

            if (mediaWrapper && view.dom.contains(mediaWrapper)) {
              const rect = mediaWrapper.getBoundingClientRect();
              const relX = clientX - rect.left;
              isLeftSide = relX < rect.width * 0.5;

              const pos = view.posAtDOM(mediaWrapper, 0);
              if (typeof pos === 'number') {
                targetPos = pos;
              }
            } else if (mediaGroupWrapper && view.dom.contains(mediaGroupWrapper)) {
              const pos = view.posAtDOM(mediaGroupWrapper, 0);
              if (typeof pos === 'number') {
                targetPos = pos;
                targetIsGroup = true;
              }
            }

            console.log('[MEDIA-DRAG] TARGET', {
              targetPos,
              isLeftSide,
              targetIsGroup,
            });

            // Se for drop no mesmo local exato, cancela
            if (draggedOrigin && targetPos !== null && draggedOrigin.pos === targetPos) {
              draggedOrigin = null;
              event.preventDefault();
              return true;
            }

            // 2. Remove o nó da posição de ORIGEM (DELETE ORIGINAL)
            if (draggedOrigin) {
              const originPos = draggedOrigin.pos;
              const $originPos = doc.resolve(originPos);

              if (draggedOrigin.insideGroup && $originPos.parent.type.name === 'mediaGroup') {
                const groupPos = $originPos.before();
                const groupNode = $originPos.parent;
                const remainingChildren: PMNode[] = [];

                let idx = 0;
                groupNode.forEach((child) => {
                  if (draggedOrigin?.childIndex !== undefined) {
                    if (idx !== draggedOrigin.childIndex) {
                      remainingChildren.push(child);
                    }
                  } else if (child !== draggedOrigin?.node) {
                    remainingChildren.push(child);
                  }
                  idx++;
                });

                if (remainingChildren.length === 0) {
                  // Grupo ficou vazio -> remove o grupo inteiro
                  tr.delete(groupPos, groupPos + groupNode.nodeSize);
                } else if (remainingChildren.length === 1) {
                  // Restou apenas 1 filho -> desempacota para nó standalone
                  tr.replaceWith(groupPos, groupPos + groupNode.nodeSize, remainingChildren[0]);
                } else {
                  // Restaram 2+ filhos -> atualiza o mediaGroup com os filhos restantes
                  const updatedGroup = mediaGroupType.create(groupNode.attrs, remainingChildren);
                  tr.replaceWith(groupPos, groupPos + groupNode.nodeSize, updatedGroup);
                }
              } else {
                // Nó standalone original -> deleta o bloco original
                const originNodeSize = draggedOrigin.node.nodeSize;
                tr.delete(originPos, originPos + originNodeSize);
              }
            }

            console.log('[MEDIA-DRAG] MOVE - Original node deleted from origin');

            // 3. Insere o nó no DESTINO mapeado (INSERT DESTINO)
            if (targetPos !== null) {
              // Mapeia a posição do alvo após a deleção da origem
              const mappedTargetPos = tr.mapping.map(targetPos);

              if (targetIsGroup) {
                // Soltou no container do mediaGroup
                const $target = tr.doc.resolve(mappedTargetPos);
                const groupNode =
                  $target.parent.type.name === 'mediaGroup'
                    ? $target.parent
                    : $target.nodeAfter;

                if (groupNode && groupNode.type.name === 'mediaGroup') {
                  const actualGroupPos =
                    $target.parent.type.name === 'mediaGroup'
                      ? $target.before()
                      : mappedTargetPos;
                  const childNodes: PMNode[] = [];
                  groupNode.forEach((c) => childNodes.push(c));
                  childNodes.push(nodeToMove!);

                  const newGroup = mediaGroupType.create(groupNode.attrs, childNodes);
                  tr.replaceWith(actualGroupPos, actualGroupPos + groupNode.nodeSize, newGroup);
                } else {
                  tr.insert(mappedTargetPos, nodeToMove!);
                }
              } else {
                // Soltou sobre uma mídia (standalone ou dentro de grupo)
                const $target = tr.doc.resolve(mappedTargetPos);
                const isTargetInsideGroup = $target.parent.type.name === 'mediaGroup';

                if (isTargetInsideGroup) {
                  // Destino está dentro de um mediaGroup existente
                  const groupPos = $target.before();
                  const groupNode = $target.parent;
                  const childNodes: PMNode[] = [];

                  let inserted = false;
                  groupNode.forEach((child, offset) => {
                    const childPos = groupPos + 1 + offset;
                    if (childPos === mappedTargetPos) {
                      if (isLeftSide) {
                        childNodes.push(nodeToMove!);
                        childNodes.push(child);
                      } else {
                        childNodes.push(child);
                        childNodes.push(nodeToMove!);
                      }
                      inserted = true;
                    } else {
                      childNodes.push(child);
                    }
                  });

                  if (!inserted) {
                    if (isLeftSide) childNodes.unshift(nodeToMove!);
                    else childNodes.push(nodeToMove!);
                  }

                  const newGroup = mediaGroupType.create(groupNode.attrs, childNodes);
                  tr.replaceWith(groupPos, groupPos + groupNode.nodeSize, newGroup);
                } else {
                  // Destino é mídia standalone -> agrupa lado a lado criando novo mediaGroup
                  const targetNode = $target.nodeAfter;
                  if (targetNode && MEDIA_NODE_NAMES.includes(targetNode.type.name)) {
                    const combinedNodes = isLeftSide
                      ? [nodeToMove!, targetNode]
                      : [targetNode, nodeToMove!];

                    const newGroup = mediaGroupType.create(null, combinedNodes);
                    tr.replaceWith(
                      mappedTargetPos,
                      mappedTargetPos + targetNode.nodeSize,
                      newGroup
                    );
                  } else {
                    tr.insert(mappedTargetPos, nodeToMove!);
                  }
                }
              }
            } else {
              // Soltou em posição normal de texto (entre blocos)
              const rawDropPos =
                view.posAtCoords({ left: clientX, top: clientY })?.pos ??
                tr.doc.content.size;
              const mappedDropPos = Math.min(
                tr.mapping.map(rawDropPos),
                tr.doc.content.size
              );
              tr.insert(mappedDropPos, nodeToMove!);
            }

            // 4. VALIDAÇÃO RIGOROSA ANTI-DUPLICAÇÃO (Regra 12)
            if (mediaId) {
              const afterOccurrences = countMediaOccurrencesInDoc(tr.doc, mediaId);
              if (afterOccurrences > beforeOccurrences) {
                console.error(
                  '[MEDIA-DRAG] ERRO CRÍTICO: Duplicação detectada! Abortando transação.',
                  {
                    mediaId,
                    beforeOccurrences,
                    afterOccurrences,
                  }
                );
                draggedOrigin = null;
                event.preventDefault();
                return false;
              }
            }

            // 5. Executa a transação única de MOVE e limpa a origem
            draggedOrigin = null;
            view.dispatch(tr);
            event.preventDefault();

            console.log('[MEDIA-DRAG] COMPLETE', {
              mediaId,
              success: true,
            });

            return true;
          },
        },
      }),
    ];
  },
});
