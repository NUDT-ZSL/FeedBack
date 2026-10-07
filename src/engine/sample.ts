// ---------------------------------------------------------------------------
// 确定性样例生成：固定 seed 的伪随机事件流与档位配置
// ---------------------------------------------------------------------------

import type { Scenario, StreamEvent } from './types.ts';

/** mulberry32 确定性伪随机数 */
export function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SampleOptions {
  sources?: number;
  durationTicks?: number;
  baseRate?: number;
  seed?: number;
  /** 注入的异常：乱序、缺来源、同刻多条 */
  injectAnomalies?: boolean;
}

export function generateSampleScenario(id: string, options: SampleOptions = {}): Scenario {
  const {
    sources = 3,
    durationTicks = 400,
    baseRate = 3,
    seed = 42,
    injectAnomalies = true,
  } = options;
  const random = prng(seed);
  const events: StreamEvent[] = [];
  let seq = 0;

  for (let s = 0; s < sources; s += 1) {
    const source = `src-${s}`;
    // 每个来源一段加速期，制造积压波动
    const surgeStart = Math.floor(durationTicks * (0.25 + 0.2 * random()));
    const surgeEnd = surgeStart + Math.floor(durationTicks * 0.3);
    for (let tick = 0; tick < durationTicks; tick += 1) {
      const surge = tick >= surgeStart && tick < surgeEnd ? 2.2 : 1;
      const lambda = baseRate * surge * (0.6 + random() * 0.8);
      // 泊松近似
      let count = 0;
      let acc = 0;
      while (acc < lambda) {
        acc += -Math.log(1 - random()) * 1;
        count += 1;
        if (count > 20) break;
      }
      for (let k = 0; k < count; k += 1) {
        events.push({
          id: `${source}-e${seq}`,
          source,
          tick,
          payload: { seq, size: Math.floor(random() * 100) },
        });
        seq += 1;
      }
    }
  }

  if (injectAnomalies) {
    // 乱序：把部分事件乱序插入
    for (let i = 0; i < Math.min(30, events.length); i += 1) {
      const idx = Math.floor(random() * events.length);
      const [event] = events.splice(idx, 1);
      events.splice(Math.floor(random() * events.length), 0, event);
    }
    // 缺来源
    for (let i = 0; i < 5 && events.length > 0; i += 1) {
      const event = events[Math.floor(random() * events.length)];
      event.source = '';
    }
    // 同刻多条：集中若干事件到同一时刻
    const hotspot = Math.floor(durationTicks / 2);
    for (let i = 0; i < 8; i += 1) {
      events.push({
        id: `burst-e${i}`,
        source: 'src-0',
        tick: hotspot,
        payload: { burst: true },
      });
    }
  }

  return {
    id,
    config: {
      tiers: [
        { id: 'normal', label: '正常', rate: baseRate + 1, upThreshold: 0 },
        {
          id: 'guarded',
          label: '警戒·降采样',
          rate: baseRate + 2,
          upThreshold: 30,
          downThreshold: 15,
          action: { kind: 'downsample', keepEvery: 3 },
        },
        {
          id: 'shed',
          label: '过载·丢弃',
          rate: baseRate + 4,
          upThreshold: 80,
          downThreshold: 40,
          action: { kind: 'drop', dropRatio: 0.5 },
        },
        {
          id: 'expand',
          label: '扩容',
          rate: baseRate + 3,
          upThreshold: 50,
          downThreshold: 25,
          action: { kind: 'expand', expandBy: 60 },
        },
      ],
      sources: Array.from({ length: sources }, (_, s) => ({
        id: `src-${s}`,
        baseCapacity: 120,
      })),
      blockSize: 64,
    },
    events,
  };
}
