export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function getDaysSince(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

export function isDateExpiredOrToday(dateStr: string): boolean {
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date.getTime() <= today.getTime();
}

export function getDaysUntil(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function getHealthColor(score: number): string {
  if (score < 30) return '#FF4444';
  if (score < 60) return '#FF9800';
  return '#4CAF50';
}

export function getHealthGradient(score: number): string {
  const percent = score / 100;
  if (percent < 0.3) {
    return `rgb(255, ${Math.floor(68 + percent * 300)}, 68)`;
  } else if (percent < 0.6) {
    const t = (percent - 0.3) / 0.3;
    return `rgb(${Math.floor(255 - t * 100)}, ${Math.floor(152 + t * 0)}, 0)`;
  } else {
    const t = (percent - 0.6) / 0.4;
    return `rgb(${Math.floor(155 - t * 75)}, ${Math.floor(152 + t * 103)}, ${Math.floor(0 + t * 80)})`;
  }
}
