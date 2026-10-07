import type {
  AnchorTarget,
  CanvasState,
  CardGroup,
  Connection,
  ResolvedConnection,
} from '../types.ts';
import { v4 as uuidv4 } from 'uuid';

export type MembershipConflict = {
  cardId: string;
  keptGroupId: string;
  rejectedGroupId: string;
};

export type GroupMutationResult = {
  groups: CardGroup[];
  conflict: MembershipConflict | null;
};

/** 建立 cardId -> groupId 的归属索引（单卡单组） */
export function buildMembershipIndex(groups: CardGroup[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const g of groups) {
    for (const cardId of g.memberIds) {
      if (!index.has(cardId)) index.set(cardId, g.id);
    }
  }
  return index;
}

export function createGroup(name: string, memberIds: string[], color: string, at?: { x: number; y: number }): CardGroup {
  return {
    id: uuidv4(),
    name,
    collapsed: false,
    x: at?.x ?? 0,
    y: at?.y ?? 0,
    memberIds: [...new Set(memberIds)],
    color,
  };
}

/**
 * 尝试把卡片加入卡组。
 * 若卡片已属于另一个卡组，则不做任何变更，并在 conflict 中返回可观察的冲突信息；
 * 已在同组内则原样返回（幂等）。
 */
export function addCardToGroup(groups: CardGroup[], groupId: string, cardId: string): GroupMutationResult {
  const membership = buildMembershipIndex(groups);
  const existing = membership.get(cardId);
  if (existing === groupId) return { groups, conflict: null };
  if (existing) {
    return { groups, conflict: { cardId, keptGroupId: existing, rejectedGroupId: groupId } };
  }
  const next = groups.map((g) =>
    g.id === groupId && !g.memberIds.includes(cardId)
      ? { ...g, memberIds: [...g.memberIds, cardId] }
      : g,
  );
  return { groups: next, conflict: null };
}

export function removeCardFromGroup(groups: CardGroup[], cardId: string): CardGroup[] {
  return groups.map((g) =>
    g.memberIds.includes(cardId) ? { ...g, memberIds: g.memberIds.filter((id) => id !== cardId) } : g,
  );
}

/** 删除卡组：仅移除容器本身，成员卡片与所有连线保持不变（不解散、不丢弃） */
export function deleteGroup(groups: CardGroup[], groupId: string): CardGroup[] {
  return groups.filter((g) => g.id !== groupId);
}

export function toggleGroupCollapsed(groups: CardGroup[], groupId: string, collapsed?: boolean): CardGroup[] {
  return groups.map((g) => (g.id === groupId ? { ...g, collapsed: collapsed ?? !g.collapsed } : g));
}

export function renameGroup(groups: CardGroup[], groupId: string, name: string): CardGroup[] {
  return groups.map((g) => (g.id === groupId ? { ...g, name } : g));
}

export function reorderMembers(groups: CardGroup[], groupId: string, fromIndex: number, toIndex: number): CardGroup[] {
  return groups.map((g) => {
    if (g.id !== groupId) return g;
    const memberIds = [...g.memberIds];
    if (fromIndex < 0 || fromIndex >= memberIds.length || toIndex < 0 || toIndex >= memberIds.length) return g;
    const [moved] = memberIds.splice(fromIndex, 1);
    memberIds.splice(toIndex, 0, moved);
    return { ...g, memberIds };
  });
}

/** 移动折叠摘要容器的位置；展开状态下位置由成员包围盒决定，调用方不应改写成员坐标 */
export function moveGroupChip(groups: CardGroup[], groupId: string, x: number, y: number): CardGroup[] {
  return groups.map((g) => (g.id === groupId ? { ...g, x, y } : g));
}

function endpointTarget(
  cardId: string,
  cardsById: Map<string, { id: string }>,
  membership: Map<string, string>,
  collapsedGroupIds: Set<string>,
): AnchorTarget | null {
  if (!cardsById.has(cardId)) return null;
  const groupId = membership.get(cardId);
  if (groupId && collapsedGroupIds.has(groupId)) return { kind: 'group', id: groupId };
  return { kind: 'card', id: cardId };
}

/**
 * 解析单条连线在当前卡组状态下的可观察形态：
 * - 两端在同一折叠卡组内：隐藏（展开后自动恢复）
 * - 端点所在卡组折叠：端点吸附为该卡组容器（跨组/组内外都不会消失或错位）
 * - 端点卡片已不存在：标记 dangling-endpoint，交由 UI 明确提示而非静默丢弃
 */
export function resolveConnection(connection: Connection, state: Pick<CanvasState, 'cards' | 'groups'>): ResolvedConnection {
  const cardsById = new Map(state.cards.map((c) => [c.id, c]));
  const membership = buildMembershipIndex(state.groups);
  const collapsedGroupIds = new Set(state.groups.filter((g) => g.collapsed).map((g) => g.id));

  const from = endpointTarget(connection.fromCardId, cardsById, membership, collapsedGroupIds);
  const to = endpointTarget(connection.toCardId, cardsById, membership, collapsedGroupIds);

  if (!from || !to) {
    return { connection, hidden: true, hiddenReason: 'dangling-endpoint', from, to };
  }

  const fromGroup = membership.get(connection.fromCardId);
  const toGroup = membership.get(connection.toCardId);
  if (
    fromGroup &&
    fromGroup === toGroup &&
    collapsedGroupIds.has(fromGroup)
  ) {
    return { connection, hidden: true, hiddenReason: 'same-collapsed-group', from, to };
  }

  return { connection, hidden: false, from, to };
}

export function resolveAllConnections(state: Pick<CanvasState, 'cards' | 'groups' | 'connections'>): ResolvedConnection[] {
  return state.connections.map((c) => resolveConnection(c, state));
}
