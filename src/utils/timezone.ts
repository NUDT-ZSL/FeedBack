import type { TimezoneOption } from '../types';

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: 'UTC-8', label: 'UTC-8 / PST', offset: -480 },
  { value: 'UTC-5', label: 'UTC-5 / EST', offset: -300 },
  { value: 'UTC+0', label: 'UTC+0 / GMT', offset: 0 },
  { value: 'UTC+1', label: 'UTC+1 / CET', offset: 60 },
  { value: 'UTC+8', label: 'UTC+8 / CST', offset: 480 },
  { value: 'UTC+9', label: 'UTC+9 / JST', offset: 540 },
];

export function getTimezoneOffset(timezone: string): number {
  const option = TIMEZONE_OPTIONS.find((tz) => tz.value === timezone);
  return option ? option.offset : 0;
}

export function convertTime(
  minutes: number,
  fromTimezone: string,
  toTimezone: string
): number {
  const fromOffset = getTimezoneOffset(fromTimezone);
  const toOffset = getTimezoneOffset(toTimezone);
  const diff = toOffset - fromOffset;
  let result = minutes + diff;
  if (result < 0) result += 1440;
  if (result >= 1440) result -= 1440;
  return result;
}

export function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export function parseTime(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

export function getCurrentMinutesInTimezone(timezone: string): number {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const offset = getTimezoneOffset(timezone);
  let localMinutes = utcMinutes + offset;
  if (localMinutes < 0) localMinutes += 1440;
  if (localMinutes >= 1440) localMinutes -= 1440;
  return localMinutes;
}
