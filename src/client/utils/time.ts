export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatDateTime(isoString: string): string {
  return `${formatDate(isoString)} ${formatTime(isoString)}`;
}

export function getDurationMinutes(startTime: string, endTime: string): number {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  return Math.round((end - start) / (1000 * 60));
}

export function generateTimeSlots(startHour: number, endHour: number, stepMinutes: number): string[] {
  const slots: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += stepMinutes) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  slots.push(`${String(endHour).padStart(2, '0')}:00`);
  return slots;
}

export function getTimePosition(
  isoTime: string,
  dayStart: string,
  dayEnd: string,
  containerWidth: number
): number {
  const start = new Date(dayStart).getTime();
  const end = new Date(dayEnd).getTime();
  const time = new Date(isoTime).getTime();

  const totalDuration = end - start;
  const offset = time - start;

  return (offset / totalDuration) * containerWidth;
}

export function getTimeRangeWidth(
  startTime: string,
  endTime: string,
  dayStart: string,
  dayEnd: string,
  containerWidth: number
): number {
  const startPos = getTimePosition(startTime, dayStart, dayEnd, containerWidth);
  const endPos = getTimePosition(endTime, dayStart, dayEnd, containerWidth);
  return endPos - startPos;
}

export function isSameDay(date1: string, date2: string): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

export function getDaysFromSchedules(schedules: { startTime: string }[]): string[] {
  const daysSet = new Set<string>();
  schedules.forEach(s => {
    const date = new Date(s.startTime);
    date.setHours(0, 0, 0, 0);
    daysSet.add(date.toISOString());
  });
  return Array.from(daysSet).sort();
}

export function getDayStart(dayIso: string): string {
  const date = new Date(dayIso);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

export function getDayEnd(dayIso: string): string {
  const date = new Date(dayIso);
  date.setHours(23, 59, 0, 0);
  return date.toISOString();
}
