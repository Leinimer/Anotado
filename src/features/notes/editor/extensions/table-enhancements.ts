import { Extension, getHTMLFromFragment } from '@tiptap/core';
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from '@tiptap/extension-table';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';

const TABLE_MOVE_MIME = 'application/x-anotado-table';

export const AnotadoTable = Table.extend({
  /**
   * O app usa o pacote "tiptap-markdown" (aguingand), cuja API de
   * serialização é addStorage().markdown.serialize.
   *
   * Não usar renderMarkdown aqui: essa propriedade pertence à API oficial
   * @tiptap/markdown e é ignorada pelo pacote instalado no projeto.
   *
   * Exportar a tabela inteira como HTML preserva:
   * - conteúdo e marcas dentro das células;
   * - data-cell-tone em td e th;
   * - data-row-height/height em tr;
   * - colwidth e larguras das colunas;
   * - primeira linha e primeira coluna sem exceções.
   */
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const html = getHTMLFromFragment(
            Fragment.from(node),
            node.type.schema
          );

          state.write(html);
          state.closeBlock(node);
        },
      },
    };
  },
}).configure({
  resizable: true,
  renderWrapper: true,
  handleWidth: 8,
  cellMinWidth: 80,
  lastColumnResizable: true,
  allowTableNodeSelection: true,
  HTMLAttributes: {
    class: 'anotado-table',
  },
});

export const AnotadoTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      rowHeight: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value =
            element.getAttribute('data-row-height') ||
            element.style.height ||
            '';
          const parsed = Number.parseFloat(value);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        },
        renderHTML: (attributes: Record<string, any>) => {
          const height = Number(attributes.rowHeight);
          if (!Number.isFinite(height) || height <= 0) return {};
          return {
            'data-row-height': String(Math.round(height)),
            style: `height: ${Math.round(height)}px`,
          };
        },
      },
    };
  },
});

function cellToneAttribute() {
  return {
    cellTone: {
      default: null,
      parseHTML: (element: HTMLElement) => element.getAttribute('data-cell-tone') || null,
      renderHTML: (attributes: Record<string, any>) =>
        attributes.cellTone ? { 'data-cell-tone': attributes.cellTone } : {},
    },
  };
}

export const AnotadoTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      ...cellToneAttribute(),
    };
  },
});

export const AnotadoTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      ...cellToneAttribute(),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    anotadoTable: {
      setTableColumnTone: (options: {
        tablePos: number;
        columnIndex: number;
        tone: string | null;
      }) => ReturnType;
      setTableAreaTone: (options: {
        tablePos: number;
        area: 'row' | 'column';
        index: number;
        tone: string | null;
      }) => ReturnType;
    };
  }
}

function findNodePositionFromDOM(
  view: any,
  target: HTMLElement,
  nodeName: string
): number | null {
  let found: number | null = null;

  view.state.doc.descendants((node: any, pos: number) => {
    if (node.type.name !== nodeName) return true;
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (dom && (dom === target || dom.contains(target) || target.contains(dom))) {
      found = pos;
      return false;
    }
    return true;
  });

  return found;
}

function findRowPosition(view: any, rowElement: HTMLTableRowElement): number | null {
  return findNodePositionFromDOM(view, rowElement, 'tableRow');
}

const ROW_SELECT_CURSOR =
  'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2218%22 height=%2218%22 viewBox=%220 0 18 18%22%3E%3Cpath d=%22M2 9h13m-5-5 5 5-5 5%22 fill=%22none%22 stroke=%22%23745d4a%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E") 9 9, pointer';

const COLUMN_SELECT_CURSOR =
  'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2218%22 height=%2218%22 viewBox=%220 0 18 18%22%3E%3Cpath d=%22M9 2v13m-5-5 5 5 5-5%22 fill=%22none%22 stroke=%22%23745d4a%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E") 9 9, pointer';

function getTableRowResizeTarget(
  view: any,
  clientX: number,
  clientY: number
): { rowElement: HTMLTableRowElement; rowPos: number; rowHeight: number } | null {
  const tables = Array.from(view.dom.querySelectorAll('table')) as HTMLTableElement[];
  let best: {
    rowElement: HTMLTableRowElement;
    rowPos: number;
    rowHeight: number;
    distance: number;
  } | null = null;

  for (const tableElement of tables) {
    const tableRect = tableElement.getBoundingClientRect();
    if (
      clientX < tableRect.left - 2 ||
      clientX > tableRect.right + 2 ||
      clientY < tableRect.top - 9 ||
      clientY > tableRect.bottom + 9
    ) continue;

    const cells = Array.from(tableElement.rows).flatMap((row) => Array.from(row.cells));
    const cellAtPointer = cells.find((cell) => {
      const rect = cell.getBoundingClientRect();
      return clientX >= rect.left - 2 && clientX <= rect.right + 2 &&
        clientY >= rect.top - 2 && clientY <= rect.bottom + 2;
    });
    // Preserva a prioridade do redimensionador vertical de coluna.
    if (cellAtPointer) {
      const cellRect = cellAtPointer.getBoundingClientRect();
      if (cellRect.right - clientX <= 5) continue;
    }

    for (const row of Array.from(tableElement.rows)) {
      const rect = row.getBoundingClientRect();
      const distance = Math.abs(rect.bottom - clientY);
      if (distance > 8 || (best !== null && distance >= best.distance)) continue;

      const rowPos = findRowPosition(view, row);
      if (rowPos === null) continue;

      best = {
        rowElement: row,
        rowPos,
        rowHeight: Math.max(40, Math.round(rect.height)),
        distance,
      };
    }
  }

  return best
    ? {
        rowElement: best.rowElement,
        rowPos: best.rowPos,
        rowHeight: best.rowHeight,
      }
    : null;
}

function getTableEdgeTarget(view: any, clientX: number, clientY: number): any | null {
  const tables = Array.from(view.dom.querySelectorAll('table')) as HTMLTableElement[];

  for (const tableElement of tables) {
    const firstRow = tableElement.rows[0];
    if (!firstRow || firstRow.cells.length === 0) continue;

    const wrapper = tableElement.closest('.tableWrapper') as HTMLElement | null;
    const wrapperRect = (wrapper || tableElement).getBoundingClientRect();
    const tableRect = tableElement.getBoundingClientRect();

    // Faixa lateral ampla: permite errar até 14 px acima/abaixo de cada divisória
    // horizontal e até 56 px para a esquerda da tabela.
    const inRowGutter =
      clientX >= wrapperRect.left - 56 &&
      clientX <= wrapperRect.left + 2;

    if (inRowGutter) {
      let nearestRowIndex = -1;
      let nearestRowDistance = Number.POSITIVE_INFINITY;

      Array.from(tableElement.rows).forEach((row, rowIndex) => {
        const rect = row.getBoundingClientRect();
        const distance =
          clientY < rect.top
            ? rect.top - clientY
            : clientY > rect.bottom
              ? clientY - rect.bottom
              : 0;

        if (distance <= 14 && distance < nearestRowDistance) {
          nearestRowDistance = distance;
          nearestRowIndex = rowIndex;
        }
      });

      if (nearestRowIndex >= 0) {
        const tablePos = findNodePositionFromDOM(view, tableElement, 'table');
        if (tablePos !== null) {
          return {
            tablePos,
            area: 'row' as const,
            rowIndex: nearestRowIndex,
            columnIndex: 0,
            rowCount: tableElement.rows.length,
            columnCount: firstRow.cells.length,
            viewDom: view.dom,
          };
        }
      }
    }

    // Faixa superior ampla: permite clicar 44 px acima ou 14 px abaixo
    // do topo da tabela. A tolerância horizontal também inclui as divisórias.
    const inColumnGutter =
      clientY >= tableRect.top - 44 &&
      clientY <= tableRect.top + 14;

    if (inColumnGutter) {
      let nearestColumnIndex = -1;
      let nearestColumnDistance = Number.POSITIVE_INFINITY;

      Array.from(firstRow.cells).forEach((cell, columnIndex) => {
        const rect = cell.getBoundingClientRect();
        const distance =
          clientX < rect.left
            ? rect.left - clientX
            : clientX > rect.right
              ? clientX - rect.right
              : 0;

        if (distance <= 12 && distance < nearestColumnDistance) {
          nearestColumnDistance = distance;
          nearestColumnIndex = columnIndex;
        }
      });

      if (nearestColumnIndex >= 0) {
        const tablePos = findNodePositionFromDOM(view, tableElement, 'table');
        if (tablePos !== null) {
          return {
            tablePos,
            area: 'column' as const,
            rowIndex: 0,
            columnIndex: nearestColumnIndex,
            rowCount: tableElement.rows.length,
            columnCount: firstRow.cells.length,
            viewDom: view.dom,
          };
        }
      }
    }
  }

  return null;
}

export const AnotadoTableInteractions = Extension.create({
  name: 'anotadoTableInteractions',

  addCommands() {
    const applyAreaTone = (
      options: { tablePos: number; area: 'row' | 'column'; index: number; tone: string | null }
    ) => ({ tr, dispatch }: any) => {
      const { tablePos, area, index, tone } = options;
      const table = tr.doc.nodeAt(tablePos);
      if (!table || table.type.name !== 'table' || index < 0) return false;

      const targetPositions: number[] = [];
      let rowOffset = 0;

      // Percorre os filhos por índice explícito, sem depender dos índices
      // fornecidos por callbacks. A primeira célula (inclusive tableHeader)
      // recebe o mesmo tratamento de todas as demais.
      for (let rowIndex = 0; rowIndex < table.childCount; rowIndex++) {
        const row = table.child(rowIndex);
        let cellOffset = 0;

        for (let columnIndex = 0; columnIndex < row.childCount; columnIndex++) {
          const cell = row.child(columnIndex);
          const isTarget =
            (area === 'row' && rowIndex === index) ||
            (area === 'column' && columnIndex === index);

          if (
            isTarget &&
            (cell.type.name === 'tableCell' ||
              cell.type.name === 'tableHeader' ||
              cell.type.spec.tableRole === 'cell' ||
              cell.type.spec.tableRole === 'header_cell')
          ) {
            // In ProseMirror the table content starts one position after tablePos,
            // and a cell starts one position inside its row.
            targetPositions.push(tablePos + 2 + rowOffset + cellOffset);
          }

          cellOffset += cell.nodeSize;
        }

        rowOffset += row.nodeSize;
      }

      if (targetPositions.length === 0) return false;
      if (!dispatch) return true;

      for (const position of targetPositions) {
        const cell = tr.doc.nodeAt(position);
        if (!cell) continue;

        tr.setNodeMarkup(position, undefined, {
          ...cell.attrs,
          cellTone: tone,
        });
      }

      dispatch(tr);
      return true;
    };

    return {
      setTableColumnTone:
        ({ tablePos, columnIndex, tone }) =>
        (context: any) =>
          applyAreaTone({ tablePos, area: 'column', index: columnIndex, tone })(context),
      setTableAreaTone:
        ({ tablePos, area, index, tone }) =>
        (context: any) =>
          applyAreaTone({ tablePos, area, index, tone })(context),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            contextmenu: (view, event) => {
              const mouseEvent = event as MouseEvent;
              const target = mouseEvent.target as HTMLElement | null;
              const cell = target?.closest('td, th') as HTMLTableCellElement | null;
              const tableElement = cell?.closest('table') as HTMLTableElement | null;

              // Clique direito no corpo da tabela ainda permite escolher a coluna.
              // Nas bordas, usa exatamente as faixas ampliadas indicadas pelo cursor.
              let areaTarget = getTableEdgeTarget(view, mouseEvent.clientX, mouseEvent.clientY);

              if (!areaTarget && cell && tableElement) {
                const row = cell.parentElement as HTMLTableRowElement | null;
                if (row) {
                  const tablePos = findNodePositionFromDOM(view, tableElement, 'table');
                  if (tablePos !== null) {
                    areaTarget = {
                      tablePos,
                      area: 'column' as const,
                      rowIndex: 0,
                      columnIndex: cell.cellIndex,
                      rowCount: tableElement.rows.length,
                      columnCount: tableElement.rows[0]?.cells.length || row.cells.length,
                      viewDom: view.dom,
                    };
                  }
                }
              }

              if (!areaTarget) return false;

              const selectedTable =
                view.nodeDOM(areaTarget.tablePos) as HTMLElement | null;
              const selectedTableElement = selectedTable?.matches('table')
                ? (selectedTable as HTMLTableElement)
                : (selectedTable?.querySelector('table') as HTMLTableElement | null);

              if (!selectedTableElement) return false;

              // Seleção visual inclui TODAS as células da área, incluindo th e a primeira célula.
              view.dom.querySelectorAll('.anotado-table-context-selected').forEach((node) => {
                node.classList.remove('anotado-table-context-selected');
              });

              Array.from(selectedTableElement.rows).forEach((row, currentRowIndex) => {
                Array.from(row.cells).forEach((currentCell, currentColumnIndex) => {
                  const isSelected =
                    (areaTarget.area === 'row' && currentRowIndex === areaTarget.rowIndex) ||
                    (areaTarget.area === 'column' && currentColumnIndex === areaTarget.columnIndex);
                  if (isSelected) currentCell.classList.add('anotado-table-context-selected');
                });
              });

              mouseEvent.preventDefault();
              mouseEvent.stopPropagation();

              view.dom.ownerDocument.defaultView?.dispatchEvent(
                new CustomEvent('anotado:table-column-contextmenu', {
                  detail: {
                    ...areaTarget,
                    x: mouseEvent.clientX,
                    y: mouseEvent.clientY,
                  },
                })
              );
              return true;
            },

            mousedown: (view, event) => {
              const mouseEvent = event as MouseEvent;
              if (mouseEvent.button !== 0) return false;
              const target = mouseEvent.target as HTMLElement | null;
              if (target?.closest('.anotado-table-context-selected')) return false;

              view.dom.querySelectorAll('.anotado-table-context-selected').forEach((node) => {
                node.classList.remove('anotado-table-context-selected');
              });
              return false;
            },

            pointerdown: (view, event) => {
              const pointerEvent = event as PointerEvent;
              if (pointerEvent.button !== 0) return false;

              const target = pointerEvent.target as HTMLElement | null;
              if (target?.closest('.column-resize-handle')) return false;

              // Localiza a linha pela coordenada do ponteiro, não pelo elemento
              // que o navegador escolheu na borda compartilhada entre duas linhas.
              const resizeTarget = getTableRowResizeTarget(
                view,
                pointerEvent.clientX,
                pointerEvent.clientY
              );
              if (!resizeTarget) return false;

              const { rowElement, rowPos, rowHeight: startHeight } = resizeTarget;
              const rowNode = view.state.doc.nodeAt(rowPos);
              if (!rowNode || rowNode.type.name !== 'tableRow') return false;

              const startY = pointerEvent.clientY;
              let currentHeight = startHeight;
              const pointerId = pointerEvent.pointerId;
              const ownerDocument = view.dom.ownerDocument;
              const ownerWindow = ownerDocument.defaultView;
              if (!ownerWindow) return false;

              pointerEvent.preventDefault();
              pointerEvent.stopPropagation();
              rowElement.classList.add('anotado-table-row-resizing');
              ownerDocument.body.classList.add('anotado-row-resize-active');

              const cleanup = () => {
                ownerWindow.removeEventListener('pointermove', handleMove);
                ownerWindow.removeEventListener('pointerup', handleUp);
                ownerWindow.removeEventListener('pointercancel', handleCancel);
                rowElement.classList.remove('anotado-table-row-resizing');
                ownerDocument.body.classList.remove('anotado-row-resize-active');
              };

              const handleMove = (moveEvent: PointerEvent) => {
                if (moveEvent.pointerId !== pointerId) return;
                moveEvent.preventDefault();
                currentHeight = Math.max(
                  40,
                  Math.min(720, startHeight + moveEvent.clientY - startY)
                );
                const heightPx = `${Math.round(currentHeight)}px`;
                rowElement.style.height = heightPx;
                rowElement.style.minHeight = heightPx;
                Array.from(rowElement.cells).forEach((cell) => {
                  cell.style.setProperty('height', heightPx, 'important');
                  cell.style.setProperty('min-height', '0px', 'important');
                });
              };

              const handleUp = (upEvent: PointerEvent) => {
                if (upEvent.pointerId !== pointerId) return;
                const finalHeight = Math.max(40, Math.min(720, Math.round(currentHeight)));
                cleanup();

                Array.from(rowElement.cells).forEach((cell) => {
                  cell.style.removeProperty('height');
                  cell.style.removeProperty('min-height');
                });
                rowElement.style.height = `${finalHeight}px`;
                rowElement.style.minHeight = '';

                const currentRow = view.state.doc.nodeAt(rowPos);
                if (!currentRow || currentRow.type.name !== 'tableRow') return;

                const tr = view.state.tr.setNodeMarkup(rowPos, undefined, {
                  ...currentRow.attrs,
                  rowHeight: finalHeight,
                });
                view.dispatch(tr);
              };

              const handleCancel = (cancelEvent: PointerEvent) => {
                if (cancelEvent.pointerId !== pointerId) return;
                cleanup();
                Array.from(rowElement.cells).forEach((cell) => {
                  cell.style.removeProperty('height');
                  cell.style.removeProperty('min-height');
                });
                rowElement.style.height = rowNode.attrs.rowHeight
                  ? `${rowNode.attrs.rowHeight}px`
                  : '';
                rowElement.style.minHeight = '';
              };

              ownerWindow.addEventListener('pointermove', handleMove);
              ownerWindow.addEventListener('pointerup', handleUp);
              ownerWindow.addEventListener('pointercancel', handleCancel);

              return true;
            },

            mousemove: (view, event) => {
              const mouseEvent = event as MouseEvent;

              const rowResizeTarget = getTableRowResizeTarget(
                view,
                mouseEvent.clientX,
                mouseEvent.clientY
              );
              if (rowResizeTarget) {
                view.dom.style.cursor = 'row-resize';
                return false;
              }

              const edgeTarget = getTableEdgeTarget(view, mouseEvent.clientX, mouseEvent.clientY);
              if (edgeTarget?.area === 'row') {
                view.dom.style.cursor = ROW_SELECT_CURSOR;
                return false;
              }
              if (edgeTarget?.area === 'column') {
                view.dom.style.cursor = COLUMN_SELECT_CURSOR;
                return false;
              }

              view.dom.style.cursor = '';
              return false;
            },

            mouseleave: (view) => {
              view.dom.style.cursor = '';
              return false;
            },

            dragover: (_view, event) => {
              const dragEvent = event as DragEvent;
              if (!Array.from(dragEvent.dataTransfer?.types || []).includes(TABLE_MOVE_MIME)) {
                return false;
              }
              dragEvent.preventDefault();
              if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = 'move';
              return true;
            },

            drop: (view, event) => {
              const dragEvent = event as DragEvent;
              const rawSourcePos = dragEvent.dataTransfer?.getData(TABLE_MOVE_MIME);
              if (!rawSourcePos) return false;

              const sourcePos = Number(rawSourcePos);
              const sourceNode = Number.isInteger(sourcePos) ? view.state.doc.nodeAt(sourcePos) : null;
              if (!sourceNode || sourceNode.type.name !== 'table') return false;

              dragEvent.preventDefault();
              dragEvent.stopPropagation();

              const coords = view.posAtCoords({
                left: dragEvent.clientX,
                top: dragEvent.clientY,
              });
              if (!coords) return true;

              if (coords.pos >= sourcePos && coords.pos <= sourcePos + sourceNode.nodeSize) {
                return true;
              }

              const tr = view.state.tr.delete(sourcePos, sourcePos + sourceNode.nodeSize);
              const mappedDropPos = tr.mapping.map(coords.pos);
              const slice = new Slice(Fragment.from(sourceNode), 0, 0);
              const insertionPos = dropPoint(tr.doc, mappedDropPos, slice);
              if (insertionPos === null) return true;

              tr.insert(insertionPos, sourceNode);
              try {
                tr.setSelection(
                  TextSelection.near(
                    tr.doc.resolve(Math.min(insertionPos + 3, tr.doc.content.size)),
                    1
                  )
                );
              } catch {
                // A tabela foi movida mesmo se não houver posição de cursor válida no destino.
              }
              tr.scrollIntoView();
              view.dispatch(tr);
              return true;
            },
          },
        },
      }),
    ];
  },
});
