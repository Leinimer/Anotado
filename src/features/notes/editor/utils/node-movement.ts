import { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';

/**
 * Verifica se o nó atual está contido dentro de um mediaGroup
 */
export function isInsideMediaGroup(
  editor: Editor,
  getPos: () => number | undefined
): boolean {
  if (!editor) return false;
  const pos = typeof getPos === 'function' ? getPos() : undefined;
  if (typeof pos !== 'number') return false;
  try {
    const { doc } = editor.state;
    const $pos = doc.resolve(pos);
    return $pos.parent.type.name === 'mediaGroup';
  } catch {
    return false;
  }
}

/**
 * Alterna o agrupamento lado a lado (MediaGroup) para o nó de mídia atual
 */
export function toggleMediaGrouping(
  editor: Editor,
  getPos: () => number | undefined
): boolean {
  if (!editor || !editor.isEditable) return false;
  const pos = typeof getPos === 'function' ? getPos() : undefined;
  if (typeof pos !== 'number') return false;

  try {
    const { state, view } = editor;
    const { tr, doc, schema } = state;
    const mediaGroupType = schema.nodes.mediaGroup;
    if (!mediaGroupType) return false;

    const $pos = doc.resolve(pos);
    const isInside = $pos.parent.type.name === 'mediaGroup';

    if (isInside) {
      // Desfaz o grupo ou remove o nó do grupo
      const groupPos = $pos.before();
      const groupNode = $pos.parent;
      const currentNode = $pos.nodeAfter;
      if (!currentNode) return false;

      if (groupNode.childCount <= 1) {
        tr.delete(groupPos, groupPos + groupNode.nodeSize);
        tr.insert(groupPos, currentNode);
      } else {
        tr.delete(pos, pos + currentNode.nodeSize);
        const afterGroupPos = tr.mapping.map(groupPos + groupNode.nodeSize);
        tr.insert(afterGroupPos, currentNode);
      }
      view.dispatch(tr);
      return true;
    } else {
      const node = $pos.nodeAfter;
      if (!node) return false;

      const prevNode = $pos.nodeBefore;
      const nextPos = pos + node.nodeSize;
      const nextNode = nextPos < doc.content.size ? doc.resolve(nextPos).nodeAfter : null;

      const isMedia = (n: any) =>
        n && ['image', 'youtube', 'documentAttachment'].includes(n.type.name);

      if (prevNode && prevNode.type.name === 'mediaGroup') {
        tr.delete(pos, pos + node.nodeSize);
        tr.insert(pos - 1, node);
        view.dispatch(tr);
        return true;
      } else if (nextNode && nextNode.type.name === 'mediaGroup') {
        tr.delete(pos, pos + node.nodeSize);
        tr.insert(pos + 1, node);
        view.dispatch(tr);
        return true;
      } else if (nextNode && isMedia(nextNode)) {
        const combinedGroup = mediaGroupType.create(null, [node, nextNode]);
        tr.delete(pos, nextPos + nextNode.nodeSize);
        tr.insert(pos, combinedGroup);
        view.dispatch(tr);
        return true;
      } else if (prevNode && isMedia(prevNode)) {
        const prevPos = pos - prevNode.nodeSize;
        const combinedGroup = mediaGroupType.create(null, [prevNode, node]);
        tr.delete(prevPos, pos + node.nodeSize);
        tr.insert(prevPos, combinedGroup);
        view.dispatch(tr);
        return true;
      } else {
        const group = mediaGroupType.create(null, [node]);
        tr.delete(pos, pos + node.nodeSize);
        tr.insert(pos, group);
        view.dispatch(tr);
        return true;
      }
    }
  } catch (err) {
    console.warn('Erro ao alternar media group:', err);
    return false;
  }
}

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
