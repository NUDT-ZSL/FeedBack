import type { ScenarioInput } from './types.ts';

/** 本地样例：三台水车、三条支渠、六块田，离线即可复算 */
export function createSampleScenario(overrides: Partial<ScenarioInput> = {}): ScenarioInput {
  return {
    id: 'baseline',
    label: '基准方案',
    ticks: 12,
    upstreamInflow: 100,
    wheels: [
      { id: 'fanche', name: '翻车', gateOpening: 50, sailAngle: 45, liftEfficiency: 1.2 },
      { id: 'tongche', name: '筒车', gateOpening: 60, sailAngle: 45, liftEfficiency: 1.0 },
      { id: 'gaozhuan', name: '高转筒车', gateOpening: 40, sailAngle: 60, liftEfficiency: 1.4 },
    ],
    channels: [
      { id: 'channel-east', name: '东支渠', shareRatio: 0.4, wheelId: 'fanche', fieldIds: ['field-a1', 'field-a2'] },
      { id: 'channel-mid', name: '中支渠', shareRatio: 0.35, wheelId: 'tongche', fieldIds: ['field-b1', 'field-b2'] },
      { id: 'channel-west', name: '西支渠', shareRatio: 0.25, wheelId: 'gaozhuan', fieldIds: ['field-c1', 'field-c2'] },
    ],
    fields: [
      { id: 'field-a1', name: '东上田', capacity: 120, initialStorage: 60, evaporationRate: 8, cropDemandThreshold: 45 },
      { id: 'field-a2', name: '东下田', capacity: 100, initialStorage: 50, evaporationRate: 6, cropDemandThreshold: 40 },
      { id: 'field-b1', name: '中上田', capacity: 90, initialStorage: 30, evaporationRate: 5, cropDemandThreshold: 35 },
      { id: 'field-b2', name: '中下田', capacity: 110, initialStorage: 55, evaporationRate: 7, cropDemandThreshold: 42 },
      { id: 'field-c1', name: '西上田', capacity: 80, initialStorage: 25, evaporationRate: 4, cropDemandThreshold: 30 },
      { id: 'field-c2', name: '西下田', capacity: 130, initialStorage: 70, evaporationRate: 9, cropDemandThreshold: 50 },
    ],
    ...overrides,
  };
}
