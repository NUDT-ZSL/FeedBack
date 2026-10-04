import type { BoardState, WhiteboardElement } from './types.ts';
import { createElement } from './types.ts';
import type { Op } from './ops.ts';
import { OpRejection } from './errors.ts';

export function cloneState(state: BoardState): BoardState {
  return {
    elements: { ...state.elements },
    rootOrder: [...state.rootOrder],
    childOrder: Object.fromEntries(
      Object.entries(state.childOrder).map(([key, list]) => [key, [...list]]),
    ),
  };
}

export function orderOf(state: BoardState, parentId: string | null): string[] {
  return parentId === null ? state.rootOrder : state.childOrder[parentId] ?? [];
}

function orderRef(
  state: BoardState,
  parentId: string | null,
): string[] {
  if (parentId === null) return state.rootOrder;
  const list = state.childOrder[parentId] ?? [];
  state.childOrder[parentId] = list;
  return list;
}

export function collectSubtree(state: BoardState, id: string): string[] {
  const out: string[] = [];
  const walk = (elementId: string): void => {
    out.push(elementId);
    for (const childId of state.childOrder[elementId] ?? []) {
      walk(childId);
    }
  };
  walk(id);
  return out;
}

export function isDescendant(
  state: BoardState,
  ancestorId: string,
  id: string,
): boolean {
  let current: string | null = state.elements[id]?.parentId ?? null;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = state.elements[current]?.parentId ?? null;
  }
  return false;
}

function boundingBox(members: WhiteboardElement[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const minX = Math.min(...members.map((m) => m.x));
  const minY = Math.min(...members.map((m) => m.y));
  const maxX = Math.max(...members.map((m) => m.x + m.width));
  const maxY = Math.max(...members.map((m) => m.y + m.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function applyOp(state: BoardState, op: Op): BoardState {
  const next = cloneState(state);
  applyInPlace(next, op);
  return next;
}

function applyInPlace(state: BoardState, op: Op): void {
  switch (op.type) {
    case 'add': {
      const element = op.element;
      if (state.elements[element.id]) {
        throw new OpRejection(
          'ADD_DUPLICATE_ID',
          `element '${element.id}' already exists`,
          op,
        );
      }
      if (element.parentId !== null) {
        const parent = state.elements[element.parentId];
        if (!parent || parent.kind !== 'group') {
          throw new OpRejection(
            'ADD_MISSING_PARENT',
            `parent group '${element.parentId}' does not exist`,
            op,
          );
        }
      }
      const list = orderRef(state, element.parentId);
      const index = op.index ?? list.length;
      if (index < 0 || index > list.length) {
        throw new OpRejection(
          'ADD_BAD_INDEX',
          `index ${index} out of range [0, ${list.length}]`,
          op,
        );
      }
      state.elements[element.id] = { ...element };
      if (element.kind === 'group' && !state.childOrder[element.id]) {
        state.childOrder[element.id] = [];
      }
      list.splice(index, 0, element.id);
      return;
    }

    case 'update': {
      const element = state.elements[op.id];
      if (!element) {
        throw new OpRejection(
          'UPDATE_MISSING',
          `element '${op.id}' does not exist`,
          op,
        );
      }
      const fields = Object.keys(op.patch);
      if (fields.length === 0) {
        throw new OpRejection(
          'UPDATE_NO_FIELDS',
          `update for '${op.id}' contains no fields`,
          op,
        );
      }
      state.elements[op.id] = { ...element, ...op.patch };
      return;
    }

    case 'remove': {
      const element = state.elements[op.id];
      if (!element) {
        throw new OpRejection(
          'REMOVE_MISSING',
          `element '${op.id}' does not exist`,
          op,
        );
      }
      const subtree = collectSubtree(state, op.id);
      const parentList = orderRef(state, element.parentId);
      const position = parentList.indexOf(op.id);
      parentList.splice(position, 1);
      for (const id of subtree) {
        delete state.elements[id];
        delete state.childOrder[id];
      }
      return;
    }

    case 'reorder': {
      const element = state.elements[op.id];
      if (!element) {
        throw new OpRejection(
          'REORDER_MISSING',
          `element '${op.id}' does not exist`,
          op,
        );
      }
      const list = orderRef(state, element.parentId);
      if (op.toIndex < 0 || op.toIndex >= list.length) {
        throw new OpRejection(
          'REORDER_BAD_INDEX',
          `index ${op.toIndex} out of range [0, ${list.length - 1}]`,
          op,
        );
      }
      const from = list.indexOf(op.id);
      list.splice(from, 1);
      list.splice(op.toIndex, 0, op.id);
      return;
    }

    case 'move': {
      const element = state.elements[op.id];
      if (!element) {
        throw new OpRejection(
          'MOVE_MISSING',
          `element '${op.id}' does not exist`,
          op,
        );
      }
      if (op.newParentId !== null) {
        const parent = state.elements[op.newParentId];
        if (!parent || parent.kind !== 'group') {
          throw new OpRejection(
            'MOVE_MISSING_PARENT',
            `target group '${op.newParentId}' does not exist`,
            op,
          );
        }
        if (
          op.newParentId === op.id ||
          isDescendant(state, op.id, op.newParentId)
        ) {
          throw new OpRejection(
            'MOVE_INTO_SUBTREE',
            `cannot move '${op.id}' into itself or one of its descendants`,
            op,
          );
        }
      }
      const fromList = orderRef(state, element.parentId);
      fromList.splice(fromList.indexOf(op.id), 1);
      const toList =
        op.newParentId === element.parentId
          ? fromList
          : orderRef(state, op.newParentId);
      const index = op.toIndex ?? toList.length;
      if (index < 0 || index > toList.length) {
        throw new OpRejection(
          'MOVE_BAD_INDEX',
          `index ${index} out of range [0, ${toList.length}]`,
          op,
        );
      }
      toList.splice(index, 0, op.id);
      state.elements[op.id] = { ...element, parentId: op.newParentId };
      return;
    }

    case 'group': {
      if (op.ids.length === 0) {
        throw new OpRejection('GROUP_EMPTY', 'group requires at least one id', op);
      }
      if (state.elements[op.groupId]) {
        throw new OpRejection(
          'GROUP_ID_TAKEN',
          `groupId '${op.groupId}' already exists`,
          op,
        );
      }
      const members = op.ids.map((id) => {
        const element = state.elements[id];
        if (!element) {
          throw new OpRejection(
            'GROUP_MISSING_ELEMENT',
            `member '${id}' does not exist`,
            op,
          );
        }
        return element;
      });
      const parentId = members[0].parentId;
      if (!members.every((m) => m.parentId === parentId)) {
        throw new OpRejection(
          'GROUP_MIXED_PARENTS',
          'group members must have the same parent',
          op,
        );
      }
      const list = orderRef(state, parentId);
      const orderedIds = [...op.ids].sort(
        (a, b) => list.indexOf(a) - list.indexOf(b),
      );
      const insertAt = Math.min(...op.ids.map((id) => list.indexOf(id)));
      for (const id of op.ids) {
        list.splice(list.indexOf(id), 1);
      }
      const box = boundingBox(members);
      state.elements[op.groupId] = createElement({
        id: op.groupId,
        kind: 'group',
        parentId,
        ...box,
        fill: '',
        stroke: '',
      });
      state.childOrder[op.groupId] = orderedIds;
      list.splice(Math.min(insertAt, list.length), 0, op.groupId);
      for (const id of op.ids) {
        state.elements[id] = { ...state.elements[id], parentId: op.groupId };
      }
      return;
    }

    case 'ungroup': {
      const group = state.elements[op.groupId];
      if (!group) {
        throw new OpRejection(
          'UNGROUP_MISSING',
          `group '${op.groupId}' does not exist`,
          op,
        );
      }
      if (group.kind !== 'group') {
        throw new OpRejection(
          'UNGROUP_NOT_GROUP',
          `element '${op.groupId}' is not a group`,
          op,
        );
      }
      const children = state.childOrder[op.groupId] ?? [];
      const list = orderRef(state, group.parentId);
      const at = list.indexOf(op.groupId);
      list.splice(at, 1, ...children);
      for (const childId of children) {
        state.elements[childId] = {
          ...state.elements[childId],
          parentId: group.parentId,
        };
      }
      delete state.childOrder[op.groupId];
      delete state.elements[op.groupId];
      return;
    }

    case 'restore': {
      const byId = new Map(op.elements.map((element) => [element.id, element]));
      for (const placement of op.placements) {
        if (state.elements[placement.id]) {
          throw new OpRejection(
            'RESTORE_DUPLICATE_ID',
            `element '${placement.id}' already exists`,
            op,
          );
        }
        if (!byId.has(placement.id)) {
          throw new OpRejection(
            'RESTORE_MISSING_ELEMENT',
            `no element data provided for '${placement.id}'`,
            op,
          );
        }
      }
      for (const placement of op.placements) {
        const element = byId.get(placement.id)!;
        state.elements[placement.id] = { ...element, parentId: placement.parentId };
        if (element.kind === 'group') {
          state.childOrder[placement.id] = state.childOrder[placement.id] ?? [];
        }
      }
      for (const placement of op.placements) {
        if (
          placement.parentId !== null &&
          !state.elements[placement.parentId]
        ) {
          throw new OpRejection(
            'RESTORE_MISSING_PARENT',
            `parent '${placement.parentId}' does not exist`,
            op,
          );
        }
      }
      const perParent = new Map<string | null, typeof op.placements>();
      for (const placement of op.placements) {
        const bucket = perParent.get(placement.parentId) ?? [];
        bucket.push(placement);
        perParent.set(placement.parentId, bucket);
      }
      for (const [parentId, bucket] of perParent) {
        bucket.sort((a, b) => b.index - a.index);
        const list = orderRef(state, parentId);
        for (const placement of bucket) {
          list.splice(Math.min(placement.index, list.length), 0, placement.id);
        }
      }
      return;
    }
  }
}
