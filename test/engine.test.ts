import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/sim/engine';
import { runScenario } from '../src/sim/replay';
import { Effect, GameEvent } from '../src/sim/types';

const DT = 1 / 60;

function stepN(engine: GameEngine, n: number): Effect[] {
  let effects: Effect[] = [];
  for (let i = 0; i < n; i++) effects = effects.concat(engine.step());
  return effects;
}

describe('同帧重复触发去重', () => {
  it('同一星星同帧触发多次只结算一次', () => {
    const engine = new GameEngine();
    engine.queueEvent({ kind: 'star', index: 0 });
    engine.queueEvent({ kind: 'star', index: 0 });
    engine.queueEvent({ kind: 'star', index: 0 });
    const effects = engine.step();

    expect(engine.state.score).toBe(100);
    expect(engine.state.starsCollected.size).toBe(1);
    expect(effects.filter((e) => e.type === 'star')).toHaveLength(1);
  });

  it('同一火焰同帧触发多次只扣一次血', () => {
    const engine = new GameEngine({ fires: [{ id: 'f0', interval: 2 }] });
    stepN(engine, 120); // t=2.0，火焰激活
    expect(engine.state.fires['f0'].active).toBe(true);

    engine.queueEvent({ kind: 'fire', id: 'f0' });
    engine.queueEvent({ kind: 'fire', id: 'f0' });
    const effects = engine.step();

    expect(engine.state.lives).toBe(4);
    expect(effects.filter((e) => e.type === 'damage')).toHaveLength(1);
  });

  it('同帧两个不同火焰也只扣一次血（燃烧无敌窗口）', () => {
    const engine = new GameEngine({
      fires: [
        { id: 'f0', interval: 2 },
        { id: 'f1', interval: 2 },
      ],
    });
    stepN(engine, 120);

    engine.queueEvent({ kind: 'fire', id: 'f0' });
    engine.queueEvent({ kind: 'fire', id: 'f1' });
    engine.step();

    expect(engine.state.lives).toBe(4);
    expect(engine.state.burning).toBe(true);
  });

  it('同一锤子同帧多次碰撞只结算一次击退', () => {
    const engine = new GameEngine();
    engine.queueEvent({ kind: 'hammer', id: 'h0', direction: [1, 0] });
    engine.queueEvent({ kind: 'hammer', id: 'h0', direction: [1, 0] });
    const effects = engine.step();

    expect(effects.filter((e) => e.type === 'hammerHit')).toHaveLength(1);
  });

  it('隐藏通道奖励同帧重复触发只加一次分', () => {
    const engine = new GameEngine();
    engine.queueEvent({ kind: 'hiddenPath' });
    engine.queueEvent({ kind: 'hiddenPath' });
    engine.step();
    expect(engine.state.score).toBe(10);
  });
});

describe('同帧多机关归并', () => {
  it('锤+火+星同帧各自结算一次，顺序确定', () => {
    const engine = new GameEngine({ fires: [{ id: 'f0', interval: 2 }] });
    stepN(engine, 120);

    // 故意以“错误”顺序入队，验证引擎按固定优先级归并
    engine.queueEvent({ kind: 'star', index: 0 });
    engine.queueEvent({ kind: 'fire', id: 'f0' });
    engine.queueEvent({ kind: 'hammer', id: 'h0', direction: [2, 0] });
    const effects = engine.step();

    const types = effects.map((e) => e.type);
    expect(types).toContain('hammerHit');
    expect(types).toContain('damage');
    expect(types).toContain('star');
    // 结算顺序：hammer(1) < fire(2) < star(3)
    expect(types.indexOf('hammerHit')).toBeLessThan(types.indexOf('damage'));
    expect(types.indexOf('damage')).toBeLessThan(types.indexOf('star'));
    expect(engine.state.lives).toBe(4);
    expect(engine.state.score).toBe(100);
  });

  it('击退方向保持原实现：水平归一化后 x/z*12、y 分量*8', () => {
    const engine = new GameEngine();
    engine.queueEvent({ kind: 'hammer', id: 'h0', direction: [3, 0] });
    const effects = engine.step();

    const hit = effects.find((e) => e.type === 'hammerHit');
    expect(hit).toBeDefined();
    if (hit?.type !== 'hammerHit') return;
    const len = Math.sqrt(9 + 0.25);
    expect(hit.velocity[0]).toBeCloseTo((3 / len) * 12, 10);
    expect(hit.velocity[1]).toBeCloseTo((0.5 / len) * 8, 10);
    expect(hit.velocity[2]).toBeCloseTo(0, 10);
  });
});

describe('火焰激活窗口边界（按累计物理时间）', () => {
  it('interval=2、窗口 0.8s：t<2 熄灭，[2,2.8) 激活，之后熄灭，t=4 再次激活', () => {
    const engine = new GameEngine({ fires: [{ id: 'f0', interval: 2 }] });
    const active: boolean[] = [];
    for (let i = 0; i < 240; i++) {
      engine.step();
      active.push(engine.state.fires['f0'].active);
    }

    expect(active[118]).toBe(false); // t≈1.983，尚未激活
    expect(active[119]).toBe(true);  // t=2.0，激活开始
    expect(active[165]).toBe(true);  // t≈2.767，仍在窗口内
    expect(active[166]).toBe(false); // 激活满 0.8s，熄灭
    expect(active[238]).toBe(false); // t≈3.983，下一周期前
    expect(active[239]).toBe(true);  // t=4.0，第二周期激活
  });

  it('熄灭期碰撞不扣血，激活期碰撞扣血，燃烧无敌期内重复碰撞不扣血', () => {
    const engine = new GameEngine({ fires: [{ id: 'f0', interval: 1 }] });
    // 窗口：[1.0,1.8) [2.0,2.8) [3.0,3.8)
    const hitAt = (time: number) => {
      const targetStep = Math.ceil(time / DT - 1e-9);
      while (engine.state.time < targetStep * DT - 1e-9) engine.step();
      engine.queueEvent({ kind: 'fire', id: 'f0' });
      engine.step();
    };

    hitAt(0.5); // 未激活
    expect(engine.state.lives).toBe(5);

    hitAt(1.1); // 激活 → 扣血，燃烧至 t≈2.1
    expect(engine.state.lives).toBe(4);

    hitAt(2.05); // 激活但仍在燃烧无敌期 → 不扣血
    expect(engine.state.lives).toBe(4);

    hitAt(2.2); // 激活且燃烧已结束 → 扣血
    expect(engine.state.lives).toBe(3);
  });
});

describe('电梯上下限（按累计物理时间推进）', () => {
  it('精确到达上下限并折返，永不越界', () => {
    const engine = new GameEngine({
      elevators: [{ id: 'e0', baseY: 0, minHeight: -1, maxHeight: 1.5, speed: 0.8 }],
    });

    let minY = Infinity;
    let maxY = -Infinity;
    let dirAtTop = 0;
    let dirAtBottom = 0;
    for (let i = 0; i < 600; i++) {
      engine.step();
      const e = engine.state.elevators['e0'];
      if (e.y > maxY) { maxY = e.y; dirAtTop = e.direction; }
      if (e.y < minY) { minY = e.y; dirAtBottom = e.direction; }
    }

    expect(maxY).toBe(1.5);   // 精确贴到上限
    expect(minY).toBe(-1);    // 精确贴到下限
    expect(dirAtTop).toBe(-1); // 触顶后向下
    expect(dirAtBottom).toBe(1); // 触底后向上
  });

  it('相同配置两次推演结果逐帧一致（与真实时钟无关）', () => {
    const run = () => {
      const engine = new GameEngine({
        elevators: [{ id: 'e0', baseY: 2, minHeight: -1, maxHeight: 1.5, speed: 0.8 }],
      });
      const ys: number[] = [];
      for (let i = 0; i < 300; i++) {
        engine.step();
        ys.push(engine.state.elevators['e0'].y);
      }
      return ys;
    };
    expect(run()).toEqual(run());
  });
});

describe('隐藏通道解锁边界', () => {
  it('2 颗星星不解锁，第 3 颗解锁且只解锁一次', () => {
    const engine = new GameEngine();
    const unlockEffects: Effect[] = [];

    engine.queueEvent({ kind: 'star', index: 0 });
    engine.step();
    expect(engine.state.hiddenPathUnlocked).toBe(false);
    expect(engine.state.gateOpen).toBe(false);

    engine.queueEvent({ kind: 'star', index: 1 });
    engine.step();
    expect(engine.state.hiddenPathUnlocked).toBe(false);

    engine.queueEvent({ kind: 'star', index: 2 });
    unlockEffects.push(...engine.step());
    expect(engine.state.hiddenPathUnlocked).toBe(true);
    expect(engine.state.gateOpen).toBe(true);

    // 重复收集已解锁后的星星不再触发解锁
    engine.queueEvent({ kind: 'star', index: 2 });
    unlockEffects.push(...engine.step());
    expect(unlockEffects.filter((e) => e.type === 'unlockHiddenPath')).toHaveLength(1);
    expect(engine.state.score).toBe(300);
  });

  it('普通终点 +200，隐藏终点 +500，终点只结算一次', () => {
    const normal = new GameEngine();
    normal.queueEvent({ kind: 'goal', hiddenPath: false });
    normal.step();
    expect(normal.state.score).toBe(200);
    expect(normal.state.won).toBe(true);

    normal.queueEvent({ kind: 'goal', hiddenPath: false });
    normal.step();
    expect(normal.state.score).toBe(200); // 不重复加分

    const hidden = new GameEngine();
    hidden.queueEvent({ kind: 'goal', hiddenPath: true });
    hidden.step();
    expect(hidden.state.score).toBe(500);
  });
});

describe('生命下限与游戏结束', () => {
  it('生命最低为 0，归零后 gameOver 且不再扣血', () => {
    const engine = new GameEngine();
    const effects: Effect[] = [];
    for (let i = 0; i < 7; i++) {
      engine.queueEvent({ kind: 'fall' });
      effects.push(...engine.step());
    }

    expect(engine.state.lives).toBe(0);
    expect(engine.state.gameOver).toBe(true);
    expect(effects.filter((e) => e.type === 'damage')).toHaveLength(5);
    expect(effects.filter((e) => e.type === 'gameOver')).toHaveLength(1);
  });
});

describe('离线复算与实时运行一致', () => {
  const config = {
    fires: [{ id: 'f0', interval: 2 }],
    elevators: [{ id: 'e0', baseY: 0, minHeight: -1, maxHeight: 1.5, speed: 0.8 }],
  };
  const events: Array<{ time: number; event: GameEvent }> = [
    { time: 0.5, event: { kind: 'star', index: 0 } },
    { time: 1.0, event: { kind: 'star', index: 1 } },
    { time: 1.5, event: { kind: 'star', index: 2 } },
    { time: 2.1, event: { kind: 'fire', id: 'f0' } },
    { time: 2.1, event: { kind: 'hammer', id: 'h0', direction: [1, 1] } },
    { time: 3.0, event: { kind: 'surface', surface: 'ice' } },
    { time: 4.2, event: { kind: 'goal', hiddenPath: true } },
  ];
  const duration = 5;

  it('同一场景复算两次，快照序列完全一致', () => {
    const a = runScenario({ duration, config, events });
    const b = runScenario({ duration, config, events });
    expect(a.snapshots).toEqual(b.snapshots);
    expect(a.effects).toEqual(b.effects);
  });

  it('实时路径（queueEvent+step）与离线 runScenario 逐帧一致', () => {
    // 模拟 main.ts 的实时循环：每步前投递到期事件，然后 step
    const realtime = new GameEngine({ ...config, fixedDt: DT });
    const sorted = [...events].sort((x, y) => x.time - y.time);
    const steps = Math.round(duration / DT);
    let cursor = 0;
    const realtimeSnapshots = [];
    for (let k = 0; k < steps; k++) {
      const stepEndsAt = (k + 1) * DT;
      while (cursor < sorted.length && sorted[cursor].time <= stepEndsAt + 1e-9) {
        realtime.queueEvent(sorted[cursor].event);
        cursor++;
      }
      realtime.step();
      realtimeSnapshots.push(realtime.snapshot());
    }

    const offline = runScenario({ duration, config, events });
    expect(realtimeSnapshots).toEqual(offline.snapshots);
  });
});
