/**
 * 生命周期一致性：同一胶囊经历多次 创建/编辑/投递/解锁 后，
 * 状态、内容与时间戳始终保持一致，不出现内容覆盖或状态回退。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_ORDER,
  createCapsule,
  editCapsule,
  evaluateCapsule,
  unlockCapsule,
  type Capsule,
} from '../src/core/capsule.ts';
import { CapsuleService, type CapsuleOp } from '../src/core/service.ts';

const T0 = 1_700_000_000_000;
const DELIVER_AT = T0 + 86_400_000; // 一天后投递

function makeCapsule(): Capsule {
  const result = createCapsule(
    { id: 'cap-1', title: '给未来的自己', content: '第一版内容', deliverAt: DELIVER_AT },
    T0,
  );
  assert.ok(result.ok);
  return result.value;
}

test('完整生命周期：创建→多次编辑→投递→解锁，字段逐步演进且一致', () => {
  let capsule = makeCapsule();
  assert.equal(capsule.status, 'sealed');
  assert.equal(capsule.version, 1);
  assert.equal(capsule.createdAt, T0);
  assert.equal(capsule.deliveredAt, null);
  assert.equal(capsule.unlockedAt, null);

  const edit1 = editCapsule(capsule, { content: '第二版内容' }, T0 + 1_000);
  assert.ok(edit1.ok);
  capsule = edit1.value;
  assert.equal(capsule.content, '第二版内容');
  assert.equal(capsule.version, 2);
  assert.equal(capsule.createdAt, T0, 'createdAt 不可变');
  assert.equal(capsule.updatedAt, T0 + 1_000);

  const edit2 = editCapsule(capsule, { title: '改标题', content: '最终版' }, T0 + 2_000);
  assert.ok(edit2.ok);
  capsule = edit2.value;
  assert.equal(capsule.title, '改标题');
  assert.equal(capsule.content, '最终版');
  assert.equal(capsule.version, 3);

  const delivered = evaluateCapsule(capsule, DELIVER_AT);
  assert.ok(delivered.ok);
  capsule = delivered.value;
  assert.equal(capsule.status, 'delivered');
  assert.equal(capsule.deliveredAt, DELIVER_AT);
  assert.equal(capsule.version, 4);

  const unlocked = unlockCapsule(capsule, DELIVER_AT + 5_000);
  assert.ok(unlocked.ok);
  capsule = unlocked.value;
  assert.equal(capsule.status, 'unlocked');
  assert.equal(capsule.unlockedAt, DELIVER_AT + 5_000);
  assert.equal(capsule.deliveredAt, DELIVER_AT, 'deliveredAt 解锁后保持不变');
  assert.equal(capsule.content, '最终版', '内容在全生命周期中未被覆盖');
  assert.equal(capsule.version, 5);
});

test('投递后编辑被明确拒绝且内容不被覆盖', () => {
  let capsule = makeCapsule();
  const delivered = evaluateCapsule(capsule, DELIVER_AT);
  assert.ok(delivered.ok);
  capsule = delivered.value;

  const edit = editCapsule(capsule, { content: '试图篡改' }, DELIVER_AT + 1);
  assert.ok(!edit.ok);
  assert.equal(edit.error.code, 'ALREADY_DELIVERED');
  assert.equal(capsule.content, '第一版内容');

  const unlocked = unlockCapsule(capsule, DELIVER_AT + 2);
  assert.ok(unlocked.ok);
  const editAfterUnlock = editCapsule(unlocked.value, { content: '再篡改' }, DELIVER_AT + 3);
  assert.ok(!editAfterUnlock.ok);
  assert.equal(editAfterUnlock.error.code, 'ALREADY_UNLOCKED');
  assert.equal(unlocked.value.content, '第一版内容');
});

test('状态机严格单向：任意时间求值都不会让状态回退', () => {
  let capsule = makeCapsule();
  const unlocked = unlockCapsule(capsule, DELIVER_AT);
  assert.ok(unlocked.ok);
  capsule = unlocked.value;
  assert.equal(capsule.status, 'unlocked');

  for (const now of [T0, DELIVER_AT - 1, DELIVER_AT, DELIVER_AT + 1]) {
    const evaluated = evaluateCapsule(capsule, now);
    assert.ok(evaluated.ok);
    assert.equal(evaluated.value.status, 'unlocked', `now=${now} 时状态不得回退`);
    assert.equal(evaluated.value, capsule, '已终态的胶囊求值必须幂等');
  }
});

test('时间戳单调不减：时钟回拨的写操作被明确拒绝', () => {
  const capsule = makeCapsule();
  const edited = editCapsule(capsule, { content: 'v2' }, T0 + 5_000);
  assert.ok(edited.ok);
  const regressed = editCapsule(edited.value, { content: 'v3' }, T0 + 4_000);
  assert.ok(!regressed.ok);
  assert.equal(regressed.error.code, 'CLOCK_REGRESSION');
});

test('相同操作序列在不同实例上重放，最终状态逐字段一致（确定性）', () => {
  const script: CapsuleOp[] = [
    { opId: 'op-1', kind: 'create', id: 'cap-x', title: 't', content: 'c1', deliverAt: DELIVER_AT, now: T0 },
    { opId: 'op-2', kind: 'edit', id: 'cap-x', expectedVersion: 1, patch: { content: 'c2' }, now: T0 + 10 },
    { opId: 'op-3', kind: 'edit', id: 'cap-x', expectedVersion: 2, patch: { title: 't2' }, now: T0 + 20 },
    { opId: 'op-4', kind: 'evaluate', id: 'cap-x', now: DELIVER_AT },
    { opId: 'op-5', kind: 'unlock', id: 'cap-x', expectedVersion: 4, now: DELIVER_AT + 1 },
  ];
  const run = () => {
    const service = new CapsuleService();
    for (const op of script) service.submit(op);
    return service.get('cap-x');
  };
  assert.deepEqual(run(), run());
});

test('服务层读取返回快照，外部篡改不影响内部状态', () => {
  const service = new CapsuleService();
  service.submit({ opId: 'op-1', kind: 'create', id: 'cap-s', title: 't', content: 'c', deliverAt: DELIVER_AT, now: T0 });
  const snapshot = service.get('cap-s');
  assert.ok(snapshot);
  snapshot.content = '被外部篡改';
  snapshot.status = 'unlocked';
  const again = service.get('cap-s');
  assert.equal(again?.content, 'c');
  assert.equal(again?.status, 'sealed');
});

test('STATUS_ORDER 与状态机方向一致', () => {
  assert.ok(STATUS_ORDER.sealed < STATUS_ORDER.delivered);
  assert.ok(STATUS_ORDER.delivered < STATUS_ORDER.unlocked);
});
