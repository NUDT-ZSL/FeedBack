/**
 * 编排核心离线自测：node --import tsx scripts/selftest.ts
 * 覆盖：多宴席隔离、增量重推等价性、约束冲突留痕、空名单不可编排、批量入口。
 */
import assert from 'node:assert/strict';
import {
  addBanquet,
  addConstraint,
  addGuest,
  addTable,
  arrangeAll,
  arrangeBanquet,
  auditWorkspace,
  clearGuests,
  confirmArrangement,
  createEmptyWorkspace,
  removeGuest,
  setTableDishes,
  addDish,
  switchBanquet,
  updateGuest,
  updateTable,
} from '../src/core/engine';
import { solve } from '../src/core/solver';
import { validateArrangement } from '../src/core/validate';
import type { Banquet, Workspace } from '../src/core/types';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

const get = (ws: Workspace, id: string): Banquet => {
  const b = ws.banquets.find((x) => x.id === id);
  if (!b) throw new Error(`banquet ${id} missing`);
  return b;
};

const assertValid = (b: Banquet) => {
  const issues = validateArrangement(
    b.guests,
    b.tables,
    b.dishes,
    b.constraints,
    b.arrangement.assignments,
  );
  assert.deepEqual(issues, [], `座次校验失败: ${issues.map((i) => i.message).join('; ')}`);
};

/** 增量结果与整体重排一致性：两者都必须合法，且整体重排同样可行 */
const assertParity = (b: Banquet) => {
  assertValid(b);
  const full = solve({
    guests: b.guests,
    tables: b.tables,
    dishes: b.dishes,
    constraints: b.constraints,
  });
  assert.equal(full.ok, true, '整体重排应可行');
};

function buildTwoBanquets(): { ws: Workspace; b1: string; b2: string } {
  let ws = createEmptyWorkspace();
  ws = addBanquet(ws, '甲宴');
  const b1 = ws.activeBanquetId!;
  ws = addBanquet(ws, '乙宴');
  const b2 = ws.activeBanquetId!;
  for (const [bid, prefix] of [
    [b1, '甲'],
    [b2, '乙'],
  ] as const) {
    ws = addTable(ws, bid, { name: `${prefix}主桌`, capacity: 6, isMain: true, minRank: 4 });
    ws = addTable(ws, bid, { name: `${prefix}次桌`, capacity: 6 });
    ws = addGuest(ws, bid, { name: `${prefix}大人`, rank: 5, entourage: 1 });
    ws = addGuest(ws, bid, { name: `${prefix}先生`, rank: 3 });
    ws = addGuest(ws, bid, { name: `${prefix}随从`, rank: 1, entourage: 2 });
  }
  return { ws, b1, b2 };
}

console.log('司膳官宴席编排 · 核心自测');

test('多场宴席互不干扰，可来回切换', () => {
  const { ws: ws0, b1, b2 } = buildTwoBanquets();
  let ws = ws0;
  ws = switchBanquet(ws, b1);
  const before1 = JSON.stringify(get(ws, b1).arrangement);
  const before2 = JSON.stringify(get(ws, b2).arrangement);
  ws = addGuest(ws, b1, { name: '甲新客', rank: 2 });
  ws = switchBanquet(ws, b2);
  assert.notEqual(JSON.stringify(get(ws, b1).arrangement), before1, '甲宴应被重推');
  assert.equal(JSON.stringify(get(ws, b2).arrangement), before2, '乙宴不应受影响');
  assert.equal(get(ws, b1).guests.length, 4);
  assert.equal(get(ws, b2).guests.length, 3);
});

test('确认的座次不被无关改动冲掉', () => {
  const { ws: ws0, b1 } = buildTwoBanquets();
  let ws = ws0;
  ws = confirmArrangement(ws, b1);
  const seatOf = (name: string) => {
    const b = get(ws, b1);
    const g = b.guests.find((x) => x.name === name)!;
    return b.arrangement.assignments.find((a) => a.guestId === g.id)?.tableId;
  };
  const mainSeat = seatOf('甲大人');
  // 无关改动：给乙宴加人
  const b2 = ws.banquets.find((b) => b.id !== b1)!.id;
  ws = addGuest(ws, b2, { name: '乙新客', rank: 2 });
  assert.equal(seatOf('甲大人'), mainSeat, '甲宴座次不应被乙宴改动影响');
  assert.equal(get(ws, b1).arrangement.confirmed, true);
});

test('忌口变更只重推受影响桌次，结果与整体重排一致', () => {
  const { ws: ws0, b1 } = buildTwoBanquets();
  let ws = ws0;
  ws = addDish(ws, b1, { name: '花生酥', tags: ['花生'] });
  ws = addTable(ws, b1, { name: '甲侧桌', capacity: 6 });
  const b = get(ws, b1);
  const sideTable = b.tables.find((t) => !t.isMain)!;
  ws = setTableDishes(ws, b1, sideTable.id, [b.dishes[0].id]);
  const target = get(ws, b1).guests.find((g) => g.name === '甲先生')!;
  ws = updateGuest(ws, b1, target.id, { dietary: ['花生'] });
  const after = get(ws, b1);
  assertParity(after);
  assert.ok(after.arrangement.affectedTableIds.length >= 1, '应记录受影响桌次');
  assert.ok(
    after.arrangement.trace.some((t) => t.kind === 'keep'),
    '应有保留座次的追溯记录',
  );
});

test('桌容量调小后重推，不超容、不重复落座', () => {
  const { ws: ws0, b1 } = buildTwoBanquets();
  let ws = ws0;
  ws = addTable(ws, b1, { name: '甲侧桌', capacity: 6 });
  const b = get(ws, b1);
  const sideTable = b.tables.find((t) => !t.isMain)!;
  ws = updateTable(ws, b1, sideTable.id, { capacity: 2 });
  const after = get(ws, b1);
  assertParity(after);
  for (const t of after.tables) {
    const heads = after.arrangement.assignments
      .filter((a) => a.tableId === t.id)
      .reduce((s, a) => s + 1 + after.guests.find((g) => g.id === a.guestId)!.entourage, 0);
    assert.ok(heads <= t.capacity, `${t.name} 超容`);
  }
});

test('主桌等级门槛生效', () => {
  const { ws: ws0, b1 } = buildTwoBanquets();
  let ws = ws0;
  const b = get(ws, b1);
  const main = b.tables.find((t) => t.isMain)!;
  for (const a of b.arrangement.assignments.filter((x) => x.tableId === main.id)) {
    const g = b.guests.find((x) => x.id === a.guestId)!;
    assert.ok(g.rank >= main.minRank, `${g.name} 等级不足却坐了主桌`);
  }
  // 把大人等级调低，应被请出主桌
  const vip = b.guests.find((g) => g.name === '甲大人')!;
  ws = updateGuest(ws, b1, vip.id, { rank: 2 });
  const after = get(ws, b1);
  assertParity(after);
  const seat = after.arrangement.assignments.find((a) => a.guestId === vip.id)!;
  assert.notEqual(seat.tableId, main.id, '降级后不应再坐主桌');
});

test('随行人员与主宾同桌且计入容量', () => {
  const { ws, b1 } = buildTwoBanquets();
  const b = get(ws, b1);
  const vip = b.guests.find((g) => g.name === '甲随从')!;
  assert.equal(vip.entourage, 2);
  assertValid(b);
});

test('矛盾约束保留并给出可追溯说明，不静默择一', () => {
  let ws = createEmptyWorkspace();
  ws = addBanquet(ws, '矛盾宴');
  const bid = ws.activeBanquetId!;
  ws = addTable(ws, bid, { name: '唯一桌', capacity: 3 });
  ws = addGuest(ws, bid, { name: '甲', rank: 3 });
  ws = addGuest(ws, bid, { name: '乙', rank: 3 });
  ws = addGuest(ws, bid, { name: '丙', rank: 3 });
  let b = get(ws, bid);
  const [ga, gb, gc] = b.guests;
  ws = addConstraint(ws, bid, ga.id, gb.id, '甲忌乙');
  ws = addConstraint(ws, bid, gb.id, gc.id, '乙忌丙');
  ws = addConstraint(ws, bid, gc.id, ga.id, '丙忌甲');
  b = get(ws, bid);
  assert.equal(b.arrangement.status, 'unarrangeable', '应进入不可编排状态');
  assert.equal(b.arrangement.assignments.length, 0, '不可编排时不残留座次');
  assert.ok(b.arrangement.conflicts, '应有冲突报告');
  assert.ok(b.arrangement.conflicts!.core.length >= 1, '应列出冲突核心');
  assert.ok(b.arrangement.conflicts!.cycles.length >= 1, '应识别约束环');
  const all = b.constraints.length;
  assert.equal(all, 3, '三条约束必须全部保留，不得静默择一');
  assert.ok(
    b.arrangement.trace.some((t) => t.kind === 'conflict'),
    '追溯记录中应有冲突说明',
  );
});

test('约束解除后可恢复编排', () => {
  let ws = createEmptyWorkspace();
  ws = addBanquet(ws, '恢复宴');
  const bid = ws.activeBanquetId!;
  ws = addTable(ws, bid, { name: '桌一', capacity: 2 });
  ws = addTable(ws, bid, { name: '桌二', capacity: 2 });
  ws = addGuest(ws, bid, { name: '甲', rank: 3 });
  ws = addGuest(ws, bid, { name: '乙', rank: 3 });
  let b = get(ws, bid);
  ws = addConstraint(ws, bid, b.guests[0].id, b.guests[1].id);
  b = get(ws, bid);
  assert.equal(b.arrangement.status, 'arranged');
  const t1 = b.arrangement.assignments.find((a) => a.guestId === b.guests[0].id)!;
  const t2 = b.arrangement.assignments.find((a) => a.guestId === b.guests[1].id)!;
  assert.notEqual(t1.tableId, t2.tableId, '不宜同桌者不应同桌');
});

test('清空宾客名单进入明确的不可编排状态，旧座次归档不残留', () => {
  const { ws: ws0, b1 } = buildTwoBanquets();
  let ws = ws0;
  assert.ok(get(ws, b1).arrangement.assignments.length > 0);
  ws = clearGuests(ws, b1);
  const b = get(ws, b1);
  assert.equal(b.arrangement.status, 'empty');
  assert.equal(b.arrangement.assignments.length, 0, '不得残留旧座次');
  assert.ok(b.lastArchived, '旧座次应归档备查');
  assert.ok(b.lastArchived!.assignments.length > 0);
});

test('移除宾客后其座次消失，其余保留', () => {
  const { ws: ws0, b1 } = buildTwoBanquets();
  let ws = ws0;
  const b = get(ws, b1);
  const target = b.guests.find((g) => g.name === '甲先生')!;
  ws = removeGuest(ws, b1, target.id);
  const after = get(ws, b1);
  assert.ok(!after.arrangement.assignments.some((a) => a.guestId === target.id));
  assertParity(after);
});

test('批量编排入口对多场宴席一次性核对', () => {
  const { ws: ws0, b1, b2 } = buildTwoBanquets();
  let ws = ws0;
  ws = clearGuests(ws, b2);
  ws = arrangeAll(ws);
  const audit = auditWorkspace(ws);
  assert.equal(audit.length, 2);
  const a1 = audit.find((a) => a.banquetId === b1)!;
  const a2 = audit.find((a) => a.banquetId === b2)!;
  assert.equal(a1.status, 'arranged');
  assert.deepEqual(a1.issues, []);
  assert.equal(a2.status, 'empty');
  // 单场整体编排入口
  ws = arrangeBanquet(ws, b1);
  assert.equal(get(ws, b1).arrangement.status, 'arranged');
});

test('容量总体不足时给出不可编排与说明', () => {
  let ws = createEmptyWorkspace();
  ws = addBanquet(ws, '拥挤宴');
  const bid = ws.activeBanquetId!;
  ws = addTable(ws, bid, { name: '小桌', capacity: 2 });
  ws = addGuest(ws, bid, { name: '甲', rank: 3, entourage: 2 });
  ws = addGuest(ws, bid, { name: '乙', rank: 3 });
  const b = get(ws, bid);
  assert.equal(b.arrangement.status, 'unarrangeable');
  assert.ok(
    b.arrangement.conflicts!.core.some((c) => c.includes('容量')),
    '说明中应指出容量问题',
  );
});

console.log(`\n全部通过：${passed} 项`);
