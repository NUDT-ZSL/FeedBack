import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getScoreColor(score: number): string {
  const ratio = (score - 1) / 9;
  const r = Math.round(192 + (39 - 192) * ratio);
  const g = Math.round(57 + (174 - 57) * ratio);
  const b = Math.round(43 + (96 - 43) * ratio);
  return `rgb(${r}, ${g}, ${b})`;
}

export function formatBrewTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}分${secs}秒` : `${mins}分钟`;
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export const teaCategoryMap: Record<string, { name: string; color: string; icon: string }> = {
  green: { name: '绿茶', color: '#6b8e23', icon: '🍃' },
  black: { name: '红茶', color: '#c0392b', icon: '🍂' },
  oolong: { name: '乌龙茶', color: '#d4a373', icon: '🫖' },
  white: { name: '白茶', color: '#f5f0e8', icon: '☁️' },
  yellow: { name: '黄茶', color: '#f1c40f', icon: '🌾' },
  dark: { name: '黑茶', color: '#4a2c1a', icon: '🌰' },
};
