import { describe, it, expect } from 'vitest';
import { generateWaterTrendData } from '../src/utils/chartHelper';
import type { CareLog } from '../src/utils/chartHelper';

let seq = 0;
function log(date: string, type: CareLog['activityType'] = 'water'): CareLog {
  seq += 1;
  return { id: `t${seq}`, date, activityType: type, notes: '' };
}

// 固定参考时刻：2026-06-15 14:30（带非零时分秒）
const NOW = new Date(2026, 5, 15, 14, 30);

describe('generateWaterTrendData 近30天水分趋势', () => {
  it('序列长度为 30，标签按日期升序且首尾正确', () => {
    const { labels, datasets } = generateWaterTrendData([], NOW);
    expect(labels).toHaveLength(30);
    expect(datasets[0].data).toHaveLength(30);
    // 近 30 天窗口：2026-05-17 到 2026-06-15
    expect(labels[0]).toBe('5/17');
    expect(labels[29]).toBe('6/15');
    // 跨月处标签连续：5/31 之后是 6/1
    expect(labels[14]).toBe('5/31');
    expect(labels[15]).toBe('6/1');
  });

  it('空记录时每天计数为 0', () => {
    const { datasets } = generateWaterTrendData([], NOW);
    expect(datasets[0].data.every((n) => n === 0)).toBe(true);
  });

  it('浇水记录落在正确的日期桶里', () => {
    const logs = [log('2026-06-15'), log('2026-06-01'), log('2026-05-17')];
    const { datasets } = generateWaterTrendData(logs, NOW);
    const data = datasets[0].data;
    expect(data[29]).toBe(1); // 今天 6/15
    expect(data[15]).toBe(1); // 6/1
    expect(data[0]).toBe(1); // 5/17（窗口最早一天）
    expect(data.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('同一天多条浇水记录累计计数', () => {
    const logs = [log('2026-06-10'), log('2026-06-10'), log('2026-06-10')];
    const { datasets } = generateWaterTrendData(logs, NOW);
    expect(datasets[0].data[24]).toBe(3); // 6/10 距 6/15 为 5 天前 → 下标 29-5=24
  });

  it('非浇水类型记录不进入序列', () => {
    const logs = [
      log('2026-06-15', 'fertilize'),
      log('2026-06-14', 'prune'),
      log('2026-06-13', 'water'),
    ];
    const { datasets } = generateWaterTrendData(logs, NOW);
    const data = datasets[0].data;
    expect(data.reduce((a, b) => a + b, 0)).toBe(1);
    expect(data[27]).toBe(1); // 只有 6/13 的浇水被计入
  });

  it('窗口之外的记录不计入', () => {
    const logs = [log('2026-05-16'), log('2026-04-01')]; // 均早于 5/17
    const { datasets } = generateWaterTrendData(logs, NOW);
    expect(datasets[0].data.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('无效日期字符串被安全忽略', () => {
    const logs = [log('not-a-date'), log('2026-02-30'), log('2026-06-15')];
    const { datasets } = generateWaterTrendData(logs, NOW);
    expect(datasets[0].data.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('跨月窗口：月初运行时标签与归属日期不错位', () => {
    const now = new Date(2026, 2, 2, 9, 0); // 2026-03-02
    const logs = [log('2026-02-01'), log('2026-03-02')];
    const { labels, datasets } = generateWaterTrendData(logs, now);
    expect(labels[0]).toBe('2/1');
    expect(labels[29]).toBe('3/2');
    expect(datasets[0].data[0]).toBe(1);
    expect(datasets[0].data[29]).toBe(1);
  });

  it('结果不受运行时刻时分秒影响', () => {
    const logs = [log('2026-06-15'), log('2026-06-14')];
    const morning = generateWaterTrendData(logs, new Date(2026, 5, 15, 0, 0, 1));
    const night = generateWaterTrendData(logs, new Date(2026, 5, 15, 23, 59, 59));
    expect(morning.labels).toEqual(night.labels);
    expect(morning.datasets[0].data).toEqual(night.datasets[0].data);
  });
});
