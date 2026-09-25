import { Ball } from '../ball';
import { assert, closeTo, equal, greaterThan, lessThanOrEqual, test } from './harness';

test('反弹：左墙反弹保持速度、位置在界内且水平分量转正', () => {
  const ball = new Ball(11, 100, 8, () => 0);
  ball.speed = 6;
  ball.vx = -5.4;
  ball.vy = 2.6;

  ball.update(800, 600);

  equal(ball.x, 8, '左墙反弹后 x 必须被夹回边界');
  assert(ball.vx > 0, '左墙反弹后水平速度必须向右');
  assert(ball.vy > 0, '左墙反弹不应改变垂直分量所在的半区');
  closeTo(Math.hypot(ball.vx, ball.vy), 6, 1e-12, '左墙反弹后速度大小必须保持不变');
});

test('反弹：右墙反弹保持速度、位置在界内且水平分量转负', () => {
  const ball = new Ball(789, 100, 8, () => 1);
  ball.speed = 6;
  ball.vx = 5.4;
  ball.vy = 2.6;

  ball.update(800, 600);

  equal(ball.x, 792, '右墙反弹后 x 必须被夹回边界');
  assert(ball.vx < 0, '右墙反弹后水平速度必须向左');
  assert(ball.vy > 0, '右墙反弹不应改变垂直分量所在的半区');
  closeTo(Math.hypot(ball.vx, ball.vy), 6, 1e-12, '右墙反弹后速度大小必须保持不变');
});

test('反弹：顶部反弹保持速度、位置在界内且垂直分量转正', () => {
  const ball = new Ball(100, 10.5, 8, () => 1);
  ball.speed = 6;
  ball.vx = 5.4;
  ball.vy = -2.6;

  ball.update(800, 600);

  equal(ball.y, 8, '顶部反弹后 y 必须被夹回边界');
  assert(ball.vy > 0, '顶部反弹后垂直速度必须向下');
  closeTo(Math.hypot(ball.vx, ball.vy), 6, 1e-12, '顶部反弹后速度大小必须保持不变');
});

test('碰撞：挡板仅在小球向下且真实接触时响应', () => {
  const separated = new Ball(150, 480, 8, () => 0.5);
  separated.speed = 6;
  separated.vx = 0;
  separated.vy = 6;
  assert(!separated.checkPaddleCollision(100, 500, 100, 15), '未接触挡板时不能碰撞');

  const movingUp = new Ball(150, 496, 8, () => 0.5);
  movingUp.speed = 6;
  movingUp.vx = 0;
  movingUp.vy = -6;
  assert(!movingUp.checkPaddleCollision(100, 500, 100, 15), '向上运动时不能与挡板碰撞');
});

test('碰撞：挡板命中后向上离开且不会嵌入挡板', () => {
  const ball = new Ball(150, 496, 8, () => 0.5);
  ball.speed = 6;
  ball.vx = 0;
  ball.vy = 6;

  const collided = ball.checkPaddleCollision(100, 500, 100, 15);

  assert(collided, '小球向下接触挡板时必须发生碰撞');
  assert(ball.vy < 0, '挡板碰撞后垂直速度必须向上');
  lessThanOrEqual(ball.y + ball.radius, 500, '挡板碰撞后球体不能进入挡板');
  closeTo(Math.hypot(ball.vx, ball.vy), 6, 1e-12, '挡板反弹后速度大小必须保持不变');
});

test('碰撞：靠近挡板两端时水平速度显著大于中心命中', () => {
  const center = new Ball(150, 496, 8, () => 0.5);
  center.speed = 6;
  center.vy = 6;
  center.checkPaddleCollision(100, 500, 100, 15);

  const leftEdge = new Ball(102, 496, 8, () => 0.5);
  leftEdge.speed = 6;
  leftEdge.vy = 6;
  leftEdge.checkPaddleCollision(100, 500, 100, 15);

  const rightEdge = new Ball(198, 496, 8, () => 0.5);
  rightEdge.speed = 6;
  rightEdge.vy = 6;
  rightEdge.checkPaddleCollision(100, 500, 100, 15);

  greaterThan(Math.abs(leftEdge.vx), Math.abs(center.vx) + 2.5, '左端命中应明显增大水平速度');
  greaterThan(Math.abs(rightEdge.vx), Math.abs(center.vx) + 2.5, '右端命中应明显增大水平速度');
  assert(leftEdge.vx < 0 && rightEdge.vx > 0, '两端命中的水平方向必须分别朝外');
});
