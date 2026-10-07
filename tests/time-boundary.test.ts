/**
 * 时间边界：投递时间未到/条件未满足时必须保持锁定；
 * 到达后必须解锁；恰好等于投递时间、条件刚满足的边界时刻给出确定结论。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCapsule,
  evaluateCapsule,
  hashPassphrase,
  unlockCapsule,
  type Capsule,
  type UnlockCondition,
} from '../src/core/capsule.ts';

const T0 = 1_700_000_000_000;
const DELIVER_AT = T0 + 3_600_000;

function makeCapsule(condition?: UnlockCondition): Capsule {
  const result = createCapsule(
    { id: 'cap-t', title: 't', content: 'c', deliverAt: DELIVER_AT, unlockCondition: condition },
    T0,
  );
  assert.ok(result.ok);
  return result.value;
}

test('投递时间未到达：保持锁定，解锁被明确拒绝', () => {
  const capsule = makeCapsule();
  for (const now of [T0, DELIVER_AT - 2, DELIVER_AT - 1]) {
    const evaluated = evaluateCapsule(capsule, now);
    assert.ok(evaluated.ok);
    assert.equal(evaluated.value.status, 'sealed', `now=${now} 应保持锁定`);
    assert.equal(evaluated.value.deliveredAt, null);

    const unlocked = unlockCapsule(capsule, now);
    assert.ok(!unlocked.ok);
    assert.equal(unlocked.error.code, 'NOT_DELIVERABLE_YET');
    assert.equal(capsule.status, 'sealed', '解锁失败后原状态不变');
  }
});

test('边界：now 恰好等于 deliverAt 时投递生效（含等号）', () => {
  const capsule = makeCapsule();
  const evaluated = evaluateCapsule(capsule, DELIVER_AT);
  assert.ok(evaluated.ok);
  assert.equal(evaluated.value.status, 'delivered');
  assert.equal(evaluated.value.deliveredAt, DELIVER_AT);
});

test('边界：恰好等于投递时间即可解锁成功', () => {
  const capsule = makeCapsule();
  const unlocked = unlockCapsule(capsule, DELIVER_AT);
  assert.ok(unlocked.ok);
  assert.equal(unlocked.value.status, 'unlocked');
  assert.equal(unlocked.value.deliveredAt, DELIVER_AT);
  assert.equal(unlocked.value.unlockedAt, DELIVER_AT);
});

test('投递时间之后：求值与解锁均确定成功', () => {
  const capsule = makeCapsule();
  const evaluated = evaluateCapsule(capsule, DELIVER_AT + 1);
  assert.ok(evaluated.ok);
  assert.equal(evaluated.value.status, 'delivered');
  const unlocked = unlockCapsule(capsule, DELIVER_AT + 1);
  assert.ok(unlocked.ok);
  assert.equal(unlocked.value.status, 'unlocked');
});

test('after 条件：差 1ms 不满足，恰好到达即满足', () => {
  const conditionAt = DELIVER_AT + 60_000;
  const capsule = makeCapsule({ type: 'after', at: conditionAt });

  const tooEarly = unlockCapsule(capsule, conditionAt - 1);
  assert.ok(!tooEarly.ok);
  assert.equal(tooEarly.error.code, 'CONDITION_NOT_MET');
  assert.equal(capsule.status, 'sealed', '条件未满足时必须保持锁定');

  const justMet = unlockCapsule(capsule, conditionAt);
  assert.ok(justMet.ok);
  assert.equal(justMet.value.status, 'unlocked');
  assert.equal(justMet.value.unlockedAt, conditionAt);
});

test('passphrase 条件：口令错误保持锁定，口令正确立即解锁', () => {
  const capsule = makeCapsule({ type: 'passphrase', hash: hashPassphrase('open-sesame') });

  const wrong = unlockCapsule(capsule, DELIVER_AT, { passphrase: 'wrong' });
  assert.ok(!wrong.ok);
  assert.equal(wrong.error.code, 'CONDITION_NOT_MET');

  const missing = unlockCapsule(capsule, DELIVER_AT);
  assert.ok(!missing.ok);
  assert.equal(missing.error.code, 'CONDITION_NOT_MET');

  const right = unlockCapsule(capsule, DELIVER_AT, { passphrase: 'open-sesame' });
  assert.ok(right.ok);
  assert.equal(right.value.status, 'unlocked');
});

test('投递时间不得早于创建时间（恰好相等允许）', () => {
  const past = createCapsule({ id: 'a', title: 't', content: 'c', deliverAt: T0 - 1 }, T0);
  assert.ok(!past.ok);
  assert.equal(past.error.code, 'DELIVER_AT_IN_PAST');

  const exact = createCapsule({ id: 'b', title: 't', content: 'c', deliverAt: T0 }, T0);
  assert.ok(exact.ok);
  const unlocked = unlockCapsule(exact.value, T0);
  assert.ok(unlocked.ok, '投递时间等于创建时间时应可立即解锁');
});

test('hashPassphrase 确定性：相同输入恒定相同输出', () => {
  assert.equal(hashPassphrase('abc'), hashPassphrase('abc'));
  assert.notEqual(hashPassphrase('abc'), hashPassphrase('abd'));
});
