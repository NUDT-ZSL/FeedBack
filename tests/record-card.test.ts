import { describe, expect, it } from 'vitest';
import {
  HIGH_PRESSURE_THRESHOLD,
  MAX_PLATE_OFFSET,
  calculateInkUniformity,
} from '../src/utils/printUtils';
import { createPrintRecord, renderPrintFrame } from '../src/utils/printEngine';
import { makeChar, printOnce } from './helpers';

describe('记录卡与版面/参数的一致性', () => {
  it('常规印刷：记录卡数值与实际使用的墨量、压力、版面一致', () => {
    const characters = [makeChar(0, 0, { char: '毕' }), makeChar(1, 1, { char: '昇' })];
    const { record } = printOnce({ characters, inkLevel: 65, pressure: 70, id: 'p-1', timestamp: 1720000000000 });

    expect(record.inkLevel).toBe(65);
    expect(record.pressure).toBe(70);
    expect(record.characters).toHaveLength(2);
    expect(record.characters.map(c => c.char)).toEqual(['毕', '昇']);
    expect(record.id).toBe('p-1');
    expect(record.timestamp).toBe(1720000000000);
    expect(record.inkUniformity).toBeGreaterThanOrEqual(0);
    expect(record.inkUniformity).toBeLessThanOrEqual(100);
    expect(record.plateOffsetX).toBe(0);
    expect(record.plateOffsetY).toBe(0);
  });

  it('边界：活字数量为零时记录卡如实记录 0，成品无字形', () => {
    const { record, frame } = printOnce({ characters: [], inkLevel: 50, pressure: 50 });
    expect(record.characters).toHaveLength(0);
    expect(record.characters.length).toBe(0);
    expect(frame.glyphs).toHaveLength(0);
    expect(frame.whiteSpotCount).toBe(0);
    expect(record.inkLevel).toBe(50);
    expect(record.pressure).toBe(50);
  });

  it('边界：墨量为零时记录卡用墨量为 0，均匀度与透明度不越界', () => {
    const { record, frame } = printOnce({ characters: [makeChar(0, 0)], inkLevel: 0, pressure: 60 });
    expect(record.inkLevel).toBe(0);
    expect(record.inkUniformity).toBeGreaterThanOrEqual(0);
    expect(record.inkUniformity).toBeLessThanOrEqual(100);
    expect(frame.textOpacity).toBeGreaterThanOrEqual(0.2);
    expect(frame.textOpacity).toBeLessThanOrEqual(1);
  });

  it('边界：压力为零时记录卡压力为 0、版心不偏移、出现重影', () => {
    const { record, frame } = printOnce({ characters: [makeChar(0, 0)], inkLevel: 80, pressure: 0 });
    expect(record.pressure).toBe(0);
    expect(record.plateOffsetX).toBe(0);
    expect(record.plateOffsetY).toBe(0);
    expect(frame.hasGhosting).toBe(true);
  });

  it(`边界：压力超过 ${HIGH_PRESSURE_THRESHOLD} 时记录卡偏移与帧内字形位移一致`, () => {
    const characters = [makeChar(2, 3, { offsetX: 0.5, offsetY: -0.5 })];
    const { record, frame } = printOnce({ characters, inkLevel: 60, pressure: 100 });

    expect(record.pressure).toBe(100);
    expect(Math.abs(record.plateOffsetX)).toBeLessThanOrEqual(MAX_PLATE_OFFSET);
    expect(Math.abs(record.plateOffsetY)).toBeLessThanOrEqual(MAX_PLATE_OFFSET);

    const glyph = frame.glyphs[0];
    expect(glyph.x).toBeCloseTo(40 + 3 * 20 + 10 + record.plateOffsetX + 0.5, 6);
    expect(glyph.y).toBeCloseTo(40 + 2 * 20 + 10 + record.plateOffsetY - 0.5, 6);
  });

  it('记录卡活字数量始终等于版面实际落字数量', () => {
    for (const count of [0, 1, 5, 40]) {
      const characters = Array.from({ length: count }, (_, i) =>
        makeChar(Math.floor(i / 10), i % 10)
      );
      const { record } = printOnce({ characters, inkLevel: 50, pressure: 50 });
      expect(record.characters.length).toBe(count);
    }
  });

  it('墨色均匀度只随墨量与种子变化，且对同一墨量可复现', () => {
    const a = calculateInkUniformity(60);
    const b = calculateInkUniformity(60);
    expect(a).toBe(b);
    for (let ink = 0; ink <= 100; ink += 10) {
      const uniformity = calculateInkUniformity(ink);
      expect(uniformity).toBeGreaterThanOrEqual(0);
      expect(uniformity).toBeLessThanOrEqual(100);
    }
  });

  it('同一记录重复渲染，记录卡字段不被渲染过程改写', () => {
    const { record } = printOnce({ characters: [makeChar(0, 0)], inkLevel: 15, pressure: 90 });
    const snapshot = JSON.stringify(record);
    renderPrintFrame(record);
    renderPrintFrame(record);
    expect(JSON.stringify(record)).toBe(snapshot);
  });

  it('不同参数的印刷记录彼此独立，不会串用上一次的压力或墨量', () => {
    const characters = [makeChar(0, 0)];
    const low = createPrintRecord({ characters, inkLevel: 10, pressure: 10 });
    const high = createPrintRecord({ characters, inkLevel: 90, pressure: 90 });
    expect(low.inkLevel).toBe(10);
    expect(low.pressure).toBe(10);
    expect(high.inkLevel).toBe(90);
    expect(high.pressure).toBe(90);
    expect(high.seed).not.toBe(low.seed);
  });
});
