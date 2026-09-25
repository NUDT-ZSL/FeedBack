import { Paddle } from '../paddle';
import { assert, closeTo, equal, test } from './harness';

const rect = { left: 0, width: 400 } as unknown as DOMRect;

test('挡板：鼠标拖拽松手后按固定阻尼和回弹系数惯性移动', () => {
  const paddle = new Paddle(100, 500, 100, 15);
  paddle.setCanvasWidth(400);

  paddle.handleMouseDown(100, rect);
  assert(paddle.isDragging, '按在挡板上时必须进入拖拽状态');

  paddle.handleMouseMove(140, rect);
  equal(paddle.x, 140, '拖拽过程中挡板应随指针移动');

  paddle.handleMouseUp();
  assert(!paddle.isDragging, '松手后必须退出拖拽状态');
  closeTo(paddle.velocity, -12, 1e-12, '松手瞬间应产生与拖拽方向相反的回弹初速度');

  paddle.update();
  closeTo(paddle.x, 129.8, 1e-12, '第一次惯性更新应使用 0.85 阻尼');

  paddle.update();
  closeTo(paddle.x, 121.13, 1e-12, '第二次惯性更新应继续衰减');
  assert(paddle.x < 140, '松手后挡板应向拖拽反方向回弹');
});

test('挡板：拖拽到右边界时位置和后续惯性都受画布宽度约束', () => {
  const paddle = new Paddle(100, 500, 100, 15);
  paddle.setCanvasWidth(400);

  paddle.handleMouseDown(100, rect);
  paddle.handleMouseMove(350, rect);
  equal(paddle.x, 300, '挡板右侧不能越过画布');

  paddle.handleMouseUp();
  paddle.update();
  assert(paddle.x > 200 && paddle.x < 300, '边界回弹时必须留在画布内');
});

test('挡板：触摸拖拽使用同一套惯性状态，无需浏览器渲染', () => {
  const paddle = new Paddle(100, 500, 100, 15);
  paddle.setCanvasWidth(400);
  const touch = { clientX: 100 } as Touch;

  paddle.handleTouchStart(touch, rect);
  paddle.handleTouchMove({ clientX: 140 } as Touch, rect);
  paddle.handleTouchEnd();
  paddle.update();

  closeTo(paddle.x, 129.8, 1e-12, '触摸拖拽松手后的惯性结果必须确定');
});
