import type { BoardState } from './types.ts';

export function checkInvariants(state: BoardState): string[] {
  const problems: string[] = [];
  const locationOf = new Map<string, string | null>();

  const visit = (id: string, parentId: string | null): void => {
    const where = parentId === null ? 'rootOrder' : `childOrder['${parentId}']`;
    if (!state.elements[id]) {
      problems.push(`${where} references missing element '${id}'`);
      return;
    }
    if (locationOf.has(id)) {
      const prev = locationOf.get(id);
      const prevWhere = prev === null ? 'rootOrder' : `childOrder['${prev}']`;
      problems.push(`element '${id}' appears in both ${prevWhere} and ${where}`);
      return;
    }
    locationOf.set(id, parentId);
  };

  for (const id of state.rootOrder) visit(id, null);
  for (const [groupId, list] of Object.entries(state.childOrder)) {
    for (const id of list) visit(id, groupId);
  }

  for (const [id, element] of Object.entries(state.elements)) {
    if (!locationOf.has(id)) {
      problems.push(`element '${id}' is not present in any order list`);
      continue;
    }
    const structuralParent = locationOf.get(id)!;
    if (element.parentId !== structuralParent) {
      problems.push(
        `element '${id}' parentId '${element.parentId}' does not match its location under '${structuralParent}'`,
      );
    }
    if (element.parentId !== null) {
      const parent = state.elements[element.parentId];
      if (!parent) {
        problems.push(`element '${id}' has missing parent '${element.parentId}'`);
      } else if (parent.kind !== 'group') {
        problems.push(
          `element '${id}' parent '${element.parentId}' is not a group`,
        );
      }
    }
    if (element.kind === 'group' && !state.childOrder[id]) {
      problems.push(`group '${id}' is missing its childOrder entry`);
    }
  }

  for (const [groupId, list] of Object.entries(state.childOrder)) {
    const element = state.elements[groupId];
    if (!element) {
      problems.push(`childOrder has entry for missing group '${groupId}'`);
    } else if (element.kind !== 'group') {
      problems.push(`childOrder entry '${groupId}' belongs to a non-group element`);
    }
    if (new Set(list).size !== list.length) {
      problems.push(`childOrder['${groupId}'] contains duplicate ids`);
    }
  }
  if (new Set(state.rootOrder).size !== state.rootOrder.length) {
    problems.push('rootOrder contains duplicate ids');
  }

  for (const id of Object.keys(state.elements)) {
    const chain = new Set<string>();
    let current: string | null = id;
    while (current !== null) {
      if (chain.has(current)) {
        problems.push(`parent cycle detected involving '${current}'`);
        break;
      }
      chain.add(current);
      current = state.elements[current]?.parentId ?? null;
    }
  }

  return problems;
}
