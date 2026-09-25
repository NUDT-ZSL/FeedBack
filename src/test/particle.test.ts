import { Particle, BrickManager } from '../brick';
import { assert, equal, lessThanOrEqual, test } from './harness';

function makeParticle(id: number): Particle {
  return {
    x: id,
    y: 0,
    vx: 0,
    vy: 0,
    color: '#ffffff',
    alpha: 1,
    life: 500,
    maxLife: 500
  };
}

class CountingContext {
  arcCalls = 0;
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  arc(): void {
    this.arcCalls++;
  }
  fill(): void {}
}

test('粒子：数量超过上限时保留最新 200 个并淘汰旧粒子', () => {
  const manager = new BrickManager(800, 600);
  const add = (manager as unknown as { addParticles: (particles: Particle[]) => void }).addParticles;

  add.call(manager, Array.from({ length: 150 }, (_, index) => makeParticle(index)));
  add.call(manager, Array.from({ length: 100 }, (_, index) => makeParticle(1000 + index)));

  const particles = manager.getParticles();
  lessThanOrEqual(particles.length, 200, '粒子总数不能超过上限');
  equal(particles.length, 200, '超出上限后应正好保留 200 个粒子');
  equal(particles[0].x, 50, '最早的 50 个旧粒子必须被淘汰');
  equal(particles[particles.length - 1].x, 1099, '新粒子必须全部保留');
});

test('粒子：寿命耗尽后删除且不再参与绘制', () => {
  const manager = new BrickManager(800, 600);
  const add = (manager as unknown as { addParticles: (particles: Particle[]) => void }).addParticles;
  const particle = makeParticle(7);
  add.call(manager, [particle]);

  manager.updateParticles(499);
  equal(manager.getParticles().length, 1, '寿命未耗尽时粒子仍应存活');
  equal(particle.alpha > 0, true, '存活粒子应保留可见 alpha');

  manager.updateParticles(2);
  equal(manager.getParticles().length, 0, '寿命耗尽后粒子必须从更新集合删除');

  const ctx = new CountingContext();
  manager.drawParticles(ctx as unknown as CanvasRenderingContext2D);
  equal(ctx.arcCalls, 0, '寿命耗尽的粒子不能再参与绘制');
});

test('粒子：固定随机源生成的粒子数量、位置、速度和寿命可复现', () => {
  const first = new BrickManager(800, 600, () => 0);
  const second = new BrickManager(800, 600, () => 0);
  const addFirst = (first as unknown as { createParticles: (x: number, y: number, color: string) => Particle[] }).createParticles;
  const addSecond = (second as unknown as { createParticles: (x: number, y: number, color: string) => Particle[] }).createParticles;

  const firstParticles = addFirst.call(first, 30, 40, '#ff4757');
  const secondParticles = addSecond.call(second, 30, 40, '#ff4757');

  equal(firstParticles.length, 5, '替代随机源固定为 0 时应生成 5 个粒子');
  equal(JSON.stringify(firstParticles), JSON.stringify(secondParticles), '相同随机序列必须生成相同粒子状态');
  assert(firstParticles.every((particle) => particle.life === 500 && particle.maxLife === 500), '粒子寿命必须固定为 500ms');
});
