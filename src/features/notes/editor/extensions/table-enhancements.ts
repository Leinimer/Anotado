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

function renderTableCellContent(cell: any, helpers: any): string {
  const blocks = Array.isArray(cell.content) ? cell.content : [];
  return blocks
    .map((block: any) => {
      if (block.type === 'paragraph') {
        const inline = helpers.renderChildren(block.content || []);
        return `<p>${inline || ''}</p>`;
      }
      return helpers.renderChildren([block]);
    })
    .join('');
}

export const AnotadoTable = Table.extend({
  renderMarkdown(node, helpers) {
    // Serializa como HTML quando a nota contém larguras, cores ou alturas
    // personalizadas, para que essas configurações sobrevivam ao autosave.
    const rows = (node.content || []).map((row: any) => {
      const rowHeight = Number(row.attrs?.rowHeight || 0);
      const rowStyle = rowHeight > 0 ? ` style="height: ${rowHeight}px"` : '';
      const cells = (row.content || []).map((cell: any) => {
        const tag = cell.type === 'tableHeader' ? 'th' : 'td';
        const tone = cell.attrs?.cellTone
          ? ` data-cell-tone="${escapeHtmlAttribute(cell.attrs.cellTone)}"`
          : '';
        const width = Array.isArray(cell.attrs?.colwidth) ? Number(cell.attrs.colwidth[0]) : 0;
        const widthStyle = width > 0 ? ` style="width: ${width}px"` : '';
        const inner = renderTableCellContent(cell, helpers);
        return `<${tag}${tone}${widthStyle}>${inner}</${tag}>`;
      }).join('');
      return `<tr${rowStyle}>${cells}</tr>`;
    }).join('');

    return `<table class="anotado-table"><tbody>${rows}</tbody></table>\n\n`;
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

function findAncestorPosition(view: any, pos: number, nodeName: string): number | null {
  const safePos = Math.max(0, Math.min(pos, view.state.doc.content.size));
  const candidates = [safePos, Math.max(0, safePos - 1), Math.min(view.state.doc.content.size, safePos + 1)];

  for (const candidate of candidates) {
    const $pos = view.state.doc.resolve(candidate);
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).type.name === nodeName) {
        return $pos.before(depth);
      }
    }
  }

  return null;
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
