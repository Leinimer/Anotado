'use client';

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { Node as PMNode } from '@tiptap/pm/model';

interface ActivePdfDrag {
  pos: number;
  node: PMNode;
  id: string;
}

interface ActivePdfDropTarget {
  targetPos: number;
  targetNode: PMNode;
  isTop: boolean;
  element: HTMLElement;
}

export const PdfDragDrop = Extension.create({
  name: 'pdfDragDrop',

  addProseMirrorPlugins() {
    let indicatorEl: HTMLDivElement | null = null;
    let activePdfDrag: ActivePdfDrag | null = null;
    let currentDropTarget: ActivePdfDropTarget | null = null;

    const getOrCreateIndicator = (): HTMLDivElement | null => {
      if (typeof document === 'undefined') return null;
      if (!indicatorEl) {
        indicatorEl = document.createElement('div');
        indicatorEl.className = 'pdf-drop-indicator pointer-events-none fixed z-50 transition-all duration-75';
        indicatorEl.style.display = 'none';
        indicatorEl.style.height = '3px';
        indicatorEl.style.backgroundColor = '#68594d';
        indicatorEl.style.borderRadius = '2px';
        indicatorEl.style.boxShadow = '0 0 8px rgba(104, 89, 77, 0.6)';
        document.body.appendChild(indicatorEl);
      }
      return indicatorEl;
    };

    const showIndicator = (rect: { top: number; left: number; width: number }) => {
      const el = getOrCreateIndicator();
      if (!el) return;
      el.style.top = `${rect.top}px`;
      el.style.left = `${rect.left}px`;
      el.style.width = `${rect.width}px`;
      el.style.display = 'block';
    };

    const hideIndicator = () => {
      if (indicatorEl) {
        indicatorEl.style.display = 'none';
      }
    };

    const findPdfNodeAtDOM = (
      view: any,
      element: HTMLElement
    ): { pos: number; node: PMNode } | null => {
      try {
        const { doc } = view.state;

        // 1. Tenta pelo nearestDesc do ProseMirror
        const desc = view.docView?.nearestDesc(element, true);
        if (desc && desc.node && desc.node.type.name === 'documentAttachment') {
          return { pos: desc.posBefore, node: desc.node };
        }

        // 2. Tenta por posAtDOM
        const pos = view.posAtDOM(element, 0);
        if (typeof pos === 'number') {
          const safePos = Math.max(0, Math.min(pos, doc.content.size));
          const nodeAt = doc.nodeAt(safePos);
          if (nodeAt && nodeAt.type.name === 'documentAttachment') {
            return { pos: safePos, node: nodeAt };
          }
          const $pos = doc.resolve(safePos);
          if ($pos.nodeAfter && $pos.nodeAfter.type.name === 'documentAttachment') {
            return { pos: safePos, node: $pos.nodeAfter };
          }
          if ($pos.nodeBefore && $pos.nodeBefore.type.name === 'documentAttachment') {
            return { pos: safePos - $pos.nodeBefore.nodeSize, node: $pos.nodeBefore };
          }
        }

        // 3. Fallback: varre doc procurando por atributos correspondentes no DOM
        const linkEl = element.querySelector('a');
        const src = linkEl?.getAttribute('href') || element.getAttribute('data-src');
        const nameEl = element.querySelector('p');
        const name = nameEl?.textContent?.trim();

        let found: { pos: number; node: PMNode } | null = null;
        doc.descendants((node: PMNode, p: number) => {
          if (found) return false;
          if (node.type.name === 'documentAttachment') {
            if (src && node.attrs.src === src) {
              found = { pos: p, node };
              return false;
            }
            if (name && node.attrs.name === name) {
              found = { pos: p, node };
              return false;
            }
          }
        });

        return found;
      } catch (err) {
        console.warn('[PDF-DRAG] Error in findPdfNodeAtDOM:', err);
        return null;
      }
    };

    return [
      new Plugin({
        key: new PluginKey('pdfDragDrop'),
        props: {
          handleDOMEvents: {
            dragstart(view, event) {
              if (!view.editable) return false;

              const target = event.target as HTMLElement | null;
              if (!target) return false;

              const wrapper = target.closest<HTMLElement>(
                '.document-attachment-wrapper, [data-type="documentAttachment"]'
              );
              if (!wrapper || !view.dom.contains(wrapper)) return false;

              const found = findPdfNodeAtDOM(view, wrapper);
              if (!found) return false;

              const { pos, node } = found;
              const pdfId = node.attrs.src || node.attrs.name || String(pos);

              activePdfDrag = { pos, node, id: pdfId };
              currentDropTarget = null;

              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-anotado-pdf-drag', pdfId);
                event.dataTransfer.setData('text/plain', node.attrs.name || 'PDF');
              }

              return false;
            },

            dragover(view, event) {
              if (!activePdfDrag && !event.dataTransfer?.types.includes('application/x-anotado-pdf-drag')) {
                return false;
              }

              const clientX = event.clientX;
              const clientY = event.clientY;

              const elementUnder = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
              const target = event.target as HTMLElement | null;
              const wrapper =
                elementUnder?.closest<HTMLElement>(
                  '.document-attachment-wrapper, [data-type="documentAttachment"]'
                ) ||
                target?.closest<HTMLElement>(
                  '.document-attachment-wrapper, [data-type="documentAttachment"]'
                );

              if (wrapper && view.dom.contains(wrapper)) {
                const found = findPdfNodeAtDOM(view, wrapper);
                if (found) {
                  const rect = wrapper.getBoundingClientRect();
                  const relY = clientY - rect.top;
                  const isTop = relY < rect.height * 0.5;

                  showIndicator({
                    top: isTop ? rect.top - 2 : rect.bottom + 2,
                    left: rect.left,
                    width: rect.width,
                  });

                  currentDropTarget = {
                    targetPos: found.pos,
                    targetNode: found.node,
                    isTop,
                    element: wrapper,
                  };

                  event.preventDefault();
                  if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = 'move';
                  }
                  return true;
                }
              }

              hideIndicator();
              currentDropTarget = null;
              return false;
            },

            dragleave(view, event) {
              if (!view.dom.contains(event.relatedTarget as Node)) {
                hideIndicator();
                currentDropTarget = null;
              }
              return false;
            },

            dragend() {
              hideIndicator();
              setTimeout(() => {
                activePdfDrag = null;
                currentDropTarget = null;
              }, 100);
              return false;
            },
          },

          handleDrop(view, event, _slice) {
            if (!activePdfDrag && !event.dataTransfer?.getData('application/x-anotado-pdf-drag')) {
              return false;
            }

            hideIndicator();

            if (!view.editable) return false;

            const dropTarget = currentDropTarget;
            const dragged = activePdfDrag;
            currentDropTarget = null;
            activePdfDrag = null;

            if (!dragged) {
              return false;
            }

            // 1. Encontra a posição REAL do PDF de origem no documento atual
            const { doc } = view.state;
            let sourcePos: number | null = null;
            let sourceNode: PMNode | null = null;

            const nodeAtRecordedPos = dragged.pos < doc.content.size ? doc.nodeAt(dragged.pos) : null;
            if (
              nodeAtRecordedPos &&
              nodeAtRecordedPos.type.name === 'documentAttachment' &&
              (nodeAtRecordedPos.attrs.src === dragged.node.attrs.src ||
                nodeAtRecordedPos.attrs.name === dragged.node.attrs.name)
            ) {
              sourcePos = dragged.pos;
              sourceNode = nodeAtRecordedPos;
            } else {
              doc.descendants((node, pos) => {
                if (sourcePos !== null) return false;
                if (node.type.name === 'documentAttachment') {
                  if (dragged.node.attrs.src && node.attrs.src === dragged.node.attrs.src) {
                    sourcePos = pos;
                    sourceNode = node;
                    return false;
                  }
                  if (dragged.node.attrs.name && node.attrs.name === dragged.node.attrs.name) {
                    sourcePos = pos;
                    sourceNode = node;
                    return false;
                  }
                }
              });
            }

            if (sourcePos === null || !sourceNode) {
              return false;
            }

            // 2. Encontra a posição REAL do PDF alvo no documento atual
            let targetPos: number | null = null;
            let targetNode: PMNode | null = null;
            let isTop = false;

            if (dropTarget) {
              isTop = dropTarget.isTop;
              const nodeAtTarget =
                dropTarget.targetPos < doc.content.size ? doc.nodeAt(dropTarget.targetPos) : null;
              if (
                nodeAtTarget &&
                nodeAtTarget.type.name === 'documentAttachment' &&
                (nodeAtTarget.attrs.src === dropTarget.targetNode.attrs.src ||
                  nodeAtTarget.attrs.name === dropTarget.targetNode.attrs.name)
              ) {
                targetPos = dropTarget.targetPos;
                targetNode = nodeAtTarget;
              } else {
                doc.descendants((node, pos) => {
                  if (targetPos !== null) return false;
                  if (node.type.name === 'documentAttachment') {
                    if (
                      dropTarget.targetNode.attrs.src &&
                      node.attrs.src === dropTarget.targetNode.attrs.src
                    ) {
                      targetPos = pos;
                      targetNode = node;
                      return false;
                    }
                    if (
                      dropTarget.targetNode.attrs.name &&
                      node.attrs.name === dropTarget.targetNode.attrs.name
                    ) {
                      targetPos = pos;
                      targetNode = node;
                      return false;
                    }
                  }
                });
              }
            }

            // Fallback se dropTarget não estava memorizado
            if (targetPos === null) {
              const el = (
                document.elementFromPoint(event.clientX, event.clientY) ||
                (event.target as Element)
              )?.closest<HTMLElement>(
                '.document-attachment-wrapper, [data-type="documentAttachment"]'
              );
              if (el && view.dom.contains(el)) {
                const found = findPdfNodeAtDOM(view, el);
                if (found) {
                  targetPos = found.pos;
                  targetNode = found.node;
                  const rect = el.getBoundingClientRect();
                  isTop = event.clientY - rect.top < rect.height * 0.5;
                }
              }
            }

            if (targetPos === null || !targetNode) {
              return false;
            }

            // Se for soltar na mesma mídia na mesma posição, cancela
            if (sourcePos === targetPos) {
              event.preventDefault();
              event.stopPropagation();
              return true;
            }

            // 3. EXECUTA A REORDENAÇÃO EM UMA ÚNICA TRANSAÇÃO ATÔMICA
            event.preventDefault();
            event.stopPropagation();

            const tr = view.state.tr;
            const sourceSize = sourceNode.nodeSize;
            const targetSize = targetNode.nodeSize;

            // Posição de destino no documento ANTES de deletar:
            // isTop: antes do nó alvo (targetPos)
            // !isTop: depois do nó alvo (targetPos + targetSize)
            const rawTargetInsertPos = isTop ? targetPos : targetPos + targetSize;

            // Remove o nó PDF original da posição de origem
            tr.delete(sourcePos, sourcePos + sourceSize);

            // Recalcula/mapeia a posição de destino no documento após a remoção
            const finalInsertPos = Math.max(
              0,
              Math.min(tr.mapping.map(rawTargetInsertPos), tr.doc.content.size)
            );

            // Insere o MESMO nó PDF original preservando todos os atributos
            tr.insert(finalInsertPos, sourceNode);

            // Mantém a seleção no nó reposicionado
            try {
              tr.setSelection(NodeSelection.create(tr.doc, finalInsertPos));
            } catch {}

            tr.scrollIntoView();
            view.focus();
            view.dispatch(tr);

            return true;
          },
        },
      }),
    ];
  },
});
