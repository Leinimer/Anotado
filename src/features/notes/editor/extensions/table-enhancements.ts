import { Extension } from '@tiptap/core';
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

function escapeHtmlAttribute(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderInlineNodeToHtml(node: any): string {
  if (node.type === 'text') {
    let html = escapeHtmlAttribute(node.text || '');
    for (const mark of node.marks || []) {
      const attrs = mark.attrs || {};
      switch (mark.type) {
        case 'bold':
        case 'strong':
          html = `<strong>${html}</strong>`;
          break;
        case 'italic':
          html = `<em>${html}</em>`;
          break;
        case 'underline':
          html = `<u>${html}</u>`;
          break;
        case 'strike':
        case 'strikethrough':
          html = `<s>${html}</s>`;
          break;
        case 'code':
          html = `<code>${html}</code>`;
          break;
        case 'link':
          html = `<a href="${escapeHtmlAttribute(attrs.href)}"${attrs.title ? ` title="${escapeHtmlAttribute(attrs.title)}"` : ''}>${html}</a>`;
          break;
        case 'highlight':
        case 'customHighlight': {
          const color = attrs.color ? ` style="background-color: ${escapeHtmlAttribute(attrs.color)}"` : '';
          html = `<mark${color}>${html}</mark>`;
          break;
        }
        case 'subscript':
          html = `<sub>${html}</sub>`;
          break;
        case 'superscript':
          html = `<sup>${html}</sup>`;
          break;
        case 'textStyle': {
          const styles: string[] = [];
          if (attrs.color) styles.push(`color: ${escapeHtmlAttribute(attrs.color)}`);
          if (attrs.fontSize) styles.push(`font-size: ${escapeHtmlAttribute(attrs.fontSize)}`);
          if (attrs.fontFamily) styles.push(`font-family: ${escapeHtmlAttribute(attrs.fontFamily)}`);
          if (styles.length) html = `<span style="${styles.join('; ')}">${html}</span>`;
          break;
        }
        default:
          break;
      }
    }
    return html;
  }

  if (node.type === 'hardBreak') return '<br>';
  if (node.type === 'image') {
    return `<img src="${escapeHtmlAttribute(node.attrs?.src)}" alt="${escapeHtmlAttribute(node.attrs?.alt)}">`;
  }
  if (Array.isArray(node.content)) {
    return node.content.map(renderInlineNodeToHtml).join('');
  }
  return '';
}

function renderTableBlockToHtml(block: any): string {
  const children = Array.isArray(block.content) ? block.content : [];
  switch (block.type) {
    case 'paragraph':
      return `<p>${children.map(renderInlineNodeToHtml).join('')}</p>`;
    case 'heading': {
      const level = Math.max(1, Math.min(6, Number(block.attrs?.level || 2)));
      return `<h${level}>${children.map(renderInlineNodeToHtml).join('')}</h${level}>`;
    }
    case 'blockquote':
      return `<blockquote>${children.map(renderTableBlockToHtml).join('')}</blockquote>`;
    case 'bulletList':
      return `<ul>${children.map(renderTableBlockToHtml).join('')}</ul>`;
    case 'orderedList':
      return `<ol>${children.map(renderTableBlockToHtml).join('')}</ol>`;
    case 'listItem':
      return `<li>${children.map(renderTableBlockToHtml).join('')}</li>`;
    case 'taskList':
      return `<ul data-type="taskList">${children.map(renderTableBlockToHtml).join('')}</ul>`;
    case 'taskItem':
      return `<li data-type="taskItem" data-checked="${block.attrs?.checked ? 'true' : 'false'}">${children.map(renderTableBlockToHtml).join('')}</li>`;
    case 'horizontalRule':
      return '<hr>';
    default:
      return children.map(renderTableBlockToHtml).join('');
  }
}

function renderTableCellContent(cell: any): string {
  const blocks = Array.isArray(cell.content) ? cell.content : [];
  return blocks.map(renderTableBlockToHtml).join('');
}

export const AnotadoTable = Table.extend({
  renderMarkdown(node) {
    // Serializa como HTML para conservar larguras, alturas, cores e formatação
    // inline das células no autosave em Markdown.
    const tableRows = Array.isArray(node.content) ? node.content : [];
    const firstRowCells = tableRows[0]?.content || [];
    const colgroup = firstRowCells
      .map((cell: any) => {
        const width = Array.isArray(cell.attrs?.colwidth) ? Number(cell.attrs.colwidth[0]) : 0;
        return width > 0 ? `<col style="width: ${width}px">` : '<col>';
      })
      .join('');

    const rows = tableRows.map((row: any) => {
      const rowHeight = Number(row.attrs?.rowHeight || 0);
      const rowStyle = rowHeight > 0 ? ` style="height: ${rowHeight}px"` : '';
      const cells = (row.content || []).map((cell: any) => {
        const tag = cell.type === 'tableHeader' ? 'th' : 'td';
        const tone = cell.attrs?.cellTone
          ? ` data-cell-tone="${escapeHtmlAttribute(cell.attrs.cellTone)}"`
          : '';
        const inner = renderTableCellContent(cell);
        return `<${tag}${tone}>${inner}</${tag}>`;
      }).join('');
      return `<tr${rowStyle}>${cells}</tr>`;
    }).join('');

    return `<table class="anotado-table"><colgroup>${colgroup}</colgroup><tbody>${rows}</tbody></table>\n\n`;
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
  'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M3 12h18m-7-7 7 7-7 7%22 fill=%22none%22 stroke=%22%23745d4a%22 stroke-width=%222.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E") 12 12, pointer';

const COLUMN_SELECT_CURSOR =
  'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M12 3v18m-7-7 7 7 7-7%22 fill=%22none%22 stroke=%22%23745d4a%22 stroke-width=%222.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E") 12 12, pointer';

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
              // A borda inferior-direita pertence ao redimensionador nativo de coluna.
              // Não interceptar esse gesto para que os dois redimensionamentos coexistam.
              if (target?.closest('.column-resize-handle')) return false;
              const cellElement = target?.closest('td, th') as HTMLTableCellElement | null;
              const rowElement = target?.closest('tr') as HTMLTableRowElement | null;
              if (!rowElement || !rowElement.closest('table')) return false;

              if (cellElement) {
                const cellRect = cellElement.getBoundingClientRect();
                if (cellRect.right - pointerEvent.clientX <= 9) return false;
              }

              const rect = rowElement.getBoundingClientRect();
              const distanceFromBottom = rect.bottom - pointerEvent.clientY;
              if (distanceFromBottom < -1 || distanceFromBottom > 7) return false;

              const rowPos = findRowPosition(view, rowElement);
              if (rowPos === null) return false;
              const rowNode = view.state.doc.nodeAt(rowPos);
              if (!rowNode || rowNode.type.name !== 'tableRow') return false;

              const startY = pointerEvent.clientY;
              const startHeight = Math.max(36, Math.round(rect.height));
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
                const nextHeight = Math.max(
                  36,
                  Math.min(720, startHeight + moveEvent.clientY - startY)
                );
                rowElement.style.height = `${Math.round(nextHeight)}px`;
              };

              const handleUp = (upEvent: PointerEvent) => {
                if (upEvent.pointerId !== pointerId) return;
                const finalHeight = Math.max(
                  36,
                  Math.min(720, Math.round(rowElement.getBoundingClientRect().height))
                );
                cleanup();

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
                rowElement.style.height = rowNode.attrs.rowHeight
                  ? `${rowNode.attrs.rowHeight}px`
                  : '';
              };

              ownerWindow.addEventListener('pointermove', handleMove);
              ownerWindow.addEventListener('pointerup', handleUp);
              ownerWindow.addEventListener('pointercancel', handleCancel);

              return true;
            },

            mousemove: (view, event) => {
              const mouseEvent = event as MouseEvent;
              const edgeTarget = getTableEdgeTarget(view, mouseEvent.clientX, mouseEvent.clientY);

              // O ponteiro nativo vira a seta correspondente; não há botões flutuantes.
              if (edgeTarget?.area === 'row') {
                view.dom.style.cursor = ROW_SELECT_CURSOR;
                return false;
              }
              if (edgeTarget?.area === 'column') {
                view.dom.style.cursor = COLUMN_SELECT_CURSOR;
                return false;
              }

              // Mantém o redimensionamento de altura ao passar pela borda inferior da linha.
              const target = mouseEvent.target as HTMLElement | null;
              const rowElement = target?.closest('tr') as HTMLTableRowElement | null;
              const cellElement = target?.closest('td, th') as HTMLTableCellElement | null;
              const rect = rowElement?.getBoundingClientRect();
              const distanceFromBottom = rect ? rect.bottom - mouseEvent.clientY : Infinity;
              const nearColumnEdge = cellElement
                ? cellElement.getBoundingClientRect().right - mouseEvent.clientX <= 9
                : false;

              view.dom.style.cursor =
                !nearColumnEdge && distanceFromBottom >= 0 && distanceFromBottom <= 6
                  ? 'row-resize'
                  : '';

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
