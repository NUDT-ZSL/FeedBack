/**
 * 卡组功能批量验证入口（纯 Node 运行，无需浏览器、无需网络）：
 *   node scripts/verify.ts    或    npm run verify
 *
 * 覆盖路径：
 *   1. 折叠/展开：组内连线随折叠隐藏、展开恢复，成员位置大小不变
 *   2. 跨组连线吸附：折叠时端点吸附到卡组容器边界，展开恢复卡片端点
 *   3. 成员归属冲突：一卡拖入两组的处理结果可观察（拒绝 + 冲突信息）
 *   4. 删除卡组后连线引用：连线与成员卡片保留，端点回退为卡片，不静默丢弃
 *   5. 旧状态兼容加载：v1 无 groups 字段可加载；脏数据归一化且问题可观察
 *   6. 持久化往返：折叠状态/归属/成员顺序保存后重载保持一致
 */
import type { CanvasState, Card, Connection } from '../src/types.ts';
import { CANVAS_STORAGE_VERSION, GROUP_CHIP_WIDTH } from '../src/types.ts';
import {
  addCardToGroup,
  buildMembershipIndex,
  createGroup,
  deleteGroup,
  resolveConnection,
  toggleGroupCollapsed,
} from '../src/utils/groups.ts';
import { normalizeCanvasState, serializeCanvasState } from '../src/utils/storage.ts';
import { boundaryPoint, collapsedGroupRect, rectContainsPoint } from '../src/utils/geometry.ts';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function card(id: string, x: number, y: number): Card {
  return {
    id, title: `卡片${id}`, content: '', color: '#2a2a4e',
    x, y, width: 200, height: 150, createdAt: 0, updatedAt: 0,
  };
}

function conn(id: string, fromCardId: string, toCardId: string): Connection {
  return { id, fromCardId, toCardId, type: 'arrow', color: '#aaaaaa', label: '' };
}

function makeState(): CanvasState {
  return {
    version: CANVAS_STORAGE_VERSION,
    offsetX: 0, offsetY: 0, scale: 1,
    cards: [card('A', 0, 0), card('B', 300, 0), card('C', 900, 0), card('D', 900, 400)],
    connections: [conn('c1', 'A', 'B'), conn('c2', 'A', 'C'), conn('c3', 'C', 'D')],
    groups: [],
  };
}

// ---------- 1. 折叠/展开 ----------
console.log('\n[1] 折叠/展开');
{
  const state = makeState();
  state.groups = [createGroup('情节线一', ['A', 'B'], '#4d96ff', { x: 0, y: -80 })];
  state.groups = toggleGroupCollapsed(state.groups, state.groups[0].id, true);

  const r1 = resolveConnection(state.connections[0], state); // A->B 同组
  check('组内连线折叠后隐藏', r1.hidden && r1.hiddenReason === 'same-collapsed-group');

  const membership = buildMembershipIndex(state.groups);
  const hiddenCards = new Set(state.groups.filter((g) => g.collapsed).flatMap((g) => g.memberIds));
  check('折叠后成员卡片隐藏', hiddenCards.has('A') && hiddenCards.has('B'));
  check('组外卡片不受影响', !hiddenCards.has('C') && membership.get('C') === undefined);

  state.groups = toggleGroupCollapsed(state.groups, state.groups[0].id, false);
  const r1b = resolveConnection(state.connections[0], state);
  check('展开后组内连线恢复可见', !r1b.hidden);
  const cardA = state.cards.find((c) => c.id === 'A')!;
  check('展开后成员位置与大小不变', cardA.x === 0 && cardA.y === 0 && cardA.width === 200 && cardA.height === 150);
}

// ---------- 2. 跨组连线吸附 ----------
console.log('\n[2] 跨组连线吸附');
{
  const state = makeState();
  state.groups = [createGroup('情节线一', ['A', 'B'], '#4d96ff', { x: 100, y: 300 })];
  state.groups = toggleGroupCollapsed(state.groups, state.groups[0].id, true);
  const gid = state.groups[0].id;

  const r2 = resolveConnection(state.connections[1], state); // A(组内) -> C(组外)
  check('跨组连线不消失', !r2.hidden);
  check('组内端点吸附为卡组容器', r2.from?.kind === 'group' && r2.from.id === gid);
  check('组外端点保持为卡片', r2.to?.kind === 'card' && r2.to.id === 'C');

  const chipRect = collapsedGroupRect(state.groups[0]);
  const cardC = state.cards.find((c) => c.id === 'C')!;
  const toward = { x: cardC.x + cardC.width / 2, y: cardC.y + cardC.height / 2 };
  const snap = boundaryPoint(chipRect, toward);
  check('吸附点落在容器边界上',
    (Math.abs(snap.x - chipRect.x) < 1e-6 || Math.abs(snap.x - (chipRect.x + chipRect.width)) < 1e-6 ||
     Math.abs(snap.y - chipRect.y) < 1e-6 || Math.abs(snap.y - (chipRect.y + chipRect.height)) < 1e-6),
    `snap=(${snap.x},${snap.y}) rect=${JSON.stringify(chipRect)}`);
  check('吸附点在容器内（不错位）', rectContainsPoint({ ...chipRect, x: chipRect.x - 1, y: chipRect.y - 1, width: chipRect.width + 2, height: chipRect.height + 2 }, snap));

  state.groups = toggleGroupCollapsed(state.groups, gid, false);
  const r2b = resolveConnection(state.connections[1], state);
  check('展开后端点恢复为原始卡片', r2b.from?.kind === 'card' && r2b.from.id === 'A');

  // 两端分别属于两个折叠卡组
  state.groups = [
    createGroup('组一', ['A'], '#4d96ff', { x: 0, y: 300 }),
    createGroup('组二', ['C'], '#9b59b6', { x: 900, y: 300 }),
  ];
  state.groups = toggleGroupCollapsed(state.groups, state.groups[0].id, true);
  state.groups = toggleGroupCollapsed(state.groups, state.groups[1].id, true);
  const r2c = resolveConnection(state.connections[1], state);
  check('两端各自折叠时均吸附到各自容器', !r2c.hidden && r2c.from?.kind === 'group' && r2c.to?.kind === 'group');
  check('折叠容器尺寸为摘要尺寸', collapsedGroupRect(state.groups[0]).width === GROUP_CHIP_WIDTH);
}

// ---------- 3. 成员归属冲突 ----------
console.log('\n[3] 成员归属冲突');
{
  let groups = [createGroup('组一', ['A'], '#4d96ff'), createGroup('组二', [], '#9b59b6')];
  const result = addCardToGroup(groups, groups[1].id, 'A');
  check('一卡入两组被拒绝', result.conflict !== null);
  check('冲突信息可观察（保留组/拒绝组）',
    result.conflict?.keptGroupId === groups[0].id && result.conflict?.rejectedGroupId === groups[1].id);
  check('拒绝后原归属不变', result.groups[0].memberIds.includes('A') && !result.groups[1].memberIds.includes('A'));

  const again = addCardToGroup(groups, groups[0].id, 'A');
  check('重复加入同组幂等', again.conflict === null && again.groups[0].memberIds.filter((id) => id === 'A').length === 1);

  const ok = addCardToGroup(groups, groups[1].id, 'B');
  check('空闲卡片可正常入组', ok.conflict === null && ok.groups[1].memberIds.includes('B'));
  groups = ok.groups;
}

// ---------- 4. 删除卡组后连线引用 ----------
console.log('\n[4] 删除卡组后连线引用');
{
  const state = makeState();
  state.groups = [createGroup('情节线一', ['A', 'B'], '#4d96ff')];
  const gid = state.groups[0].id;
  state.groups = deleteGroup(state.groups, gid);
  check('删除卡组后连线数据保留', state.connections.length === 3);
  check('删除卡组后成员卡片保留', state.cards.length === 4);
  const r = resolveConnection(state.connections[0], state);
  check('连线端点回退为原始卡片（可观察，非静默丢弃）',
    !r.hidden && r.from?.kind === 'card' && r.from.id === 'A' && r.to?.kind === 'card' && r.to.id === 'B');

  // 连线引用已不存在的卡片：标记 dangling 且数据保留
  const danglingState = makeState();
  danglingState.connections.push(conn('cX', 'A', 'GHOST'));
  const rd = resolveConnection(danglingState.connections[3], danglingState);
  check('缺失端点的连线标记为 dangling-endpoint', rd.hidden && rd.hiddenReason === 'dangling-endpoint');
  check('dangling 连线数据不被删除', danglingState.connections.some((c) => c.id === 'cX'));
}

// ---------- 5. 旧状态兼容加载 ----------
console.log('\n[5] 旧状态兼容加载');
{
  const v1 = {
    version: 1,
    offsetX: 10, offsetY: 20, scale: 1.5,
    cards: [card('A', 0, 0), card('B', 300, 0)],
    connections: [conn('c1', 'A', 'B')],
    // 无 groups 字段
  };
  const loaded = normalizeCanvasState(v1);
  check('v1 数据（无 groups）可加载', loaded.state.cards.length === 2 && loaded.state.connections.length === 1);
  check('缺失 groups 字段归一化为空数组', Array.isArray(loaded.state.groups) && loaded.state.groups.length === 0);
  check('版本号迁移到当前版本', loaded.state.version === CANVAS_STORAGE_VERSION && loaded.migratedFrom === 1);
  check('视口状态保留', loaded.state.offsetX === 10 && loaded.state.scale === 1.5);

  const dirty = {
    version: 2,
    cards: [card('A', 0, 0), card('B', 300, 0)],
    connections: [conn('c1', 'A', 'B'), conn('cBad', 'A', 'GHOST')],
    groups: [
      { id: 'g1', name: '组一', collapsed: true, x: 0, y: 0, memberIds: ['A', 'GHOST'], color: '#4d96ff' },
      { id: 'g2', name: '组二', collapsed: false, x: 0, y: 0, memberIds: ['A'], color: '#9b59b6' },
    ],
  };
  const result = normalizeCanvasState(dirty);
  check('脏数据不整体失败', result.state.cards.length === 2 && result.state.groups.length === 2);
  check('重复归属冲突可观察', result.issues.some((i) => i.kind === 'membership-conflict'));
  check('冲突归一化：保留先出现的归属',
    result.state.groups[0].memberIds.includes('A') && !result.state.groups[1].memberIds.includes('A'));
  check('引用缺失卡片的成员记录被移除并可观察', result.issues.some((i) => i.kind === 'unknown-member'));
  check('dangling 连线保留且可观察',
    result.issues.some((i) => i.kind === 'dangling-connection') &&
    result.state.connections.some((c) => c.id === 'cBad'));
  check('折叠状态在归一化后保留', result.state.groups[0].collapsed === true);

  const garbage = normalizeCanvasState('not-an-object');
  check('完全非法输入回退为空画布', garbage.state.cards.length === 0 && garbage.state.groups.length === 0);
}

// ---------- 6. 持久化往返 ----------
console.log('\n[6] 持久化往返');
{
  const state = makeState();
  state.groups = [createGroup('情节线一', ['B', 'A'], '#4d96ff', { x: 50, y: 60 })];
  state.groups = toggleGroupCollapsed(state.groups, state.groups[0].id, true);

  const reloaded = normalizeCanvasState(JSON.parse(serializeCanvasState(state)));
  check('折叠状态持久化', reloaded.state.groups[0].collapsed === true);
  check('成员顺序持久化', JSON.stringify(reloaded.state.groups[0].memberIds) === JSON.stringify(['B', 'A']));
  check('卡组归属持久化', buildMembershipIndex(reloaded.state.groups).get('A') === state.groups[0].id);
  const r = resolveConnection(reloaded.state.connections[0], reloaded.state);
  check('重载后组内连线仍处于隐藏状态', r.hidden && r.hiddenReason === 'same-collapsed-group');
  check('重载后跨组连线仍吸附到容器', (() => {
    const r2 = resolveConnection(reloaded.state.connections[1], reloaded.state);
    return !r2.hidden && r2.from?.kind === 'group';
  })());
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) {
  console.log('失败项：');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
