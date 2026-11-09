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
    return {
      setTableColumnTone:
        ({ tablePos, columnIndex, tone }) =>
        ({ tr, dispatch }) => {
          const table = tr.doc.nodeAt(tablePos);
          if (!table || table.type.name !== 'table' || columnIndex < 0) return false;

          const targetPositions: number[] = [];
          let rowOffset = 0;

          table.forEach((row: any) => {
            let cellOffset = 0;
            row.forEach((cell: any, _offset: number, currentColumn: number) => {
              if (currentColumn === columnIndex) {
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
        },
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
              if (!cell) return false;

              const row = cell.parentElement as HTMLTableRowElement | null;
              const tableElement = cell.closest('table') as HTMLTableElement | null;
              if (!row || !tableElement || tableElement.rows[0] !== row) return false;

              const tablePos = findNodePositionFromDOM(view, tableElement, 'table');
              if (tablePos === null) return false;

              mouseEvent.preventDefault();
              const columnIndex = cell.cellIndex;
              const browserWindow = view.dom.ownerDocument.defaultView;
              browserWindow?.dispatchEvent(
                new CustomEvent('anotado:table-column-contextmenu', {
                  detail: {
                    tablePos,
                    columnIndex,
                    columnCount: row.cells.length,
                    x: mouseEvent.clientX,
                    y: mouseEvent.clientY,
                  },
                })
              );
              return true;
            },

            pointerdown: (view, event) => {
              const pointerEvent = event as PointerEvent;
              if (pointerEvent.button !== 0) return false;

              const target = pointerEvent.target as HTMLElement | null;
              const rowElement = target?.closest('tr') as HTMLTableRowElement | null;
              if (!rowElement || !rowElement.closest('table')) return false;

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
              const target = mouseEvent.target as HTMLElement | null;
              const rowElement = target?.closest('tr') as HTMLTableRowElement | null;
              if (!rowElement) {
                view.dom.style.cursor = '';
                return false;
              }

              const rect = rowElement.getBoundingClientRect();
              const distanceFromBottom = rect.bottom - mouseEvent.clientY;
              view.dom.style.cursor =
                distanceFromBottom >= 0 && distanceFromBottom <= 6 ? 'row-resize' : '';
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
