import { GrowthStage, PlantParams } from '../src/simulation.js';

export interface Expectation {
  stage?: GrowthStage;
  isWilting?: boolean;
  growthTime?: number;
  growthTimeBelow?: number;
  growthTimeAbove?: number;
  wiltProgress?: number;
  wiltProgressBelow?: number;
  wiltProgressAbove?: number;
  countdownSeconds?: number;
  countdownText?: string;
  tolerance?: number;
}

export type SimOp =
  | { kind: 'set'; params: Partial<PlantParams> }
  | { kind: 'advance'; seconds: number; delta?: number }
  | { kind: 'reset' }
  | { kind: 'expect'; expect: Expectation; note?: string };

export interface Scenario {
  name: string;
  description: string;
  ops: SimOp[];
}

const DEFAULT_DELTA = 1 / 60;
// Wilt progress decay/approach factor per 1/60s tick: p' = p + (t-p)*delta*2
const decay = (ticks: number) => Math.pow(1 - 2 * DEFAULT_DELTA, ticks);
// Growth rate with light=50, water=10, temperature=20 (wilting but still growing)
const WILT_RATE = 0.3 + 0.7 * Math.sin(0.1 * Math.PI);

const NORMAL: PlantParams = { light: 50, water: 50, temperature: 20 };

// Growth rate with default params is exactly 1.0, so growthTime == elapsed
// seconds unless wilting pauses growth or params change the rate.

const stageBoundaries: Scenario = {
  name: 'stage-boundaries',
  description: '阶段边界临界值：growthTime 跨越 5 / 15 / 30 时的阶段切换',
  ops: [
    { kind: 'advance', seconds: 4.999, delta: 0.001 },
    { kind: 'expect', expect: { stage: 'seed', growthTime: 4.999 }, note: '5s 前仍是种子' },
    { kind: 'advance', seconds: 0.002, delta: 0.001 },
    { kind: 'expect', expect: { stage: 'sprout', growthTime: 5.001 }, note: '越过 5s 进入嫩芽' },
    { kind: 'advance', seconds: 5.002, delta: 0.001 },
    { kind: 'expect', expect: { stage: 'sprout', growthTime: 10.003, countdownSeconds: 19.997, countdownText: '20 秒' }, note: '约 10s 时开花倒计时约 20s' },
    { kind: 'advance', seconds: 4.996, delta: 0.001 },
    { kind: 'expect', expect: { stage: 'sprout', growthTime: 14.999 }, note: '15s 前仍是嫩芽' },
    { kind: 'advance', seconds: 0.002, delta: 0.001 },
    { kind: 'expect', expect: { stage: 'adult', growthTime: 15.001 }, note: '越过 15s 进入成株' },
    { kind: 'advance', seconds: 14.998, delta: 0.001 },
    { kind: 'expect', expect: { stage: 'adult', growthTime: 29.999, countdownText: '1 秒' }, note: '30s 前仍是成株' },
    { kind: 'advance', seconds: 0.002, delta: 0.001 },
    { kind: 'expect', expect: { stage: 'flowering', growthTime: 30.001, countdownSeconds: 0, countdownText: '已开花 🌸' }, note: '越过 30s 进入开花' }
  ]
};

const wiltEnterExit: Scenario = {
  name: 'wilt-enter-exit',
  description: '极端参数触发萎蔫、进度累积暂停生长、恢复后进度消退',
  ops: [
    { kind: 'advance', seconds: 2 },
    { kind: 'expect', expect: { stage: 'seed', growthTime: 2, isWilting: false, wiltProgress: 0 } },
    { kind: 'set', params: { water: 10 } },
    { kind: 'expect', expect: { isWilting: true, wiltProgress: 0 }, note: '参数变更当刻即进入萎蔫，进度尚未累积' },
    { kind: 'advance', seconds: 1 },
    // 60 ticks: 1 - decay(60); progress < 0.9 the whole time, still growing.
    // Note: growth also slows while wilting — rate with water=10 is
    // 0.3 + 0.7*sin(0.1*pi) = ~0.5163, not 1.0.
    { kind: 'expect', expect: { wiltProgress: 1 - decay(60), growthTime: 2 + WILT_RATE }, note: '萎蔫进度未达 0.9，生长以低速率继续' },
    { kind: 'advance', seconds: 0.5 },
    // progress crosses 0.9 at tick 68 of wilting -> only 8 of these 30 ticks grow
    { kind: 'expect', expect: { wiltProgress: 1 - decay(90), growthTime: 2 + WILT_RATE + (8 / 60) * WILT_RATE }, note: '进度越过 0.9 后生长暂停' },
    { kind: 'advance', seconds: 2 },
    { kind: 'expect', expect: { wiltProgress: 1 - decay(210), growthTime: 2 + WILT_RATE + (8 / 60) * WILT_RATE }, note: '深度萎蔫期间生长时间完全冻结' },
    { kind: 'set', params: { water: NORMAL.water } },
    { kind: 'expect', expect: { isWilting: false }, note: '参数拉回正常区间立即退出萎蔫' },
    { kind: 'advance', seconds: 1 },
    {
      kind: 'expect',
      expect: {
        wiltProgress: (1 - decay(210)) * decay(60),
        growthTime: 2 + WILT_RATE + (8 / 60) * WILT_RATE + 1,
        stage: 'seed'
      },
      note: '恢复后进度按同一速率消退、生长立即恢复'
    }
  ]
};

const wiltMidRecovery: Scenario = {
  name: 'wilt-mid-recovery',
  description: '萎蔫途中拉回正常并反复触发：进度未达阈值时生长不暂停',
  ops: [
    { kind: 'set', params: { temperature: 40 } },
    { kind: 'expect', expect: { isWilting: true }, note: '温度 40°C 触发萎蔫' },
    { kind: 'advance', seconds: 0.5 },
    // rate with tempFactor 0.3: 0.3 + 0.7*1*1*0.3 = 0.51
    { kind: 'expect', expect: { wiltProgress: 1 - decay(30), growthTime: 0.5 * 0.51 }, note: '萎蔫中但未达 0.9，以慢速率继续生长' },
    { kind: 'set', params: { temperature: NORMAL.temperature } },
    { kind: 'advance', seconds: 1 },
    {
      kind: 'expect',
      expect: { wiltProgress: (1 - decay(30)) * decay(60), growthTime: 0.5 * 0.51 + 1 },
      note: '中途恢复：进度消退、速率回到 1.0'
    },
    { kind: 'set', params: { temperature: 40 } },
    { kind: 'expect', expect: { isWilting: true }, note: '再次触发萎蔫' },
    { kind: 'advance', seconds: 0.2 },
    { kind: 'set', params: { temperature: NORMAL.temperature } },
    { kind: 'advance', seconds: 0.5 },
    {
      kind: 'expect',
      expect: {
        isWilting: false,
        growthTime: 0.5 * 0.51 + 1 + 0.2 * 0.51 + 0.5,
        stage: 'seed'
      },
      note: '反复触发/恢复后状态仍一致'
    }
  ]
};

const resetRestart: Scenario = {
  name: 'reset-restart',
  description: '重置后状态归零，并在相同参数链路下重新推进',
  ops: [
    { kind: 'advance', seconds: 16 },
    { kind: 'expect', expect: { stage: 'adult', growthTime: 16 } },
    { kind: 'set', params: { light: 95 } },
    { kind: 'advance', seconds: 0.5 },
    { kind: 'expect', expect: { isWilting: true, wiltProgress: 1 - decay(30) } },
    { kind: 'reset' },
    {
      kind: 'expect',
      expect: { stage: 'seed', growthTime: 0, wiltProgress: 0, isWilting: false },
      note: '重置后生长时间/萎蔫状态全部归零（参数本身不被重置）'
    },
    { kind: 'set', params: { ...NORMAL } },
    { kind: 'expect', expect: { countdownSeconds: 30, countdownText: '30 秒' }, note: '倒计时从 30s 重新计算' },
    { kind: 'advance', seconds: 5.5 },
    { kind: 'expect', expect: { stage: 'sprout', growthTime: 5.5 }, note: '重置后重新推进到嫩芽' },
    { kind: 'advance', seconds: 10 },
    { kind: 'expect', expect: { stage: 'adult', growthTime: 15.5 } }
  ]
};

const countdownSlowRate: Scenario = {
  name: 'countdown-slow-rate',
  description: '非萎蔫的亚适温度（33°C）下生长速率与开花倒计时联动',
  ops: [
    { kind: 'set', params: { temperature: 33 } },
    { kind: 'expect', expect: { isWilting: false }, note: '33°C 不触发萎蔫但温度因子降为 0.3' },
    // rate = 0.51 -> countdown = 30 / 0.51
    { kind: 'expect', expect: { countdownSeconds: 30 / 0.51, countdownText: '59 秒' } },
    { kind: 'advance', seconds: 10 },
    { kind: 'expect', expect: { stage: 'sprout', growthTime: 10 * 0.51, countdownSeconds: (30 - 5.1) / 0.51, countdownText: '49 秒' } },
    { kind: 'set', params: { temperature: NORMAL.temperature } },
    { kind: 'expect', expect: { countdownSeconds: 30 - 5.1, countdownText: '25 秒' }, note: '温度恢复后倒计时按新速率重算' }
  ]
};

function buildContinuousSweep(): Scenario {
  const ops: SimOp[] = [];
  // 连续扫参：反复穿越萎蔫阈值，验证逐 tick 一致性
  for (let light = 0; light <= 100; light += 5) {
    ops.push({ kind: 'set', params: { light } }, { kind: 'advance', seconds: 0.1 });
  }
  for (let water = 100; water >= 0; water -= 5) {
    ops.push({ kind: 'set', params: { water } }, { kind: 'advance', seconds: 0.1 });
  }
  for (let temperature = 0; temperature <= 40; temperature += 2) {
    ops.push({ kind: 'set', params: { temperature } }, { kind: 'advance', seconds: 0.1 });
  }
  ops.push(
    { kind: 'set', params: { ...NORMAL } },
    { kind: 'expect', expect: { isWilting: false }, note: '扫参结束回到正常区间' },
    { kind: 'advance', seconds: 3 },
    {
      kind: 'expect',
      expect: { isWilting: false, wiltProgressBelow: 0.01, growthTimeAbove: 0 },
      note: '恢复 3s 后萎蔫进度基本消退'
    }
  );
  return {
    name: 'continuous-param-sweep',
    description: '参数连续变化穿越萎蔫阈值，逐 tick 比对 Plant 与参考仿真',
    ops
  };
}

export const scenarios: Scenario[] = [
  stageBoundaries,
  wiltEnterExit,
  wiltMidRecovery,
  resetRestart,
  countdownSlowRate,
  buildContinuousSweep()
];
