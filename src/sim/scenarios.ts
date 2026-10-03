import type { InputEvent, SimConfig } from './types';

export interface ScenarioInput {
  step: number;
  event: InputEvent;
}

export interface Scenario {
  name: string;
  description: string;
  config: SimConfig;
  steps: number;
  inputs: ScenarioInput[];
}

const TANK: Pick<SimConfig, 'width' | 'height'> = { width: 1280, height: 720 };

/** 预设场景：覆盖撒食、装饰物放置（含越界）、同步多事件、繁殖上限等路径 */
export const SCENARIOS: Scenario[] = [
  {
    name: 'baseline',
    description: '基准场景：10 条鱼自由游动 600 步，无任何输入',
    config: { ...TANK, seed: 20260608, initialFish: 10 },
    steps: 600,
    inputs: []
  },
  {
    name: 'feeding-cleanup',
    description: '撒食与食物清理：多次撒食，覆盖被吃完与过期/沉底两条清理路径',
    config: { ...TANK, seed: 42, initialFish: 8 },
    steps: 1200,
    inputs: [
      { step: 30, event: { type: 'addFood', x: 640, y: 200 } },
      { step: 90, event: { type: 'addFood', x: 300, y: 150 } },
      { step: 91, event: { type: 'addFood', x: 980, y: 180 } },
      { step: 400, event: { type: 'addFood', x: 640, y: 100 } }
    ]
  },
  {
    name: 'same-step-multi-events',
    description: '顺序稳定性：同一时间步内撒食 + 放装饰物 + 再撒食，按记录顺序生效',
    config: { ...TANK, seed: 7, initialFish: 6 },
    steps: 300,
    inputs: [
      { step: 100, event: { type: 'addFood', x: 100, y: 100 } },
      { step: 100, event: { type: 'addDecoration', decoration: 'coral', x: 400, y: 700 } },
      { step: 100, event: { type: 'addFood', x: 1100, y: 120 } },
      { step: 100, event: { type: 'addDecoration', decoration: 'shell', x: 800, y: 650 } }
    ]
  },
  {
    name: 'decoration-out-of-bounds',
    description: '边界处理：装饰物放置在鱼缸范围外，应被确定性地夹取回边界内',
    config: { ...TANK, seed: 99, initialFish: 5 },
    steps: 200,
    inputs: [
      { step: 10, event: { type: 'addDecoration', decoration: 'coral', x: -500, y: 100 } },
      { step: 20, event: { type: 'addDecoration', decoration: 'wreck', x: 99999, y: -300 } },
      { step: 30, event: { type: 'addDecoration', decoration: 'shell', x: 640, y: 99999 } }
    ]
  },
  {
    name: 'breeding-and-cap',
    description: '繁殖链路：28 条鱼高密度长跑，覆盖繁殖事件与 30 条上限时的拒绝行为',
    config: { ...TANK, seed: 1337, initialFish: 28 },
    steps: 3600,
    inputs: [
      { step: 600, event: { type: 'addFood', x: 640, y: 300 } },
      { step: 1800, event: { type: 'addFood', x: 400, y: 250 } }
    ]
  }
];

export function getScenario(name: string): Scenario | undefined {
  return SCENARIOS.find(s => s.name === name);
}
