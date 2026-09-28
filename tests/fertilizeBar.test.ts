import { describe, it, expect } from 'vitest';
import { generateFertilizeBarData } from '../src/utils/chartHelper';
import type { CareLog } from '../src/utils/chartHelper';

let seq = 0;
function log(date: string, type: CareLog['activityType'] = 'fertilize'): CareLog {
  seq += 1;
  return { id: `t${seq}`, date, activityType: type, notes: '' };
}

describe('generateFertilizeBarData 近6个月施肥频率', () => {
  it('序列长度为 6，按自然月升序排列', () => {
    const now = new Date(2026, 5, 15, 12, 0); // 2026-06-15
    const { labels, datasets } = generateFertilizeBarData([], now);
    expect(labels).toEqual(['1月', '2月', '3月', '4月', '5月', '6月']);
    expect(datasets[0].data).toHaveLength(6);
  });

  it('跨年时月份标签与归属月不错位', () => {
    const now = new Date(2026, 1, 10, 9, 0); // 2026-02-10
    const { labels } = generateFertilizeBarData([], now);
    expect(labels).toEqual(['9月', '10月', '11月', '12月', '1月', '2月']);
  });

  it('跨年记录归入正确的月份桶', () => {
    const now = new Date(2026, 1, 10, 9, 0); // 2026-02-10
    const logs = [
      log('2025-12-05'), // 应进 12月 桶（下标 3）
      log('2026-01-20'), // 应进 1月 桶（下标 4）
      log('2026-02-01'), // 应进 2月 桶（下标 5）
    ];
    const { datasets } = generateFertilizeBarData(logs, now);
    expect(datasets[0].data).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('同一自然月多条施肥记录累计', () => {
    const now = new Date(2026, 5, 15, 12, 0);
    const logs = [log('2026-04-01'), log('2026-04-15'), log('2026-04-30')];
    const { datasets } = generateFertilizeBarData(logs, now);
    expect(datasets[0].data[3]).toBe(3); // 4月 桶
    expect(datasets[0].data.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('非施肥记录不计入', () => {
    const now = new Date(2026, 5, 15, 12, 0);
    const logs = [
      log('2026-06-10', 'water'),
      log('2026-06-11', 'prune'),
      log('2026-06-12', 'fertilize'),
    ];
    const { datasets } = generateFertilizeBarData(logs, now);
    expect(datasets[0].data.reduce((a, b) => a + b, 0)).toBe(1);
    expect(datasets[0].data[5]).toBe(1);
  });

  it('空记录时每月计数为 0', () => {
    const now = new Date(2026, 5, 15, 12, 0);
    const { datasets } = generateFertilizeBarData([], now);
    expect(datasets[0].data).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('窗口之外的记录不计入', () => {
    const now = new Date(2026, 5, 15, 12, 0); // 窗口为 2026-01 ~ 2026-06
    const logs = [log('2025-12-31'), log('2026-07-01')];
    const { datasets } = generateFertilizeBarData(logs, now);
    expect(datasets[0].data.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('无效日期字符串被安全忽略', () => {
    const now = new Date(2026, 5, 15, 12, 0);
    const logs = [log('garbage'), log('2026-13-01'), log('2026-06-05')];
    const { datasets } = generateFertilizeBarData(logs, now);
    expect(datasets[0].data.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('月末日期运行不会导致月份溢出或重复', () => {
    // 3月31日回退 1 个月若直接 setMonth 会溢出到 3月3日，产生重复 3月 桶
    const now = new Date(2026, 2, 31, 23, 0); // 2026-03-31
    const { labels, datasets } = generateFertilizeBarData([], now);
    expect(labels).toEqual(['10月', '11月', '12月', '1月', '2月', '3月']);
    expect(new Set(labels).size).toBe(6);
    expect(datasets[0].data).toHaveLength(6);
  });
});
