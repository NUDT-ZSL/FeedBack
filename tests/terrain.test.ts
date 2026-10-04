import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ball, runSteps, runUntilStopped, zone, snapshot } from './helpers.ts';
import { selectTerrain } from '../src/ball.ts';
import { mulberry32 } from '../src/rng.ts';

function speedAfterSteps(zones: ReturnType<typeof zone>[], steps: number, rngSeed = 1): number {
  const ball = new Ball(500, 500);
  ball.applyForce({ x: 1, y: 0 }, 5);
  runSteps(ball, steps, { zones, rngSeed });
  return Math.hypot(ball.velocity.x, ball.velocity.y);
}

test('地形减速：沙地 > 上坡 > 草地 > 下坡（同初速度同帧数比较）', () => {
  const grass = speedAfterSteps([], 60);
  const sand = speedAfterSteps([zone('sand', 500, 500, 200)], 60);
  const uphill = speedAfterSteps(
    [zone('uphill', 500, 500, 200, { slopeAngle: 0.3, slopeDirection: { x: 1, y: 0 } })],
    60
  );
  const downhill = speedAfterSteps(
    [zone('downhill', 500, 500, 200, { slopeAngle: 0.3, slopeDirection: { x: 1, y: 0 } })],
    60
  );

  assert.ok(sand < grass, `沙地剩余速度 ${sand} 应小于草地 ${grass}`);
  assert.ok(uphill < grass, `上坡剩余速度 ${uphill} 应小于草地 ${grass}`);
  assert.ok(downhill > grass, `下坡剩余速度 ${downhill} 应大于草地 ${grass}`);
});

test('上坡推力逆坡向：球逆坡滚动会减速直至回滚', () => {
  const ball = new Ball(500, 500);
  ball.applyForce({ x: 1, y: 0 }, 5);
  const zones = [zone('uphill', 500, 500, 2000, { slopeAngle: 0.4, slopeDirection: { x: 1, y: 0 } })];
  const noDeviation = () => 0.5;
  for (let i = 0; i < 120; i++) {
    ball.stepFixed(zones, [], { x: 0, y: 0 }, 18, noDeviation);
  }
  assert.ok(ball.velocity.x < 0, `上坡推力应使球回滚，实际 vx=${ball.velocity.x}`);
});

test('下坡推力顺坡向：静止附近的球会被坡拉动', () => {
  const ball = new Ball(500, 500);
  ball.applyForce({ x: 1, y: 0 }, 0.5);
  const zones = [zone('downhill', 500, 500, 2000, { slopeAngle: 0.4, slopeDirection: { x: 0, y: 1 } })];
  const noDeviation = () => 0.5;
  for (let i = 0; i < 200; i++) {
    ball.stepFixed(zones, [], { x: 0, y: 0 }, 18, noDeviation);
  }
  assert.ok(ball.velocity.y > 0.5, `下坡应沿坡向加速，实际 vy=${ball.velocity.y}`);
});

test('坡度方向扰动：相同种子轨迹逐帧一致，不同种子轨迹不同', () => {
  const makeBall = () => {
    const b = new Ball(500, 500);
    b.applyForce({ x: 0, y: 1 }, 6);
    return b;
  };
  const zones = [zone('downhill', 500, 500, 500, { slopeAngle: 0.4, slopeDirection: { x: 1, y: 0 } })];

  const run = (seed: number) => {
    const ball = makeBall();
    const rng = mulberry32(seed);
    const frames: { x: number; y: number }[] = [];
    for (let i = 0; i < 120; i++) {
      ball.stepFixed(zones, [], { x: 0, y: 0 }, 18, rng);
      frames.push({ x: ball.position.x, y: ball.position.y });
    }
    return frames;
  };

  const a1 = run(42);
  const a2 = run(42);
  const b = run(43);

  assert.deepEqual(a1, a2, '同一种子两次运行每一帧位置必须完全一致');
  assert.notDeepEqual(a1, b, '不同种子在坡地扰动下轨迹应不同');
});

test('完整场景确定性：同一输入重复运行最终静止位置逐帧一致', () => {
  const zones = [
    zone('sand', 600, 400, 90),
    zone('uphill', 400, 300, 80, { slopeAngle: 0.35, slopeDirection: { x: 0.6, y: 0.8 } }),
    zone('downhill', 700, 250, 70, { slopeAngle: 0.3, slopeDirection: { x: -0.7, y: 0.7 } }),
  ];
  const run = () => {
    const ball = new Ball(200, 350);
    ball.applyForce({ x: 0.9, y: -0.2 }, 9);
    const frames: ReturnType<typeof snapshot>[] = [];
    const rng = mulberry32(7);
    while (ball.isMoving && !ball.isInHole && frames.length < 5000) {
      ball.stepFixed(zones, [], { x: 1000, y: 100 }, 18, rng);
      frames.push(snapshot(ball));
    }
    return frames;
  };

  const first = run();
  const second = run();
  assert.ok(first.length > 10, '轨迹应包含多帧');
  assert.deepEqual(first, second, '同一输入重复运行必须逐帧一致');
});

test('地形重叠：受力归属与区域数组顺序无关（沙地优先于坡地）', () => {
  const sand = zone('sand', 500, 500, 100);
  const uphill = zone('uphill', 520, 500, 100, { slopeAngle: 0.4, slopeDirection: { x: 1, y: 0 } });
  const downhill = zone('downhill', 480, 500, 100, { slopeAngle: 0.4, slopeDirection: { x: 1, y: 0 } });

  const p = { x: 500, y: 500 };
  assert.equal(selectTerrain([uphill, sand], p).type, 'sand');
  assert.equal(selectTerrain([sand, uphill], p).type, 'sand');
  assert.equal(selectTerrain([downhill, uphill], p).type, 'uphill');
  assert.equal(selectTerrain([uphill, downhill], p).type, 'uphill');

  const runWithOrder = (zones: ReturnType<typeof zone>[]) => {
    const ball = new Ball(500, 500);
    ball.applyForce({ x: 1, y: 0 }, 5);
    runSteps(ball, 30, { zones, rngSeed: 9 });
    return snapshot(ball);
  };
  assert.deepEqual(runWithOrder([uphill, sand]), runWithOrder([sand, uphill]),
    '沙地与上坡重叠时，数组顺序不得影响物理结果');
  assert.deepEqual(runWithOrder([downhill, uphill]), runWithOrder([uphill, downhill]),
    '上坡与下坡重叠时，数组顺序不得影响物理结果');
});

test('球最终能静止：速度低于阈值后停止且速度清零', () => {
  const ball = new Ball(500, 500);
  ball.applyForce({ x: 1, y: 0 }, 3);
  const steps = runUntilStopped(ball, { hole: { x: -1000, y: -1000 } });
  assert.ok(steps > 0, '球应滚动若干步');
  assert.equal(ball.isMoving, false);
  assert.deepEqual(ball.velocity, { x: 0, y: 0 });
});
