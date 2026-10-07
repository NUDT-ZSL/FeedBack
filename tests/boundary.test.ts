/**
 * 边界输入验证：
 * 极端/非法输入下各模块不抛未捕获异常，不产生 NaN、负长度等非法状态。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { Loom } from '../src/Loom';
import { ScrollViewer, ScrollState } from '../src/ScrollViewer';
import {
  PRESET_PATTERNS,
  mapPatternToWeave,
  getHeddlePositionsForRow,
  getSilkColorsForPattern,
} from '../src/PatternEngine';
import { finishShuttle, weaveToCompletion } from './helpers/animation';

const HEDDLE_COUNT = 108;

function expectLoomStateSane(loom: Loom): void {
  expect(Number.isFinite(loom.state.fabricLength)).toBe(true);
  expect(loom.state.fabricLength).toBeGreaterThanOrEqual(0);
  expect(loom.state.fabricLength).toBeLessThanOrEqual(50);
  expect(Number.isFinite(loom.state.targetLength)).toBe(true);
  expect(loom.state.targetLength).toBeGreaterThanOrEqual(10);
  expect(loom.state.targetLength).toBeLessThanOrEqual(50);
  for (const t of loom.state.warpThreads) {
    expect(Number.isFinite(t.heddleHeight)).toBe(true);
  }
}

describe('边界输入', () => {
  let loom: Loom;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    loom = new Loom();
  });

  afterEach(() => {
    loom.dispose();
    vi.useRealTimers();
  });

  it('目标长度取上下限及越界值时被钳制到 [10, 50]', () => {
    loom.setTargetLength(10);
    expect(loom.state.targetLength).toBe(10);
    loom.setTargetLength(50);
    expect(loom.state.targetLength).toBe(50);
    loom.setTargetLength(0);
    expect(loom.state.targetLength).toBe(10);
    loom.setTargetLength(-100);
    expect(loom.state.targetLength).toBe(10);
    loom.setTargetLength(1000);
    expect(loom.state.targetLength).toBe(50);
  });

  it('目标长度为 NaN/Infinity 时保持原值且不产生非法状态', () => {
    loom.setTargetLength(20);
    loom.setTargetLength(NaN);
    expect(loom.state.targetLength).toBe(20);
    loom.setTargetLength(Infinity);
    expect(loom.state.targetLength).toBe(20);
    loom.setTargetLength(-Infinity);
    expect(loom.state.targetLength).toBe(20);

    // 目标仍有效，可正常织完
    expect(weaveToCompletion(loom)).toBe(10);
    expectLoomStateSane(loom);
  });

  it('槽位索引越界/非法时落纱被拒绝且不抛异常', () => {
    const before = loom.state.warpThreads.map((t) => t.color);
    const invalidIndices = [-1, -100, 108, 109, 1000, NaN, Infinity, 3.5];

    for (const idx of invalidIndices) {
      expect(() => loom.setWarpColor(idx, '#ff0000')).not.toThrow();
      expect(loom.dropSilk(idx, '#ff0000')).toBe(false);
    }

    expect(loom.state.warpThreads.map((t) => t.color)).toEqual(before);
    expectLoomStateSane(loom);
  });

  it('图案行索引为负、越界、非整数、NaN 时不抛异常且结果确定', () => {
    const mapping = mapPatternToWeave(PRESET_PATTERNS[0].pixelData);

    expect(() => getHeddlePositionsForRow(mapping, -1)).not.toThrow();
    expect(() => getHeddlePositionsForRow(mapping, 64)).not.toThrow();
    expect(() => getHeddlePositionsForRow(mapping, 1e9)).not.toThrow();
    expect(() => getHeddlePositionsForRow(mapping, NaN)).not.toThrow();
    expect(() => getHeddlePositionsForRow(mapping, 2.7)).not.toThrow();

    // 64 行循环：第 64 行等价于第 0 行，负索引按模归一化
    expect(getHeddlePositionsForRow(mapping, 64)).toEqual(getHeddlePositionsForRow(mapping, 0));
    expect(getHeddlePositionsForRow(mapping, -1)).toEqual(getHeddlePositionsForRow(mapping, 63));
    expect(getHeddlePositionsForRow(mapping, 2.7)).toEqual(getHeddlePositionsForRow(mapping, 2));

    // NaN 行索引退化为全零（全部综丝放下），不产生异常
    const nanRow = getHeddlePositionsForRow(mapping, NaN);
    expect(nanRow.length).toBe(HEDDLE_COUNT);
    expect(nanRow.every((p) => p === 0)).toBe(true);

    // 空图案映射不抛异常
    const emptyMapping = { weaveTypes: [], colorScheme: [], heddleSequence: [] };
    expect(() => getHeddlePositionsForRow(emptyMapping, 0)).not.toThrow();
    expect(() => getSilkColorsForPattern(emptyMapping)).not.toThrow();
    expect(getHeddlePositionsForRow(emptyMapping, 0).every((p) => p === 0)).toBe(true);
  });

  it('时间步长为零、负值、NaN、过大时更新不抛异常且状态合法', () => {
    const mapping = mapPatternToWeave(PRESET_PATTERNS[1].pixelData);
    loom.applyPattern(mapping);
    loom.fireShuttle();

    expect(() => loom.update(0)).not.toThrow();
    expect(() => loom.update(-1)).not.toThrow();
    expect(() => loom.update(NaN)).not.toThrow();
    expect(() => loom.update(Infinity)).not.toThrow();
    expect(() => loom.update(1e9)).not.toThrow();

    finishShuttle(loom);
    expectLoomStateSane(loom);

    const scroll = new ScrollViewer();
    scroll.createScroll(new THREE.Texture());
    expect(() => scroll.update(0)).not.toThrow();
    expect(() => scroll.update(-5)).not.toThrow();
    expect(() => scroll.update(NaN)).not.toThrow();
    expect(() => scroll.update(1e9)).not.toThrow();
    expect(scroll.state).toBe(ScrollState.FLOATING);
    expect(Number.isFinite(scroll.group.rotation.y)).toBe(true);
    scroll.dispose();
  });

  it('快速连续操作序列后状态保持一致', () => {
    const mapping = mapPatternToWeave(PRESET_PATTERNS[0].pixelData);
    loom.setTargetLength(10);

    // 快速交替：落纱、应用图案、投梭、调目标
    for (let i = 0; i < 30; i++) {
      loom.dropSilk(i % HEDDLE_COUNT, i % 2 === 0 ? '#cc2936' : '#ffe066');
      if (i % 3 === 0) loom.applyPattern(mapping);
      if (loom.fireShuttle()) finishShuttle(loom);
      loom.setTargetLength(10 + (i % 5) * 10);
      loom.update(1 / 60);
    }

    loom.setTargetLength(50);
    let completions = 0;
    loom.onFabricComplete = () => {
      completions += 1;
    };
    while (loom.fireShuttle()) {
      finishShuttle(loom);
    }
    vi.advanceTimersByTime(2000);
    loom.update(1 / 60);

    expect(completions).toBeLessThanOrEqual(1);
    expectLoomStateSane(loom);
  });
});
