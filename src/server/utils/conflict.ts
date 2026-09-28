import { Schedule, ConflictInfo } from '../types/index.js';

function normalizeToTimestamp(time: string): number {
  return new Date(time).getTime();
}

function isAlignedTo15Minutes(isoString: string): boolean {
  const date = new Date(isoString);
  const minutes = date.getMinutes();
  return minutes % 15 === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0;
}

export function validateTimeGranularity(startTime: string, endTime: string): string | null {
  if (!isAlignedTo15Minutes(startTime)) {
    return '开始时间必须对齐到15分钟粒度（如 18:00、18:15、18:30、18:45）';
  }
  if (!isAlignedTo15Minutes(endTime)) {
    return '结束时间必须对齐到15分钟粒度（如 18:00、18:15、18:30、18:45）';
  }
  return null;
}

function resolveTimestamps(startTime: string, endTime: string): { start: number; end: number } {
  let start = normalizeToTimestamp(startTime);
  let end = normalizeToTimestamp(endTime);

  if (end <= start) {
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    endDate.setDate(endDate.getDate() + 1);
    end = endDate.getTime();
  }

  return { start, end };
}

export function checkTimeConflict(
  schedules: Schedule[],
  stage: string,
  startTime: string,
  endTime: string,
  excludeId?: string
): ConflictInfo | null {
  const { start: newStart, end: newEnd } = resolveTimestamps(startTime, endTime);

  for (const schedule of schedules) {
    if (schedule.stage !== stage) continue;
    if (excludeId && schedule.id === excludeId) continue;

    const { start: existStart, end: existEnd } = resolveTimestamps(
      schedule.startTime,
      schedule.endTime
    );

    if (newStart < existEnd && newEnd > existStart) {
      return {
        stage: schedule.stage,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        bandName: schedule.bandName
      };
    }
  }

  return null;
}

export function formatConflictMessage(conflict: ConflictInfo): string {
  const formatTime = (iso: string) => {
    const date = new Date(iso);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}月${day}日 ${hours}:${minutes}`;
  };

  return `${conflict.stage} ${formatTime(conflict.startTime)}-${formatTime(conflict.endTime)} 已被乐队${conflict.bandName}占用`;
}
