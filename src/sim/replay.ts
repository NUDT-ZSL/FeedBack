import { GameEngine } from './engine';
import { EngineConfig, Effect, GameEvent, StateSnapshot } from './types';

export interface TimedEvent {
  /** 事件发生的物理时间（秒）；会被投递到覆盖该时间点的固定步结算 */
  time: number;
  event: GameEvent;
}

export interface Scenario {
  name?: string;
  fixedDt?: number;
  /** 推演总时长（秒），按 fixedDt 切成整数个固定步 */
  duration: number;
  config?: EngineConfig;
  events?: TimedEvent[];
}

export interface ReplayResult {
  engine: GameEngine;
  /** effects[k] / snapshots[k] 对应第 k+1 个固定步结算后的结果 */
  effects: Effect[][];
  snapshots: StateSnapshot[];
}

/**
 * 离线复算：完全不依赖浏览器 / three / cannon / requestAnimationFrame。
 * 同一份 Scenario 在任何机器、任何帧率下产出完全一致的快照序列；
 * 实时运行时也是把碰撞回调转成 GameEvent 投给同一个 GameEngine，
 * 因此离线结果与实时结果逐帧一致。
 */
export function runScenario(scenario: Scenario): ReplayResult {
  const fixedDt = scenario.fixedDt ?? 1 / 60;
  const engine = new GameEngine({ ...scenario.config, fixedDt });

  const timed = [...(scenario.events ?? [])].sort((a, b) => a.time - b.time);
  const steps = Math.round(scenario.duration / fixedDt);

  const effects: Effect[][] = [];
  const snapshots: StateSnapshot[] = [];

  let cursor = 0;
  for (let k = 0; k < steps; k++) {
    const stepEndsAt = (k + 1) * fixedDt;
    while (cursor < timed.length && timed[cursor].time <= stepEndsAt + 1e-9) {
      engine.queueEvent(timed[cursor].event);
      cursor++;
    }
    effects.push(engine.step());
    snapshots.push(engine.snapshot());
  }

  return { engine, effects, snapshots };
}
