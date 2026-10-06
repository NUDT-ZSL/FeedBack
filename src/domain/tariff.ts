import type { CargoCategory, Origin, TariffSchedule } from './types';

export const CARGO_CATEGORIES: CargoCategory[] = ['香料', '药材', '珠宝', '丝绸', '瓷器', '杂货'];

export const ORIGINS: Origin[] = ['高丽', '日本', '大食', '三佛齐', '占城', '本港'];

export const CATEGORY_LABEL: Record<CargoCategory, string> = {
  香料: '香料（细色）',
  药材: '药材（细色）',
  珠宝: '珠宝（细色）',
  丝绸: '丝绸（细色）',
  瓷器: '瓷器（粗色）',
  杂货: '杂货（粗色）',
};

export const DEFAULT_SCHEDULE: TariffSchedule = {
  version: 1,
  categoryRates: { 香料: 0.1, 药材: 0.1, 珠宝: 0.1, 丝绸: 0.1, 瓷器: 0.15, 杂货: 0.15 },
  originAdjust: { 高丽: 0, 日本: 0, 大食: 0.02, 三佛齐: 0.01, 占城: 0.01, 本港: -0.02 },
};

/** 实际税率 = 类别基础税率 + 船籍加减，不为负 */
export function effectiveRate(schedule: TariffSchedule, origin: Origin, category: CargoCategory): number {
  return Math.max(0, round4(schedule.categoryRates[category] + schedule.originAdjust[origin]));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function formatGuan(n: number): string {
  return `${round2(n)} 贯`;
}

export function formatRate(rate: number): string {
  return `${round2(rate * 100)}%`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}
