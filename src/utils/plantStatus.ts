import type { CareLog } from './chartHelper';

export type PlantStatus = 'healthy' | 'needs-water' | 'wilted';

export const PLANT_STATUS_META: Record<
  PlantStatus,
  { label: string; icon: string; title: string }
> = {
  healthy: { label: '健康', icon: '🍃', title: '健康' },
  'needs-water': { label: '需浇水', icon: '💧', title: '需要浇水' },
  wilted: { label: '缺水', icon: '🥀', title: '缺水' },
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * 严格解析 'YYYY-MM-DD' 格式的日期字符串为本地自然日（午夜）。
 * 非法格式或不存在的日期（如 2026-02-30）返回 null。
 */
export function parseLocalDate(dateStr: string): Date | null {
  if (typeof dateStr !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

/** 两个日期之间相差的自然日数（按本地日历整天计算，忽略时分秒）。 */
export function wholeDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/**
 * 根据养护记录判定植物状态（纯函数，可独立测试）：
 * - 最近一次浇水距今不足 4 天：healthy（健康）
 * - 4 到 7 天（含）：needs-water（需浇水）
 * - 超过 7 天：wilted（缺水）
 * - 没有任何有效浇水记录：wilted（缺水）
 *
 * 比较按自然日整天进行，与运行时刻的时分秒和时区无关。
 */
export function getPlantStatus(
  logs: CareLog[],
  now: Date = new Date()
): PlantStatus {
  const waterDates = logs
    .filter((l) => l.activityType === 'water')
    .map((l) => parseLocalDate(l.date))
    .filter((d): d is Date => d !== null);

  if (waterDates.length === 0) return 'wilted';

  const lastWater = waterDates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
  const diffDays = wholeDaysBetween(lastWater, now);

  if (diffDays > 7) return 'wilted';
  if (diffDays >= 4) return 'needs-water';
  return 'healthy';
}
