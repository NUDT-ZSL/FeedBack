// ---------------------------------------------------------------------------
// 内置批量用例：覆盖边界情况与增量一致性路径
// ---------------------------------------------------------------------------

import type { BatchCase } from './batch.ts';
import { generateSampleScenario } from './sample.ts';
import type { Scenario, StreamEvent } from './types.ts';

function ev(id: string, source: string, tick: number): StreamEvent {
  return { id, source, tick };
}

/** 1/tick 连续到达的事件流 */
function steadyStream(source: string, count: number, perTick = 1, startTick = 0): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    for (let k = 0; k < perTick; k += 1) {
      events.push(ev(`${source}-${i}-${k}`, source, startTick + i));
    }
  }
  return events;
}

const anomaliesScenario: Scenario = {
  id: 'edge-anomalies',
  config: {
    tiers: [
      { id: 'normal', rate: 2, upThreshold: 0 },
      { id: 'shed', rate: 4, upThreshold: 20, action: { kind: 'drop', dropRatio: 0.5 } },
    ],
  },
  events: [
    // 乱序到达
    ev('a5', 's1', 5), ev('a1', 's1', 1), ev('a3', 's1', 3), ev('a0', 's1', 0),
    ev('a2', 's1', 2), ev('a4', 's1', 4),
    // 同刻多条
    ev('b1', 's1', 6), ev('b2', 's1', 6), ev('b3', 's1', 6),
    // 缺来源
    ev('n1', '', 2), { id: 'n2', source: undefined as never, tick: 3 },
    // 重复 id（后者排除）
    ev('a5', 's1', 7),
    // 非整数时刻（向下取整）
    ev('f1', 's1', 2.7),
    // 负时刻（排除）
    ev('neg1', 's1', -3),
    ...steadyStream('s2', 30, 3),
  ],
};

const conflictScenario: Scenario = {
  id: 'tier-overlap-conflict',
  config: {
    tiers: [
      { id: 'normal', rate: 0, upThreshold: 0 },
      { id: 'A', rate: 1, upThreshold: 5, action: { kind: 'downsample', keepEvery: 2 } },
      { id: 'B', rate: 2, upThreshold: 5, action: { kind: 'drop', dropRatio: 0.5 } },
    ],
  },
  // 1/tick，t=5 结束时积压 6 > 5，A/B 同时满足 -> t=6 冲突切换
  events: steadyStream('s', 20),
};

const cycleScenario: Scenario = {
  id: 'tier-cycle',
  config: {
    tiers: [
      { id: 'normal', rate: 1, upThreshold: 0 },
      { id: 'A', rate: 3, upThreshold: 5, allowedNext: ['B'] },
      { id: 'B', rate: 4, upThreshold: 3, allowedNext: ['A'] },
    ],
  },
  events: steadyStream('s', 40, 2),
};

const pauseScenario: Scenario = {
  id: 'pause-resume',
  config: {
    tiers: [
      { id: 'normal', rate: 1, upThreshold: 0 },
      { id: 'pauser', rate: 2, upThreshold: 10, action: { kind: 'pause', pauseTicks: 5 } },
    ],
  },
  events: steadyStream('s', 30, 2),
};

const expandScenario: Scenario = {
  id: 'expand-capacity',
  config: {
    tiers: [
      { id: 'normal', rate: 1, upThreshold: 0 },
      { id: 'expander', rate: 1, upThreshold: 8, action: { kind: 'expand', expandBy: 50 } },
    ],
    sources: [{ id: 's', baseCapacity: 10 }],
  },
  events: steadyStream('s', 30, 3),
};

const downsampleScenario: Scenario = {
  id: 'downsample-determinism',
  config: {
    tiers: [{ id: 'normal', rate: 100, upThreshold: 0, action: { kind: 'downsample', keepEvery: 2 } }],
  },
  events: steadyStream('s', 10),
};

export function sampleBatchCases(): BatchCase[] {
  const incrementalBase = generateSampleScenario('incremental-base', {
    sources: 2,
    durationTicks: 300,
    seed: 7,
  });
  return [
    {
      id: 'edge-anomalies',
      scenario: anomaliesScenario,
      expect: {
        issueCodes: [
          'EVENT_MISSING_SOURCE',
          'EVENT_DUPLICATE_ID',
          'EVENT_NON_INTEGER_TICK',
          'EVENT_NEGATIVE_TICK',
        ],
      },
      mutations: [
        {
          description: '修改丢弃档位阈值 20 -> 10',
          spec: { type: 'setTierThreshold', tierId: 'shed', upThreshold: 10 },
        },
      ],
    },
    {
      id: 'tier-overlap-conflict',
      scenario: conflictScenario,
      expect: {
        // 积压在阈值附近振荡：normal <-> A 往返，每次越阈都是 A/B 冲突判定
        switches: 6,
        conflictSwitches: 3,
        issueCodes: ['TIER_THRESHOLD_OVERLAP'],
      },
      mutations: [
        {
          description: '人工裁决 t=6 冲突改选档位 B',
          spec: { type: 'addAdjudication', source: 's', tick: 6, chosenTierId: 'B', reason: 'B 速率更高，优先保吞吐' },
        },
      ],
    },
    {
      id: 'tier-cycle',
      scenario: cycleScenario,
      expect: { issueCodes: ['TIER_EDGE_CYCLE'] },
      mutations: [
        {
          description: '解除环：A 不再指向 B',
          spec: { type: 'setTierAction', tierId: 'A', action: { kind: 'expand', expandBy: 10 } },
        },
      ],
    },
    {
      id: 'pause-resume',
      scenario: pauseScenario,
      // 暂停耗尽积压后，稳态到达=消费使积压维持在阈值上，滞回保持 pauser 直到流结束
      expect: { switches: 2 },
      mutations: [
        {
          description: '暂停时长 5 -> 8',
          spec: { type: 'setTierAction', tierId: 'pauser', action: { kind: 'pause', pauseTicks: 8 } },
        },
      ],
    },
    {
      id: 'expand-capacity',
      scenario: expandScenario,
      expect: { switches: 1 },
      mutations: [
        {
          description: '扩容阈值 8 -> 15',
          spec: { type: 'setTierThreshold', tierId: 'expander', upThreshold: 15 },
        },
      ],
    },
    {
      id: 'downsample-determinism',
      scenario: downsampleScenario,
      expect: { dropped: 5, consumed: 5, kept: 0, switches: 0 },
    },
    {
      id: 'incremental-consistency',
      scenario: incrementalBase,
      mutations: [
        {
          description: '来源 src-0 到达速率翻倍（时刻压缩）',
          spec: { type: 'scaleSourceEvents', source: 'src-0', factor: 2 },
        },
        {
          description: '来源 src-1 到达速率减半',
          spec: { type: 'scaleSourceEvents', source: 'src-1', factor: 0.5 },
        },
        {
          description: '警戒档阈值 30 -> 20',
          spec: { type: 'setTierThreshold', tierId: 'guarded', upThreshold: 20 },
        },
        {
          description: '过载档速率 +4 -> +8',
          spec: { type: 'setTierRate', tierId: 'shed', rate: 12 },
        },
        {
          description: '插入突发事件',
          spec: {
            type: 'insertEvents',
            events: Array.from({ length: 50 }, (_, i) => ev(`burst-${i}`, 'src-0', 100)),
          },
        },
        {
          description: '分块大小 64 -> 32',
          spec: { type: 'setBlockSize', blockSize: 32 },
        },
        {
          description: '时间轴截断到 200',
          spec: { type: 'setHorizon', horizon: 200 },
        },
      ],
    },
  ];
}
