/**
 * 收藏链路批量验证入口（离线运行，无网络/无浏览器/无实时帧依赖）：
 *   node scripts/verify/collection.verify.ts   或   npm run verify
 *
 * 覆盖：正常收藏、印章越界、题跋为空、顺序冲突、
 *       单条修改/清除后局部重推与整体重推一致性、持久化回环、裁决可追溯性。
 */
import assert from 'node:assert/strict';
import scrolls from '../../src/data/scrolls.ts';
import { CollectionEngine } from '../../src/collection/engine.ts';
import { deriveCollection } from '../../src/collection/domain/derive.ts';
import type { RawCollectionEntry, AdjudicationIssue } from '../../src/collection/domain/raw.ts';
import type { KeyValueStorage } from '../../src/collection/storage/localStorage.ts';
import {
  SEAL_ROTATION_MAX,
  SEAL_ROTATION_MIN,
  SEAL_POSITION_MAX,
  COLOPHON_MAX_LENGTH,
} from '../../src/types/index.ts';

const catalog = scrolls;
const [s0, s1, s2, s3] = catalog.map((s) => s.id);

const memoryStorage = (): KeyValueStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

const engineWith = (entries: RawCollectionEntry[]): CollectionEngine =>
  new CollectionEngine({ catalog, storage: null, initialState: { entries } });

const validEntry = (scrollId: string, order: number, collectedAt = 1000 + order): RawCollectionEntry => ({
  scrollId,
  colophon: `题跋-${scrollId}`,
  seal: {
    id: `seal-${scrollId}`,
    shape: 'square',
    character: '赏',
    color: '#c0392b',
    rotation: 5,
    position: { x: 0.9, y: 0.9 },
  },
  collectedAt,
  order,
});

let passed = 0;
let failed = 0;
const caseRun = (name: string, fn: () => void): void => {
  try {
    fn();
    passed += 1;
    console.log(`  ✔ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✘ ${name}`);
    console.error(`    ${(error as Error).message}`);
  }
};

const assertTraceable = (issues: AdjudicationIssue[]): void => {
  for (const issue of issues) {
    assert.ok(issue.code, '裁决必须带问题代码');
    assert.ok(issue.path, '裁决必须带定位路径');
    assert.ok(issue.resolution, '裁决必须带处理依据');
    assert.ok('received' in issue, '裁决必须保留原始取值');
  }
};

console.log('\n[1] 正常收藏：完整依赖链推导');
caseRun('三条合法收藏全部入藏，顺序连续唯一', () => {
  const engine = engineWith([validEntry(s0, 0), validEntry(s1, 1), validEntry(s2, 2)]);
  const derived = engine.getDerived();
  assert.equal(derived.ordered.length, 3);
  assert.deepEqual(derived.ordered.map((c) => c.order), [0, 1, 2]);
  assert.equal(new Set(derived.ordered.map((c) => c.order)).size, 3);
  assert.equal(derived.issues.length, 0);
  assert.equal(derived.rejected.length, 0);
});
caseRun('同一卷轴的收藏结果/印章/题跋在 entries 与 ordered 中是同一份', () => {
  const engine = engineWith([validEntry(s0, 0)]);
  const derived = engine.getDerived();
  const fromOrdered = derived.ordered[0];
  const fromEntries = derived.entries[s0];
  assert.equal(fromOrdered.colophon, fromEntries.colophon);
  assert.equal(fromOrdered.seal, fromEntries.seal);
  assert.equal(fromOrdered.id, s0);
});
caseRun('合法印章原样保留（形状/颜色/旋转/位置不变）', () => {
  const engine = engineWith([validEntry(s0, 0)]);
  const seal = engine.getDerived().entries[s0].seal;
  assert.deepEqual(seal, {
    id: `seal-${s0}`,
    shape: 'square',
    character: '赏',
    color: '#c0392b',
    rotation: 5,
    position: { x: 0.9, y: 0.9 },
  });
});

console.log('\n[2] 印章越界：取值归一化到既有范围且留痕，非法枚举整条拒绝');
caseRun('旋转越界被钳制到 [0,15] 并保留裁决依据', () => {
  const engine = engineWith([
    { ...validEntry(s0, 0), seal: { ...validEntry(s0, 0).seal!, rotation: 45 } },
    { ...validEntry(s1, 1), seal: { ...validEntry(s1, 1).seal!, rotation: -3 } },
  ]);
  const derived = engine.getDerived();
  assert.equal(derived.entries[s0].seal?.rotation, SEAL_ROTATION_MAX);
  assert.equal(derived.entries[s1].seal?.rotation, SEAL_ROTATION_MIN);
  const codes = derived.issues.map((i) => i.code);
  assert.ok(codes.includes('seal.rotation-above-range'));
  assert.ok(codes.includes('seal.rotation-below-range'));
  assertTraceable(derived.issues);
});
caseRun('位置越界被钳制到 [0,1]，缺失坐标回退并留痕', () => {
  const engine = engineWith([
    { ...validEntry(s0, 0), seal: { ...validEntry(s0, 0).seal!, position: { x: 1.7, y: -0.2 } } },
    { ...validEntry(s1, 1), seal: { shape: 'circle', color: '#2c3e50', rotation: 3 } },
  ]);
  const derived = engine.getDerived();
  assert.deepEqual(derived.entries[s0].seal?.position, { x: SEAL_POSITION_MAX, y: 0 });
  assert.deepEqual(derived.entries[s1].seal?.position, { x: SEAL_POSITION_MAX, y: SEAL_POSITION_MAX });
  const codes = derived.issues.map((i) => i.code);
  assert.ok(codes.includes('seal.position-x-above-range'));
  assert.ok(codes.includes('seal.position-y-below-range'));
  assert.ok(codes.includes('seal.position-x-missing'));
  assertTraceable(derived.issues);
});
caseRun('未知形状/颜色不被静默吞掉：印章整条拒绝且记录依据', () => {
  const engine = engineWith([
    { ...validEntry(s0, 0), seal: { ...validEntry(s0, 0).seal!, shape: 'hexagon' } },
    { ...validEntry(s1, 1), seal: { ...validEntry(s1, 1).seal!, color: '#ffffff' } },
  ]);
  const derived = engine.getDerived();
  assert.equal(derived.entries[s0].seal, null);
  assert.equal(derived.entries[s1].seal, null);
  const codes = derived.issues.map((i) => i.code);
  assert.ok(codes.includes('seal.shape-unknown'));
  assert.ok(codes.includes('seal.color-unknown'));
  assert.ok(derived.issues.every((i) => i.severity !== undefined));
  assertTraceable(derived.issues);
});
caseRun('篆字与形状不一致时以形状为准并留痕', () => {
  const engine = engineWith([
    { ...validEntry(s0, 0), seal: { ...validEntry(s0, 0).seal!, shape: 'gourd', character: '玩' } },
  ]);
  const derived = engine.getDerived();
  assert.equal(derived.entries[s0].seal?.character, '永');
  assert.ok(derived.issues.some((i) => i.code === 'seal.character-mismatch'));
});

console.log('\n[3] 题跋为空：合法收藏，不阻断推导');
caseRun('空题跋/缺省题跋均可正常入藏', () => {
  const engine = engineWith([
    { ...validEntry(s0, 0), colophon: '' },
    { scrollId: s1, seal: null, collectedAt: 2000, order: 1 },
  ]);
  const derived = engine.getDerived();
  assert.equal(derived.ordered.length, 2);
  assert.equal(derived.entries[s0].colophon, '');
  assert.equal(derived.entries[s1].colophon, '');
  assert.equal(derived.entries[s1].seal, null);
});
caseRun('题跋超过 100 字被截断并留痕', () => {
  const engine = engineWith([{ ...validEntry(s0, 0), colophon: '长'.repeat(150) }]);
  const derived = engine.getDerived();
  assert.equal(derived.entries[s0].colophon.length, COLOPHON_MAX_LENGTH);
  assert.ok(derived.issues.some((i) => i.code === 'entry.colophon-too-long'));
});

console.log('\n[4] 顺序冲突：确定性裁决，最终顺序连续唯一');
caseRun('相同 order 按入藏时间决胜，冲突留痕', () => {
  const engine = engineWith([
    { ...validEntry(s0, 0), collectedAt: 3000 },
    { ...validEntry(s1, 0), collectedAt: 1000 },
    { ...validEntry(s2, 1), collectedAt: 2000 },
  ]);
  const derived = engine.getDerived();
  assert.deepEqual(derived.ordered.map((c) => c.id), [s1, s0, s2]);
  assert.deepEqual(derived.ordered.map((c) => c.order), [0, 1, 2]);
  assert.ok(derived.issues.some((i) => i.code === 'entry.order-conflict'));
  assertTraceable(derived.issues);
});
caseRun('重复裁决确定性：同一输入两次推导结果一致', () => {
  const entries = [
    { ...validEntry(s0, 0), collectedAt: 3000 },
    { ...validEntry(s1, 0), collectedAt: 1000 },
  ];
  const a = engineWith(entries).getDerived();
  const b = engineWith(entries).getDerived();
  assert.deepEqual(a, b);
});

console.log('\n[5] 局部重推：单条修改/清除后只重推受影响部分，且与整体重推一致');
caseRun('修改单条题跋：只重推该条，结果与整体重推一致', () => {
  const engine = engineWith([validEntry(s0, 0), validEntry(s1, 1), validEntry(s2, 2), validEntry(s3, 3)]);
  const before = engine.getDerived();
  engine.patchEntry(s1, { colophon: '改后题跋' });
  const after = engine.getDerived();
  assert.deepEqual(engine.getLastRecomputed(), [s1], '只应重推被修改的切片');
  assert.equal(after.entries[s0], before.entries[s0], '未受影响切片应复用（引用不变）');
  assert.equal(after.entries[s2], before.entries[s2]);
  assert.equal(after.entries[s3], before.entries[s3]);
  assert.equal(after.entries[s1].colophon, '改后题跋');
  const full = deriveCollection(engine.getRawState(), catalog);
  assert.deepEqual(after, full, '局部重推必须与整体重推一致');
});
caseRun('修改单条印章：只重推该条，结果与整体重推一致', () => {
  const engine = engineWith([validEntry(s0, 0), validEntry(s1, 1), validEntry(s2, 2)]);
  engine.patchEntry(s2, { seal: { shape: 'oval', color: '#2c2c2c', rotation: 99, position: { x: 0.5, y: 2 } } });
  const after = engine.getDerived();
  assert.deepEqual(engine.getLastRecomputed(), [s2]);
  assert.equal(after.entries[s2].seal?.rotation, SEAL_ROTATION_MAX);
  assert.equal(after.entries[s2].seal?.position.y, SEAL_POSITION_MAX);
  const full = deriveCollection(engine.getRawState(), catalog);
  assert.deepEqual(after, full);
});
caseRun('清除单条收藏：只重推受影响部分，结果与整体重推一致', () => {
  const engine = engineWith([validEntry(s0, 0), validEntry(s1, 1), validEntry(s2, 2)]);
  const before = engine.getDerived();
  engine.removeEntry(s1);
  const after = engine.getDerived();
  assert.equal(after.ordered.length, 2);
  assert.deepEqual(after.ordered.map((c) => c.id), [s0, s2]);
  assert.deepEqual(after.ordered.map((c) => c.order), [0, 1]);
  assert.equal(after.entries[s0], before.entries[s0], '未受影响切片应复用');
  assert.equal(after.entries[s2], before.entries[s2]);
  assert.equal(after.entries[s1], undefined);
  const full = deriveCollection(engine.getRawState(), catalog);
  assert.deepEqual(after, full, '清除后局部重推必须与整体重推一致');
});
caseRun('重排顺序：切片全部复用，仅全局顺序重算，与整体重推一致', () => {
  const engine = engineWith([validEntry(s0, 0), validEntry(s1, 1), validEntry(s2, 2)]);
  const before = engine.getDerived();
  engine.reorder([s2, s0, s1]);
  const after = engine.getDerived();
  assert.deepEqual(engine.getLastRecomputed(), [], '重排不应重推任何切片');
  assert.equal(after.entries[s0], before.entries[s0]);
  assert.deepEqual(after.ordered.map((c) => c.id), [s2, s0, s1]);
  const full = deriveCollection(engine.getRawState(), catalog);
  assert.deepEqual(after, full);
});

console.log('\n[6] 持久化回环与非法数据兜底');
caseRun('写入存储后重建引擎，推导结果一致', () => {
  const storage = memoryStorage();
  const key = 'verify.collection';
  const a = new CollectionEngine({ catalog, storage, storageKey: key, initialState: { entries: [validEntry(s0, 0), validEntry(s1, 1)] } });
  const b = new CollectionEngine({ catalog, storage, storageKey: key });
  assert.deepEqual(a.getDerived(), b.getDerived());
});
caseRun('未知卷轴/重复卷轴被拒绝并留痕，不静默吞掉', () => {
  const engine = engineWith([
    validEntry(s0, 0),
    { scrollId: 'scroll-not-exists', colophon: 'x', seal: null, collectedAt: 1, order: 1 },
    validEntry(s0, 2),
  ]);
  const derived = engine.getDerived();
  assert.equal(derived.ordered.length, 1);
  assert.equal(derived.rejected.length, 2);
  const codes = derived.issues.map((i) => i.code);
  assert.ok(codes.includes('entry.unknown-scroll'));
  assert.ok(codes.includes('entry.duplicate-scroll'));
  assertTraceable(derived.issues);
});
caseRun('revision 由内容决定：同态同值，异态异值', () => {
  const a = engineWith([validEntry(s0, 0)]).getDerived().revision;
  const b = engineWith([validEntry(s0, 0)]).getDerived().revision;
  const c = engineWith([validEntry(s0, 1)]).getDerived().revision;
  assert.equal(a, b);
  assert.notEqual(a, c);
});

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) {
  process.exit(1);
}
console.log('全部验证通过 ✔\n');
