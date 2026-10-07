// 图案映射与提花序列链路验证。
import { test, assert, assertEqual, assertDeepEqual, assertNotThrows } from './harness.mjs';
import { clock } from './env/clock.mjs';
import { Loom } from '../src/Loom.ts';
import {
  WeaveType,
  PRESET_PATTERNS,
  mapPatternToWeave,
  getHeddlePositionsForRow,
} from '../src/PatternEngine.ts';
import type { PatternMapping } from '../src/PatternEngine.ts';

const SHUTTLE_ANIMATION_MS = 2000;
const HEDDLE_COUNT = 108;
const SCALE = HEDDLE_COUNT / 64;

function expectedWarpColor(type: WeaveType): string {
  if (type === WeaveType.WARP_UP) return '#cc2936';
  if (type === WeaveType.WEFT_VISIBLE) return '#ffe066';
  return '#1f4e79';
}

function snapshotWarpColors(loom: Loom): string[] {
  return loom.state.warpThreads.map((thread) => thread.color);
}

test('图案映射: 灰度阈值与提花值满足既定对应关系', () => {
  const data = new Uint8ClampedArray(64 * 64); // 默认 0 -> 纬线露出
  data[0 * 64 + 0] = 255; // >180 经线提起
  data[2 * 64 + 3] = 128; // 中间值混织

  const mapping = mapPatternToWeave(data);

  assertEqual(mapping.weaveTypes[0][0], WeaveType.WARP_UP, '灰度 255 应映射为经线提起');
  assertEqual(mapping.heddleSequence[0][0], 1, '经线提起对应提花值 1');

  assertEqual(mapping.weaveTypes[1][0], WeaveType.WEFT_VISIBLE, '灰度 0 应映射为纬线露出');
  assertEqual(mapping.heddleSequence[1][0], 0, '纬线露出对应提花值 0');

  assertEqual(mapping.weaveTypes[2][3], WeaveType.MIXED, '灰度 128 应映射为混织');
  assertEqual(mapping.heddleSequence[2][3], (3 + 2) % 2, '混织提花值应为 (x+y)%2');
});

test('图案应用: 经线颜色序列满足图案首行映射对应关系', () => {
  const loom = new Loom();
  const mapping = mapPatternToWeave(PRESET_PATTERNS[0].pixelData);
  loom.applyPattern(mapping);

  for (let i = 0; i < HEDDLE_COUNT; i++) {
    const patternX = Math.min(Math.floor(i / SCALE), 63);
    const expected = expectedWarpColor(mapping.weaveTypes[0][patternX]);
    assertEqual(loom.state.warpThreads[i].color, expected, `经线 ${i} 颜色应符合图案映射`);
  }
});

test('图案应用: 重复应用同一图案结果可复现', () => {
  const loom = new Loom();
  const mapping = mapPatternToWeave(PRESET_PATTERNS[0].pixelData);

  loom.applyPattern(mapping);
  const first = snapshotWarpColors(loom);
  loom.applyPattern(mapping);
  const second = snapshotWarpColors(loom);
  assertDeepEqual(first, second, '同一图案重复应用结果应一致');
});

test('图案切换: 切换图案后经线颜色按新图案且可再次复现', () => {
  const loom = new Loom();
  const mappingA = mapPatternToWeave(PRESET_PATTERNS[1].pixelData);
  const mappingB = mapPatternToWeave(PRESET_PATTERNS[2].pixelData);

  loom.applyPattern(mappingA);
  loom.applyPattern(mappingB);
  const colorsB1 = snapshotWarpColors(loom);

  for (let i = 0; i < HEDDLE_COUNT; i++) {
    const patternX = Math.min(Math.floor(i / SCALE), 63);
    assertEqual(colorsB1[i], expectedWarpColor(mappingB.weaveTypes[0][patternX]),
      `切换图案后经线 ${i} 应按新图案配色`);
  }

  loom.applyPattern(mappingA);
  loom.applyPattern(mappingB);
  const colorsB2 = snapshotWarpColors(loom);
  assertDeepEqual(colorsB1, colorsB2, '再次切换到同一图案结果应可复现');
});

test('提花序列: 每行投梭的综丝位置与图案行映射一致(含跨行)', () => {
  clock.reset();
  const loom = new Loom();
  loom.setTargetLength(50); // 25 行内不触发织物完成
  loom.applyPattern(mapPatternToWeave(PRESET_PATTERNS[3].pixelData));

  for (let row = 0; row < 25; row++) {
    loom.fireShuttle();
    assertDeepEqual(loom.state.heddlePositions, getHeddlePositionsForRow(
      loom.state.currentPattern!, row, HEDDLE_COUNT
    ), `第 ${row} 行提花序列应与图案行对应`);
    clock.advance(SHUTTLE_ANIMATION_MS);
    loom.update(0.016);
  }
});

test('提花序列: 行索引超出图案高度时按图案高度回绕', () => {
  const mapping = mapPatternToWeave(PRESET_PATTERNS[0].pixelData);
  for (const rowIndex of [63, 64, 65, 127, 128, 1000]) {
    const positions = getHeddlePositionsForRow(mapping, rowIndex, HEDDLE_COUNT);
    assertDeepEqual(positions, getHeddlePositionsForRow(mapping, rowIndex % 64, HEDDLE_COUNT),
      `行索引 ${rowIndex} 应按 64 行高度回绕`);
  }
});

test('边界: 非64行高图案的应用与投梭不抛异常且按实际高度回绕', () => {
  const shortRows = 10;
  const weaveTypes: WeaveType[][] = [];
  const heddleSequence: number[][] = [];
  for (let y = 0; y < shortRows; y++) {
    const weaveRow: WeaveType[] = [];
    const heddleRow: number[] = [];
    for (let x = 0; x < 64; x++) {
      weaveRow.push((x + y) % 3 === 0 ? WeaveType.WARP_UP : WeaveType.WEFT_VISIBLE);
      heddleRow.push((x + y) % 2);
    }
    weaveTypes.push(weaveRow);
    heddleSequence.push(heddleRow);
  }
  const shortMapping: PatternMapping = { weaveTypes, colorScheme: [], heddleSequence };

  const expectedRow25 = getHeddlePositionsForRow(shortMapping, 25, HEDDLE_COUNT);
  assertDeepEqual(expectedRow25, getHeddlePositionsForRow(shortMapping, 5, HEDDLE_COUNT),
    '10 行高图案的第 25 行应回绕到第 5 行');

  clock.reset();
  const loom = new Loom();
  loom.setTargetLength(50);
  assertNotThrows(() => {
    loom.applyPattern(shortMapping);
    loom.fireShuttle();
    clock.advance(SHUTTLE_ANIMATION_MS);
    loom.update(0.016);
  }, '非标准高度图案应用与投梭不应抛异常');
  assertDeepEqual(loom.state.heddlePositions,
    getHeddlePositionsForRow(shortMapping, 0, HEDDLE_COUNT),
    '首次投梭提花序列应对应图案第 0 行');
});
