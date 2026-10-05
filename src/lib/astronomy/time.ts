import { J2000 } from './constants';

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export function gregorianToJd(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const m = month <= 2 ? month + 12 : month;
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    day +
    b -
    1524.5
  );
}

export interface CivilDateTime extends DateParts {
  hour: number;
}

export function civilToJd(dt: CivilDateTime): number {
  const base = gregorianToJd(dt.year, dt.month, dt.day);
  return base + (dt.hour - 12) / 24;
}

export function jdToCivil(jd: number): CivilDateTime {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  const alpha = Math.floor((z - 1867216.25) / 36524.25);
  const a = z + 1 + alpha - Math.floor(alpha / 4);
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const dayFraction = b - d - Math.floor(30.6001 * e) + f;
  const day = Math.floor(dayFraction);
  const hour = (dayFraction - day) * 24;
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return { year, month, day, hour };
}

export function jdCentury(jd: number): number {
  return (jd - J2000) / 36525;
}

export function formatCivil(c: CivilDateTime): string {
  const hh = Math.floor(c.hour);
  const mm = Math.floor((c.hour - hh) * 60 + 0.5 * (1 / 60));
  const mStr = String(mm).padStart(2, '0');
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')} ${String(hh).padStart(2, '0')}:${mStr}`;
}

export function formatOffset(offsetHours: number): string {
  const sign = offsetHours >= 0 ? '+' : '-';
  const abs = Math.abs(offsetHours);
  const hh = Math.floor(abs);
  const mm = Math.round((abs - hh) * 60);
  return `UTC${sign}${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
