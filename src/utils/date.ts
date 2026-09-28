const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse a calendar day in YYYY-MM-DD format.
 *
 * The application stores dates without time or zone information. UTC calendar
 * components are used as a fixed arithmetic coordinate system so date-only
 * comparisons are not shifted by the runtime's local timezone offset.
 */
export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function startOfCalendarDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function calendarDayKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calendarMonthKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function calendarDayDiff(laterDate: Date, earlierDate: Date): number {
  const later = Date.UTC(
    laterDate.getUTCFullYear(),
    laterDate.getUTCMonth(),
    laterDate.getUTCDate()
  );
  const earlier = Date.UTC(
    earlierDate.getUTCFullYear(),
    earlierDate.getUTCMonth(),
    earlierDate.getUTCDate()
  );

  return Math.round((later - earlier) / MS_PER_DAY);
}

export function addCalendarMonths(date: Date, monthOffset: number): Date {
  const result = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  result.setUTCMonth(result.getUTCMonth() + monthOffset);
  return new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth(), result.getUTCDate())
  );
}

export function normalizeReferenceDate(referenceDate: Date = new Date()): Date {
  return startOfCalendarDay(referenceDate);
}
