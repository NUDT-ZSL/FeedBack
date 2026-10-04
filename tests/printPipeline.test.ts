import { describe, expect, it } from 'vitest';
import type { PlacedCharacter } from '../src/types';
import { CANVAS_PADDING, CELL_SIZE, getTextOpacity } from '../src/utils/printUtils';
import {
  LOW_INK_THRESHOLD,
  LOW_PRESSURE_THRESHOLD,
  MAX_PLATE_OFFSET_PX,
  PRESSURE_OFFSET_THRESHOLD,
  computeRenderPlan,
  getRecordCardData,
  runPrintPipeline,
} from '../src/utils/printPipeline';

let charSeq = 0;
function makeChar(char: string, row: number, col: number, offsetX = 0, offsetY = 0): PlacedCharacter {
  charSeq += 1;
  return { id: `char-${charSeq}`, char, radical: '木', radicalName: '木字旁', row, col, offsetX, offsetY };
}

function cardValue(record: Parameters<typeof getRecordCardData>[0], key: string): string {
  const entry = getRecordCardData(record).find((e) => e.key === key);
  expect(entry, `记录卡缺少 ${key} 项`).toBeDefined();
  return entry!.value;
}

describe('一、印刷成品呈现的可复现性', () => {
  const chars = [makeChar('天', 0, 0), makeChar('地', 0, 1), makeChar('人', 1, 0)];

  it('同一份记录重复渲染，文字位置/透明度/断墨白点完全一致', () => {
    const record = runPrintPipeline({ characters: chars, inkLevel: 15, pressure: 50, seed: 42 });
    const first = computeRenderPlan(record);
    const second = computeRenderPlan(record);
    expect(second).toEqual(first);
    expect(first.glyphs.length).toBe(3);
  });

  it('相同 seed 的印刷作业产出完全相同的记录', () => {
    const job = { characters: chars, inkLevel: 60, pressure: 90, seed: 7 };
    expect(runPrintPipeline(job)).toEqual(runPrintPipeline(job));
  });

  it('压力超过阈值时版心偏移落在约定范围内，且可复现', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const record = runPrintPipeline({ characters: chars, inkLevel: 60, pressure: 95, seed });
      expect(Math.abs(record.plateOffsetX)).toBeLessThanOrEqual(MAX_PLATE_OFFSET_PX);
      expect(Math.abs(record.plateOffsetY)).toBeLessThanOrEqual(MAX_PLATE_OFFSET_PX);
      // 同一记录重复渲染，偏移不漂移
      const again = runPrintPipeline({ characters: chars, inkLevel: 60, pressure: 95, seed });
      expect(again.plateOffsetX).toBe(record.plateOffsetX);
      expect(again.plateOffsetY).toBe(record.plateOffsetY);
    }
  });

  it('压力不超过阈值时版心偏移恒为 0', () => {
    for (const pressure of [0, 30, PRESSURE_OFFSET_THRESHOLD]) {
      const record = runPrintPipeline({ characters: chars, inkLevel: 60, pressure, seed: 1 });
      expect(record.plateOffsetX).toBe(0);
      expect(record.plateOffsetY).toBe(0);
    }
  });

  it('墨量过低时断墨白点可稳定观察，墨量正常时绝不出现', () => {
    const lowInk = runPrintPipeline({ characters: chars, inkLevel: LOW_INK_THRESHOLD - 1, pressure: 50, seed: 3 });
    const plan = computeRenderPlan(lowInk);
    // 白点判定结果在重复渲染间稳定
    expect(computeRenderPlan(lowInk).glyphs.map((g) => g.whiteSpot)).toEqual(
      plan.glyphs.map((g) => g.whiteSpot)
    );
    // 白点字的透明度被压暗
    for (const glyph of plan.glyphs) {
      expect(glyph.opacity).toBe(getTextOpacity(50, LOW_INK_THRESHOLD - 1));
    }

    const normalInk = runPrintPipeline({ characters: chars, inkLevel: 80, pressure: 50, seed: 3 });
    expect(computeRenderPlan(normalInk).glyphs.every((g) => !g.whiteSpot)).toBe(true);
  });

  it('压力过低时重影表现稳定出现，压力正常时不出现', () => {
    const lowPressure = runPrintPipeline({ characters: chars, inkLevel: 60, pressure: LOW_PRESSURE_THRESHOLD - 1, seed: 5 });
    const plan = computeRenderPlan(lowPressure);
    expect(plan.ghosting).toBe(true);
    expect(plan.glyphs.every((g) => g.ghost)).toBe(true);
    expect(computeRenderPlan(lowPressure)).toEqual(plan);

    const normal = runPrintPipeline({ characters: chars, inkLevel: 60, pressure: LOW_PRESSURE_THRESHOLD, seed: 5 });
    expect(computeRenderPlan(normal).ghosting).toBe(false);
    expect(computeRenderPlan(normal).glyphs.every((g) => !g.ghost)).toBe(true);
  });
});

describe('二、记录卡与版面参数的一致性', () => {
  const chars = [makeChar('仁', 2, 3), makeChar('义', 2, 4)];

  it('记录卡各项数值与本次印刷参数一致', () => {
    const record = runPrintPipeline({ characters: chars, inkLevel: 55, pressure: 66, seed: 11, timestamp: 1700000000000 });
    expect(cardValue(record, 'inkLevel')).toBe('55%');
    expect(cardValue(record, 'pressure')).toBe('66');
    expect(cardValue(record, 'characterCount')).toBe('2 个');
    expect(cardValue(record, 'inkUniformity')).toBe(`${record.inkUniformity}%`);
    expect(cardValue(record, 'plateOffsetX')).toBe(`${record.plateOffsetX.toFixed(1)} px`);
    expect(cardValue(record, 'plateOffsetY')).toBe(`${record.plateOffsetY.toFixed(1)} px`);
    expect(record.inkUniformity).toBeGreaterThanOrEqual(0);
    expect(record.inkUniformity).toBeLessThanOrEqual(100);
  });

  it('边界：活字数量为零时记录卡显示 0 个', () => {
    const record = runPrintPipeline({ characters: [], inkLevel: 50, pressure: 50, seed: 1 });
    expect(cardValue(record, 'characterCount')).toBe('0 个');
    expect(computeRenderPlan(record).glyphs).toEqual([]);
  });

  it('边界：墨量为零时用墨量显示 0%，均匀度仍在合法区间', () => {
    const record = runPrintPipeline({ characters: chars, inkLevel: 0, pressure: 50, seed: 2 });
    expect(cardValue(record, 'inkLevel')).toBe('0%');
    expect(record.inkUniformity).toBeGreaterThanOrEqual(0);
    expect(record.inkUniformity).toBeLessThanOrEqual(100);
    // 墨量为零必然触发断墨判定路径，且结果可复现
    const plan = computeRenderPlan(record);
    expect(computeRenderPlan(record)).toEqual(plan);
  });

  it('边界：压力为零时压力值显示 0，且出现重影、无版心偏移', () => {
    const record = runPrintPipeline({ characters: chars, inkLevel: 60, pressure: 0, seed: 4 });
    expect(cardValue(record, 'pressure')).toBe('0');
    expect(record.plateOffsetX).toBe(0);
    expect(record.plateOffsetY).toBe(0);
    expect(computeRenderPlan(record).ghosting).toBe(true);
  });

  it('边界：压力超过阈值时记录卡偏移值与实际一致且不超范围', () => {
    const record = runPrintPipeline({ characters: chars, inkLevel: 60, pressure: 100, seed: 9 });
    expect(Math.abs(record.plateOffsetX)).toBeLessThanOrEqual(MAX_PLATE_OFFSET_PX);
    expect(Math.abs(record.plateOffsetY)).toBeLessThanOrEqual(MAX_PLATE_OFFSET_PX);
    expect(cardValue(record, 'plateOffsetX')).toBe(`${record.plateOffsetX.toFixed(1)} px`);
    expect(cardValue(record, 'plateOffsetY')).toBe(`${record.plateOffsetY.toFixed(1)} px`);
    expect(cardValue(record, 'pressure')).toBe('100');
  });
});

describe('三、排版盘到成品的映射', () => {
  it('活字按行列顺序稳定映射到成品对应位置（含微调偏移与版心偏移）', () => {
    // 故意乱序传入，验证映射按排版盘行列排序而非传入顺序
    const chars = [
      makeChar('丙', 1, 2, 0.5, -0.5),
      makeChar('甲', 0, 0),
      makeChar('乙', 0, 1, -1, 1),
      makeChar('丁', 1, 0),
    ];
    const record = runPrintPipeline({ characters: chars, inkLevel: 70, pressure: 90, seed: 21 });
    const plan = computeRenderPlan(record);

    // 行优先、同行按列：甲(0,0) 乙(0,1) 丁(1,0) 丙(1,2)
    expect(plan.glyphs.map((g) => g.char)).toEqual(['甲', '乙', '丁', '丙']);

    for (const glyph of plan.glyphs) {
      const source = chars.find((c) => c.char === glyph.char)!;
      expect(glyph.x).toBeCloseTo(
        CANVAS_PADDING + source.col * CELL_SIZE + CELL_SIZE / 2 + record.plateOffsetX + source.offsetX,
        10
      );
      expect(glyph.y).toBeCloseTo(
        CANVAS_PADDING + source.row * CELL_SIZE + CELL_SIZE / 2 + record.plateOffsetY + source.offsetY,
        10
      );
    }
  });

  it('同一版面重复印刷，活字顺序与位置不错乱', () => {
    const chars = [
      makeChar('春', 0, 0),
      makeChar('夏', 0, 5),
      makeChar('秋', 3, 2),
      makeChar('冬', 7, 9),
    ];
    const job = { characters: chars, inkLevel: 65, pressure: 85, seed: 33 };
    const first = computeRenderPlan(runPrintPipeline(job));
    const second = computeRenderPlan(runPrintPipeline(job));
    expect(second.glyphs.map((g) => [g.char, g.x, g.y])).toEqual(
      first.glyphs.map((g) => [g.char, g.x, g.y])
    );
  });
});
