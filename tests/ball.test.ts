import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ball } from '../src/ball.js';

const speedAfter = (ball: Ball) => Math.hypot(ball.vx, ball.vy);

test('反弹 - 左墙：速度大小保持、位置归位且水平分量转向', () => {
  const ball = new Ball(8, 100, 8, () => 0.5);
  ball.vx = -ball.speed;
  ball.vy = 0;

  ball.update(400, 300);

  assert.equal(ball.x, ball.radius, '左墙反弹后 x 越界');
  assert.ok(ball.vx > 0, '左墙反弹后水平分量仍朝左');
  assert.ok(Math.abs(speedAfter(ball) - ball.speed) < 1e-12, '反弹后速度大小改变');
});

test('反弹 - 右墙：速度大小保持、位置归位且水平分量转向', () => {
  const ball = new Ball(392, 100, 8, () => 0.5);
  ball.vx = ball.speed;
  ball.vy = 0;

  ball.update(400, 300);

  assert.equal(ball.x, 400 - ball.radius, '右墙反弹后 x 越界');
  assert.ok(ball.vx < 0, '右墙反弹后水平分量仍朝右');
  assert.ok(Math.abs(speedAfter(ball) - ball.speed) < 1e-12, '反弹后速度大小改变');
});

test('反弹 - 顶墙：速度大小保持、位置归位且垂直分量转向', () => {
  const ball = new Ball(100, 8, 8, () => 0.5);
  ball.vx = 0;
  ball.vy = -ball.speed;

  ball.update(400, 300);

  assert.equal(ball.y, ball.radius, '顶墙反弹后 y 越界');
  assert.ok(ball.vy > 0, '顶墙反弹后垂直分量仍朝上');
  assert.ok(Math.abs(speedAfter(ball) - ball.speed) < 1e-12, '反弹后速度大小改变');
});

test('挡板碰撞 - 仅向下且真实接触时发生，边缘命中水平速度增大且不嵌入', () => {
  const paddleX = 100;
  const paddleY = 200;
  const ball = new Ball(paddleX + 98, paddleY - 7, 8, () => 0.5);
  ball.vx = 0;
  ball.vy = ball.speed;

  const hit = ball.checkPaddleCollision(paddleX, paddleY, 100, 15);
  const closestX = Math.max(paddleX, Math.min(ball.x, paddleX + 100));
  const closestY = Math.max(paddleY, Math.min(ball.y, paddleY + 15));

  assert.ok(hit, '向下且真实接触挡板时未触发碰撞');
  assert.ok(ball.vy < 0, '挡板碰撞后垂直分量未朝上');
  assert.ok(Math.abs(ball.vx) > 2.5, '靠近挡板两端时水平分量没有明显增大');
  assert.ok(
    Math.hypot(ball.x - closestX, ball.y - closestY) >= ball.radius - 1e-9,
    '挡板碰撞解算后球体仍嵌入挡板'
  );
});

test('挡板碰撞 - 向上运动即使重叠也不反弹', () => {
  const ball = new Ball(150, 205, 8, () => 0.5);
  ball.vx = 0;
  ball.vy = -ball.speed;

  assert.equal(ball.checkPaddleCollision(100, 200, 100, 15), false);
  assert.ok(ball.vy < 0, '向上穿过接触区域时错误反弹');
});

test('挡板碰撞 - 向下但未接触时不反弹', () => {
  const ball = new Ball(198, 180, 8, () => 0.5);
  ball.vx = 0;
  ball.vy = ball.speed;

  assert.equal(ball.checkPaddleCollision(100, 200, 100, 15), false);
  assert.equal(ball.y, 180, '未接触挡板时位置被错误修改');
});

test('挡板碰撞 - 挡板底面下方的侧向重叠不视为顶面击球', () => {
  const ball = new Ball(198, 220, 8, () => 0.5);
  ball.vx = 0;
  ball.vy = ball.speed;

  assert.equal(ball.checkPaddleCollision(100, 200, 100, 15), false);
  assert.ok(ball.vy > 0, '挡板底面下方的侧向重叠错误反弹');
});
