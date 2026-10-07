/**
 * 推演引擎：把星历、可见性、统计组装成无状态快照接口。
 *
 * 设计要点：
 * - snapshot(tick) 是纯函数，同一 tick 任意时刻、任意次序调用结果逐位一致；
 * - 引擎不保存任何会随调用变化的状态，因此不存在「回退污染前进」；
 * - TimelineCursor 仅为批量顺序遍历提供便利，其区间统计通过全量重扫实现，
 *   统计量不依赖增量更新。
 */

import {
  BodyConfig,
  ObserverConfig,
  SimulationConfig,
  TickSnapshot,
} from './types';
import { evaluateVisibility } from './visibility';
import { bodyPosition, localSiderealTime } from './ephemeris';
import {
  AccumulatedStats,
  accumulate,
  computeTickCompletion,
  TickCompletion,
} from './stats';

export class Simulation {
  readonly observer: ObserverConfig;
  readonly bodies: BodyConfig[];
  readonly bodyIds: string[];

  constructor(config: SimulationConfig) {
    this.observer = config.observer;
    this.bodies = config.bodies;
    this.bodyIds = config.bodies.map((b) => b.id);
  }

  /** 某一 tick 的完整快照（纯数据，可序列化比对） */
  snapshot(tick: number): TickSnapshot {
    const visibility = evaluateVisibility(tick, this.observer, this.bodies);
    const bodies: TickSnapshot['bodies'] = {};
    let visibleCount = 0;
    for (const v of visibility) {
      const body = this.bodies.find((b) => b.id === v.bodyId);
      if (!body) throw new Error(`unknown body ${v.bodyId}`);
      bodies[v.bodyId] = {
        position: bodyPosition(body, tick),
        altitudeDeg: v.altitudeDeg,
        azimuthDeg: v.azimuthDeg,
        visible: v.visible,
        aboveHorizon: v.aboveHorizon,
        occultedBy: v.occultedBy,
        tangent: v.tangent,
      };
      if (v.visible) visibleCount += 1;
    }
    return {
      tick,
      lstDeg: localSiderealTime(
        tick,
        this.observer.epochTick,
        this.observer.lstAtEpochDeg,
        this.observer.lstRateDegPerTick,
      ),
      bodies,
      visibleCount,
    };
  }

  /** 某一 tick 的完成度（与 snapshot 共用同一可见性判定） */
  completion(tick: number): TickCompletion {
    return computeTickCompletion(
      tick,
      evaluateVisibility(tick, this.observer, this.bodies),
    );
  }

  /** 区间累计统计（一次性扫描，全整数计数） */
  accumulate(startTick: number, endTick: number, step = 1): AccumulatedStats {
    return accumulate(startTick, endTick, step, this.bodyIds, (tick) =>
      evaluateVisibility(tick, this.observer, this.bodies),
    );
  }

  /** 顺序遍历游标：回退/前进只改变 tick 索引，不携带任何增量状态 */
  createCursor(startTick = 0, step = 1): TimelineCursor {
    return new TimelineCursor(this, startTick, step);
  }
}

export class TimelineCursor {
  private readonly sim: Simulation;
  private readonly step: number;
  private tick: number;

  constructor(sim: Simulation, startTick: number, step: number) {
    if (step <= 0) throw new Error('step must be positive');
    this.sim = sim;
    this.step = step;
    this.tick = startTick;
  }

  get currentTick(): number {
    return this.tick;
  }

  snapshot(): TickSnapshot {
    return this.sim.snapshot(this.tick);
  }

  completion(): TickCompletion {
    return this.sim.completion(this.tick);
  }

  /** 前进 n 步 */
  advance(n = 1): TickSnapshot {
    this.tick += this.step * n;
    return this.snapshot();
  }

  /** 后退 n 步 */
  rewind(n = 1): TickSnapshot {
    this.tick -= this.step * n;
    return this.snapshot();
  }

  /**
   * 区间累计统计。无论游标此前如何移动，结果都只取决于区间本身
   * （内部一次性重扫，不做增量累加）。
   */
  stats(startTick: number, endTick: number): AccumulatedStats {
    return this.sim.accumulate(startTick, endTick, this.step);
  }
}
