'use client';

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { Node as PMNode, Slice } from '@tiptap/pm/model';

const MEDIA_NODE_NAMES = ['image', 'documentAttachment', 'youtube'];

export const SmartMediaDragDrop = Extension.create({
  name: 'smartMediaDragDrop',

  addProseMirrorPlugins() {
    let dropIndicatorEl: HTMLDivElement | null = null;

    const getOrCreateIndicator = () => {
      if (!dropIndicatorEl && typeof document !== 'undefined') {
        dropIndicatorEl = document.createElement('div');
        dropIndicatorEl.className = 'smart-media-drop-indicator pointer-events-none fixed z-50 transition-all duration-75';
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

    const showIndicator = (rect: { top: number; left: number; width: number; height: number }, isSide: boolean) => {
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
        el.style.boxShadow = '0 0 6px rgba(104, 89, 77, 0.4)';
        el.style.display = 'block';
      } else {
        // Indicador horizontal (entre blocos)
        el.style.top = `${rect.top}px`;
        el.style.left = `${rect.left}px`;
        el.style.width = `${rect.width}px`;
        el.style.height = '3px';
        el.style.backgroundColor = '#68594d';
        el.style.borderRadius = '2px';
        el.style.boxShadow = '0 0 6px rgba(104, 89, 77, 0.4)';
        el.style.display = 'block';
      }
    };

    return [
      new Plugin({
        key: new PluginKey('smartMediaDragDrop'),
        props: {
          handleDOMEvents: {
            dragend() {
              hideIndicator();
              return false;
            },
            dragleave(view, event) {
              // Se o cursor saiu do editor, oculta o indicador
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
                const isLeftSide = relX < rect.width * 0.4;
                const isRightSide = relX > rect.width * 0.6;

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
                  return false; // Permite que o evento continue para o drop
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

          handleDrop(view, event, slice, moved) {
            hideIndicator();

            if (!view.editable) return false;

            const clientX = event.clientX;
            const clientY = event.clientY;

            // Extrai o nó de mídia sendo arrastado do slice
            let draggedMediaNode: PMNode | null = null;
            slice.content.forEach((node) => {
              if (MEDIA_NODE_NAMES.includes(node.type.name)) {
                draggedMediaNode = node;
              } else if (node.type.name === 'mediaGroup') {
                node.forEach((child) => {
                  if (MEDIA_NODE_NAMES.includes(child.type.name) && !draggedMediaNode) {
                    draggedMediaNode = child;
                  }
                });
              }
            });

            if (!draggedMediaNode) {
              return false; // Deixa o ProseMirror tratar outros drops normalmente
            }

            const elementUnder = document.elementFromPoint(clientX, clientY);
            if (!elementUnder) return false;

            const mediaWrapper = elementUnder.closest<HTMLElement>(
              '.image-node-view-wrapper, .document-attachment-wrapper, .youtube-node-view-wrapper'
            );

            const mediaGroupWrapper = elementUnder.closest<HTMLElement>('[data-media-group]');

            const { state } = view;
            const { doc, schema, tr } = state;
            const mediaGroupType = schema.nodes.mediaGroup;

            if (!mediaGroupType) return false;

            // Caso 1: Soltar ao lado de uma mídia standalone ou dentro de um mediaGroup
            if (mediaWrapper && view.dom.contains(mediaWrapper)) {
              const rect = mediaWrapper.getBoundingClientRect();
              const relX = clientX - rect.left;
              const isLeftSide = relX < rect.width * 0.5;

              // Encontra a posição do nó alvo no ProseMirror
              const targetPos = view.posAtDOM(mediaWrapper, 0);
              if (typeof targetPos !== 'number') return false;

              const $pos = doc.resolve(targetPos);
              const isTargetInsideGroup = $pos.parent.type.name === 'mediaGroup';

              if (isTargetInsideGroup) {
                // Insere dentro do mediaGroup existente
                const groupPos = $pos.before();
                const groupNode = $pos.parent;
                const childNodes: PMNode[] = [];

                let inserted = false;
                groupNode.forEach((child, offset) => {
                  const childPos = groupPos + 1 + offset;
                  if (childPos === targetPos) {
                    if (isLeftSide) {
                      childNodes.push(draggedMediaNode!);
                      childNodes.push(child);
                    } else {
                      childNodes.push(child);
                      childNodes.push(draggedMediaNode!);
                    }
                    inserted = true;
                  } else {
                    childNodes.push(child);
                  }
                });

                if (!inserted) {
                  if (isLeftSide) childNodes.unshift(draggedMediaNode!);
                  else childNodes.push(draggedMediaNode!);
                }

                // Cria o novo mediaGroup com os filhos atualizados
                const newGroup = mediaGroupType.create(groupNode.attrs, childNodes);
                tr.replaceWith(groupPos, groupPos + groupNode.nodeSize, newGroup);
                view.dispatch(tr);
                event.preventDefault();
                return true;
              } else {
                // Alvo é mídia standalone -> Cria novo mediaGroup combinando as duas mídias
                const targetNode = $pos.nodeAfter || $pos.node(1);
                if (!targetNode || !MEDIA_NODE_NAMES.includes(targetNode.type.name)) {
                  return false;
                }

                const combinedNodes = isLeftSide
                  ? [draggedMediaNode, targetNode]
                  : [targetNode, draggedMediaNode];

                const newGroup = mediaGroupType.create(null, combinedNodes);
                tr.replaceWith(targetPos, targetPos + targetNode.nodeSize, newGroup);
                view.dispatch(tr);
                event.preventDefault();
                return true;
              }
            } else if (mediaGroupWrapper && view.dom.contains(mediaGroupWrapper)) {
              // Soltou dentro do container do mediaGroup
              const groupPos = view.posAtDOM(mediaGroupWrapper, 0);
              if (typeof groupPos === 'number') {
                const $pos = doc.resolve(groupPos);
                const groupNode = $pos.parent.type.name === 'mediaGroup' ? $pos.parent : $pos.nodeAfter;

                if (groupNode && groupNode.type.name === 'mediaGroup') {
                  const actualGroupPos = $pos.parent.type.name === 'mediaGroup' ? $pos.before() : groupPos;
                  const childNodes: PMNode[] = [];
                  groupNode.forEach((c) => childNodes.push(c));
                  childNodes.push(draggedMediaNode);

                  const newGroup = mediaGroupType.create(groupNode.attrs, childNodes);
                  tr.replaceWith(actualGroupPos, actualGroupPos + groupNode.nodeSize, newGroup);
                  view.dispatch(tr);
                  event.preventDefault();
                  return true;
                }
              }
            }

            // Caso 2: Soltar entre blocos normais (não sobre mídia)
            // ProseMirror fará o posicionamento limpo no cursor de drop
            return false;
          },
        },
      }),
    ];
  },
});
