import { ROOT_ID, type BoardState } from './types.ts';

export function createBoard(): BoardState {
  return {
    nodes: {},
    children: { [ROOT_ID]: [] },
    parent: {},
  };
}

export function cloneBoard(state: BoardState): BoardState {
  return structuredClone(state);
}

export function childrenOf(state: BoardState, id: string): string[] {
  return state.children[id] ?? [];
}

export function isContainer(state: BoardState, id: string): boolean {
  if (id === ROOT_ID) return true;
  return state.nodes[id]?.type === 'group';
}

export function indexInParent(state: BoardState, id: string): number {
  const parentId = state.parent[id];
  if (parentId === undefined) return -1;
  return state.children[parentId].indexOf(id);
}

export function subtreeIds(state: BoardState, rootNodeId: string): string[] {
  const order: string[] = [];
  const visit = (id: string): void => {
    order.push(id);
    for (const child of state.children[id] ?? []) {
      visit(child);
    }
  };
  visit(rootNodeId);
  return order;
}

export function isDescendant(state: BoardState, ancestorId: string, nodeId: string): boolean {
  let current: string | undefined = nodeId;
  while (current !== undefined && current !== ROOT_ID) {
    if (current === ancestorId) return true;
    current = state.parent[current];
  }
  return false;
}

export function visibleOrder(state: BoardState): string[] {
  const order: string[] = [];
  const visit = (containerId: string): void => {
    for (const child of state.children[containerId] ?? []) {
      order.push(child);
      visit(child);
    }
  };
  visit(ROOT_ID);
  return order;
}
