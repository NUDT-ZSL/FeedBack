import { createHash } from 'node:crypto';
import type { BoardState, WhiteboardElement } from './types.ts';

const ELEMENT_KEYS = [
  'id',
  'kind',
  'parentId',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'fill',
  'stroke',
  'strokeWidth',
  'text',
] as const;

function canonicalElement(element: WhiteboardElement): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const key of ELEMENT_KEYS) {
    record[key] = element[key];
  }
  return record;
}

export function canonicalize(state: BoardState): string {
  const elements = Object.keys(state.elements)
    .sort()
    .map((id) => canonicalElement(state.elements[id]));
  const childOrder: Record<string, string[]> = {};
  for (const key of Object.keys(state.childOrder).sort()) {
    childOrder[key] = [...state.childOrder[key]];
  }
  return JSON.stringify({ elements, rootOrder: [...state.rootOrder], childOrder });
}

export function stateHash(state: BoardState): string {
  return createHash('sha256').update(canonicalize(state)).digest('hex');
}

export function visibleOrder(state: BoardState): string[] {
  const out: string[] = [];
  const walk = (id: string): void => {
    out.push(id);
    for (const childId of state.childOrder[id] ?? []) {
      walk(childId);
    }
  };
  for (const id of state.rootOrder) {
    walk(id);
  }
  return out;
}
