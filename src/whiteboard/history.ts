import type { BoardState, WhiteboardElement } from './types.ts';
import { emptyState } from './types.ts';
import type { ElementPatch, Op, Placement } from './ops.ts';
import { applyOp, collectSubtree, orderOf } from './apply.ts';

export interface HistoryEntry {
  redo: Op[];
  undo: Op[];
}

export function inverseOf(state: BoardState, op: Op): Op[] {
  switch (op.type) {
    case 'add':
      return [{ type: 'remove', id: op.element.id }];

    case 'update': {
      const element = state.elements[op.id];
      if (!element) return [];
      const previous: Record<string, unknown> = {};
      for (const key of Object.keys(op.patch) as (keyof ElementPatch)[]) {
        previous[key] = element[key];
      }
      return [{ type: 'update', id: op.id, patch: previous }];
    }

    case 'remove': {
      if (!state.elements[op.id]) return [];
      const subtree = collectSubtree(state, op.id);
      const elements: WhiteboardElement[] = subtree.map((id) => ({
        ...state.elements[id],
      }));
      const placements: Placement[] = subtree.map((id) => {
        const element = state.elements[id];
        const list = orderOf(state, element.parentId);
        return { id, parentId: element.parentId, index: list.indexOf(id) };
      });
      return [{ type: 'restore', elements, placements }];
    }

    case 'reorder': {
      const element = state.elements[op.id];
      if (!element) return [];
      const list = orderOf(state, element.parentId);
      return [{ type: 'reorder', id: op.id, toIndex: list.indexOf(op.id) }];
    }

    case 'move': {
      const element = state.elements[op.id];
      if (!element) return [];
      const list = orderOf(state, element.parentId);
      return [
        {
          type: 'move',
          id: op.id,
          newParentId: element.parentId,
          toIndex: list.indexOf(op.id),
        },
      ];
    }

    case 'group': {
      const first = state.elements[op.ids[0]];
      if (!first) return [];
      const parentId = first.parentId;
      const list = orderOf(state, parentId);
      const positions = op.ids
        .map((id) => ({ id, index: list.indexOf(id) }))
        .sort((a, b) => a.index - b.index);
      const minIndex = positions[0].index;
      const undo: Op[] = [{ type: 'ungroup', groupId: op.groupId }];
      for (let k = positions.length - 1; k >= 0; k -= 1) {
        const target = positions[k].index;
        if (target !== minIndex + k) {
          undo.push({
            type: 'move',
            id: positions[k].id,
            newParentId: parentId,
            toIndex: target,
          });
        }
      }
      return undo;
    }

    case 'ungroup': {
      const group = state.elements[op.groupId];
      if (!group || group.kind !== 'group') return [];
      const children = state.childOrder[op.groupId] ?? [];
      const list = orderOf(state, group.parentId);
      const restore: Op = {
        type: 'restore',
        elements: [{ ...group }],
        placements: [
          { id: group.id, parentId: group.parentId, index: list.indexOf(group.id) },
        ],
      };
      const moves: Op[] = children.map((childId, index) => ({
        type: 'move',
        id: childId,
        newParentId: group.id,
        toIndex: index,
      }));
      return [restore, ...moves];
    }

    case 'restore':
      return op.placements.map((p) => ({ type: 'remove', id: p.id }));
  }
}

export class Board {
  state: BoardState;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  constructor(initial?: BoardState) {
    this.state = initial ?? emptyState();
  }

  get undoDepth(): number {
    return this.past.length;
  }

  get redoDepth(): number {
    return this.future.length;
  }

  dispatch(op: Op): void {
    const next = applyOp(this.state, op);
    const undo = inverseOf(this.state, op);
    this.state = next;
    this.past.push({ redo: [op], undo });
    this.future = [];
  }

  undo(): boolean {
    const entry = this.past.pop();
    if (!entry) return false;
    for (const op of entry.undo) {
      this.state = applyOp(this.state, op);
    }
    this.future.push(entry);
    return true;
  }

  redo(): boolean {
    const entry = this.future.pop();
    if (!entry) return false;
    for (const op of entry.redo) {
      this.state = applyOp(this.state, op);
    }
    this.past.push(entry);
    return true;
  }

  resetHistory(): void {
    this.past = [];
    this.future = [];
  }
}
