import type {
  Card,
  CardGroup,
  CanvasState,
  Connection,
  GroupEvent,
  Point,
  Rect,
} from '../types.ts';
import {
  COLLAPSED_GROUP_HEIGHT,
  COLLAPSED_GROUP_WIDTH,
  GROUP_COLORS,
  GROUP_HEADER_HEIGHT,
  GROUP_NAME_MAX_LENGTH,
  GROUP_PADDING,
} from '../types.ts';
import { boundaryPoint, rectCenter, rectsIntersect } from './geometry.ts';

export interface MutationResult {
  state: CanvasState;
  events: GroupEvent[];
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function cloneState(state: CanvasState): CanvasState {
  return {
    ...state,
    cards: state.cards.map((card) => ({ ...card })),
    connections: state.connections.map((conn) => ({ ...conn })),
    groups: state.groups.map((group) => ({ ...group, memberIds: [...group.memberIds] })),
  };
}

export function groupOfCard(state: CanvasState, cardId: string): CardGroup | undefined {
  return state.groups.find((group) => group.memberIds.includes(cardId));
}

export function cardById(state: CanvasState, cardId: string): Card | undefined {
  return state.cards.find((card) => card.id === cardId);
}

/** 根据成员卡片位置计算卡组展开时的包围盒 */
export function expandedGroupRect(state: CanvasState, group: CardGroup): Rect {
  const members = group.memberIds
    .map((id) => cardById(state, id))
    .filter((card): card is Card => Boolean(card));
  if (members.length === 0) {
    return { x: group.x, y: group.y, width: 220, height: 120 };
  }
  const minX = Math.min(...members.map((card) => card.x));
  const minY = Math.min(...members.map((card) => card.y));
  const maxX = Math.max(...members.map((card) => card.x + card.width));
  const maxY = Math.max(...members.map((card) => card.y + card.height));
  return {
    x: minX - GROUP_PADDING,
    y: minY - GROUP_PADDING - GROUP_HEADER_HEIGHT,
    width: maxX - minX + GROUP_PADDING * 2,
    height: maxY - minY + GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT,
  };
}

/** 卡组在当前折叠状态下对外可见的矩形 */
export function groupDisplayRect(group: CardGroup): Rect {
  if (group.collapsed) {
    return { x: group.x, y: group.y, width: group.collapsedWidth, height: group.collapsedHeight };
  }
  return { x: group.x, y: group.y, width: group.width, height: group.height };
}

function reflowGroup(state: CanvasState, group: CardGroup): void {
  if (!group.collapsed) {
    const rect = expandedGroupRect(state, group);
    group.x = rect.x;
    group.y = rect.y;
    group.width = rect.width;
    group.height = rect.height;
  }
  group.updatedAt = Date.now();
}

/** 折叠卡组中成员卡片 id 集合：这些卡片当前不在画布上显示 */
export function hiddenMemberCardIds(state: CanvasState): Set<string> {
  const ids = new Set<string>();
  for (const group of state.groups) {
    if (group.collapsed) group.memberIds.forEach((id) => ids.add(id));
  }
  return ids;
}

export function visibleCards(state: CanvasState): Card[] {
  const hidden = hiddenMemberCardIds(state);
  return state.cards.filter((card) => !hidden.has(card.id));
}

export function createGroup(
  state: CanvasState,
  cardIds: string[] = [],
  name = '新卡组',
): MutationResult {
  const next = cloneState(state);
  const events: GroupEvent[] = [];
  const now = Date.now();
  const group: CardGroup = {
    id: createId(),
    name: name.slice(0, GROUP_NAME_MAX_LENGTH) || '未命名卡组',
    color: GROUP_COLORS[next.groups.length % GROUP_COLORS.length],
    collapsed: false,
    memberIds: [],
    x: 0,
    y: 0,
    width: 220,
    height: 120,
    collapsedWidth: COLLAPSED_GROUP_WIDTH,
    collapsedHeight: COLLAPSED_GROUP_HEIGHT,
    createdAt: now,
    updatedAt: now,
  };
  for (const cardId of cardIds) {
    addMemberInternal(next, group, cardId, events);
  }
  next.groups.push(group);
  reflowGroup(next, group);
  events.unshift({
    type: 'group-created',
    groupId: group.id,
    message: `已创建卡组「${group.name}」，成员 ${group.memberIds.length} 张`,
  });
  return { state: next, events };
}

function addMemberInternal(
  state: CanvasState,
  group: CardGroup,
  cardId: string,
  events: GroupEvent[],
): void {
  if (group.memberIds.includes(cardId)) return;
  if (!cardById(state, cardId)) return;
  const other = state.groups.find(
    (candidate) => candidate.id !== group.id && candidate.memberIds.includes(cardId),
  );
  if (other) {
    const card = cardById(state, cardId);
    events.push({
      type: 'membership-conflict',
      groupId: group.id,
      cardId,
      message: `卡片「${card?.title ?? cardId}」已属于卡组「${other.name}」，一张卡片不能同时归入两个卡组`,
    });
    return;
  }
  group.memberIds.push(cardId);
  reflowGroup(state, group);
  events.push({
    type: 'member-added',
    groupId: group.id,
    cardId,
    message: `卡片已加入卡组「${group.name}」（成员顺序第 ${group.memberIds.length}）`,
  });
}

/**
 * 把卡片加入卡组。若该卡片已属于其他卡组，返回 membership-conflict 事件，
 * 状态保持不变（不会静默改挂或丢弃）。
 */
export function addCardToGroup(
  state: CanvasState,
  groupId: string,
  cardId: string,
): MutationResult {
  const next = cloneState(state);
  const group = next.groups.find((candidate) => candidate.id === groupId);
  const events: GroupEvent[] = [];
  if (group) addMemberInternal(next, group, cardId, events);
  return { state: next, events };
}

export function removeCardFromGroup(
  state: CanvasState,
  groupId: string,
  cardId: string,
): MutationResult {
  const next = cloneState(state);
  const group = next.groups.find((candidate) => candidate.id === groupId);
  const events: GroupEvent[] = [];
  if (group && group.memberIds.includes(cardId)) {
    group.memberIds = group.memberIds.filter((id) => id !== cardId);
    reflowGroup(next, group);
    events.push({
      type: 'member-removed',
      groupId,
      cardId,
      message: `卡片已从卡组「${group.name}」移除`,
    });
  }
  return { state: next, events };
}

/** 在成员顺序内移动位置（from/to 为 memberIds 下标），顺序随状态持久化 */
export function reorderMembers(
  state: CanvasState,
  groupId: string,
  fromIndex: number,
  toIndex: number,
): MutationResult {
  const next = cloneState(state);
  const group = next.groups.find((candidate) => candidate.id === groupId);
  const events: GroupEvent[] = [];
  if (
    group &&
    fromIndex >= 0 &&
    fromIndex < group.memberIds.length &&
    toIndex >= 0 &&
    toIndex < group.memberIds.length &&
    fromIndex !== toIndex
  ) {
    const [moved] = group.memberIds.splice(fromIndex, 1);
    group.memberIds.splice(toIndex, 0, moved);
    group.updatedAt = Date.now();
    events.push({
      type: 'members-reordered',
      groupId,
      cardId: moved,
      message: `卡组「${group.name}」成员顺序已更新`,
    });
  }
  return { state: next, events };
}

export function renameGroup(
  state: CanvasState,
  groupId: string,
  name: string,
): MutationResult {
  const next = cloneState(state);
  const group = next.groups.find((candidate) => candidate.id === groupId);
  const events: GroupEvent[] = [];
  if (group) {
    group.name = (name.slice(0, GROUP_NAME_MAX_LENGTH) || group.name).trim() || group.name;
    group.updatedAt = Date.now();
    events.push({ type: 'group-renamed', groupId, message: `卡组已重命名为「${group.name}」` });
  }
  return { state: next, events };
}

export function setGroupCollapsed(
  state: CanvasState,
  groupId: string,
  collapsed: boolean,
): MutationResult {
  const next = cloneState(state);
  const group = next.groups.find((candidate) => candidate.id === groupId);
  const events: GroupEvent[] = [];
  if (group && group.collapsed !== collapsed) {
    group.collapsed = collapsed;
    if (collapsed) {
      group.collapsedWidth = COLLAPSED_GROUP_WIDTH;
      group.collapsedHeight = COLLAPSED_GROUP_HEIGHT;
    } else {
      reflowGroup(next, group);
    }
    group.updatedAt = Date.now();
    const hidden = collapsed
      ? next.connections.filter((conn) => isInternalConnection(next, conn)).length
      : 0;
    events.push({
      type: 'group-collapse-changed',
      groupId,
      message: collapsed
        ? `卡组「${group.name}」已折叠，${group.memberIds.length} 张成员卡片与 ${hidden} 条内部连线已隐藏`
        : `卡组「${group.name}」已展开，成员卡片恢复原有位置与大小，内部连线恢复显示`,
    });
  }
  return { state: next, events };
}

/**
 * 删除卡组：成员卡片保留在画布上，引用成员的连线全部保留并恢复到卡片端点，
 * 对每条受影响连线发出 connection-endpoint-detached 事件，绝不静默丢弃。
 */
export function deleteGroup(state: CanvasState, groupId: string): MutationResult {
  const next = cloneState(state);
  const group = next.groups.find((candidate) => candidate.id === groupId);
  const events: GroupEvent[] = [];
  if (!group) return { state: next, events };
  const memberSet = new Set(group.memberIds);
  const affected = next.connections.filter(
    (conn) => memberSet.has(conn.fromCardId) || memberSet.has(conn.toCardId),
  );
  for (const conn of affected) {
    events.push({
      type: 'connection-endpoint-detached',
      groupId,
      connectionId: conn.id,
      message: `卡组「${group.name}」已删除，连线 ${conn.id} 的引用保留，端点恢复连接到原卡片`,
    });
  }
  next.groups = next.groups.filter((candidate) => candidate.id !== groupId);
  events.unshift({
    type: 'group-deleted',
    groupId,
    message: `卡组「${group.name}」已删除：${group.memberIds.length} 张成员卡片与 ${affected.length} 条连线均保留`,
  });
  return { state: next, events };
}

/** 整体平移卡组：卡组与其成员一起移动，相对关系不变（也用于拖动折叠容器） */
export function moveGroup(state: CanvasState, groupId: string, dx: number, dy: number): CanvasState {
  const next = cloneState(state);
  const group = next.groups.find((candidate) => candidate.id === groupId);
  if (!group) return next;
  group.x += dx;
  group.y += dy;
  for (const card of next.cards) {
    if (group.memberIds.includes(card.id)) {
      card.x += dx;
      card.y += dy;
      card.updatedAt = Date.now();
    }
  }
  if (!group.collapsed) reflowGroup(next, group);
  return next;
}

/** 成员卡片移动 / 缩放后同步展开卡组的包围盒；折叠状态下成员本就不可见 */
export function syncGroupsAfterCardChange(state: CanvasState): CanvasState {
  for (const group of state.groups) reflowGroup(state, group);
  return state;
}

export function isInternalConnection(state: CanvasState, conn: Connection): boolean {
  const fromGroup = groupOfCard(state, conn.fromCardId);
  const toGroup = groupOfCard(state, conn.toCardId);
  return Boolean(
    fromGroup && toGroup && fromGroup.id === toGroup.id && fromGroup.collapsed,
  );
}

function endpointShape(state: CanvasState, cardId: string): { rect: Rect; center: Point } | null {
  const card = cardById(state, cardId);
  if (!card) return null;
  const group = groupOfCard(state, cardId);
  if (group?.collapsed) {
    const rect = groupDisplayRect(group);
    return { rect, center: rectCenter(rect) };
  }
  const rect = { x: card.x, y: card.y, width: card.width, height: card.height };
  return { rect, center: rectCenter(rect) };
}

export interface ResolvedConnection {
  connection: Connection;
  /** 两端属于同一个已折叠卡组时为 true：连线应整体隐藏 */
  hidden: boolean;
  from: Point;
  to: Point;
}

/**
 * 解析连线当前端点：
 * - 同组且卡组折叠 → hidden
 * - 端点所在卡组折叠（跨组 / 组外）→ 吸附到折叠容器边界
 * - 否则吸附到卡片矩形边界；展开后天然恢复原始卡片端点
 */
export function resolveConnection(
  state: CanvasState,
  conn: Connection,
): ResolvedConnection | null {
  if (isInternalConnection(state, conn)) {
    return { connection: conn, hidden: true, from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
  }
  const fromShape = endpointShape(state, conn.fromCardId);
  const toShape = endpointShape(state, conn.toCardId);
  if (!fromShape || !toShape) return null;
  return {
    connection: conn,
    hidden: false,
    from: boundaryPoint(fromShape.rect, toShape.center),
    to: boundaryPoint(toShape.rect, fromShape.center),
  };
}

export interface BoxSelection {
  cardIds: string[];
  groupIds: string[];
}

/**
 * 框选命中规则：
 * - 命中折叠卡组 → 只选中卡组容器，其内部成员不计入卡片命中
 * - 展开卡组的成员卡片按正常卡片参与命中
 */
export function boxSelect(state: CanvasState, rect: Rect): BoxSelection {
  const groupIds: string[] = [];
  const blockedCardIds = new Set<string>();
  for (const group of state.groups) {
    if (group.collapsed && rectsIntersect(rect, groupDisplayRect(group))) {
      groupIds.push(group.id);
      group.memberIds.forEach((id) => blockedCardIds.add(id));
    }
  }
  const cardIds = visibleCards(state)
    .filter((card) => !blockedCardIds.has(card.id))
    .filter((card) =>
      rectsIntersect(rect, { x: card.x, y: card.y, width: card.width, height: card.height }),
    )
    .map((card) => card.id);
  return { cardIds, groupIds };
}
