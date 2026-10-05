import { describe, it, expect } from 'vitest';
import {
  Simulation,
  runScenario,
  SimConfig,
  SimEvent,
  FIXED_DT,
  MAX_LIVES,
  STAR_SCORE,
  GOAL_SCORE,
  HIDDEN_GOAL_SCORE,
  STARS_TO_UNLOCK
} from './simulation';

const config: SimConfig = {
  fireColumns: [{ interval: 2 }, { interval: 2.5 }],
  elevators: [{ baseY: 0, minHeight: -1, maxHeight: 1.5, speed: 0.8 }]
};

const emptyConfig: SimConfig = { fireColumns: [], elevators: [] };

function advance(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    sim.nextTick();
    sim.settle();
  }
}

describe('重复触发去重', () => {
  it('同一 tick 同一火焰柱多次碰撞只扣一次血', () => {
    const sim = new Simulation(config);
    advance(sim, 120); // 火焰柱 0 在 tick 120 激活
    expect(sim.fires[0].active).toBe(true);

    sim.enqueue({ tick: sim.tick, type: 'fire', id: 0 });
    sim.enqueue({ tick: sim.tick, type: 'fire', id: 0 });
    sim.enqueue({ tick: sim.tick, type: 'fire', id: 0 });
    const effects = sim.settle();

    expect(effects.filter((e) => e.type === 'lifeLost')).toHaveLength(1);
    expect(sim.lives).toBe(MAX_LIVES - 1);
  });

  it('同一 tick 同一颗星星多次碰撞只加一次分', () => {
    const sim = new Simulation(emptyConfig);
    sim.nextTick();
    for (let i = 0; i < 5; i++) {
      sim.enqueue({ tick: sim.tick, type: 'star', id: 0 });
    }
    const effects = sim.settle();

    expect(effects.filter((e) => e.type === 'starCollected')).toHaveLength(1);
    expect(sim.score).toBe(STAR_SCORE);
    expect(sim.starsCollected.size).toBe(1);
  });

  it('同一 tick 同一锤子多次碰撞只击退一次', () => {
    const sim = new Simulation(emptyConfig);
    sim.nextTick();
    sim.enqueue({ tick: sim.tick, type: 'hammer', id: 0, dirX: 1, dirZ: 0 });
    sim.enqueue({ tick: sim.tick, type: 'hammer', id: 0, dirX: 1, dirZ: 0 });
    const effects = sim.settle();

    expect(effects.filter((e) => e.type === 'hammerHit')).toHaveLength(1);
  });
});

describe('同帧多机关确定性结算', () => {
  it('同一 tick 的火焰 + 星星 + 锤子 + 表面各自结算一次且顺序确定', () => {
    const sim = new Simulation(config);
    advance(sim, 120);

    // 故意以乱序入队，结算顺序必须仍然确定
    sim.enqueue({ tick: sim.tick, type: 'star', id: 0 });
    sim.enqueue({ tick: sim.tick, type: 'fire', id: 0 });
    sim.enqueue({ tick: sim.tick, type: 'surface', surface: 'ice' });
    sim.enqueue({ tick: sim.tick, type: 'hammer', id: 1, dirX: 0, dirZ: 1 });
    const effects = sim.settle();

    expect(effects.map((e) => e.type)).toEqual([
      'surfaceChanged',
      'hammerHit',
      'lifeLost',
      'scoreAdd',
      'starCollected'
    ]);
    expect(sim.lives).toBe(MAX_LIVES - 1);
    expect(sim.score).toBe(STAR_SCORE);
    expect(sim.currentSurface).toBe('ice');
  });
});

describe('火焰激活窗口边界', () => {
  it('激活窗口为 [120, 166]（interval=2s，持续 0.8s，步长 1/60）', () => {
    const sim = new Simulation({ fireColumns: [{ interval: 2 }], elevators: [] });
    const activeTicks: number[] = [];
    for (let t = 0; t < 180; t++) {
      sim.nextTick();
      sim.settle();
      if (sim.fires[0].active) activeTicks.push(sim.tick);
    }
    expect(activeTicks[0]).toBe(120);
    expect(activeTicks[activeTicks.length - 1]).toBe(166);
  });

  it('窗口外碰撞不扣血，窗口内碰撞扣血', () => {
    const sim = new Simulation({ fireColumns: [{ interval: 2 }], elevators: [] });

    advance(sim, 119);
    expect(sim.fires[0].active).toBe(false);
    sim.enqueue({ tick: sim.tick, type: 'fire', id: 0 });
    sim.settle();
    expect(sim.lives).toBe(MAX_LIVES);

    sim.nextTick(); // tick 120，激活
    expect(sim.fires[0].active).toBe(true);
    sim.enqueue({ tick: sim.tick, type: 'fire', id: 0 });
    sim.settle();
    expect(sim.lives).toBe(MAX_LIVES - 1);
  });

  it('燃烧无敌期内不重复扣血，熄灭后再次激活可再次扣血', () => {
    const sim = new Simulation({ fireColumns: [{ interval: 2 }], elevators: [] });

    advance(sim, 120);
    sim.enqueue({ tick: sim.tick, type: 'fire', id: 0 });
    sim.settle();
    expect(sim.lives).toBe(MAX_LIVES - 1);
    expect(sim.burning).toBe(true);

    // 无敌期内（1s）再次碰到火焰：不扣血
    sim.nextTick();
    sim.enqueue({ tick: sim.tick, type: 'fire', id: 0 });
    sim.settle();
    expect(sim.lives).toBe(MAX_LIVES - 1);

    // 推进到无敌期结束（60 个固定步）
    advance(sim, 59);
    expect(sim.burning).toBe(false);

    // 下一个激活窗口（tick 240）再次扣血
    advance(sim, 60);
    expect(sim.tick).toBe(240);
    expect(sim.fires[0].active).toBe(true);
    sim.enqueue({ tick: sim.tick, type: 'fire', id: 0 });
    sim.settle();
    expect(sim.lives).toBe(MAX_LIVES - 2);
  });
});

describe('电梯上下限', () => {
  it('到达上限后反向，到达下限后反向，且不越界', () => {
    const sim = new Simulation({
      fireColumns: [],
      elevators: [{ baseY: 0, minHeight: -1, maxHeight: 1.5, speed: 0.8 }]
    });

    const ys: number[] = [];
    const dirs: number[] = [];
    for (let t = 0; t < 400; t++) {
      sim.nextTick();
      sim.settle();
      ys.push(sim.elevators[0].y);
      dirs.push(sim.elevators[0].direction);
    }

    // 0.8 / (1/60) = 48/s，1.5 / 0.8 * 60 = 112.5 -> tick 113 触顶并反向
    expect(ys[112]).toBeCloseTo(1.5, 9);
    expect(dirs[112]).toBe(-1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1.5 + 1e-9);

    // 从 1.5 下行 2.5 距离需 187.5 步 -> tick 301 触底并反向
    expect(ys[300]).toBeCloseTo(-1, 9);
    expect(dirs[300]).toBe(1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1 - 1e-9);
  });
});

describe('隐藏通道解锁边界', () => {
  it('2 颗星星不解锁，第 3 颗解锁且只解锁一次', () => {
    const sim = new Simulation(emptyConfig);

    sim.nextTick();
    sim.enqueue({ tick: sim.tick, type: 'star', id: 0 });
    sim.enqueue({ tick: sim.tick, type: 'star', id: 1 });
    let effects = sim.settle();
    expect(sim.starsCollected.size).toBe(2);
    expect(sim.gateOpen).toBe(false);
    expect(sim.hiddenPathUnlocked).toBe(false);
    expect(effects.some((e) => e.type === 'gateOpened')).toBe(false);

    sim.nextTick();
    sim.enqueue({ tick: sim.tick, type: 'star', id: 2 });
    effects = sim.settle();
    expect(sim.starsCollected.size).toBe(STARS_TO_UNLOCK);
    expect(sim.gateOpen).toBe(true);
    expect(sim.hiddenPathUnlocked).toBe(true);
    expect(effects.filter((e) => e.type === 'gateOpened')).toHaveLength(1);

    // 重复收集已解锁后的星星：不再产生解锁或加分
    sim.nextTick();
    sim.enqueue({ tick: sim.tick, type: 'star', id: 2 });
    effects = sim.settle();
    expect(effects).toHaveLength(0);
    expect(sim.score).toBe(STAR_SCORE * 3);
  });

  it('同一 tick 集齐 3 颗星星也只触发一次解锁', () => {
    const sim = new Simulation(emptyConfig);
    sim.nextTick();
    sim.enqueue({ tick: sim.tick, type: 'star', id: 0 });
    sim.enqueue({ tick: sim.tick, type: 'star', id: 1 });
    sim.enqueue({ tick: sim.tick, type: 'star', id: 2 });
    sim.enqueue({ tick: sim.tick, type: 'star', id: 2 }); // 重复
    const effects = sim.settle();

    expect(effects.filter((e) => e.type === 'gateOpened')).toHaveLength(1);
    expect(sim.score).toBe(STAR_SCORE * 3);
  });
});

describe('终点与生命结算', () => {
  it('普通终点 +200 并锁定，隐藏终点 +500，结算后事件被忽略', () => {
    const sim = new Simulation(emptyConfig);
    sim.nextTick();
    sim.enqueue({ tick: sim.tick, type: 'goal', hiddenPath: false });
    sim.enqueue({ tick: sim.tick, type: 'goal', hiddenPath: false }); // 重复
    const effects = sim.settle();

    expect(effects.filter((e) => e.type === 'goal')).toHaveLength(1);
    expect(sim.score).toBe(GOAL_SCORE);
    expect(sim.won).toBe(true);
    expect(sim.wonViaHiddenPath).toBe(false);

    // 通关后冻结：后续事件与机关推进都被忽略
    const tickAfterWin = sim.tick;
    sim.nextTick();
    sim.enqueue({ tick: sim.tick, type: 'star', id: 0 });
    expect(sim.settle()).toHaveLength(0);
    expect(sim.tick).toBe(tickAfterWin);
    expect(sim.score).toBe(GOAL_SCORE);
  });

  it('隐藏终点 +500', () => {
    const sim = new Simulation(emptyConfig);
    sim.nextTick();
    sim.enqueue({ tick: sim.tick, type: 'goal', hiddenPath: true });
    sim.settle();
    expect(sim.score).toBe(HIDDEN_GOAL_SCORE);
    expect(sim.wonViaHiddenPath).toBe(true);
  });

  it('坠落伤害不受燃烧无敌保护，生命归零后游戏结束', () => {
    const sim = new Simulation({ fireColumns: [{ interval: 2 }], elevators: [] });
    advance(sim, 120);
    sim.enqueue({ tick: sim.tick, type: 'fire', id: 0 });
    sim.settle();
    expect(sim.burning).toBe(true);

    // 燃烧中坠落仍然扣血
    sim.nextTick();
    sim.enqueue({ tick: sim.tick, type: 'fall' });
    sim.settle();
    expect(sim.lives).toBe(MAX_LIVES - 2);

    // 连续坠落至归零
    for (let i = 0; i < 10; i++) {
      sim.nextTick();
      sim.enqueue({ tick: sim.tick, type: 'fall' });
      sim.settle();
    }
    expect(sim.lives).toBe(0);
    expect(sim.gameOver).toBe(true);

    // 结束后冻结
    const tickAtEnd = sim.tick;
    sim.nextTick();
    expect(sim.tick).toBe(tickAtEnd);
  });
});

describe('离线复算一致性', () => {
  it('实时固定步循环产生的事件日志可离线复算出完全相同的状态序列', () => {
    const scripted: SimEvent[] = [
      { tick: 5, type: 'star', id: 0 },
      { tick: 5, type: 'star', id: 0 }, // 重复触发
      { tick: 30, type: 'surface', surface: 'sand' },
      { tick: 60, type: 'hammer', id: 0, dirX: 1, dirZ: 0.5 },
      { tick: 120, type: 'fire', id: 0 },
      { tick: 120, type: 'fire', id: 0 }, // 重复触发
      { tick: 121, type: 'fire', id: 0 }, // 无敌期内
      { tick: 150, type: 'star', id: 1 },
      { tick: 200, type: 'star', id: 2 }, // 解锁隐藏通道
      { tick: 240, type: 'fire', id: 0 },
      { tick: 300, type: 'goal', hiddenPath: true }
    ];

    // 模拟实时循环：逐 tick 推进并注入事件
    const realtime = new Simulation(config);
    const realtimeSnapshots = [];
    for (let t = 1; t <= 400; t++) {
      realtime.nextTick();
      for (const e of scripted) {
        if (e.tick === t) realtime.enqueue({ ...e });
      }
      realtime.settle();
      realtimeSnapshots.push(realtime.snapshot());
    }

    // 离线复算：只使用实时循环记录下的事件日志
    const replayed = runScenario(config, realtime.eventLog, 400);

    expect(replayed).toEqual(realtimeSnapshots);

    const final = replayed[replayed.length - 1];
    expect(final.lives).toBe(MAX_LIVES - 2);
    expect(final.score).toBe(STAR_SCORE * 3 + HIDDEN_GOAL_SCORE);
    expect(final.hiddenPathUnlocked).toBe(true);
    expect(final.won).toBe(true);
    expect(final.wonViaHiddenPath).toBe(true);
  });
});
