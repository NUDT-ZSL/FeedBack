import { describe, it, expect, vi, afterEach } from 'vitest';
import { ParticleSystem } from '@/core/particleSystem';

describe('粒子系统：数量上限与对象池回收（保持现有约束）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('存活粒子总数不超过构造上限', () => {
    const max = 50;
    const system = new ParticleSystem(max);

    // 水滴立即生效、生命 3s；上限前发射后活跃数应被钳制
    for (let i = 0; i < 100; i++) system.emitWaterDrop(0, 0, 0);
    const stats = system.getStats();
    expect(stats.active).toBe(max);
    expect(stats.pooled).toBe(0);

    // 蒸汽按 30 颗/秒累积发射，一帧 0.1s 发射 3 颗且同样受总上限约束
    system.update(10); // 让上述水滴全部到期回收
    expect(system.getStats().active).toBe(0);
    expect(system.getStats().pooled).toBe(max);

    system.emitSteam(0, 0, 0); // 内部累加 30（按秒），一帧发射 30
    expect(system.getStats().active).toBe(30);
    // 到期对象被复用：池存量相应减少
    expect(system.getStats().pooled).toBe(max - 30);
  });

  it('打浆粒子硬上限 200，超额发射被丢弃且不挤占其它类型', () => {
    const system = new ParticleSystem(1000);
    for (let i = 0; i < 500; i++) system.emitPulp(0, 0, 0, '#ffffff');
    expect(system.getStats().pulpCount).toBe(200);
    expect(system.getStats().active).toBe(200);

    // 其它类型粒子仍可发射
    system.emitWaterDrop(0, 0, 0);
    expect(system.getStats().active).toBe(201);
  });

  it('生命到期后粒子归还对象池，类型计数同步回退', () => {
    const system = new ParticleSystem(100);
    system.emitPulp(0, 0, 0, '#fff');
    expect(system.getStats().pulpCount).toBe(1);

    system.update(5); // pulp 生命 2-4s，全部到期
    const stats = system.getStats();
    expect(stats.active).toBe(0);
    expect(stats.pooled).toBe(1);
    expect(stats.pulpCount).toBe(0);

    // 复用池中对象再次发射为 pulp，计数恢复正常
    system.emitPulp(0, 0, 0, '#fff');
    expect(system.getStats().pulpCount).toBe(1);
    expect(system.getStats().active).toBe(1);
  });

  it('update 按 deltaTime 推进位置与生命', () => {
    const system = new ParticleSystem(10);
    system.emitWaterDrop(0, 0, 0);
    const before = system.getParticles()[0];
    const lifeBefore = before.life;
    system.update(0.5);
    const after = system.getParticles()[0];
    expect(after.vy).toBe(100);
    expect(after.y).toBeCloseTo(50, 6);
    expect(after.life).toBeCloseTo(lifeBefore - 0.5, 6);
  });
});

describe('回归：资源释放（组件卸载场景）', () => {
  it('dispose 清空活跃粒子、对象池与 canvas 引用，之后的发射/更新为空操作', () => {
    const system = new ParticleSystem(100);
    const fakeCanvas = { id: 'fake-canvas' } as unknown as HTMLCanvasElement;
    system.attachCanvas(fakeCanvas);
    expect(system.getAttachedCanvas()).toBe(fakeCanvas);

    for (let i = 0; i < 50; i++) system.emitPulp(0, 0, 0, '#fff');
    system.emitSteam(0, 0, 0);
    system.emitWaterDrop(0, 0, 0);
    expect(system.getStats().active).toBeGreaterThan(0);

    system.dispose();
    expect(system.isDisposed).toBe(true);
    const stats = system.getStats();
    expect(stats.active).toBe(0);
    expect(stats.pooled).toBe(0);
    expect(stats.pulpCount).toBe(0);
    expect(system.getAttachedCanvas()).toBeNull();

    // 卸载后即便外部仍误调用帧循环/发射接口，也不会再产生对象或重新持有 canvas
    system.emitSteam(0, 0, 0);
    system.emitPulp(0, 0, 0, '#fff');
    system.emitWaterDrop(0, 0, 0);
    system.update(1);
    system.attachCanvas(fakeCanvas);
    expect(system.getStats().active).toBe(0);
    expect(system.getAttachedCanvas()).toBeNull();
  });

  it('detachCanvas 仅解绑画布，不影响粒子生命周期', () => {
    const system = new ParticleSystem(10);
    const fakeCanvas = {} as HTMLCanvasElement;
    system.attachCanvas(fakeCanvas);
    system.detachCanvas();
    expect(system.getAttachedCanvas()).toBeNull();

    system.emitWaterDrop(0, 0, 0);
    expect(system.getStats().active).toBe(1);
    system.update(5);
    expect(system.getStats().active).toBe(0);
    expect(system.isDisposed).toBe(false);
  });
});
