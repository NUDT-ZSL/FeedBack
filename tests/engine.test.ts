import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine.js';
import { Paddle } from '../src/paddle.js';
import { createSeededRandom } from '../src/rng.js';

test('主循环 - 固定种子时同一场景重复运行的状态一致', () => {
  const run = () => {
    const engine = new GameEngine(400, 300, createSeededRandom(2026));
    engine.initialize();
    engine.launchBall(-Math.PI / 3);
    for (let frame = 0; frame < 20; frame++) engine.update(16);
    return {
      status: engine.getStatus(),
      ball: engine.ball.getState(),
      bricks: engine.brickManager.getBricks()
    };
  };

  assert.deepEqual(run(), run(), '固定种子下主循环结果不可复现');
});

test('主循环 - 挡板碰撞在主循环内生效且不嵌入', () => {
  const engine = new GameEngine(400, 300, () => 0.5);
  engine.initialize();
  engine.launchBall(-Math.PI / 2);
  engine.ball.x = engine.paddle.x + engine.paddle.width - 2;
  engine.ball.y = engine.paddle.y - 7;
  engine.ball.vx = 0;
  engine.ball.vy = engine.ball.speed;

  engine.update(16);

  assert.ok(engine.ball.vy < 0, '主循环未处理向下球与挡板的碰撞');
  assert.ok(Math.abs(engine.ball.vx) > 2.5, '主循环边缘碰撞未增大水平分量');
  assert.ok(engine.ball.y <= engine.paddle.y + engine.paddle.height, '主循环碰撞后球体嵌入挡板');
});

test('主循环 - 球体坠落扣生命并复位，生命耗尽进入结束状态', () => {
  const engine = new GameEngine(400, 300, () => 0.5);
  engine.initialize();
  engine.launchBall(Math.PI / 2);
  engine.ball.y = 299;
  engine.ball.vx = 0;
  engine.ball.vy = 6;

  const first = engine.update(16);
  assert.ok(first.ballFell, '越过底边未报告坠落');
  assert.equal(engine.lives, 2, '坠落后生命未扣减');
  assert.equal(engine.ballLaunched, false, '坠落后球体未复位到待发射状态');

  engine.lives = 1;
  engine.launchBall(Math.PI / 2);
  engine.ball.y = 299;
  engine.ball.vx = 0;
  engine.ball.vy = 6;
  const final = engine.update(16);
  assert.ok(final.gameOver, '最后一条生命坠落未结束游戏');
  assert.equal(engine.isGameOver, true, '游戏结束状态未设置');
});

test('主循环 - 全部消除后进入下一关且进度重置', () => {
  const engine = new GameEngine(400, 300, () => 0.5);
  engine.initialize();
  const target = engine.brickManager.getBricks()[0];
  for (const brick of engine.brickManager.getBricks()) {
    if (brick !== target) brick.alive = false;
  }

  engine.launchBall(0);
  engine.ball.x = target.x - engine.ball.speed;
  engine.ball.y = target.y;
  const result = engine.update(16);

  assert.ok(result.brickHit, '最后一块砖未被主循环命中');
  assert.equal(result.comboChain, 1, '单块消除连锁计数错误');
  assert.ok(result.levelCompleted, '全部消除后未触发下一关');
  assert.equal(engine.level, 2, '全部消除后关卡未增加');
  assert.equal(engine.getProgress(), 0, '新关卡进度未重置为 0');
});

test('挡板惯性 - 拖拽释放反向回弹、逐帧阻尼且边界内', () => {
  const paddle = new Paddle(100, 200, 100, 15);
  paddle.setCanvasWidth(300);
  paddle.startDrag(150);
  paddle.dragTo(170);
  paddle.handleMouseUp();

  assert.equal(paddle.velocity, -6, '拖拽释放后的反向惯性错误');
  paddle.update();
  assert.ok(paddle.velocity > -6 && paddle.velocity < 0, '惯性未按阻尼衰减');
  assert.ok(paddle.x >= 0 && paddle.x + paddle.width <= 300, '惯性更新后挡板越界');
});
