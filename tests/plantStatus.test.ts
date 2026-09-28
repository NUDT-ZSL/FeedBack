import { describe, it, expect } from 'vitest';
import {
  getPlantStatus,
  parseLocalDate,
  wholeDaysBetween,
  PLANT_STATUS_META,
} from '../src/utils/plantStatus';
import type { CareLog } from '../src/utils/chartHelper';

let seq = 0;
function log(date: string, type: CareLog['activityType'] = 'water'): CareLog {
  seq += 1;
  return { id: `t${seq}`, date, activityType: type, notes: '' };
}

/** 相对 reference 向前推 days 天的本地日期字符串 */
function daysAgo(reference: Date, days: number): string {
  const d = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 固定参考时刻：2026-06-15 14:37:22（带非零时分秒，验证整天比较）
const NOW = new Date(2026, 5, 15, 14, 37, 22);

describe('getPlantStatus 状态判定', () => {
  it('最近一次浇水距今不足 4 天时为 healthy', () => {
    for (const d of [0, 1, 2, 3]) {
      expect(getPlantStatus([log(daysAgo(NOW, d))], NOW), `距今 ${d} 天`).toBe('healthy');
    }
  });

  it('最近一次浇水距今 4 到 7 天（含边界）时为 needs-water', () => {
    for (const d of [4, 5, 6, 7]) {
      expect(getPlantStatus([log(daysAgo(NOW, d))], NOW), `距今 ${d} 天`).toBe('needs-water');
    }
  });

  it('最近一次浇水距今超过 7 天时为 wilted', () => {
    for (const d of [8, 15, 60]) {
      expect(getPlantStatus([log(daysAgo(NOW, d))], NOW), `距今 ${d} 天`).toBe('wilted');
    }
  });

  it('完全没有记录时为 wilted', () => {
    expect(getPlantStatus([], NOW)).toBe('wilted');
  });

  it('只有非浇水记录时为 wilted', () => {
    const logs = [log(daysAgo(NOW, 0), 'fertilize'), log(daysAgo(NOW, 1), 'prune')];
    expect(getPlantStatus(logs, NOW)).toBe('wilted');
  });

  it('多条浇水记录乱序时以最近一次为准', () => {
    const logs = [log(daysAgo(NOW, 30)), log(daysAgo(NOW, 1)), log(daysAgo(NOW, 10))];
    expect(getPlantStatus(logs, NOW)).toBe('healthy');
  });

  it('边界按整天计算，不受运行时刻时分秒影响', () => {
    const date4DaysAgo = daysAgo(NOW, 4);
    // 同一天的不同时刻：凌晨 00:00:01 与深夜 23:59:59 判定结果必须一致
    const earlyMorning = new Date(2026, 5, 15, 0, 0, 1);
    const lateNight = new Date(2026, 5, 15, 23, 59, 59);
    expect(getPlantStatus([log(date4DaysAgo)], earlyMorning)).toBe('needs-water');
    expect(getPlantStatus([log(date4DaysAgo)], lateNight)).toBe('needs-water');
    // 3 天前即使在深夜判定也不能滑到 needs-water
    expect(getPlantStatus([log(daysAgo(NOW, 3))], lateNight)).toBe('healthy');
    // 8 天前即使在凌晨判定也不能停留在 needs-water
    expect(getPlantStatus([log(daysAgo(NOW, 8))], earlyMorning)).toBe('wilted');
  });

  it('无效日期字符串被忽略：全部无效时等同无记录', () => {
    const invalid = ['', 'not-a-date', '2026-13-01', '2026-02-30', '2026/06/01', '2026-6-1'];
    for (const bad of invalid) {
      expect(getPlantStatus([log(bad)], NOW), `日期 "${bad}"`).toBe('wilted');
    }
  });

  it('无效日期与有效浇水记录混合时使用有效记录', () => {
    const logs = [log('garbage'), log(daysAgo(NOW, 2)), log('2026-02-30')];
    expect(getPlantStatus(logs, NOW)).toBe('healthy');
  });
});

describe('状态标签与图标映射', () => {
  it('每种状态对应稳定的标签和图标', () => {
    expect(PLANT_STATUS_META.healthy).toMatchObject({ label: '健康', icon: '🍃' });
    expect(PLANT_STATUS_META['needs-water']).toMatchObject({ label: '需浇水', icon: '💧' });
    expect(PLANT_STATUS_META.wilted).toMatchObject({ label: '缺水', icon: '🥀' });
  });
});

describe('parseLocalDate / wholeDaysBetween 工具函数', () => {
  it('合法日期解析为本地自然日', () => {
    const d = parseLocalDate('2026-06-15');
    expect(d).not.toBeNull();
    expect([d!.getFullYear(), d!.getMonth() + 1, d!.getDate()]).toEqual([2026, 6, 15]);
    expect([d!.getHours(), d!.getMinutes(), d!.getSeconds()]).toEqual([0, 0, 0]);
  });

  it('非法输入返回 null', () => {
    expect(parseLocalDate('2026-2-5')).toBeNull();
    expect(parseLocalDate('hello')).toBeNull();
    expect(parseLocalDate('2026-02-30')).toBeNull();
  });

  it('wholeDaysBetween 忽略时分秒，只按自然日计差', () => {
    const a = new Date(2026, 5, 10, 23, 59, 59);
    const b = new Date(2026, 5, 14, 0, 0, 1);
    expect(wholeDaysBetween(a, b)).toBe(4);
  });
});
