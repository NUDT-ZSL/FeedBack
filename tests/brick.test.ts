import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  areBricksAdjacent,
  Brick,
  BrickManager,
  PARTICLE_MAX_COUNT,
  Particle
} from '../src/brick.js';
import { createSeededRandom } from '../src/rng.js';

const layout = (random = createSeededRandom(123)) => {
  const manager = new BrickManager(400, 350, random);
  manager.generateHoneycombLayout();
  return manager;
};

test('布局 - 固定画布和种子时数量、行列错位与存活总数可复现', () => {
  const first = layout(createSeededRandom(123));
  const second = layout(createSeededRandom(123));
  const bricks = first.getBricks();

  assert.equal(bricks.length, 80, '蜂窝布局砖块数量不是 80');
  assert.equal(bricks.filter((brick) => brick.alive).length, 80, '初始存活总数错误');
  assert.deepEqual(second.getBricks(), bricks, '同一种子生成布局不可复现');

  const rowCounts = new Map<number, number>();
  for (const brick of bricks) rowCounts.set(brick.y, (rowCounts.get(brick.y) ?? 0) + 1);
  const rows = [...rowCounts.entries()].sort((a, b) => a[0] - b[0]);
  assert.deepEqual(rows.map(([, count]) => count), [16, 15, 16, 15, 16, 2], '行列数量不符合蜂窝规则');
  assert.equal(rows[0][1] > 0 && bricks.find((b) => b.y === rows[0][0])?.x, 22, '偶数行未从基准位置开始');
  assert.equal(bricks.find((b) => b.y === rows[1][0])?.x, 33, '奇数行未错开半个步距');
});

test('邻接 - 同行相邻、错行斜向相邻和跨行非相邻结果确定', () => {
  const origin: Brick = { x: 22, y: 60, radius: 10, color: '#fff', alive: true };
  assert.ok(areBricksAdjacent(origin, { x: 44, y: 60 }), '同行相邻未识别');
  assert.ok(areBricksAdjacent(origin, { x: 33, y: 82 }), '错行斜向相邻未识别');
  assert.equal(areBricksAdjacent(origin, { x: 22, y: 104 }), false, '跨行被误判为相邻');
});

test('连锁 - 命中中心砖后消除 7 块，计数与实际死亡数一致', () => {
  let colorCalls = 0;
  const manager = new BrickManager(400, 350, () => {
    if (colorCalls++ < 80) return 0;
    return 0.2;
  });
  manager.generateHoneycombLayout();
  const bricks = manager.getBricks();
  const center = bricks.find((brick) =>
    bricks.filter((candidate) => candidate !== brick && areBricksAdjacent(brick, candidate)).length === 6
  );
  if (!center) throw new Error('测试布局中找不到六邻接中心砖');

  const result = manager.checkCollision(center.x, center.y, 10);
  const dead = bricks.filter((brick) => !brick.alive).length;

  assert.ok(result.hit, '中心砖碰撞未命中');
  assert.equal(result.comboChain, 7, '连锁计数不符合中心砖加六邻接');
  assert.equal(dead, result.comboChain, '连锁计数与实际消除数量不一致');
  assert.ok(Math.abs(manager.getProgress() - 7 / 80) < 1e-12, '连锁后进度统计错误');
});

test('进度 - 全部消除为 1，空布局为 0', () => {
  const manager = layout();
  for (const brick of manager.getBricks()) brick.alive = false;
  assert.equal(manager.getProgress(), 1, '全部消除后进度不是 1');

  manager.clear();
  assert.equal(manager.getProgress(), 0, '空布局进度不是 0');
});

test('粒子 - 超出上限时淘汰旧粒子，寿命耗尽后从绘制列表移除', () => {
  const manager = new BrickManager(400, 350, () => 0.5);
  const oldParticles: Particle[] = Array.from({ length: 150 }, (_, index) => ({
    x: index,
    y: 0,
    vx: 0,
    vy: 0,
    color: '#old',
    alpha: 1,
    life: 500,
    maxLife: 500
  }));
  const newParticles: Particle[] = Array.from({ length: 100 }, (_, index) => ({
    x: index,
    y: 1,
    vx: 0,
    vy: 0,
    color: '#new',
    alpha: 1,
    life: 500,
    maxLife: 500
  }));

  manager.addParticles(oldParticles);
  manager.addParticles(newParticles);
  const particles = manager.getParticles();

  assert.equal(particles.length, PARTICLE_MAX_COUNT, '粒子数量超过上限');
  assert.equal(particles[0], oldParticles[50], '旧粒子淘汰顺序错误');
  assert.equal(particles[PARTICLE_MAX_COUNT - 1], newParticles[99], '新粒子未保留');

  manager.updateParticles(500);
  assert.equal(manager.getParticles().length, 0, '寿命耗尽的粒子仍参与绘制');
});
