export function fmtMoney(n: number): string {
  return `${n.toLocaleString('zh-CN')} 文`;
}

function fromDate(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtMs(ms: number): string {
  return fromDate(new Date(ms));
}

export function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : fromDate(d);
}

export function fmtPeriod(start: number, end: number): string {
  const s = start === -Infinity ? '开店起' : fmtMs(start);
  const e = end === Infinity ? '至今' : fmtMs(end);
  return `${s} ~ ${e}`;
}

export function toLocalIso(ms: number): string {
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
