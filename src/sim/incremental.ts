/**
 * 增量重推：调整波次/敌人参数后，只重算受影响的时间区间。
 *
 * 原理：
 *   - 整体推演时按固定间隔保存引擎状态检查点（含 RNG 状态）；
 *   - 新旧配置做结构化比较，定位最早受影响的时刻：
 *       * 全局字段（输出策略、机制参数等）变化 -> 从 0 重推；
 *       * 第 i 波配置变化 -> 从第 i 波开始时刻重推；
 *       * 波次新增/删除 -> 从第一个发生差异的波次开始时刻重推；
 *   - 从不晚于该时刻的最近检查点恢复，推演到结束，再与旧结果中
 *     早于检查点的事件/曲线拼接。
 *
 * 因引擎确定性（固定步长 + 种子化 RNG + 可恢复状态），增量拼接结果
 * 与对新配置整体重推严格一致（selfcheck.ts 负责回归验证）。
 */
import { Engine } from './engine.js';
import { buildResult } from './result.js';
import {
  CurvePoint,
  EngineState,
  SimConfig,
  SimEvent,
  SimResult
} from './types.js';

interface Checkpoint {
  t: number;
  state: EngineState;
  /** 截至该检查点，已发出的事件 / 已采样曲线点数量（用于精确裁剪旧结果） */
  eventsCount: number;
  curveCount: number;
}

export interface IncrementalOutcome {
  result: SimResult;
  /** 配置变化最早影响到的时刻（毫秒）；Infinity 表示无需重推 */
  affectedFromMs: number;
  /** 实际复用的旧结果截止时刻 */
  reusedUntilMs: number;
  /** 本次真正重新推演的时间区间 */
  recomputedRangeMs: [number, number];
}

export class IncrementalRunner {
  private config: SimConfig | null = null;
  private checkpoints: Checkpoint[] = [];
  private events: SimEvent[] = [];
  private curve: CurvePoint[] = [];
  private readonly checkpointEveryMs: number;

  constructor(checkpointEveryMs: number = 5000) {
    this.checkpointEveryMs = checkpointEveryMs;
  }

  runFull(config: SimConfig, configHash: string): SimResult {
    this.config = config;
    this.checkpoints = [];
    const engine = new Engine(config);
    this.checkpoints.push({
      t: 0,
      state: engine.snapshot(),
      eventsCount: 0,
      curveCount: 0
    });
    while (!engine.done) {
      engine.step();
      const t = engine.timeMs;
      if (t % this.checkpointEveryMs === 0) {
        this.checkpoints.push({
          t,
          state: engine.snapshot(),
          eventsCount: engine.events.length,
          curveCount: engine.curve.length
        });
      }
    }
    this.events = [...engine.events];
    this.curve = [...engine.curve];
    return buildResult(config, this.events, this.curve, configHash);
  }

  applyChange(next: SimConfig, configHash: string): IncrementalOutcome {
    if (!this.config) {
      return {
        result: this.runFull(next, configHash),
        affectedFromMs: 0,
        reusedUntilMs: 0,
        recomputedRangeMs: [0, 0]
      };
    }

    const affectedFromMs = computeAffectedFromMs(this.config, next, this.events);
    if (affectedFromMs === Infinity) {
      return {
        result: buildResult(next, this.events, this.curve, configHash),
        affectedFromMs,
        reusedUntilMs: this.curve.length > 0 ? this.curve[this.curve.length - 1].t : 0,
        recomputedRangeMs: [0, 0]
      };
    }

    let cp = this.checkpoints[0];
    for (const c of this.checkpoints) {
      if (c.t <= affectedFromMs) cp = c;
      else break;
    }

    const keptEvents = this.events.slice(0, cp.eventsCount);
    const keptCurve = this.curve.slice(0, cp.curveCount);

    const engine = new Engine(next, cp.state);
    const newCheckpoints: Checkpoint[] = this.checkpoints.filter(c => c.t <= cp.t);
    while (!engine.done) {
      engine.step();
      const t = engine.timeMs;
      if (t % this.checkpointEveryMs === 0) {
        newCheckpoints.push({
          t,
          state: engine.snapshot(),
          eventsCount: keptEvents.length + engine.events.length,
          curveCount: keptCurve.length + engine.curve.length
        });
      }
    }
    const endMs = engine.timeMs;

    this.config = next;
    this.checkpoints = newCheckpoints;
    this.events = [...keptEvents, ...engine.events];
    this.curve = [...keptCurve, ...engine.curve];

    return {
      result: buildResult(next, this.events, this.curve, configHash),
      affectedFromMs,
      reusedUntilMs: cp.t,
      recomputedRangeMs: [cp.t, endMs]
    };
  }
}

function computeAffectedFromMs(
  oldConfig: SimConfig,
  newConfig: SimConfig,
  oldEvents: SimEvent[]
): number {
  const { waves: oldWaves, ...oldRest } = oldConfig;
  const { waves: newWaves, ...newRest } = newConfig;
  if (stableJson(oldRest) !== stableJson(newRest)) return 0;

  const common = Math.min(oldWaves.length, newWaves.length);
  for (let i = 0; i < common; i++) {
    if (stableJson(oldWaves[i]) !== stableJson(newWaves[i])) {
      return waveStartMs(oldEvents, i + 1);
    }
  }
  if (oldWaves.length !== newWaves.length) {
    return waveStartMs(oldEvents, common + 1);
  }
  return Infinity;
}

function waveStartMs(events: SimEvent[], wave: number): number {
  const start = events.find(e => e.type === 'wave-start' && e.wave === wave);
  if (start) return start.t;
  const last = events[events.length - 1];
  return last ? last.t : 0;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
