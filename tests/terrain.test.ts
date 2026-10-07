import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateHerbPositions,
  getTerrainHeight,
  getStreamCenterZ,
  isValidHerbPosition,
  HERB_COUNT,
  HERB_STREAM_MIN_DISTANCE,
  HERB_CENTER_RATIO,
  HERB_MAX_HEIGHT,
  HERB_MIN_SEPARATION
} from '../src/core/terrain';
import { createSeededRandom } from '../src/core/random';

const SIZE = 100;

function assertPositionValid(p: { x: number; y: number; z: number }, size: number): void {
  const distFromStream = Math.abs(p.z - getStreamCenterZ(p.x));
  const distFromCenter = Math.hypot(p.x, p.z);
  const groundHeight = getTerrainHeight(p.x, p.z, size);

  assert.ok(
    distFromStream > HERB_STREAM_MIN_DISTANCE,
    `落点(${p.x.toFixed(2)}, ${p.z.toFixed(2)})距溪流${distFromStream.toFixed(2)}，应>${HERB_STREAM_MIN_DISTANCE}`
  );
  assert.ok(
    distFromCenter < size * HERB_CENTER_RATIO,
    `落点距中心${distFromCenter.toFixed(2)}，应<${size * HERB_CENTER_RATIO}`
  );
  assert.ok(groundHeight < HERB_MAX_HEIGHT, `落点高度${groundHeight.toFixed(2)}，应<${HERB_MAX_HEIGHT}`);
  assert.equal(p.y, groundHeight + 0.05, '落点 y 应为地形高度+0.05');
}

test('相同种子生成完全一致的草药分布', () => {
  const a = generateHerbPositions(HERB_COUNT, SIZE, createSeededRandom(42));
  const b = generateHerbPositions(HERB_COUNT, SIZE, createSeededRandom(42));
  assert.deepEqual(a, b);
});

test('不同种子生成不同的草药分布', () => {
  const a = generateHerbPositions(HERB_COUNT, SIZE, createSeededRandom(1));
  const b = generateHerbPositions(HERB_COUNT, SIZE, createSeededRandom(2));
  assert.notDeepEqual(a, b);
});

test('批量种子下每株草药都满足溪流/中心/高度约束且数量恰好', () => {
  for (let seed = 0; seed < 200; seed++) {
    const positions = generateHerbPositions(HERB_COUNT, SIZE, createSeededRandom(seed));
    assert.equal(positions.length, HERB_COUNT, `seed=${seed} 草药数量必须恰好为${HERB_COUNT}`);
    positions.forEach(p => assertPositionValid(p, SIZE));
  }
});

test('随机源持续命中边界拒绝时，兜底扫描仍保证数量与约束（不静默跳过）', () => {
  // 常数随机源：采样点恒为角落，必然被中心区域约束拒绝
  for (const constant of [0, 0.9999, 0.5]) {
    const positions = generateHerbPositions(HERB_COUNT, SIZE, () => constant);
    assert.equal(positions.length, HERB_COUNT, `random()=${constant} 时也必须放满${HERB_COUNT}株`);
    positions.forEach(p => assertPositionValid(p, SIZE));

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = Math.hypot(positions[i].x - positions[j].x, positions[i].z - positions[j].z);
        assert.ok(dist >= HERB_MIN_SEPARATION, `兜底落点 ${i} 与 ${j} 间距${dist.toFixed(2)}过小`);
      }
    }
  }
});

test('随机种子下落点互不重叠', () => {
  for (let seed = 0; seed < 20; seed++) {
    const positions = generateHerbPositions(HERB_COUNT, SIZE, createSeededRandom(seed));
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = Math.hypot(positions[i].x - positions[j].x, positions[i].z - positions[j].z);
        assert.ok(dist >= HERB_MIN_SEPARATION, `seed=${seed} 落点 ${i} 与 ${j} 重叠`);
      }
    }
  }
});

test('整片区域都不存在合法落点时抛出明确错误而非静默少放', () => {
  assert.throws(
    () =>
      generateHerbPositions(HERB_COUNT, SIZE, createSeededRandom(7), {
        isValid: () => false
      }),
    /无法为第 1\/25 株草药找到满足约束的落点/
  );
});

test('地形高度与溪流中心线为纯函数', () => {
  assert.equal(getTerrainHeight(3.7, -8.2, SIZE), getTerrainHeight(3.7, -8.2, SIZE));
  assert.equal(getStreamCenterZ(12.34), getStreamCenterZ(12.34));
  assert.ok(isValidHerbPosition(0, 0, SIZE));
});
