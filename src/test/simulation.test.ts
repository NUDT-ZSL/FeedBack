import { Ball } from '../ball';
import { Brick, BrickManager } from '../brick';
import { Paddle } from '../paddle';
import { createSeededRandom } from '../random';
import { GameWorld, stepGameWorld } from '../simulation';
import { assert, equal, test } from './harness';

function oneBrickWorld(seed: number): GameWorld {
  const manager = new BrickManager(800, 600, () => 0);
  const brick: Brick = { x: 100, y: 100, radius: 10, color: '#ff4757', alive: true };
  (manager as unknown as { bricks: Brick[] }).bricks = [brick];
  (manager as unknown as { totalBricks: number }).totalBricks = 1;

  const ball = new Ball(100, 110, 10, createSeededRandom(seed + 1));
  ball.speed = 6;
  ball.vx = 0;
  ball.vy = 6;

  return {
    ball,
    bricks: manager,
    paddle: new Paddle(100, 500, 100, 15),
    canvasWidth: 800,
    canvasHeight: 600
  };
}

test('主循环：单帧串联球体运动、砖块消除、连锁计数、进度和粒子更新', () => {
  const world = oneBrickWorld(99);
  const result = stepGameWorld(world, 16);

  assert(result.brickHit, '主循环必须把球体位置传入砖块碰撞检测');
  equal(result.comboChain, 1, '单砖场景连锁计数应为 1');
  equal(result.particlesCreated, 5, '固定随机源应为主砖创建 5 个粒子');
  equal(result.progress, 1, '主循环返回的进度必须在消除后为 1');
  assert(world.ball.vy < 0, '砖块碰撞后球体必须在同一帧反弹');
  assert(world.bricks.getParticles().every((particle) => particle.life === 484), '主循环必须推进粒子寿命');
});

test('主循环：单帧中挡板碰撞先于砖块检测，小球不会继续嵌入挡板', () => {
  const random = createSeededRandom(7);
  const ball = new Ball(150, 496, 8, random);
  ball.speed = 6;
  ball.vx = 0;
  ball.vy = 6;
  const world: GameWorld = {
    ball,
    bricks: new BrickManager(800, 600, random),
    paddle: new Paddle(100, 500, 100, 15),
    canvasWidth: 800,
    canvasHeight: 600
  };

  const result = stepGameWorld(world, 16);

  assert(!result.brickHit, '空布局不应报告砖块命中');
  assert(world.ball.vy < 0, '主循环中的挡板碰撞必须让小球反弹');
  assert(world.ball.y + world.ball.radius <= world.paddle.y, '主循环后球体不能嵌入挡板');
});

test('主循环：相同种子与相同场景的跨模块结果完全一致', () => {
  const first = oneBrickWorld(321);
  const second = oneBrickWorld(321);

  const firstResult = stepGameWorld(first, 16);
  const secondResult = stepGameWorld(second, 16);

  equal(JSON.stringify(firstResult), JSON.stringify(secondResult), '帧结果必须可复现');
  equal(JSON.stringify(first.ball.getState()), JSON.stringify(second.ball.getState()), '球体状态必须可复现');
  equal(
    JSON.stringify(first.bricks.getParticles()),
    JSON.stringify(second.bricks.getParticles()),
    '粒子状态必须可复现'
  );
});

test('主循环：小球越过底部时明确报告落底且不执行碰撞更新', () => {
  const ball = new Ball(100, 599, 8, createSeededRandom(1));
  ball.speed = 6;
  ball.vx = 0;
  ball.vy = 6;
  const world: GameWorld = {
    ball,
    bricks: new BrickManager(800, 600),
    paddle: new Paddle(100, 500, 100, 15),
    canvasWidth: 800,
    canvasHeight: 600
  };

  const result = stepGameWorld(world, 16);

  assert(result.ballFell, '球体越过底部必须返回落底信号');
  assert(!result.brickHit, '落底帧不应继续进行砖块碰撞');
});
