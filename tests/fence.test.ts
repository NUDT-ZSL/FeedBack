import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ball, fence, runSteps, distToFence, PHYSICS } from './helpers.ts';
import { mulberry32 } from '../src/rng.ts';

const HOLE_FAR = { x: -10000, y: -10000 };

function stepAndAssertNoPenetration(ball: Ball, fences: ReturnType<typeof fence>[], steps: number): void {
  const rng = mulberry32(1);
  for (let i = 0; i < steps; i++) {
    ball.stepFixed([], fences, HOLE_FAR, 18, rng);
    for (const f of fences) {
      const d = distToFence(f, ball.position);
      assert.ok(
        d >= ball.radius - 1e-6,
        `第 ${i} 帧球心穿透围栏：距离 ${d} 小于半径 ${ball.radius}`
      );
    }
    assert.ok(Number.isFinite(ball.position.x) && Number.isFinite(ball.position.y), '位置必须有限');
    assert.ok(Number.isFinite(ball.velocity.x) && Number.isFinite(ball.velocity.y), '速度必须有限');
  }
}

test('围栏碰撞：球心落在线段端点外侧时按端点圆形碰撞且不被穿透', () => {
  const f = fence(0, 0, 200, 0, { x: 0, y: -1 });
  const ball = new Ball(240, 6);
  ball.applyForce({ x: -1, y: 0 }, 8);

  stepAndAssertNoPenetration(ball, [f], 120);

  const distToEndpoint = Math.hypot(ball.position.x - 200, ball.position.y - 0);
  assert.ok(distToEndpoint >= ball.radius - 1e-6, '球不得卡在端点内');
  assert.ok(ball.velocity.x > 0, `撞击端点后应被弹回（vx>0），实际 vx=${ball.velocity.x}`);
});

test('围栏碰撞：恰好相切滚动时不损失切向速度、不产生法向速度', () => {
  const f = fence(0, 0, 400, 0, { x: 0, y: 1 });
  const ball = new Ball(50, 10);
  ball.applyForce({ x: 1, y: 0 }, 5);

  const rng = mulberry32(1);
  let prevVx = ball.velocity.x;
  for (let i = 0; i < 60; i++) {
    ball.stepFixed([], [f], HOLE_FAR, 18, rng);
    assert.ok(Math.abs(ball.velocity.y) < 1e-9, `相切时不应产生法向速度，第 ${i} 帧 vy=${ball.velocity.y}`);
    const ratio = ball.velocity.x / prevVx;
    assert.ok(
      Math.abs(ratio - PHYSICS.GRASS_FRICTION) < 1e-9,
      `相切时切向速度只受摩擦衰减，第 ${i} 帧衰减比 ${ratio}`
    );
    prevVx = ball.velocity.x;
  }
});

test('围栏碰撞：高速球一帧内穿越围栏被拦截（不穿模）', () => {
  const f = fence(0, 0, 400, 0, { x: 0, y: -1 });
  const speeds = [10, 60, 300];
  for (const speed of speeds) {
    const ball = new Ball(200, -40);
    ball.applyForce({ x: 0, y: 1 }, speed);
    stepAndAssertNoPenetration(ball, [f], 200);
    assert.ok(
      ball.position.y < 0,
      `速度 ${speed} 的球不得穿过围栏到另一侧，实际 y=${ball.position.y}`
    );
  }
});

test('围栏碰撞：反弹方向与衰减稳定（法向反射 + 0.7 恢复系数）', () => {
  const f = fence(0, 0, 400, 0, { x: 0, y: -1 });
  const ball = new Ball(200, -30);
  ball.applyForce({ x: 0.3, y: 1 }, 10);

  const rng = mulberry32(1);
  let preVy: number | null = null;
  let preVx: number | null = null;
  let bounced = false;
  for (let i = 0; i < 200 && !bounced; i++) {
    preVx = ball.velocity.x;
    preVy = ball.velocity.y;
    ball.stepFixed([], [f], HOLE_FAR, 18, rng);
    if (ball.velocity.y < 0 && preVy! > 0) {
      bounced = true;
      const expectedVy = -preVy! * PHYSICS.RESTITUTION * PHYSICS.GRASS_FRICTION;
      assert.ok(
        Math.abs(ball.velocity.y - expectedVy) < 1e-9,
        `反弹后法向速度应为入射的 -0.7 倍（含摩擦），期望 ${expectedVy}，实际 ${ball.velocity.y}`
      );
      const expectedVx = preVx! * PHYSICS.GRASS_FRICTION;
      assert.ok(
        Math.abs(ball.velocity.x - expectedVx) < 1e-9,
        `切向速度不应受碰撞影响，期望 ${expectedVx}，实际 ${ball.velocity.x}`
      );
    }
  }
  assert.ok(bounced, '球应与围栏发生碰撞');
});

test('围栏碰撞：射入角落的球不会卡在围栏内，最终静止在合法位置', () => {
  const f1 = fence(300, 0, 300, 300, { x: -1, y: 0 });
  const f2 = fence(0, 300, 300, 300, { x: 0, y: -1 });
  const ball = new Ball(100, 100);
  ball.applyForce({ x: 0.8, y: 0.6 }, 12);

  stepAndAssertNoPenetration(ball, [f1, f2], 800);
  assert.equal(ball.isMoving, false, '球最终应静止');
  assert.ok(ball.position.x < 300 - ball.radius + 1e-6, '静止位置不得嵌入竖直围栏');
  assert.ok(ball.position.y < 300 - ball.radius + 1e-6, '静止位置不得嵌入水平围栏');
});

test('围栏碰撞：同一场景重复运行结果逐帧一致', () => {
  const f = fence(0, 0, 400, 0, { x: 0, y: -1 });
  const run = () => {
    const ball = new Ball(150, -60);
    ball.applyForce({ x: 0.5, y: 1 }, 14);
    const rng = mulberry32(5);
    const frames: { x: number; y: number; vx: number; vy: number }[] = [];
    for (let i = 0; i < 200; i++) {
      ball.stepFixed([], [f], HOLE_FAR, 18, rng);
      frames.push({ x: ball.position.x, y: ball.position.y, vx: ball.velocity.x, vy: ball.velocity.y });
    }
    return frames;
  };
  assert.deepEqual(run(), run(), '围栏碰撞场景重复运行必须逐帧一致');
});
