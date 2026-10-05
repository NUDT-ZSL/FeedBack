import type { StreamEvent } from './types';

/** mulberry32 确定性伪随机数发生器，保证样本可离线复现 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SampleOptions {
  seed?: number;
  sources?: string[];
  /** 时间跨度（秒） */
  span?: number;
  /** 常规事件数量 */
  count?: number;
  /** 突发窗口 [start, end) 与突发事件数 */
  burst?: { start: number; end: number; count: number; size: [number, number] };
  /** 常规事件体积范围 */
  size?: [number, number];
}

/** 生成一批确定性事件样本（含一段突发流量） */
export function generateEvents(options: SampleOptions = {}): StreamEvent[] {
  const {
    seed = 42,
    sources = ['sensor-a', 'sensor-b', 'sensor-c'],
    span = 120,
    count = 60,
    burst = { start: 40, end: 50, count: 18, size: [8, 20] },
    size = [2, 10],
  } = options;
  const rng = seededRng(seed);
  const events: StreamEvent[] = [];
  let seq = 0;
  const emit = (time: number, sizeRange: [number, number]) => {
    const source = sources[Math.floor(rng() * sources.length)];
    const sz = Math.round(sizeRange[0] + rng() * (sizeRange[1] - sizeRange[0]));
    events.push({
      id: `e${seq++}`,
      source,
      time: Math.round(time * 10) / 10,
      size: sz,
      payload: `payload-${source}-${Math.floor(time)}-${sz}`,
    });
  };
  for (let i = 0; i < count; i++) emit(rng() * span, size);
  for (let i = 0; i < burst.count; i++) {
    emit(burst.start + rng() * (burst.end - burst.start), burst.size);
  }
  return events.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

/** 构造一对同源同时刻的冲突事件（内容不一致） */
export function makeConflictPair(source: string, time: number, idPrefix = 'c'): [StreamEvent, StreamEvent] {
  return [
    { id: `${idPrefix}-1`, source, time, size: 12, payload: 'reading-A' },
    { id: `${idPrefix}-2`, source, time, size: 30, payload: 'reading-B' },
  ];
}

/** 构造一对同源同时刻的重复事件（内容完全一致） */
export function makeDuplicatePair(source: string, time: number, idPrefix = 'd'): [StreamEvent, StreamEvent] {
  const base = { source, time, size: 9, payload: 'same-reading' };
  return [
    { id: `${idPrefix}-1`, ...base },
    { id: `${idPrefix}-2`, ...base },
  ];
}
