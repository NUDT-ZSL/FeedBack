/**
 * 工作历时间换算：把"工作分钟数"映射到具体起止时刻。
 * 全部使用纯数学 UTC 纪元分钟 + 固定时区偏移，不依赖运行环境时区，
 * 保证同一输入在任何机器上得到相同结果。
 */
import type { WorkCalendar, WorkWindow } from './types';

export const MINUTES_PER_DAY = 1440;
/** 1970-01-01 是周四；以周一为 0 的星期索引需要 +4 偏移。 */
const EPOCH_DAY_OF_WEEK = 4;
const EPS = 1e-6;

/** 内部时间... 分钟取整，消除浮点噪声，保证跨入口结果逐位一致。 */
export function roundMinute(minute: number): number {
  return Math.round(minute * 1000) / 1000;
}

export function isoToMinute(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`非法 ISO 时间: ${iso}`);
  }
  return roundMinute(ms / 60000);
}

export function minuteToIso(minute: number): string {
  return new Date(Math.round(minute * 60000)).toISOString();
}

function localParts(calendar: WorkCalendar, epochMinute: number) {
  const local = epochMinute + calendar.timezoneOffsetMinutes;
  const dayIndex = Math.floor(local / MINUTES_PER_DAY);
  const minuteOfDay = local - dayIndex * MINUTES_PER_DAY;
  const dayOfWeek = (((dayIndex + EPOCH_DAY_OF_WEEK) % 7) + 7) % 7;
  return { dayIndex, minuteOfDay, dayOfWeek };
}

function windowsOf(calendar: WorkCalendar, dayOfWeek: number): WorkWindow[] {
  return calendar.days[dayOfWeek] ?? [];
}

/** 若给定时刻不在工作时段内，推进到下一个工作时段起点。 */
export function snapToWork(calendar: WorkCalendar, epochMinute: number): number {
  let cursor = epochMinute;
  for (let guard = 0; guard < 100000; guard += 1) {
    const { dayIndex, minuteOfDay, dayOfWeek } = localParts(calendar, cursor);
    for (const window of windowsOf(calendar, dayOfWeek)) {
      if (minuteOfDay < window.startMinute) {
        cursor = roundMinute(cursor + (window.startMinute - minuteOfDay));
        return cursor;
      }
      if (minuteOfDay < window.endMinute) {
        return roundMinute(cursor);
      }
    }
    cursor = roundMinute((dayIndex + 1) * MINUTES_PER_DAY - calendar.timezoneOffsetMinutes);
  }
  throw new Error('工作历没有可用的工作时段');
}

/** 从 startMinute 起消耗 workMinutes 个工作分钟，返回完成时刻（纪元分钟）。 */
export function addWorkMinutes(
  calendar: WorkCalendar,
  startMinute: number,
  workMinutes: number,
): number {
  let remaining = workMinutes;
  let cursor = snapToWork(calendar, startMinute);
  for (let guard = 0; guard < 100000; guard += 1) {
    if (remaining <= EPS) {
      return roundMinute(cursor);
    }
    const { dayIndex, minuteOfDay, dayOfWeek } = localParts(calendar, cursor);
    let advanced = false;
    for (const window of windowsOf(calendar, dayOfWeek)) {
      if (minuteOfDay < window.startMinute) {
        cursor = roundMinute(cursor + (window.startMinute - minuteOfDay));
        advanced = true;
        break;
      }
      if (minuteOfDay < window.endMinute) {
        const available = window.endMinute - minuteOfDay;
        const consumed = Math.min(available, remaining);
        remaining -= consumed;
        cursor = roundMinute(cursor + consumed);
        advanced = true;
        break;
      }
    }
    if (!advanced) {
      cursor = roundMinute((dayIndex + 1) * MINUTES_PER_DAY - calendar.timezoneOffsetMinutes);
    }
  }
  throw new Error('工时推算超出工作历可表达范围');
}
