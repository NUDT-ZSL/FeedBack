import { PlantParams, PlantSimulation, SimulationSnapshot, STAGE_BOUNDARIES } from '../src/simulation.js';

export type Expected = Partial<Record<keyof SimulationSnapshot, number | string | boolean>>;

export type Step =
  | { setParams: Partial<PlantParams>; note?: string; expect?: Expected; tol?: number }
  | { advance: number; delta?: number; note?: string; expect?: Expected; tol?: number }
  | { reset: true; note?: string; expect?: Expected; tol?: number }
  | { expect: Expected; tol?: number; note?: string };

export interface Scenario {
  name: string;
  description: string;
  params?: PlantParams;
  steps: Step[];
}

const GOOD: PlantParams = { light: 50, water: 50, temperature: 20 };

export const scenarios: Scenario[] = [
  {
    name: 'stage-boundaries',
    description: '阶段边界临界取值：growthTime 恰好等于 5/15/30 时切换到下一阶段',
    params: { ...GOOD },
    steps: [
      { expect: { stage: 'seed', growthTime: 0 }, note: '初始为种子' },
      { advance: 5, delta: 0.5 },
      { expect: { stage: 'sprout', growthTime: STAGE_BOUNDARIES.sprout }, tol: 0, note: 'growthTime=5 恰好发芽' },
      { advance: 10, delta: 0.5 },
      { expect: { stage: 'adult', growthTime: STAGE_BOUNDARIES.adult }, tol: 0, note: 'growthTime=15 恰好成株' },
      { advance: 15, delta: 0.5 },
      { expect: { stage: 'flowering', growthTime: STAGE_BOUNDARIES.flowering }, tol: 0, note: 'growthTime=30 恰好开花' },
      { advance: 1, delta: 0.5 },
      { expect: { stage: 'flowering', countdownSeconds: 0 }, tol: 0, note: '开花后倒计时为 0' }
    ]
  },
  {
    name: 'stage-boundary-precision',
    description: '边界内侧不越界：4.99/14.99/29.99 仍属上一阶段，再推进一步才切换',
    params: { ...GOOD },
    steps: [
      { advance: 4.9, delta: 0.1 },
      { expect: { stage: 'seed' }, note: '4.9 秒仍为种子' },
      { advance: 0.2, delta: 0.1 },
      { expect: { stage: 'sprout' }, note: '跨过 5 秒后发芽' },
      { advance: 9.8, delta: 0.1 },
      { expect: { stage: 'sprout' }, note: '14.9 秒仍为嫩芽' },
      { advance: 0.2, delta: 0.1 },
      { expect: { stage: 'adult' }, note: '跨过 15 秒后成株' },
      { advance: 14.8, delta: 0.1 },
      { expect: { stage: 'adult' }, note: '29.9 秒仍为成株' },
      { advance: 0.2, delta: 0.1 },
      { expect: { stage: 'flowering' }, note: '跨过 30 秒后开花' }
    ]
  },
  {
    name: 'wilt-entry-exit',
    description: '极端参数触发萎蔫，参数恢复正常后退出萎蔫，萎蔫进度随之衰减',
    params: { ...GOOD },
    steps: [
      { setParams: { light: 10 }, note: '光照 10% 低于下限 15%' },
      { expect: { isWilting: true, wiltProgress: 0 }, note: '立即进入萎蔫，进度从 0 累积' },
      { advance: 0.5, delta: 0.01 },
      { expect: { isWilting: true, wiltProgress: 0.63 }, tol: 0.02, note: '进入后进度向 1 累积' },
      { setParams: { light: 50 }, note: '光照恢复正常' },
      { expect: { isWilting: false, wiltProgress: 0.63 }, tol: 0.02, note: '立即退出萎蔫，进度尚未衰减' },
      { advance: 2, delta: 0.01 },
      { expect: { isWilting: false, wiltProgress: 0 }, tol: 0.02, note: '恢复后进度衰减回 0' }
    ]
  },
  {
    name: 'wilt-threshold-edges',
    description: '萎蔫阈值临界取值：15/90、5/35 为正常，越过即萎蔫',
    params: { ...GOOD },
    steps: [
      { setParams: { light: 15 }, expect: { isWilting: false }, note: '光照 15% 为正常边界' },
      { setParams: { light: 14 }, expect: { isWilting: true }, note: '光照 14% 触发萎蔫' },
      { setParams: { light: 90 }, expect: { isWilting: false }, note: '光照 90% 为正常边界' },
      { setParams: { light: 91 }, expect: { isWilting: true }, note: '光照 91% 触发萎蔫' },
      { setParams: { water: 90, light: 50 }, expect: { isWilting: false }, note: '水分 90% 为正常边界' },
      { setParams: { water: 91 }, expect: { isWilting: true }, note: '水分 91% 触发萎蔫' },
      { setParams: { water: 15, temperature: 20 }, expect: { isWilting: false }, note: '水分 15% 为正常边界' },
      { setParams: { temperature: 5, water: 50 }, expect: { isWilting: false }, note: '温度 5°C 为正常边界' },
      { setParams: { temperature: 4 }, expect: { isWilting: true }, note: '温度 4°C 触发萎蔫' },
      { setParams: { temperature: 35 }, expect: { isWilting: false }, note: '温度 35°C 为正常边界' },
      { setParams: { temperature: 36 }, expect: { isWilting: true }, note: '温度 36°C 触发萎蔫' }
    ]
  },
  {
    name: 'wilt-recovery-mid-progress',
    description: '萎蔫进度累积到中途时把参数拉回正常区间：立即退出、进度衰减、生长恢复',
    params: { ...GOOD },
    steps: [
      { setParams: { water: 5 }, note: '严重缺水' },
      { advance: 0.3, delta: 0.01 },
      { expect: { isWilting: true, wiltProgress: 0.45 }, tol: 0.05, note: '进度累积到约一半以下' },
      { setParams: { water: 50 }, note: '萎蔫途中恢复供水' },
      { expect: { isWilting: false }, note: '退出萎蔫' },
      { advance: 0.3, delta: 0.01 },
      { expect: { isWilting: false, wiltProgress: 0.25 }, tol: 0.06, note: '进度衰减中' },
      { advance: 1.4, delta: 0.01 },
      { expect: { wiltProgress: 0 }, tol: 0.02, note: '进度归零' },
      { setParams: {} },
      { advance: 2, delta: 0.5 },
      { expect: { growthTime: 3.82, growthRate: 1 }, tol: 0.03, note: '恢复后以正常速率 1.0 继续生长' }
    ]
  },
  {
    name: 'wilt-stops-growth-at-0.9',
    description: '萎蔫进度达到 0.9 后生长时间停止推进；恢复后继续推进',
    params: { ...GOOD },
    steps: [
      { advance: 5, delta: 0.5 },
      { setParams: { light: 0 }, note: '极端光照' },
      { advance: 30, delta: 0.05 },
      { expect: { isWilting: true, wiltProgress: 1 }, tol: 0.01, note: '进度接近 1' },
      { expect: { growthTime: 5.33 }, tol: 0.005, note: '仅在进度到达 0.9 前有少量生长（22 帧 × 0.05 × 0.3）' },
      { advance: 5, delta: 0.5 },
      { expect: { isWilting: true, growthTime: 5.33 }, tol: 0.005, note: '深度萎蔫期间生长完全停滞' },
      { setParams: { light: 50 }, note: '恢复正常' },
      { advance: 5, delta: 0.5 },
      { expect: { isWilting: false, wiltProgress: 0, growthTime: 10.33 }, tol: 0.005, note: '恢复后生长重新推进' }
    ]
  },
  {
    name: 'wilt-repeated',
    description: '萎蔫反复触发与恢复，状态每次都正确翻转',
    params: { ...GOOD },
    steps: [
      { setParams: { light: 0 }, expect: { isWilting: true } },
      { advance: 0.4, delta: 0.02 },
      { setParams: { light: 50 }, expect: { isWilting: false } },
      { advance: 0.2, delta: 0.02 },
      { setParams: { light: 0 }, expect: { isWilting: true }, note: '再次触发萎蔫' },
      { advance: 0.4, delta: 0.02 },
      { setParams: { light: 50 }, expect: { isWilting: false }, note: '再次恢复' },
      { advance: 0.2, delta: 0.02 },
      { setParams: { temperature: 40 }, expect: { isWilting: true }, note: '换由极端温度触发' },
      { advance: 0.4, delta: 0.02 },
      { setParams: { temperature: 20 }, expect: { isWilting: false }, note: '温度恢复' }
    ]
  },
  {
    name: 'reset-zero-and-regrow',
    description: '重置后生长时间、阶段、萎蔫状态全部归零，参数为默认值，随后重新推进',
    params: { light: 5, water: 5, temperature: 40 },
    steps: [
      { setParams: { light: 5, water: 5, temperature: 40 }, note: '应用极端参数' },
      { advance: 40, delta: 0.1 },
      { expect: { isWilting: true, wiltProgress: 1 }, tol: 0.01, note: '极端参数下持续萎蔫' },
      { reset: true, note: '重置' },
      { expect: { growthTime: 0, stage: 'seed', isWilting: false, wiltProgress: 0, countdownSeconds: 30 }, tol: 0.001, note: '全部状态归零' },
      { advance: 5, delta: 0.5 },
      { expect: { stage: 'sprout', growthTime: 5 }, tol: 0, note: '重置后按默认参数重新发芽' },
      { advance: 10, delta: 0.5 },
      { expect: { stage: 'adult', growthTime: 15 }, tol: 0, note: '重新成株' }
    ]
  },
  {
    name: 'continuous-params-and-countdown',
    description: '参数连续变化时生长速率与开花倒计时随之平滑变化',
    params: { ...GOOD },
    steps: [
      { advance: 5, delta: 0.5 },
      { setParams: { light: 50 }, expect: { countdownSeconds: 25 }, tol: 0.001, note: '已生长 5 秒，默认速率 1.0，剩 25 秒' },
      { setParams: { light: 16, water: 16 }, expect: { growthRate: 0.462 }, tol: 0.01, note: '参数变差，速率下降' },
      { setParams: {}, expect: { countdownSeconds: 54.1 }, tol: 0.5, note: '倒计时按新速率拉长' },
      { setParams: { temperature: 33, light: 50, water: 50 }, expect: { growthRate: 0.51 }, tol: 0.01, note: '温度 33°C 使温度因子降为 0.3（尚未触发萎蔫）' },
      { advance: 2, delta: 0.5 },
      { setParams: { temperature: 20 }, expect: { growthRate: 1 }, tol: 0, note: '恢复适宜温度，速率回到 1.0' },
      { advance: 24.5, delta: 0.5 },
      { expect: { stage: 'flowering', countdownSeconds: 0 }, tol: 0.02, note: '累计生长时间到达 30 秒开花' }
    ]
  }
];
