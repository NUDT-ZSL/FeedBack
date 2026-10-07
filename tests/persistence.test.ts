/**
 * 持久化：重新加载与内存一致；文件缺失、整体损坏、单条记录损坏
 * 都必须被明确识别，绝不静默跳过。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCapsule,
  evaluateCapsule,
  unlockCapsule,
  hashPassphrase,
  type Capsule,
} from '../src/core/capsule.ts';
import { CapsuleService } from '../src/core/service.ts';
import {
  STORE_SCHEMA_VERSION,
  loadCapsules,
  saveCapsules,
  validateCapsuleRecord,
} from '../src/core/store.ts';

let dir: string;
let file: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'capsule-store-'));
  file = join(dir, 'capsules.json');
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function buildJourney(): Capsule[] {
  const service = new CapsuleService();
  const t0 = 1_700_000_000_000;
  const deliverA = t0 + 10_000;
  const deliverB = t0 + 20_000;

  service.submit({
    opId: 'create-a',
    kind: 'create',
    id: 'cap-a',
    title: '已解锁胶囊',
    content: '解锁后的完整内容',
    deliverAt: deliverA,
    unlockCondition: { type: 'passphrase', hash: hashPassphrase('k') },
    now: t0,
  });
  service.submit({
    opId: 'edit-a',
    kind: 'edit',
    id: 'cap-a',
    expectedVersion: 1,
    patch: { content: '更新后的内容' },
    now: t0 + 1_000,
  });
  service.submit({ opId: 'eval-a', kind: 'evaluate', id: 'cap-a', now: deliverA });
  service.submit({
    opId: 'unlock-a',
    kind: 'unlock',
    id: 'cap-a',
    expectedVersion: 3,
    proof: { passphrase: 'k' },
    now: deliverA + 1,
  });
  service.submit({
    opId: 'create-b',
    kind: 'create',
    id: 'cap-b',
    title: '仍在锁定',
    content: '不可见内容',
    deliverAt: deliverB,
    now: t0,
  });

  return service.list();
}

test('保存后重新加载：与内存状态逐字段一致（含三个状态的胶囊）', () => {
  const inMemory = buildJourney();
  saveCapsules(file, inMemory);

  const loaded = loadCapsules(file);
  assert.ok(loaded.ok);
  assert.equal(loaded.corrupted.length, 0);
  assert.deepEqual(loaded.capsules, inMemory);

  const a = loaded.capsules.find((c) => c.id === 'cap-a');
  const b = loaded.capsules.find((c) => c.id === 'cap-b');
  assert.equal(a?.status, 'unlocked');
  assert.equal(a?.content, '更新后的内容');
  assert.ok(typeof a?.deliveredAt === 'number');
  assert.ok(typeof a?.unlockedAt === 'number');
  assert.equal(b?.status, 'sealed');
  assert.equal(b?.deliveredAt, null);
});

test('写入为原子操作：持久化成功后文件必须是完整 JSON 且带 schema 版本', () => {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(raw.schemaVersion, STORE_SCHEMA_VERSION);
  assert.ok(Array.isArray(raw.capsules));
});

test('文件缺失：返回 FILE_MISSING 而不是静默返回空集合', () => {
  const result = loadCapsules(join(dir, 'never-existed.json'));
  assert.ok(!result.ok);
  assert.equal(result.error.code, 'FILE_MISSING');
});

test('整体损坏（非法 JSON）：返回 INVALID_JSON', () => {
  const badFile = join(dir, 'broken.json');
  writeFileSync(badFile, '{ "schemaVersion": 1, "capsules": [ ', 'utf8');
  const result = loadCapsules(badFile);
  assert.ok(!result.ok);
  assert.equal(result.error.code, 'INVALID_JSON');
});

test('顶层结构非法：返回 INVALID_SHAPE', () => {
  const badFile = join(dir, 'wrong-shape.json');
  writeFileSync(badFile, JSON.stringify({ hello: 'world' }), 'utf8');
  const result = loadCapsules(badFile);
  assert.ok(!result.ok);
  assert.equal(result.error.code, 'INVALID_SHAPE');
});

test('单条记录损坏：合法记录照常加载，损坏记录被逐条明确标注原因', () => {
  const sealed = createCapsule(
    { id: 'good', title: '好', content: 'c', deliverAt: 1_800_000_000_000 },
    1_700_000_000_000,
  );
  assert.ok(sealed.ok);
  const delivered = evaluateCapsule(sealed.value, 1_800_000_000_000);
  assert.ok(delivered.ok);
  const unlocked = unlockCapsule(delivered.value, 1_800_000_000_001);
  assert.ok(unlocked.ok);

  const payload = {
    schemaVersion: STORE_SCHEMA_VERSION,
    capsules: [
      sealed.value, // 0: 合法
      { ...unlocked.value, status: 'typo-status' }, // 1: status 非法
      { ...unlocked.value, id: 'missing-field', content: undefined }, // 2: 字段缺失
      { ...sealed.value, deliveredAt: 1_800_000_000_000 }, // 3: sealed 却带 deliveredAt（矛盾）
      'not-an-object', // 4: 完全不是记录
    ],
  };
  const mixedFile = join(dir, 'mixed.json');
  writeFileSync(mixedFile, JSON.stringify(payload), 'utf8');

  const result = loadCapsules(mixedFile);
  assert.ok(result.ok, '存在损坏记录不应整体崩溃');
  assert.equal(result.capsules.length, 1);
  assert.equal(result.capsules[0].id, 'good');
  assert.equal(result.corrupted.length, 4, '每条损坏记录都必须被识别');
  assert.deepEqual(result.corrupted.map((c) => c.index), [1, 2, 3, 4]);
  assert.ok(result.corrupted[0].reason.includes('status'));
  assert.equal(result.corrupted[1].id, 'missing-field');
  assert.ok(result.corrupted[2].reason.includes('矛盾'));
  assert.equal(result.corrupted[3].id, null);
});

test('validateCapsuleRecord 覆盖关键不一致：时间戳回退与解锁早于投递', () => {
  const created = createCapsule(
    { id: 'x', title: 't', content: 'c', deliverAt: 100 },
    100,
  );
  assert.ok(created.ok);
  const base = created.value;
  const timestampRegression = validateCapsuleRecord({
    ...base,
    updatedAt: base.createdAt - 1,
  });
  assert.ok(timestampRegression?.includes('updatedAt'));

  const unlockedOrder = validateCapsuleRecord({
    ...base,
    status: 'unlocked',
    deliveredAt: 200,
    unlockedAt: 150,
  });
  assert.ok(unlockedOrder?.includes('unlockedAt'));
});
