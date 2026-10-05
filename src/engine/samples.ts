import type { EngineParams, StreamEvent } from './types';

export const DEFAULT_PARAMS: EngineParams = {
  version: 0,
  tickMs: 1000,
  consumeRate: 10,
  highThreshold: 40,
  lowThreshold: 10,
  burstLimit: 60,
};

let seq = 0;
function ev(source: string, timestamp: number, size: number, extra?: Partial<StreamEvent>): StreamEvent {
  seq += 1;
  return { id: `e${seq}`, source, timestamp, size, ...extra };
}

/** 生成一段稳定流量：每秒 rate 单位，拆成两条事件 */
function steady(source: string, fromSec: number, toSec: number, rate: number, out: StreamEvent[]) {
  for (let sec = fromSec; sec < toSec; sec += 1) {
    out.push(ev(source, sec * 1000, Math.ceil(rate / 2)));
    out.push(ev(source, sec * 1000 + 500, Math.floor(rate / 2)));
  }
}

/** 样本 A：稳定流量 + 中段突发，触发背压后回落解除 */
export function sampleBurst(): StreamEvent[] {
  seq = 0;
  const out: StreamEvent[] = [];
  steady('sensor-a', 0, 20, 8, out);
  steady('sensor-a', 20, 26, 34, out); // 突发
  steady('sensor-a', 26, 60, 8, out);
  return out;
}

/** 样本 B：稳定流量中包含一对重复事件和一对内容冲突事件 */
export function sampleConflicts(): StreamEvent[] {
  seq = 0;
  const out: StreamEvent[] = [];
  steady('sensor-b', 0, 50, 9, out);
  // 重复：同一来源同一时刻、内容完全一致的两条
  out.push(ev('sensor-d', 15_000, 6, { kind: 'reading', payload: 'temp=36.5' }));
  out.push(ev('sensor-d', 15_000, 6, { kind: 'reading', payload: 'temp=36.5' }));
  // 冲突：同一来源同一时刻、内容不一致的两条
  out.push(ev('sensor-d', 30_000, 12, { kind: 'reading', payload: 'temp=36.5' }));
  out.push(ev('sensor-d', 30_000, 20, { kind: 'reading', payload: 'temp=41.0' }));
  return out;
}

/** 样本 C：边界场景——到达速率恰好等于消费速率 */
export function sampleEdgeBalanced(): StreamEvent[] {
  seq = 0;
  const out: StreamEvent[] = [];
  steady('sensor-c', 0, 40, 10, out); // 与默认 consumeRate=10 恰好持平
  return out;
}

export const SAMPLES = {
  burst: { name: '样本A：突发流量', build: sampleBurst },
  conflicts: { name: '样本B：重复与冲突', build: sampleConflicts },
  edge: { name: '样本C：速率持平边界', build: sampleEdgeBalanced },
} as const;

export type SampleKey = keyof typeof SAMPLES;
