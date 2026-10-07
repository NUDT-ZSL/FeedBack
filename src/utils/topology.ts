import type { CanvasState, Card } from '../types.ts';

/**
 * 基于连线的拓扑排序（Kahn 算法）生成线性叙事路径。
 * 手动重排顺序（outlineOrder）仅在无环时作为同优先级卡片的排序提示。
 * 返回 ordered（入序卡片）与 cyclic（处于环中、无法定位的卡片 id）。
 */
export function topologicalOrder(state: Pick<CanvasState, 'cards' | 'connections' | 'outlineOrder'>): {
  ordered: Card[];
  cyclic: string[];
} {
  const cardsById = new Map(state.cards.map((c) => [c.id, c]));
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const card of state.cards) {
    indegree.set(card.id, 0);
    adjacency.set(card.id, []);
  }
  const edges = new Set<string>();
  for (const conn of state.connections) {
    if (!cardsById.has(conn.fromCardId) || !cardsById.has(conn.toCardId)) continue;
    if (conn.fromCardId === conn.toCardId) continue;
    const key = `${conn.fromCardId}->${conn.toCardId}`;
    if (edges.has(key)) continue;
    edges.add(key);
    adjacency.get(conn.fromCardId)!.push(conn.toCardId);
    indegree.set(conn.toCardId, (indegree.get(conn.toCardId) ?? 0) + 1);
  }

  const rank = new Map<string, number>();
  state.outlineOrder?.forEach((id, i) => rank.set(id, i));
  const byYThenX = (a: string, b: string) => {
    const ra = rank.has(a) ? rank.get(a)! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b) ? rank.get(b)! : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    const ca = cardsById.get(a)!;
    const cb = cardsById.get(b)!;
    return ca.y - cb.y || ca.x - cb.x;
  };

  let ready = state.cards.filter((c) => (indegree.get(c.id) ?? 0) === 0).map((c) => c.id);
  const orderedIds: string[] = [];
  while (ready.length > 0) {
    ready.sort(byYThenX);
    const id = ready.shift()!;
    orderedIds.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) ready.push(next);
    }
  }
  const cyclic = state.cards.map((c) => c.id).filter((id) => !orderedIds.includes(id));
  return {
    ordered: orderedIds.map((id) => cardsById.get(id)!).filter(Boolean),
    cyclic,
  };
}
