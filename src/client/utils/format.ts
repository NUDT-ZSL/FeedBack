import { formatDistanceToNow, parseISO, format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function formatCountdown(deadline: string): string {
  const end = parseISO(deadline);
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();

  if (diffMs <= 0) return '已截止';

  const diffSec = Math.floor(diffMs / 1000);
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const seconds = diffSec % 60;

  if (days > 0) {
    return `${days}天 ${hours.toString().padStart(2, '0')}时 ${minutes.toString().padStart(2, '0')}分`;
  }
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function formatCountdownParts(deadline: string) {
  const end = parseISO(deadline);
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { expired: true, days: '00', hours: '00', minutes: '00', seconds: '00' };
  }
  const diffSec = Math.floor(diffMs / 1000);
  return {
    expired: false,
    days: Math.floor(diffSec / 86400).toString().padStart(2, '0'),
    hours: Math.floor((diffSec % 86400) / 3600).toString().padStart(2, '0'),
    minutes: Math.floor((diffSec % 3600) / 60).toString().padStart(2, '0'),
    seconds: (diffSec % 60).toString().padStart(2, '0'),
  };
}

export function formatRelativeTime(dateStr: string): string {
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true, locale: zhCN });
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'yyyy-MM-dd HH:mm', { locale: zhCN });
  } catch {
    return dateStr;
  }
}

export function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'yyyy年MM月dd日', { locale: zhCN });
  } catch {
    return dateStr;
  }
}

export function formatTime(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'HH:mm', { locale: zhCN });
  } catch {
    return dateStr;
  }
}

export function formatGender(gender: 'male' | 'female' | 'any'): string {
  switch (gender) {
    case 'male':
      return '男';
    case 'female':
      return '女';
    default:
      return '不限';
  }
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay = 200
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}
