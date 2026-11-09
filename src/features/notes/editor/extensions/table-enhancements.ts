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

      table.forEach((row: any, _rowOffset: number, rowIndex: number) => {
        let cellOffset = 0;
        row.forEach((cell: any, _offset: number, columnIndex: number) => {
          const isTarget =
            (area === 'row' && rowIndex === index) ||
            (area === 'column' && columnIndex === index);

          if (isTarget) {
            targetPositions.push(tablePos + 2 + rowOffset + cellOffset);
          }
          cellOffset += cell.nodeSize;
        });
        rowOffset += row.nodeSize;
      });

      if (targetPositions.length === 0) return false;
      if (!dispatch) return true;

      for (const position of targetPositions) {
        const cell = tr.doc.nodeAt(position);
        if (!cell || (cell.type.name !== 'tableCell' && cell.type.name !== 'tableHeader')) {
          continue;
        }
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
    let lastEdgeHoverKey = '';

    const publishEdgeHover = (view: any, detail: any | null) => {
      const key = detail
        ? `${detail.tablePos}:${detail.area}:${detail.area === 'row' ? detail.rowIndex : detail.columnIndex}:${Math.round(detail.left)}:${Math.round(detail.top)}`
        : '';

      if (key === lastEdgeHoverKey) return;
      lastEdgeHoverKey = key;

      view.dom.ownerDocument.defaultView?.dispatchEvent(
        new CustomEvent('anotado:table-edge-hover', { detail })
      );
    };

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            contextmenu: (view, event) => {
              const mouseEvent = event as MouseEvent;
              const target = mouseEvent.target as HTMLElement | null;
              let tableElement = target?.closest('table') as HTMLTableElement | null;
              let targetRow: HTMLTableRowElement | null = null;
              let area: 'row' | 'column' | null = null;
              let rowIndex = -1;
              let columnIndex = -1;

              // Clique com botão direito dentro de uma célula: seleciona a coluna inteira.
              const cell = target?.closest('td, th') as HTMLTableCellElement | null;
              if (cell && tableElement) {
                targetRow = cell.parentElement as HTMLTableRowElement | null;
                if (targetRow) {
                  rowIndex = Array.from(tableElement.rows).indexOf(targetRow);
                  columnIndex = cell.cellIndex;
                  area = 'column';
                }
              } else {
                // Área de contexto da linha: margem de 30 px à esquerda do início
                // visível do contêiner horizontal. Funciona mesmo após rolar colunas.
                const tables = Array.from(view.dom.querySelectorAll('table')) as HTMLTableElement[];
                for (const candidate of tables) {
                  const wrapper = candidate.closest('.tableWrapper') as HTMLElement | null;
                  const visibleRect = (wrapper || candidate).getBoundingClientRect();
                  const inRowGutter =
                    mouseEvent.clientX >= visibleRect.left - 32 &&
                    mouseEvent.clientX <= visibleRect.left + 3 &&
                    mouseEvent.clientY >= visibleRect.top &&
                    mouseEvent.clientY <= visibleRect.bottom;

                  if (!inRowGutter) continue;

                  const row = Array.from(candidate.rows).find((item) => {
                    const rect = item.getBoundingClientRect();
                    return mouseEvent.clientY >= rect.top && mouseEvent.clientY <= rect.bottom;
                  });

                  if (row) {
                    tableElement = candidate;
                    targetRow = row;
                    rowIndex = Array.from(candidate.rows).indexOf(row);
                    area = 'row';
                    break;
                  }
                }
              }

              if (!tableElement || !targetRow || !area) return false;
              const tablePos = findNodePositionFromDOM(view, tableElement, 'table');
              if (tablePos === null) return false;

              // Marca visualmente todas as células da linha/coluna antes de abrir o menu.
              view.dom.querySelectorAll('.anotado-table-context-selected').forEach((node) => {
                node.classList.remove('anotado-table-context-selected');
              });

              Array.from(tableElement.rows).forEach((row, currentRowIndex) => {
                Array.from(row.cells).forEach((currentCell, currentColumnIndex) => {
                  const isSelected =
                    (area === 'row' && currentRowIndex === rowIndex) ||
                    (area === 'column' && currentColumnIndex === columnIndex);
                  if (isSelected) currentCell.classList.add('anotado-table-context-selected');
                });
              });

              mouseEvent.preventDefault();
              mouseEvent.stopPropagation();

              const browserWindow = view.dom.ownerDocument.defaultView;
              browserWindow?.dispatchEvent(
                new CustomEvent('anotado:table-column-contextmenu', {
                  detail: {
                    tablePos,
                    area,
                    rowIndex,
                    columnIndex,
                    rowCount: tableElement.rows.length,
                    columnCount: targetRow.cells.length,
                    viewDom: view.dom,
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
              const tables = Array.from(view.dom.querySelectorAll('table')) as HTMLTableElement[];
              let edgeHover: any | null = null;

              for (const tableElement of tables) {
                const firstRow = tableElement.rows[0];
                if (!firstRow || firstRow.cells.length === 0) continue;

                const wrapper = tableElement.closest('.tableWrapper') as HTMLElement | null;
                const wrapperRect = (wrapper || tableElement).getBoundingClientRect();
                const tableRect = tableElement.getBoundingClientRect();
                const rowGutterLeft = wrapperRect.left - 34;
                const rowGutterRight = wrapperRect.left - 3;

                // Seta para a direita: aparece na margem lateral, alinhada a cada linha.
                if (
                  mouseEvent.clientX >= rowGutterLeft &&
                  mouseEvent.clientX <= rowGutterRight
                ) {
                  const rowIndex = Array.from(tableElement.rows).findIndex((row) => {
                    const rect = row.getBoundingClientRect();
                    return mouseEvent.clientY >= rect.top && mouseEvent.clientY <= rect.bottom;
                  });

                  if (rowIndex >= 0) {
                    const rowRect = tableElement.rows[rowIndex].getBoundingClientRect();
                    const tablePos = findNodePositionFromDOM(view, tableElement, 'table');
                    if (tablePos !== null) {
                      edgeHover = {
                        tablePos,
                        area: 'row',
                        rowIndex,
                        columnIndex: 0,
                        rowCount: tableElement.rows.length,
                        columnCount: firstRow.cells.length,
                        viewDom: view.dom,
                        left: wrapperRect.left - 28,
                        top: rowRect.top + rowRect.height / 2 - 11,
                        x: mouseEvent.clientX,
                        y: mouseEvent.clientY,
                      };
                    }
                  }
                }

                // Seta para baixo: aparece acima de cada coluna, inclusive da primeira.
                if (!edgeHover) {
                  const columnHeaderBandTop = tableRect.top - 30;
                  const columnHeaderBandBottom = tableRect.top + 2;
                  if (
                    mouseEvent.clientY >= columnHeaderBandTop &&
                    mouseEvent.clientY <= columnHeaderBandBottom
                  ) {
                    const columnIndex = Array.from(firstRow.cells).findIndex((cell) => {
                      const rect = cell.getBoundingClientRect();
                      return mouseEvent.clientX >= rect.left && mouseEvent.clientX <= rect.right;
                    });

                    if (columnIndex >= 0) {
                      const cellRect = firstRow.cells[columnIndex].getBoundingClientRect();
                      const tablePos = findNodePositionFromDOM(view, tableElement, 'table');
                      if (tablePos !== null) {
                        edgeHover = {
                          tablePos,
                          area: 'column',
                          rowIndex: 0,
                          columnIndex,
                          rowCount: tableElement.rows.length,
                          columnCount: firstRow.cells.length,
                          viewDom: view.dom,
                          left: cellRect.left + cellRect.width / 2 - 11,
                          top: tableRect.top - 25,
                          x: mouseEvent.clientX,
                          y: mouseEvent.clientY,
                        };
                      }
                    }
                  }
                }

                if (edgeHover) break;
              }

              publishEdgeHover(view, edgeHover);

              // Preserva o indicador de redimensionamento de altura de linha.
              const target = mouseEvent.target as HTMLElement | null;
              const rowElement = target?.closest('tr') as HTMLTableRowElement | null;
              const cellElement = target?.closest('td, th') as HTMLTableCellElement | null;
              const rect = rowElement?.getBoundingClientRect();
              const distanceFromBottom = rect ? rect.bottom - mouseEvent.clientY : Infinity;
              const nearColumnEdge = cellElement
                ? cellElement.getBoundingClientRect().right - mouseEvent.clientX <= 9
                : false;

              view.dom.style.cursor = edgeHover
                ? 'pointer'
                : !nearColumnEdge && distanceFromBottom >= 0 && distanceFromBottom <= 6
                  ? 'row-resize'
                  : '';

              return false;
            },

            mouseleave: (view, event) => {
              const relatedTarget = (event as MouseEvent).relatedTarget as Element | null;
              // O indicador é um botão flutuante fora do DOM do editor. Não o esconda
              // quando o ponteiro sair da célula diretamente para a própria seta.
              if (relatedTarget?.closest('.anotado-table-edge-control')) {
                // A seta está fora do DOM do ProseMirror; libera a próxima
                // passagem do ponteiro para republicar o mesmo índice/posição.
                lastEdgeHoverKey = '';
                return false;
              }

              publishEdgeHover(view, null);
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
