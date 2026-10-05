import type { Batch, FlourType } from './types';
import {
  createLedger,
  pack,
  setGap,
  setValve,
  tick,
  type MillLedger,
} from './MillCore';

/**
 * 离线确定性仿真：用预设的"间隙/阀门/打包"事件序列驱动同一套账目引擎。
 * 固定步长、注入时钟、计数器式编号 —— 同一序列重复运行结果完全一致。
 *
 * 同一时刻多个事件的处理顺序（明确的结算口径）：
 *   1. 先处理 pack：只结算截至该时刻之前已经产出的段落；
 *   2. 再处理 setGap/setValve（按序列顺序）：新工况只影响之后的产出；
 *   3. 最后推进一个固定步长的产出。
 * 因此同一时刻"调整 + 打包"时，这一袋按变化前结算，变化后的产出归下一袋。
 */

export type SimEvent =
  | { t: number; action: 'setGap'; value: number }
  | { t: number; action: 'setValve'; value: number }
  | { t: number; action: 'pack'; flour: FlourType };

export interface SimLogEntry {
  t: number;
  kind: 'packed' | 'empty-pack' | 'setGap' | 'setValve' | 'overload-on' | 'overload-off';
  detail: string;
}

export interface SimResult {
  ledger: MillLedger;
  batches: Batch[];
  log: SimLogEntry[];
}

export const PRESET_EVENTS: SimEvent[] = [
  { t: 0.5, action: 'setValve', value: 50 },
  { t: 2.0, action: 'setGap', value: 1.2 },
  { t: 4.0, action: 'setGap', value: 0.8 },
  { t: 6.0, action: 'setValve', value: 100 },
  { t: 8.0, action: 'setValve', value: 40 },
  { t: 9.0, action: 'pack', flour: 'medium' },
  { t: 9.0, action: 'pack', flour: 'fine' },
  { t: 9.0, action: 'pack', flour: 'bran' },
  { t: 10.0, action: 'setValve', value: 0 },
  { t: 11.0, action: 'pack', flour: 'bran' },
  { t: 12.0, action: 'setValve', value: 60 },
  { t: 14.0, action: 'setGap', value: 2.5 },
  { t: 16.0, action: 'pack', flour: 'bran' },
  { t: 18.0, action: 'setGap', value: 0 },
  { t: 18.0, action: 'setValve', value: 200 },
  { t: 19.0, action: 'setValve', value: 0 },
  { t: 19.5, action: 'pack', flour: 'bran' },
];

export const runSimulation = (
  events: SimEvent[] = PRESET_EVENTS,
  options: { dt?: number; duration?: number; clock0?: number } = {}
): SimResult => {
  const dt = options.dt ?? 0.25;
  const duration = options.duration ?? 20;
  const clock0 = options.clock0 ?? 1_600_000_000_000;

  const sorted = [...events].sort((a, b) => a.t - b.t);
  let ledger = createLedger({ gap: 1.5, valve: 0 });
  const log: SimLogEntry[] = [];
  const stepCount = Math.round(duration / dt);

  for (let step = 0; step < stepCount; step += 1) {
    const t = Math.round(step * dt * 1000) / 1000;
    const at = sorted.filter((e) => e.t === t);
    const overloadBefore = ledger.overloaded;

    const packEvents = at.filter((e) => e.action === 'pack');
    for (const event of packEvents) {
      if (event.action !== 'pack') continue;
      const result = pack(ledger, event.flour, clock0 + t * 1000);
      if (result.batch) {
        log.push({
          t,
          kind: 'packed',
          detail: `${result.batch.id} ${result.batch.type} ${result.batch.weight}斤 依据${result.batch.evidence.length}段`,
        });
      } else {
        log.push({ t, kind: 'empty-pack', detail: `${event.flour} 无累计可打包` });
      }
      ledger = result.ledger;
    }

    for (const event of at) {
      if (event.action === 'setGap') {
        ledger = setGap(ledger, event.value);
        log.push({
          t,
          kind: 'setGap',
          detail: `间隙→${ledger.gap.toFixed(2)}mm 负载${ledger.load.toFixed(1)}%`,
        });
      } else if (event.action === 'setValve') {
        ledger = setValve(ledger, event.value);
        log.push({
          t,
          kind: 'setValve',
          detail: `阀门→${ledger.valve.toFixed(0)}% 转速${ledger.speed.toFixed(1)}rpm 负载${ledger.load.toFixed(1)}%`,
        });
      }
    }

    ledger = tick(ledger, dt);
    if (ledger.overloaded && !overloadBefore) {
      log.push({ t, kind: 'overload-on', detail: '负载>85%，过载保护停机' });
    } else if (!ledger.overloaded && overloadBefore) {
      log.push({ t, kind: 'overload-off', detail: '负载回落，恢复研磨' });
    }
  }

  return { ledger, batches: ledger.batches, log };
};
