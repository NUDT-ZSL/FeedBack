/**
 * 并发/重复提交：相同输入重复提交幂等且不重复生效；
 * 冲突输入给出明确拒绝而非静默择一；最终状态由操作顺序唯一确定。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CapsuleService } from '../src/core/service.ts';

const T0 = 1_700_000_000_000;
const DELIVER_AT = T0 + 7_200_000;

function seed(service: CapsuleService): void {
  const result = service.submit({
    opId: 'seed-create',
    kind: 'create',
    id: 'cap-c',
    title: '原标题',
    content: '原内容',
    deliverAt: DELIVER_AT,
    now: T0,
  });
  assert.ok(result.ok);
}

test('相同操作（同 opId）连续提交：幂等，版本只增加一次', () => {
  const service = new CapsuleService();
  seed(service);

  const op = {
    opId: 'dup-edit',
    kind: 'edit' as const,
    id: 'cap-c',
    expectedVersion: 1,
    patch: { content: '只应生效一次' },
    now: T0 + 1_000,
  };
  const first = service.submit(op);
  const second = service.submit(op);
  const third = service.submit(op);

  assert.ok(first.ok);
  assert.equal(first.replayed, false);
  assert.ok(second.ok && third.ok);
  assert.equal(second.replayed, true, '第二次提交必须被识别为重放');
  assert.equal(third.replayed, true);
  assert.equal(service.get('cap-c')?.version, 2, '重复提交不得重复推进版本');
  assert.deepEqual(second.capsule, first.capsule);
});

test('失败操作重放：返回相同的失败结论，不产生副作用', () => {
  const service = new CapsuleService();
  seed(service);
  const badOp = {
    opId: 'bad-edit',
    kind: 'edit' as const,
    id: 'cap-c',
    expectedVersion: 1,
    patch: { title: '' },
    now: T0 + 1_000,
  };
  const first = service.submit(badOp);
  const second = service.submit(badOp);
  assert.ok(!first.ok);
  assert.equal(first.error.code, 'INVALID_INPUT');
  assert.ok(!second.ok);
  assert.equal(second.replayed, true);
  assert.equal(second.error.code, 'INVALID_INPUT');
  assert.equal(service.get('cap-c')?.version, 1);
});

test('冲突编辑（同基准版本）：先提交者生效，后提交者被明确拒绝', () => {
  const a = new CapsuleService();
  seed(a);

  const winner = a.submit({
    opId: 'edit-a',
    kind: 'edit',
    id: 'cap-c',
    expectedVersion: 1,
    patch: { content: 'A 的内容' },
    now: T0 + 1_000,
  });
  const loser = a.submit({
    opId: 'edit-b',
    kind: 'edit',
    id: 'cap-c',
    expectedVersion: 1,
    patch: { content: 'B 的内容' },
    now: T0 + 2_000,
  });

  assert.ok(winner.ok);
  assert.ok(!loser.ok);
  assert.equal(loser.error.code, 'VERSION_CONFLICT');
  const final = a.get('cap-c');
  assert.equal(final?.content, 'A 的内容', '冲突时不允许静默择一或覆盖');
  assert.equal(final?.version, 2);
});

test('最终状态由操作顺序决定：调换应用顺序结果对应调换，均可预测', () => {
  const apply = (first: 'A' | 'B') => {
    const service = new CapsuleService();
    seed(service);
    const ordered = first === 'A'
      ? [
          { opId: 'edit-a', kind: 'edit' as const, id: 'cap-c', expectedVersion: 1, patch: { content: 'A' }, now: T0 + 1_000 },
          { opId: 'edit-b', kind: 'edit' as const, id: 'cap-c', expectedVersion: 2, patch: { content: 'B' }, now: T0 + 2_000 },
        ]
      : [
          { opId: 'edit-b', kind: 'edit' as const, id: 'cap-c', expectedVersion: 1, patch: { content: 'B' }, now: T0 + 1_000 },
          { opId: 'edit-a', kind: 'edit' as const, id: 'cap-c', expectedVersion: 2, patch: { content: 'A' }, now: T0 + 2_000 },
        ];
    for (const op of ordered) {
      const result = service.submit(op);
      assert.ok(result.ok);
    }
    return service.get('cap-c')?.content;
  };
  assert.equal(apply('A'), 'B', 'A 先 B 后 → 最终为 B');
  assert.equal(apply('B'), 'A', 'B 先 A 后 → 最终为 A');
  assert.notEqual(apply('A'), apply('B'));
});

test('重复创建相同 id：同 opId 幂等，不同 opId 明确报 ALREADY_EXISTS', () => {
  const service = new CapsuleService();
  const createOp = {
    opId: 'create-1',
    kind: 'create' as const,
    id: 'cap-dup',
    title: 't',
    content: 'c',
    deliverAt: DELIVER_AT,
    now: T0,
  };
  assert.ok(service.submit(createOp).ok);
  const replay = service.submit(createOp);
  assert.ok(replay.ok);
  assert.equal(replay.replayed, true);
  const again = service.submit({ ...createOp, opId: 'create-2' });
  assert.ok(!again.ok);
  assert.equal(again.error.code, 'ALREADY_EXISTS');
});

test('重复解锁：第二次（新 opId）明确报 ALREADY_UNLOCKED，解锁时间戳不被覆盖', () => {
  const service = new CapsuleService();
  seed(service);
  const first = service.submit({
    opId: 'unlock-1',
    kind: 'unlock',
    id: 'cap-c',
    expectedVersion: 1,
    now: DELIVER_AT,
  });
  const replay = service.submit({
    opId: 'unlock-1',
    kind: 'unlock',
    id: 'cap-c',
    expectedVersion: 1,
    now: DELIVER_AT + 9_999,
  });
  const second = service.submit({
    opId: 'unlock-2',
    kind: 'unlock',
    id: 'cap-c',
    expectedVersion: 3,
    now: DELIVER_AT + 9_999,
  });
  assert.ok(first.ok);
  assert.ok(replay.ok);
  assert.equal(replay.replayed, true);
  assert.equal(replay.capsule.unlockedAt, DELIVER_AT, '重放不得改写首次解锁时间戳');
  assert.ok(!second.ok);
  assert.equal(second.error.code, 'ALREADY_UNLOCKED');
  assert.equal(service.get('cap-c')?.unlockedAt, DELIVER_AT);
});

test('对不存在的胶囊操作：明确报 NOT_FOUND', () => {
  const service = new CapsuleService();
  const result = service.submit({
    opId: 'ghost',
    kind: 'edit',
    id: 'nope',
    expectedVersion: 1,
    patch: { content: 'x' },
    now: T0,
  });
  assert.ok(!result.ok);
  assert.equal(result.error.code, 'NOT_FOUND');
});
