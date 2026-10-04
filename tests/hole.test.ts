import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ball, runSteps } from './helpers.ts';
import { GameSession } from '../src/session.ts';

const HOLE = { x: 500, y: 300 };
const HOLE_R = 18;

test('进洞：高速（≥8）掠过洞口边缘（半径一半以外）不进洞', () => {
  const ball = new Ball(400, HOLE.y - 12);
  ball.applyForce({ x: 1, y: 0 }, 12);
  runSteps(ball, 60, { hole: HOLE, holeRadius: HOLE_R });
  assert.equal(ball.isInHole, false, '高速掠过洞口边缘不应进洞');
  assert.ok(ball.position.x > HOLE.x + 50, '球应越过洞口继续滚动');
});

test('进洞：高速球穿过洞口中心（半径一半以内）仍被捕获', () => {
  const ball = new Ball(400, HOLE.y);
  ball.applyForce({ x: 1, y: 0 }, 12);
  runSteps(ball, 60, { hole: HOLE, holeRadius: HOLE_R });
  assert.equal(ball.isInHole, true, '穿过洞口中心区域（<r/2）即使高速也应进洞');
  assert.deepEqual(ball.velocity, { x: 0, y: 0 });
  assert.equal(ball.isMoving, false);
});

test('进洞：低速（<8）进入洞口范围即被捕获', () => {
  const ball = new Ball(400, HOLE.y - 12);
  ball.applyForce({ x: 1, y: 0 }, 5);
  runSteps(ball, 120, { hole: HOLE, holeRadius: HOLE_R });
  assert.equal(ball.isInHole, true, '低速进入洞口范围应进洞');
});

test('进洞：低速停在洞口边缘（距离≥半径）不进洞', () => {
  const ball = new Ball(HOLE.x, HOLE.y + 19);
  ball.applyForce({ x: 1, y: 0 }, 0.2);
  runSteps(ball, 300, { hole: HOLE, holeRadius: HOLE_R });
  assert.equal(ball.isInHole, false, '停在洞口边缘之外不应进洞');
  assert.equal(ball.isMoving, false, '球应静止');
});

test('进洞：停在洞口范围以内（距离<半径）判进洞', () => {
  const ball = new Ball(HOLE.x, HOLE.y + 15);
  ball.velocity = { x: 0.05, y: 0 };
  ball.isMoving = true;
  runSteps(ball, 100, { hole: HOLE, holeRadius: HOLE_R });
  assert.equal(ball.isInHole, true, '静止在洞口范围内应判进洞');
});

test('进洞：结论不受帧率影响（同一杆在不同帧率下结果一致）', () => {
  const runWithDt = (dt: number, frames: number) => {
    const session = new GameSession({ width: 1280, height: 720, seed: 99 });
    const hole = session.course.holePosition;
    session.ball.reset(hole.x - 60, hole.y);
    const struck = session.strike({ x: 1, y: 0 }, 4);
    assert.ok(struck);
    for (let i = 0; i < frames; i++) session.update(dt);
    return session;
  };

  const a = runWithDt(1 / 60, 240);
  const b = runWithDt(1 / 30, 120);
  const c = runWithDt(1 / 120, 480);

  assert.equal(a.state, 'win', '60fps 下应进洞');
  assert.equal(b.state, 'win', '30fps 下应进洞');
  assert.equal(c.state, 'win', '120fps 下应进洞');
  assert.deepEqual(b.ball.position, a.ball.position, '30fps 与 60fps 最终位置必须一致');
  assert.deepEqual(c.ball.position, a.ball.position, '120fps 与 60fps 最终位置必须一致');
});

test('进洞：同一杆重复运行进洞结论一致', () => {
  const run = () => {
    const session = new GameSession({ width: 1280, height: 720, seed: 7 });
    const hole = session.course.holePosition;
    session.ball.reset(hole.x - 100, hole.y - 5);
    session.strike({ x: 1, y: 0.05 }, 6);
    for (let i = 0; i < 600; i++) session.update(1 / 60);
    return { state: session.state, pos: { ...session.ball.position } };
  };
  assert.deepEqual(run(), run(), '同一输入重复运行进洞结论与位置必须一致');
});
