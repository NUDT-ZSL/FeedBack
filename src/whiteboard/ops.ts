import { OpError } from './errors.ts';
import { childrenOf, isContainer, isDescendant, subtreeIds } from './state.ts';
import { ROOT_ID, type BoardNode, type BoardState, type ElementType } from './types.ts';

export type BoardOp =
  | { kind: 'add'; element: BoardNode; parentId?: string; index?: number }
  | { kind: 'remove'; id: string }
  | { kind: 'update'; id: string; patch: Record<string, unknown> }
  | { kind: 'move'; id: string; parentId: string; index?: number };

const MUTABLE_FIELDS: Record<ElementType, ReadonlySet<string>> = {
  pen: new Set(['x', 'y', 'points', 'color', 'strokeWidth']),
  rect: new Set(['x', 'y', 'width', 'height', 'color', 'strokeWidth']),
  circle: new Set(['x', 'y', 'radius', 'color', 'strokeWidth']),
  sticky: new Set(['x', 'y', 'text', 'color', 'width', 'height']),
  group: new Set(['x', 'y', 'name']),
};

const IMMUTABLE_FIELDS = new Set(['id', 'type']);

function resolveParent(state: BoardState, op: BoardOp, parentId: string): string {
  if (parentId !== ROOT_ID && !state.nodes[parentId]) {
    throw new OpError('UNKNOWN_ELEMENT', `parent "${parentId}" does not exist`, op);
  }
  if (!isContainer(state, parentId)) {
    throw new OpError('NOT_A_GROUP', `parent "${parentId}" is not a group`, op);
  }
  return parentId;
}

function checkedIndex(op: BoardOp, length: number, index: number | undefined): number {
  const resolved = index ?? length;
  if (!Number.isInteger(resolved) || resolved < 0 || resolved > length) {
    throw new OpError('BAD_INDEX', `index ${index} out of bounds for length ${length}`, op);
  }
  return resolved;
}

function applyAdd(state: BoardState, op: Extract<BoardOp, { kind: 'add' }>): BoardOp[] {
  const element = op.element;
  if (element.id === ROOT_ID || state.nodes[element.id]) {
    throw new OpError('DUPLICATE_ID', `element "${element.id}" already exists`, op);
  }
  const parentId = resolveParent(state, op, op.parentId ?? ROOT_ID);
  const siblings = childrenOf(state, parentId);
  const index = checkedIndex(op, siblings.length, op.index);

  state.nodes[element.id] = structuredClone(element);
  state.children[element.id] = [];
  state.parent[element.id] = parentId;
  siblings.splice(index, 0, element.id);
  return [{ kind: 'remove', id: element.id }];
}

function applyRemove(state: BoardState, op: Extract<BoardOp, { kind: 'remove' }>): BoardOp[] {
  if (op.id === ROOT_ID) {
    throw new OpError('ROOT_OPERATION', 'cannot remove the root container', op);
  }
  if (!state.nodes[op.id]) {
    throw new OpError('UNKNOWN_ELEMENT', `element "${op.id}" does not exist`, op);
  }

  const removedIds = subtreeIds(state, op.id);
  const inverse: BoardOp[] = removedIds.map((id) => ({
    kind: 'add',
    element: structuredClone(state.nodes[id]),
    parentId: state.parent[id],
    index: childrenOf(state, state.parent[id]).indexOf(id),
  }));

  const topParent = state.parent[op.id];
  state.children[topParent] = state.children[topParent].filter((child) => child !== op.id);
  for (const id of removedIds) {
    delete state.nodes[id];
    delete state.children[id];
    delete state.parent[id];
  }
  return inverse;
}

function applyUpdate(state: BoardState, op: Extract<BoardOp, { kind: 'update' }>): BoardOp[] {
  const node = state.nodes[op.id];
  if (!node) {
    throw new OpError('UNKNOWN_ELEMENT', `element "${op.id}" does not exist`, op);
  }
  const keys = Object.keys(op.patch);
  if (keys.length === 0) {
    throw new OpError('EMPTY_PATCH', 'update patch must contain at least one field', op);
  }
  const allowed = MUTABLE_FIELDS[node.type];
  const previous: Record<string, unknown> = {};
  for (const key of keys) {
    if (IMMUTABLE_FIELDS.has(key)) {
      throw new OpError('IMMUTABLE_FIELD', `field "${key}" cannot be updated`, op);
    }
    if (!allowed.has(key)) {
      throw new OpError('UNKNOWN_FIELD', `field "${key}" is not valid for type "${node.type}"`, op);
    }
    previous[key] = (node as unknown as Record<string, unknown>)[key];
  }

  Object.assign(node, op.patch);
  return [{ kind: 'update', id: op.id, patch: previous }];
}

function applyMove(state: BoardState, op: Extract<BoardOp, { kind: 'move' }>): BoardOp[] {
  if (op.id === ROOT_ID) {
    throw new OpError('ROOT_OPERATION', 'cannot move the root container', op);
  }
  if (!state.nodes[op.id]) {
    throw new OpError('UNKNOWN_ELEMENT', `element "${op.id}" does not exist`, op);
  }
  const parentId = resolveParent(state, op, op.parentId);
  if (parentId === op.id || isDescendant(state, op.id, parentId)) {
    throw new OpError('CYCLE', `moving "${op.id}" into "${parentId}" would create a cycle`, op);
  }

  const oldParentId = state.parent[op.id];
  const oldSiblings = childrenOf(state, oldParentId);
  const oldIndex = oldSiblings.indexOf(op.id);
  const targetLength = childrenOf(state, parentId).length - (parentId === oldParentId ? 1 : 0);
  const index = checkedIndex(op, targetLength, op.index);

  oldSiblings.splice(oldIndex, 1);
  childrenOf(state, parentId).splice(index, 0, op.id);
  state.parent[op.id] = parentId;
  return [{ kind: 'move', id: op.id, parentId: oldParentId, index: oldIndex }];
}

export function applyOp(state: BoardState, op: BoardOp): BoardOp[] {
  switch (op.kind) {
    case 'add':
      return applyAdd(state, op);
    case 'remove':
      return applyRemove(state, op);
    case 'update':
      return applyUpdate(state, op);
    case 'move':
      return applyMove(state, op);
  }
}
