import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Course } from '../src/course.ts';
import { mulberry32 } from '../src/rng.ts';

function layoutOf(c: Course): string {
  return JSON.stringify({
    zones: c.terrainZones,
    fences: c.fences,
    hole: c.holePosition,
    tee: c.teePosition,
  });
}

test('随机源：相同种子产生相同序列，不同种子序列不同', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const c = mulberry32(43);
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  const seqC = Array.from({ length: 10 }, () => c());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) {
    assert.ok(v >= 0 && v < 1, '随机数必须在 [0,1) 区间');
  }
});

test('关卡生成：相同种子生成完全相同的布局', () => {
  const c1 = new Course(1280, 720, 12345);
  const c2 = new Course(1280, 720, 12345);
  assert.equal(layoutOf(c1), layoutOf(c2));
});

test('关卡生成：regenerate 重现同一布局（重置关卡语义）', () => {
  const c = new Course(1280, 720, 777);
  const before = layoutOf(c);
  c.regenerate();
  assert.equal(layoutOf(c), before);
});

test('关卡生成：不同种子产生不同布局', () => {
  const c1 = new Course(1280, 720, 1);
  const c2 = new Course(1280, 720, 2);
  assert.notEqual(layoutOf(c1), layoutOf(c2));
});

test('关卡生成：显式切换种子后布局确定性地跟随种子', () => {
  const c = new Course(1280, 720, 100);
  const layout100 = layoutOf(c);
  c.generate(200);
  const layout200 = layoutOf(c);
  assert.notEqual(layout100, layout200);
  c.generate(100);
  assert.equal(layoutOf(c), layout100, '切回种子 100 应还原对应布局');
});

test('关卡生成：布局满足基本约束（洞口/发球点在界内且不重叠）', () => {
  for (const seed of [1, 2, 3, 42, 999]) {
    const c = new Course(1280, 720, seed);
    assert.ok(c.teePosition.x > 0 && c.teePosition.x < 1280);
    assert.ok(c.teePosition.y > 0 && c.teePosition.y < 720);
    assert.ok(c.holePosition.x > 0 && c.holePosition.x < 1280);
    assert.ok(c.holePosition.y > 0 && c.holePosition.y < 720);
    const d = Math.hypot(c.holePosition.x - c.teePosition.x, c.holePosition.y - c.teePosition.y);
    assert.ok(d > 200, `洞口与发球点距离 ${d} 应足够远`);
    assert.ok(c.fences.length > 0, '应生成围栏');
  }
});
