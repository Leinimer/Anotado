import { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';

/**
 * Move um bloco de nó (Image, Youtube, DocumentAttachment, etc.) verticalmente dentro do documento ProseMirror
 * respeitando 100% o fluxo do documento e sem posicionamento absoluto.
 */
export function moveNodeBlock(
  editor: Editor,
  getPos: () => number | undefined,
  direction: 'up' | 'down'
): boolean {
  if (!editor || !editor.isEditable) return false;
  const pos = typeof getPos === 'function' ? getPos() : undefined;
  if (typeof pos !== 'number') return false;

  const { state, view } = editor;
  const { tr, doc } = state;
  const $pos = doc.resolve(pos);
  const node = $pos.nodeAfter;
  if (!node) return false;

  const nodeSize = node.nodeSize;

  if (direction === 'up') {
    // Procura o nó irmão imediatamente anterior
    const prevNode = $pos.nodeBefore;
    if (!prevNode) return false; // Já é o primeiro nó do container

    const targetPos = pos - prevNode.nodeSize;
    // Corta o nó da posição atual e insere antes do nó anterior
    tr.delete(pos, pos + nodeSize);
    tr.insert(targetPos, node);
    try {
      tr.setSelection(NodeSelection.create(tr.doc, targetPos));
    } catch {
      // Ignora erro de seleção se não for possível selecionar
    }
    view.dispatch(tr);
    return true;
  } else {
    // Procura o nó irmão imediatamente posterior
    const $after = doc.resolve(pos + nodeSize);
    const nextSibling = $after.nodeAfter;
    if (!nextSibling) return false; // Já é o último nó do container

    const targetPos = pos + nextSibling.nodeSize;
    // Corta o nó da posição atual e insere após o nó seguinte
    tr.delete(pos, pos + nodeSize);
    tr.insert(targetPos, node);
    try {
      tr.setSelection(NodeSelection.create(tr.doc, targetPos));
    } catch {
      // Ignora erro de seleção se não for possível selecionar
    }
    view.dispatch(tr);
    return true;
  }
}
