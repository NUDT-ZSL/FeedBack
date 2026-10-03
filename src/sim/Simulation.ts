import { FishManager } from '../FishManager';
import { DecorationManager, type DecorationType } from './DecorationManager';
import { Rng } from './rng';
import type { InputEvent, ScheduledInput, SimConfig, SimEvent, StepSnapshot, Trajectory } from './types';

/** 固定时间步长（秒）：模拟推进与真实帧率解耦 */
export const STEP_DT = 1 / 60;

/** 单帧最多补偿的步数，防止后台标签页恢复时出现死亡螺旋 */
const MAX_STEPS_PER_ADVANCE = 8;

const PRECISION = 1e6;

function round(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

export interface SimulationOptions {
  /** 是否记录逐步轨迹（回放/比对需要；纯长跑可关闭以省内存） */
  record?: boolean;
}

/**
 * 确定性模拟核心。
 * - 固定 STEP_DT 推进，不依赖 requestAnimationFrame 帧率；
 * - 所有随机性来自注入的 Rng；
 * - 输入事件按 (step, seq) 排序应用，同一步内多个事件顺序稳定；
 * - 每步结束记录关键状态快照，形成可离线回放/比较的轨迹。
 */
export class Simulation {
  readonly config: SimConfig;
  readonly rng: Rng;
  readonly fishManager: FishManager;
  readonly decorationManager: DecorationManager;

  private stepIndex = 0;
  private accumulator = 0;
  private inputSeq = 0;
  private pendingInputs: ScheduledInput[] = [];
  private appliedInputs: ScheduledInput[] = [];
  private snapshots: StepSnapshot[] = [];
  private record: boolean;

  constructor(config: SimConfig, options: SimulationOptions = {}) {
    this.config = { ...config };
    this.rng = new Rng(config.seed);
    this.fishManager = new FishManager(config.width, config.height, this.rng);
    this.decorationManager = new DecorationManager(this.rng);
    this.record = options.record ?? true;
    this.fishManager.initialize(config.initialFish);
  }

  get currentStep(): number {
    return this.stepIndex;
  }

  get time(): number {
    return this.stepIndex * STEP_DT;
  }

  /** 记录一个输入事件。atStep 缺省为下一步（模拟真实操作中"本帧点击、下步生效"）。 */
  queueInput(event: InputEvent, atStep?: number): ScheduledInput {
    const scheduled: ScheduledInput = {
      step: atStep ?? this.stepIndex + 1,
      seq: this.inputSeq++,
      event
    };
    this.pendingInputs.push(scheduled);
    return scheduled;
  }

  /** 推进一个固定时间步：应用本步输入 → 更新生态 → 记录快照 */
  step(): StepSnapshot {
    const stepEvents: SimEvent[] = [];

    // 1. 应用本步的全部输入，按 seq 排序保证顺序稳定
    const due = this.pendingInputs
      .filter(i => i.step <= this.stepIndex)
      .sort((a, b) => a.seq - b.seq);
    this.pendingInputs = this.pendingInputs.filter(i => i.step > this.stepIndex);
    for (const input of due) {
      this.appliedInputs.push(input);
      this.applyInput(input.event, stepEvents);
    }

    // 2. 推进生态模拟
    this.fishManager.update(STEP_DT);
    stepEvents.push(...this.fishManager.drainEvents());

    // 3. 记录快照
    const snapshot = this.takeSnapshot(stepEvents);
    if (this.record) {
      this.snapshots.push(snapshot);
    }
    this.stepIndex++;
    return snapshot;
  }

  /**
   * 按真实帧间隔推进（供浏览器渲染循环使用）。
   * 内部以固定 STEP_DT 累积补偿，因此不同帧率下产生的轨迹完全一致。
   */
  advance(realDt: number): void {
    this.accumulator += Math.min(realDt, MAX_STEPS_PER_ADVANCE * STEP_DT);
    while (this.accumulator >= STEP_DT) {
      this.step();
      this.accumulator -= STEP_DT;
    }
  }

  /** 无渲染地连续推进 n 步（离线批量运行/回放用） */
  run(steps: number): void {
    for (let i = 0; i < steps; i++) {
      this.step();
    }
  }

  private applyInput(event: InputEvent, stepEvents: SimEvent[]): void {
    switch (event.type) {
      case 'addFood': {
        const created = this.fishManager.addFood(event.x, event.y);
        stepEvents.push({ type: 'foodAdded', foodIds: created.map(f => f.id), x: event.x, y: event.y });
        break;
      }
      case 'addDecoration': {
        const { decoration, clamped } = this.decorationManager.place(
          event.decoration as DecorationType,
          event.x,
          event.y,
          this.config.width,
          this.config.height
        );
        stepEvents.push({
          type: 'decorationPlaced',
          id: decoration.id,
          decoration: decoration.type,
          x: decoration.x,
          y: decoration.y,
          clamped
        });
        break;
      }
    }
  }

  private takeSnapshot(events: SimEvent[]): StepSnapshot {
    return {
      step: this.stepIndex,
      time: round(this.time),
      fishCount: this.fishManager.fishes.length,
      foodCount: this.fishManager.foods.length,
      decorationCount: this.decorationManager.count,
      fishes: this.fishManager.fishes.map(f => ({ id: f.id, x: round(f.x), y: round(f.y), state: f.state })),
      foods: this.fishManager.foods.map(f => ({ id: f.id, x: round(f.x), y: round(f.y) })),
      events
    };
  }

  /** 导出完整轨迹（配置 + 已应用输入 + 逐步快照），可用于离线回放 */
  getTrajectory(): Trajectory {
    return {
      version: 1,
      config: { ...this.config },
      stepDt: STEP_DT,
      inputs: this.appliedInputs.map(i => ({ ...i })),
      steps: this.snapshots.map(s => ({
        ...s,
        fishes: s.fishes.map(f => ({ ...f })),
        foods: s.foods.map(f => ({ ...f })),
        events: s.events.map(e => ({ ...e }))
      }))
    };
  }
}
