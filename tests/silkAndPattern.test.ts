/**
 * 落纱与图案联动验证：
 * - 同一槽位连续落纱不同颜色，经线/梭子/后续纬线颜色一致，无旧色残留
 * - 投梭飞行中改色不污染进行中的这一行（行上下文快照）
 * - 应用图案后经线颜色序列、逐行提花序列与映射一致
 * - 重复应用同一图案、切换图案后结果可复现
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Loom } from '../src/Loom';
import {
  PRESET_PATTERNS,
  mapPatternToWeave,
  getSilkColorsForPattern,
  getHeddlePositionsForRow,
  WeaveType,
} from '../src/PatternEngine';
import { finishShuttle } from './helpers/animation';

const HEDDLE_COUNT = 108;

describe('落纱与图案联动', () => {
  let loom: Loom;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    loom = new Loom();
  });

  afterEach(() => {
    loom.dispose();
    vi.useRealTimers();
  });

  it('同一槽位连续落纱不同颜色：经线色与梭子当前色同步更新，无旧色残留', () => {
    const slot = 7;
    expect(loom.dropSilk(slot, '#8b0000')).toBe(true);
    expect(loom.state.warpThreads[slot].color).toBe('#8b0000');
    expect(loom.getCurrentWeftColor()).toBe('#8b0000');

    expect(loom.dropSilk(slot, '#2e8b57')).toBe(true);
    expect(loom.state.warpThreads[slot].color).toBe('#2e8b57');
    expect(loom.getCurrentWeftColor()).toBe('#2e8b57');

    expect(loom.dropSilk(slot, '#9932cc')).toBe(true);
    expect(loom.state.warpThreads[slot].color).toBe('#9932cc');
    expect(loom.getCurrentWeftColor()).toBe('#9932cc');

    // 后续织入的纬线颜色为最后一次落纱颜色
    loom.fireShuttle();
    finishShuttle(loom);
    expect(loom.getWeftThreads()[0].color).toBe('#9932cc');
  });

  it('投梭飞行中改色不影响进行中的这一行', () => {
    loom.dropSilk(0, '#cc2936');
    expect(loom.fireShuttle()).toBe(true);

    loom.setCurrentWeftColor('#ffe066');
    finishShuttle(loom);

    // 进行中的行以投梭时刻快照为准
    expect(loom.getWeftThreads()[0].color).toBe('#cc2936');

    // 后续新行才使用新颜色
    loom.fireShuttle();
    finishShuttle(loom);
    expect(loom.getWeftThreads()[1].color).toBe('#ffe066');
  });

  it('应用图案后经线颜色序列符合图案映射', () => {
    const mapping = mapPatternToWeave(PRESET_PATTERNS[0].pixelData);
    loom.applyPattern(mapping);

    const expected = getSilkColorsForPattern(mapping, HEDDLE_COUNT);
    for (let i = 0; i < HEDDLE_COUNT; i++) {
      expect(loom.state.warpThreads[i].color).toBe(expected[i]);
    }

    // 直接核对映射规则：第一行 WARP_UP -> #cc2936，WEFT_VISIBLE -> #ffe066，MIXED -> #1f4e79
    const expectedByRule = mapping.weaveTypes[0].map((t) => {
      if (t === WeaveType.WARP_UP) return '#cc2936';
      if (t === WeaveType.WEFT_VISIBLE) return '#ffe066';
      return '#1f4e79';
    });
    const scale = HEDDLE_COUNT / 64;
    for (let i = 0; i < HEDDLE_COUNT; i++) {
      const cell = Math.min(Math.floor(i / scale), 63);
      expect(loom.state.warpThreads[i].color).toBe(expectedByRule[cell]);
    }
  });

  it('投梭后每行提花序列与图案 heddleSequence 逐行对应', () => {
    const mapping = mapPatternToWeave(PRESET_PATTERNS[2].pixelData);
    loom.applyPattern(mapping);
    loom.setTargetLength(50);

    for (let row = 0; row < 25; row++) {
      expect(loom.fireShuttle()).toBe(true);
      const expectedPositions = getHeddlePositionsForRow(mapping, row, HEDDLE_COUNT);
      expect([...loom.state.heddlePositions]).toEqual(expectedPositions);
      finishShuttle(loom);
    }
  });

  it('重复应用同一图案结果完全一致', () => {
    const mapping = mapPatternToWeave(PRESET_PATTERNS[0].pixelData);
    loom.applyPattern(mapping);
    const snapshot1 = loom.state.warpThreads.map((t) => t.color);

    loom.applyPattern(mapping);
    const snapshot2 = loom.state.warpThreads.map((t) => t.color);
    expect(snapshot2).toEqual(snapshot1);

    // 不同实例独立应用同图案也一致
    const other = new Loom();
    other.applyPattern(mapping);
    expect(other.state.warpThreads.map((t) => t.color)).toEqual(snapshot1);
    other.dispose();
  });

  it('切换图案后结果可复现，再切回仍恢复原结果', () => {
    const m1 = mapPatternToWeave(PRESET_PATTERNS[0].pixelData);
    const m2 = mapPatternToWeave(PRESET_PATTERNS[1].pixelData);

    loom.applyPattern(m1);
    const colors1 = getSilkColorsForPattern(m1, HEDDLE_COUNT);
    expect(loom.state.warpThreads.map((t) => t.color)).toEqual(colors1);

    loom.applyPattern(m2);
    const colors2 = getSilkColorsForPattern(m2, HEDDLE_COUNT);
    expect(colors2).not.toEqual(colors1);
    expect(loom.state.warpThreads.map((t) => t.color)).toEqual(colors2);

    loom.applyPattern(m1);
    expect(loom.state.warpThreads.map((t) => t.color)).toEqual(colors1);
  });

  it('图案映射生成是确定性的：相同输入多次生成结果一致', () => {
    const a = mapPatternToWeave(PRESET_PATTERNS[3].pixelData);
    const b = mapPatternToWeave(PRESET_PATTERNS[3].pixelData);
    expect(b).toEqual(a);
  });
});
