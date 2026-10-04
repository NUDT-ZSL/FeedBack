import type { BoardState } from './types.ts';

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalState(state: BoardState): {
  nodes: unknown;
  children: Record<string, string[]>;
  parent: Record<string, string>;
} {
  const nodes: Record<string, unknown> = {};
  for (const id of Object.keys(state.nodes).sort()) {
    nodes[id] = sortKeysDeep(state.nodes[id]);
  }
  const children: Record<string, string[]> = {};
  for (const id of Object.keys(state.children).sort()) {
    children[id] = [...state.children[id]];
  }
  const parent: Record<string, string> = {};
  for (const id of Object.keys(state.parent).sort()) {
    parent[id] = state.parent[id];
  }
  return { nodes, children, parent };
}

export function snapshot(state: BoardState): string {
  return JSON.stringify(canonicalState(state));
}

export function hashState(state: BoardState): string {
  const text = snapshot(state);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
