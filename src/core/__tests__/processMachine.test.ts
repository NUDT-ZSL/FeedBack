import { describe, it, expect } from 'vitest';
import {
  PaperWorkshopMachine,
  createInitialState,
  reduce,
  computeQuality,
  UNIFORMITY_RETRY_THRESHOLD,
  FRAGMENTATION_READY,
  type WorkshopEvent,
  type WorkshopState,
} from '@/core/processMachine';

/** 生成一段匀速拖拽采样：速度恒定 => 均匀度应为 100。 */
function steadyPositions(count = 10, speed = 2): { x: number; y: number; t: number }[] {
  const positions: { x: number; y: number; t: number }[] = [];
  for (let i = 0; i < count; i++) {
    positions.push({ x: i * speed, y: 0, t: i * 10 });
  }
  return positions;
}

/** 生成速度剧烈抖动的拖拽采样 => 均匀度应偏低。 */
function erraticPositions(count = 10): { x: number; y: number; t: number }[] {
  const positions: { x: number; y: number; t: number }[] = [];
  let x = 0;
  for (let i = 0; i < count; i++) {
    x += i % 2 === 0 ? 50 : 1;
    positions.push({ x, y: 0, t: i * 10 });
  }
  return positions;
}

function driveToScooping(machine: PaperWorkshopMachine): void {
  machine.dispatch({ type: 'START_BOILING' });
  machine.dispatch({ type: 'TICK_BOILING', deltaTime: 2 });
  machine.dispatch({ type: 'BOIL_COMPLETE' });
  for (let i = 0; i < 40; i++) {
    machine.dispatch({ type: 'HIT_PESTLE' });
  }
  machine.dispatch({ type: 'SIEVE' });
}

function driveToDrying(machine: PaperWorkshopMachine, positions = steadyPositions()): void {
  driveToScooping(machine);
  machine.dispatch({ type: 'SCOOP_DRAG_END', positions });
  machine.dispatch({ type: 'PRESS' });
}

describe('工序状态机：状态推进（无浏览器批量验证）', () => {
  it('按顺序推进四个工序直到 finished，跨阶段事件不会回退状态', () => {
    const machine = new PaperWorkshopMachine();
    const stages: string[] = [machine.getState().stage];

    machine.dispatch({ type: 'START_BOILING' });
    stages.push(machine.getState().stage);
    machine.dispatch({ type: 'TICK_BOILING', deltaTime: 2 });
    expect(machine.getState().paper.boilingProgress).toBe(100);
    machine.dispatch({ type: 'BOIL_COMPLETE' });
    stages.push(machine.getState().stage);

    // 蒸煮未完成/打浆阶段收到蒸煮事件均无效
    machine.dispatch({ type: 'START_BOILING' });
    machine.dispatch({ type: 'TICK_BOILING', deltaTime: 10 });
    expect(machine.getState().stage).toBe('beating_active');

    for (let i = 0; i < 40; i++) machine.dispatch({ type: 'HIT_PESTLE' });
    expect(machine.getState().paper.fragmentationLevel).toBe(80);
    machine.dispatch({ type: 'SIEVE' });
    stages.push(machine.getState().stage);

    // 碎裂度不足时不允许过筛
    const underBeaten = new PaperWorkshopMachine();
    underBeaten.dispatch({ type: 'START_BOILING' });
    underBeaten.dispatch({ type: 'TICK_BOILING', deltaTime: 2 });
    underBeaten.dispatch({ type: 'BOIL_COMPLETE' });
    for (let i = 0; i < 10; i++) underBeaten.dispatch({ type: 'HIT_PESTLE' });
    underBeaten.dispatch({ type: 'SIEVE' });
    expect(underBeaten.getState().stage).toBe('beating_active');

    machine.dispatch({ type: 'SCOOP_DRAG_END', positions: steadyPositions() });
    machine.dispatch({ type: 'PRESS' });
    stages.push(machine.getState().stage);

    machine.dispatch({ type: 'TICK_DRYING', lightIntensity: 100, deltaTime: 5000 });
    expect(machine.getState().paper.dryness).toBe(100);
    machine.dispatch({ type: 'FINISH', watermark: '竹韵', poemText: '测试题诗' });
    stages.push(machine.getState().stage);

    expect(stages).toEqual([
      'boiling_idle',
      'boiling_active',
      'beating_active',
      'scooping_active',
      'drying_active',
      'finished',
    ]);
    expect(machine.getState().paper.watermark).toBe('竹韵');
  });

  it('批量化推进：对 50 组随机时长输入，状态始终满足不变量', () => {
    for (let run = 0; run < 50; run++) {
      let state = createInitialState(run);
      state = reduce(state, { type: 'START_BOILING' });
      state = reduce(state, { type: 'TICK_BOILING', deltaTime: Math.random() * 4 });
      state = reduce(state, { type: 'BOIL_COMPLETE' });
      for (let h = 0; h < Math.floor(Math.random() * 60); h++) {
        state = reduce(state, { type: 'HIT_PESTLE' });
      }
      state = reduce(state, { type: 'SIEVE' });
      if (state.stage === 'scooping_active') {
        state = reduce(state, {
          type: 'SCOOP_DRAG_END',
          positions: Math.random() > 0.5 ? steadyPositions() : erraticPositions(),
        });
        state = reduce(state, { type: 'PRESS' });
      }
      if (state.stage === 'drying_active') {
        state = reduce(state, { type: 'TICK_DRYING', lightIntensity: Math.random() * 100, deltaTime: Math.random() * 10 });
      }

      const p = state.paper;
      expect(p.boilingProgress).toBeGreaterThanOrEqual(0);
      expect(p.boilingProgress).toBeLessThanOrEqual(100);
      expect(p.fragmentationLevel).toBeGreaterThanOrEqual(0);
      expect(p.fragmentationLevel).toBeLessThanOrEqual(100);
      expect(p.uniformity).toBeGreaterThanOrEqual(0);
      expect(p.uniformity).toBeLessThanOrEqual(100);
      expect(p.dryness).toBeGreaterThanOrEqual(0);
      expect(p.dryness).toBeLessThanOrEqual(100);
      expect(Number.isFinite(computeQuality(p))).toBe(true);
    }
  });

  it('订阅者按事件顺序收到状态更新，无关事件不会触发广播', () => {
    const machine = new PaperWorkshopMachine();
    const seen: WorkshopState[] = [];
    machine.subscribe((next) => seen.push(next));

    machine.dispatch({ type: 'HIT_PESTLE' }); // 阶段错误，无效
    expect(seen).toHaveLength(0);

    driveToScooping(machine);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1].stage).toBe('scooping_active');

    let unsubscribedCalls = 0;
    const unsub = machine.subscribe(() => unsubscribedCalls++);
    unsub();
    machine.dispatch({ type: 'SCOOP_DRAG_END', positions: steadyPositions() });
    expect(unsubscribedCalls).toBe(0);
  });

  it('RESET 可回到初始状态并保留新的纹理种子', () => {
    const machine = new PaperWorkshopMachine();
    driveToDrying(machine);
    machine.dispatch({ type: 'RESET', textureSeed: 42 });
    const state = machine.getState();
    expect(state.stage).toBe('boiling_idle');
    expect(state.paper.uniformity).toBe(0);
    expect(state.paper.dryness).toBe(0);
    expect(state.paper.textureSeed).toBe(42);
  });
});

describe('质量计算', () => {
  it('匀速拖拽均匀度接近满分，剧烈抖动低于重抄阈值', () => {
    const machineA = new PaperWorkshopMachine();
    driveToScooping(machineA);
    machineA.dispatch({ type: 'SCOOP_DRAG_END', positions: steadyPositions(20, 3) });
    expect(machineA.getState().paper.uniformity).toBeCloseTo(100, 6);
    expect(machineA.getState().needsRescoop).toBe(false);

    const machineB = new PaperWorkshopMachine();
    driveToScooping(machineB);
    machineB.dispatch({ type: 'SCOOP_DRAG_END', positions: erraticPositions(20) });
    expect(machineB.getState().paper.uniformity).toBeLessThan(UNIFORMITY_RETRY_THRESHOLD);
    expect(machineB.getState().needsRescoop).toBe(true);
  });

  it('多次重抄的均匀度按尝试次数做加权平均，而非被后一次覆盖', () => {
    const machine = new PaperWorkshopMachine();
    driveToScooping(machine);

    machine.dispatch({ type: 'SCOOP_DRAG_END', positions: steadyPositions() });
    const first = machine.getState().paper.uniformity;
    expect(first).toBeCloseTo(100, 6);

    const sampler = new PaperWorkshopMachine();
    driveToScooping(sampler);
    sampler.dispatch({ type: 'SCOOP_DRAG_END', positions: erraticPositions() });
    const second = sampler.getState().paper.uniformity;

    machine.dispatch({ type: 'SCOOP_DRAG_END', positions: erraticPositions() });
    const state = machine.getState();
    // 第二次（抖动）均匀度 = (first * 1 + second) / 2，证明首次结果未被丢弃
    expect(state.paper.uniformity).toBeCloseTo((first + second) / 2, 6);
    expect(state.scoopAttempts).toBe(2);
  });

  it('均匀度低于阈值时禁止压榨进入晒纸阶段', () => {
    const machine = new PaperWorkshopMachine();
    driveToScooping(machine);
    machine.dispatch({ type: 'SCOOP_DRAG_END', positions: erraticPositions() });
    machine.dispatch({ type: 'PRESS' });
    expect(machine.getState().stage).toBe('scooping_active');

    machine.dispatch({ type: 'SCOOP_DRAG_END', positions: steadyPositions() });
    // (4 + 100) / 2 ≈ 52，仍低于阈值，继续禁止压榨
    machine.dispatch({ type: 'PRESS' });
    expect(machine.getState().stage).toBe('scooping_active');

    machine.dispatch({ type: 'SCOOP_DRAG_END', positions: steadyPositions() });
    // (4 + 200) / 3 ≈ 68，恢复后允许压榨
    machine.dispatch({ type: 'PRESS' });
    expect(machine.getState().stage).toBe('drying_active');
  });

  it('computeQuality 为四项指标的加权综合，批量输入结果确定', () => {
    const cases = [
      { paper: { boilingProgress: 100, fragmentationLevel: 80, uniformity: 90, dryness: 70 } },
      { paper: { boilingProgress: 100, fragmentationLevel: 100, uniformity: 100, dryness: 100 } },
      { paper: { boilingProgress: 0, fragmentationLevel: 0, uniformity: 0, dryness: 0 } },
    ] as { paper: WorkshopState['paper'] }[];

    expect(computeQuality(cases[0].paper)).toBe(83);
    expect(computeQuality(cases[1].paper)).toBe(100);
    expect(computeQuality(cases[2].paper)).toBe(0);
  });
});

describe('回归：快速连续拖拽时 uniformity / dryness 不互相覆盖', () => {
  it('捞纸 SCOOP_DRAG_END 与晒纸 TICK_DRYING 在同步循环中交错派发，两者更新都累积', () => {
    const machine = new PaperWorkshopMachine();
    driveToScooping(machine);

    // 模拟玩家快速连续拖拽：连续多次 SCOOP_DRAG_END
    const rounds = 10;
    for (let i = 0; i < rounds; i++) {
      machine.dispatch({
        type: 'SCOOP_DRAG_END',
        positions: i % 2 === 0 ? steadyPositions() : erraticPositions(),
      });
    }
    const scoopingState = machine.getState();
    expect(scoopingState.scoopAttempts).toBe(rounds);
    expect(scoopingState.paper.uniformity).toBeGreaterThan(0);
    expect(scoopingState.paper.dryness).toBe(0);
    // 所有尝试都参与了平均：结果应介于最低样本与满分之间
    expect(scoopingState.paper.uniformity).toBeLessThan(100);
    expect(scoopingState.paper.uniformity).toBeGreaterThan(
      UNIFORMITY_RETRY_THRESHOLD / 2,
    );

    // 再补三次匀速重抄把加权均匀度拉回阈值以上，然后进入晒纸
    machine.dispatch({ type: 'SCOOP_DRAG_END', positions: steadyPositions() });
    machine.dispatch({ type: 'SCOOP_DRAG_END', positions: steadyPositions() });
    machine.dispatch({ type: 'SCOOP_DRAG_END', positions: steadyPositions() });
    machine.dispatch({ type: 'PRESS' });
    expect(machine.getState().stage).toBe('drying_active');
    const uniformityAtDrying = machine.getState().paper.uniformity;
    expect(uniformityAtDrying).toBeGreaterThanOrEqual(UNIFORMITY_RETRY_THRESHOLD);

    // 干燥 tick 与（阶段内忽略的）其它事件交错，dryness 单调累积不被重置
    let expectedDryness = 0;
    const interleaved: WorkshopEvent[] = [];
    for (let i = 0; i < 20; i++) {
      interleaved.push({ type: 'TICK_DRYING', lightIntensity: 50, deltaTime: 0.5 });
      // calculateDryness 语义：dryness += (0.01 + light/100 * 0.01) * deltaTime
      expectedDryness = Math.min(100, expectedDryness + 0.015 * 0.5);
      // 快速操作可能夹带的其它阶段事件，在 drying 阶段必须全部无效
      interleaved.push({ type: 'HIT_PESTLE' });
      interleaved.push({ type: 'SCOOP_DRAG_END', positions: steadyPositions() });
    }
    for (const event of interleaved) machine.dispatch(event);

    const final = machine.getState();
    expect(final.paper.dryness).toBeCloseTo(expectedDryness, 6);
    // uniformity 未被干燥 tick 触碰
    expect(final.paper.uniformity).toBe(uniformityAtDrying);
  });

  it('每个事件基于上一份状态原子推进，前一事件的写入不会丢失', () => {
    let state = createInitialState(1);
    const events: WorkshopEvent[] = [
      { type: 'START_BOILING' },
      { type: 'TICK_BOILING', deltaTime: 1 },
      { type: 'TICK_BOILING', deltaTime: 1 },
    ];
    for (const event of events) state = reduce(state, event);
    expect(state.paper.boilingProgress).toBe(100);

    state = reduce(state, { type: 'BOIL_COMPLETE' });
    // 打浆 40 次（每次基于最新 hitCount），碎裂度必须到 80 而不是停在首个步长
    for (let i = 0; i < 40; i++) state = reduce(state, { type: 'HIT_PESTLE' });
    expect(state.paper.fragmentationLevel).toBe(FRAGMENTATION_READY);
  });
});
