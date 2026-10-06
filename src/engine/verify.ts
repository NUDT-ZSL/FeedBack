import type { CanvasState, Connection, GroupEvent } from '../types.ts';
import { isOnRectBoundary } from './geometry.ts';
import {
  addCardToGroup,
  boxSelect,
  createGroup,
  deleteGroup,
  groupDisplayRect,
  groupOfCard,
  moveGroup,
  reorderMembers,
  resolveConnection,
  setGroupCollapsed,
  visibleCards,
} from './groups.ts';
import {
  emptyCanvasState,
  loadCanvasState,
  migrateState,
  saveCanvasState,
  serializeState,
  type StorageLike,
} from './storage.ts';

export interface VerifyCase {
  name: string;
  passed: boolean;
  details: string[];
}

export interface VerifyReport {
  cases: VerifyCase[];
  passed: number;
  failed: number;
  ok: boolean;
  finishedAt: string;
}

class CaseRecorder {
  readonly details: string[] = [];
  private failures = 0;

  check(condition: boolean, label: string, observation?: string): void {
    if (condition) {
      this.details.push(`✓ ${label}${observation ? `（${observation}）` : ''}`);
    } else {
      this.failures += 1;
      this.details.push(`✗ ${label}${observation ? `（${observation}）` : ''}`);
    }
  }

  note(text: string): void {
    this.details.push(`· ${text}`);
  }

  get passed(): boolean {
    return this.failures === 0;
  }
}

function makeCard(id: string, x: number, y: number) {
  return {
    id,
    title: `卡片${id}`,
    content: `内容${id}`,
    color: '#2a2a4e',
    x,
    y,
    width: 200,
    height: 150,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeConnection(id: string, fromCardId: string, toCardId: string): Connection {
  return { id, fromCardId, toCardId, type: 'arrow', color: '#aaaaaa', label: '' };
}

function baseState(): CanvasState {
  return {
    ...emptyCanvasState(),
    cards: [
      makeCard('A', 0, 0),
      makeCard('B', 300, 0),
      makeCard('C', 900, 0),
      makeCard('D', 900, 400),
      makeCard('E', 1500, 200),
    ],
    connections: [
      makeConnection('c-inner', 'A', 'B'),
      makeConnection('c-cross', 'B', 'C'),
      makeConnection('c-outer', 'D', 'E'),
      makeConnection('c-between-groups', 'C', 'D'),
    ],
  };
}

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => void data.set(key, value),
  };
}

function eventSummary(events: GroupEvent[]): string {
  return events.map((event) => event.type).join(', ') || '无事件';
}

function caseCollapseExpand(): VerifyCase {
  const rec = new CaseRecorder();
  let state = baseState();
  const created = createGroup(state, ['A', 'B'], '情节线一');
  state = created.state;
  const groupId = state.groups[0].id;

  const collapsed = setGroupCollapsed(state, groupId, true);
  state = collapsed.state;
  rec.check(collapsed.events.some((e) => e.type === 'group-collapse-changed'), '折叠产生可观察事件', eventSummary(collapsed.events));
  rec.check(visibleCards(state).length === 3, '折叠后成员卡片隐藏', `可见卡片 ${visibleCards(state).length}/5`);

  const inner = resolveConnection(state, state.connections.find((c) => c.id === 'c-inner')!);
  rec.check(inner?.hidden === true, '同组内部连线随折叠隐藏');
  const cross = resolveConnection(state, state.connections.find((c) => c.id === 'c-cross')!);
  rec.check(cross !== null && !cross.hidden, '跨组连线不消失');

  const cardBBefore = state.cards.find((c) => c.id === 'B')!;
  const snapshot = { x: cardBBefore.x, y: cardBBefore.y, width: cardBBefore.width, height: cardBBefore.height };
  const expanded = setGroupCollapsed(state, groupId, false);
  state = expanded.state;
  const cardBAfter = state.cards.find((c) => c.id === 'B')!;
  rec.check(
    cardBAfter.x === snapshot.x && cardBAfter.y === snapshot.y &&
      cardBAfter.width === snapshot.width && cardBAfter.height === snapshot.height,
    '展开后成员恢复原有位置与大小',
  );
  const innerAfter = resolveConnection(state, state.connections.find((c) => c.id === 'c-inner')!);
  rec.check(innerAfter !== null && !innerAfter.hidden, '展开后内部连线恢复显示');
  return { name: '折叠 / 展开', passed: rec.passed, details: rec.details };
}

function caseCrossGroupSnapping(): VerifyCase {
  const rec = new CaseRecorder();
  let state = baseState();
  state = createGroup(state, ['A', 'B'], '组一').state;
  state = createGroup(state, ['C', 'D'], '组二').state;
  const [g1, g2] = state.groups;
  state = setGroupCollapsed(state, g1.id, true).state;
  state = setGroupCollapsed(state, g2.id, true).state;

  const cross = resolveConnection(state, state.connections.find((c) => c.id === 'c-cross')!)!;
  const rect1 = groupDisplayRect(state.groups[0]);
  const rect2 = groupDisplayRect(state.groups[1]);
  rec.check(!cross.hidden, '跨组连线在双方折叠时仍显示');
  rec.check(isOnRectBoundary(cross.from, rect1), '起点吸附到组一折叠容器边界', `(${cross.from.x.toFixed(1)}, ${cross.from.y.toFixed(1)})`);
  rec.check(isOnRectBoundary(cross.to, rect2), '终点吸附到组二折叠容器边界', `(${cross.to.x.toFixed(1)}, ${cross.to.y.toFixed(1)})`);

  const outer = resolveConnection(state, state.connections.find((c) => c.id === 'c-outer')!)!;
  rec.check(!outer.hidden && isOnRectBoundary(outer.from, rect2), '组内→组外连线仅组内端吸附容器边界');
  const cardE = state.cards.find((c) => c.id === 'E')!;
  const onCardE =
    outer.to.x >= cardE.x - 0.5 && outer.to.x <= cardE.x + cardE.width + 0.5 &&
    outer.to.y >= cardE.y - 0.5 && outer.to.y <= cardE.y + cardE.height + 0.5;
  rec.check(onCardE, '组外端仍落在原卡片边界上');

  state = setGroupCollapsed(state, g1.id, false).state;
  state = setGroupCollapsed(state, g2.id, false).state;
  const restored = resolveConnection(state, state.connections.find((c) => c.id === 'c-cross')!)!;
  const cardB = state.cards.find((c) => c.id === 'B')!;
  const onCardB =
    restored.from.x >= cardB.x - 0.5 && restored.from.x <= cardB.x + cardB.width + 0.5 &&
    restored.from.y >= cardB.y - 0.5 && restored.from.y <= cardB.y + cardB.height + 0.5;
  rec.check(onCardB, '展开后端点恢复为原始卡片端点');
  return { name: '跨组连线吸附', passed: rec.passed, details: rec.details };
}

function caseMembershipConflict(): VerifyCase {
  const rec = new CaseRecorder();
  let state = baseState();
  state = createGroup(state, ['A'], '组一').state;
  state = createGroup(state, ['C'], '组二').state;
  const [g1, g2] = state.groups;

  const result = addCardToGroup(state, g2.id, 'A');
  const conflict = result.events.find((e) => e.type === 'membership-conflict');
  rec.check(Boolean(conflict), '重复归入产生 membership-conflict 可观察事件', conflict?.message);
  rec.check(groupOfCard(result.state, 'A')?.id === g1.id, '冲突后卡片仍归属原卡组');
  rec.check(!result.state.groups[1].memberIds.includes('A'), '目标卡组未发生静默变更');
  rec.check(result.state.groups.length === 2, '卡组数量不变，无静默丢弃');

  const okResult = addCardToGroup(result.state, g2.id, 'E');
  rec.check(okResult.events.some((e) => e.type === 'member-added'), '无冲突卡片正常入组', eventSummary(okResult.events));
  return { name: '成员归属冲突', passed: rec.passed, details: rec.details };
}

function caseDeleteGroupKeepsConnections(): VerifyCase {
  const rec = new CaseRecorder();
  let state = baseState();
  state = createGroup(state, ['A', 'B'], '组一').state;
  const groupId = state.groups[0].id;

  const result = deleteGroup(state, groupId);
  state = result.state;
  rec.check(result.events.some((e) => e.type === 'group-deleted'), '删除产生可观察事件', eventSummary(result.events));
  const detached = result.events.filter((e) => e.type === 'connection-endpoint-detached');
  rec.check(detached.length === 2, '引用成员的每条连线都有脱离提示', `${detached.length} 条`);
  rec.check(state.groups.length === 0, '卡组已删除');
  rec.check(state.cards.length === 5, '成员卡片保留在画布上');
  rec.check(state.connections.length === 4, '连线全部保留，未静默丢弃');
  const inner = resolveConnection(state, state.connections.find((c) => c.id === 'c-inner')!);
  rec.check(inner !== null && !inner.hidden, '原内部连线恢复为卡片间连线');
  return { name: '删除卡组后的连线引用', passed: rec.passed, details: rec.details };
}

function caseLegacyAndPersistence(): VerifyCase {
  const rec = new CaseRecorder();
  const legacyJson = JSON.stringify({
    version: 1,
    offsetX: 12,
    offsetY: -8,
    scale: 1.5,
    cards: [makeCard('A', 0, 0), makeCard('B', 300, 0)],
    connections: [makeConnection('c-inner', 'A', 'B')],
  });
  const legacy = migrateState(JSON.parse(legacyJson));
  rec.check(legacy.ok === true, 'v1 旧状态（无 groups 字段）加载成功');
  rec.check(legacy.state?.groups.length === 0, '缺失的 groups 字段按空列表兼容');
  rec.check(legacy.state?.version === 2, '版本号升级到当前版本');
  rec.check(legacy.warnings.length > 0, '迁移过程产出可观察说明', legacy.warnings[0]);

  let state = legacy.state!;
  state = createGroup(state, ['A', 'B'], '情节线').state;
  const groupId = state.groups[0].id;
  state = reorderMembers(state, groupId, 1, 0).state;
  const orderBefore = state.groups[0].memberIds.join(',');
  state = setGroupCollapsed(state, groupId, true).state;

  const storage = memoryStorage();
  saveCanvasState(state, storage);
  const reloaded = loadCanvasState(storage);
  rec.check(reloaded.ok === true, '保存后重新加载成功');
  const group = reloaded.state?.groups[0];
  rec.check(group?.collapsed === true, '折叠状态随画布状态持久化');
  rec.check(group?.memberIds.join(',') === orderBefore, '成员顺序随画布状态持久化', orderBefore);
  const inner = resolveConnection(reloaded.state!, reloaded.state!.connections[0]);
  rec.check(inner?.hidden === true, '重新加载后内部连线仍保持隐藏');

  const broken = migrateState('not-an-object');
  rec.check(broken.ok === false && Boolean(broken.error), '彻底非法的数据给出明确错误而非崩溃', broken.error);
  void serializeState;
  return { name: '持久化与旧状态兼容', passed: rec.passed, details: rec.details };
}

function caseBoxSelectAndTransform(): VerifyCase {
  const rec = new CaseRecorder();
  let state = baseState();
  state = createGroup(state, ['A', 'B'], '组一').state;
  const groupId = state.groups[0].id;
  state = setGroupCollapsed(state, groupId, true).state;
  const rect = groupDisplayRect(state.groups[0]);

  const hit = boxSelect(state, { x: rect.x - 10, y: rect.y - 10, width: rect.width + 20, height: rect.height + 20 });
  rec.check(hit.groupIds.includes(groupId), '框选命中折叠卡组容器');
  rec.check(!hit.cardIds.includes('A') && !hit.cardIds.includes('B'), '命中容器时不选中内部卡片');
  rec.check(hit.cardIds.length === 0, '折叠成员不参与卡片命中');

  const before = state.cards.find((c) => c.id === 'A')!;
  const relBefore = { dx: before.x - rect.x, dy: before.y - rect.y };
  state = { ...state, scale: 2.5, offsetX: 300, offsetY: -120 };
  const after = state.cards.find((c) => c.id === 'A')!;
  const rectAfter = groupDisplayRect(state.groups[0]);
  rec.check(
    after.x - rectAfter.x === relBefore.dx && after.y - rectAfter.y === relBefore.dy,
    '缩放 / 平移视口不改变卡组与成员的相对关系',
  );

  const moved = moveGroup(state, groupId, 40, 60);
  const movedCard = moved.cards.find((c) => c.id === 'A')!;
  const movedRect = groupDisplayRect(moved.groups[0]);
  rec.check(
    movedCard.x - movedRect.x === relBefore.dx && movedCard.y - movedRect.y === relBefore.dy,
    '拖动折叠卡组时成员随容器整体平移',
  );
  return { name: '框选与视口变换', passed: rec.passed, details: rec.details };
}

/** 统一批量验证入口：UI 按钮与 `npm run verify` 共用 */
export function runVerification(): VerifyReport {
  const cases = [
    caseCollapseExpand(),
    caseCrossGroupSnapping(),
    caseMembershipConflict(),
    caseDeleteGroupKeepsConnections(),
    caseLegacyAndPersistence(),
    caseBoxSelectAndTransform(),
  ];
  const passed = cases.filter((item) => item.passed).length;
  return {
    cases,
    passed,
    failed: cases.length - passed,
    ok: passed === cases.length,
    finishedAt: new Date().toISOString(),
  };
}
