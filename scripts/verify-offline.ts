import {
  applyParams,
  createBuffers,
  generateBaseData,
  MAX_PARTICLES,
  type ParticleBuffers
} from '../src/particles.ts';
import { copyParams, paramsEqual, type NebulaParams } from '../src/params.ts';
import { createUpdateScheduler } from '../src/scheduler.ts';
import { advanceAnimation, createAnimationState } from '../src/animation.ts';

const BASE_PARAMS: NebulaParams = {
  particleCount: 5000,
  hueOffset: 0,
  radius: 12,
  rotationSpeed: 0.5
};

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function buffersEqual(a: ParticleBuffers, b: ParticleBuffers): boolean {
  if (a.drawRange !== b.drawRange) return false;
  const arrays: [Float32Array, Float32Array][] = [
    [a.positions, b.positions],
    [a.colors, b.colors],
    [a.alphas, b.alphas],
    [a.sizes, b.sizes],
    [a.phases, b.phases]
  ];
  return arrays.every(([x, y]) => {
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) return false;
    }
    return true;
  });
}

function runSequence(
  baseData: ReturnType<typeof generateBaseData>,
  steps: Partial<NebulaParams>[]
): ParticleBuffers {
  const buffers = createBuffers(baseData);
  let current = copyParams(BASE_PARAMS);
  applyParams(buffers, baseData, { ...BASE_PARAMS, particleCount: 0 }, current);
  for (const step of steps) {
    const next = { ...current, ...step };
    applyParams(buffers, baseData, current, next);
    current = next;
  }
  return buffers;
}

console.log('\n[1] 参数顺序无关性：同一组参数不同调整顺序，最终缓冲完全一致');
{
  const baseData = generateBaseData(MAX_PARTICLES);
  const target: NebulaParams = {
    particleCount: 8000,
    hueOffset: 180,
    radius: 20,
    rotationSpeed: 1.5
  };

  const seqA = runSequence(baseData, [
    { radius: 20 },
    { hueOffset: 180 },
    { particleCount: 8000 },
    { rotationSpeed: 1.5 }
  ]);
  const seqB = runSequence(baseData, [
    { rotationSpeed: 1.5 },
    { particleCount: 8000 },
    { hueOffset: 180 },
    { radius: 20 }
  ]);
  const seqC = runSequence(baseData, [
    { radius: 15, hueOffset: 90 },
    { radius: 20, hueOffset: 180, particleCount: 8000, rotationSpeed: 1.5 }
  ]);
  const oneShot = runSequence(baseData, [target]);

  check('顺序 A vs 顺序 B', buffersEqual(seqA, seqB));
  check('顺序 A vs 中间态顺序 C', buffersEqual(seqA, seqC));
  check('分步调整 vs 一次性应用', buffersEqual(seqA, oneShot));
  check('最终 drawRange 正确', seqA.drawRange === target.particleCount);
}

console.log('\n[2] 增量更新隔离：单参数变化只影响对应缓冲');
{
  const baseData = generateBaseData(MAX_PARTICLES);
  const buffers = createBuffers(baseData);
  let current = copyParams(BASE_PARAMS);
  applyParams(buffers, baseData, { ...BASE_PARAMS, particleCount: 0 }, current);

  const snapshot = () => ({
    positions: buffers.positions.slice(),
    colors: buffers.colors.slice()
  });

  const before = snapshot();
  let changed = applyParams(buffers, baseData, current, { ...current, hueOffset: 120 });
  current = { ...current, hueOffset: 120 };
  check('色相变化只标记 hueOffset', changed.length === 1 && changed[0] === 'hueOffset');
  check('色相变化不重写位置缓冲', buffers.positions.every((v, i) => v === before.positions[i]));
  check('色相变化确实更新颜色', !buffers.colors.every((v, i) => v === before.colors[i]));

  const beforeRadius = snapshot();
  changed = applyParams(buffers, baseData, current, { ...current, radius: 18 });
  current = { ...current, radius: 18 };
  check('半径变化只标记 radius', changed.length === 1 && changed[0] === 'radius');
  check('半径变化不重写颜色缓冲', buffers.colors.every((v, i) => v === beforeRadius.colors[i]));
  check('半径变化确实更新位置', !buffers.positions.every((v, i) => v === beforeRadius.positions[i]));

  const beforeCount = snapshot();
  changed = applyParams(buffers, baseData, current, { ...current, particleCount: 3000 });
  current = { ...current, particleCount: 3000 };
  check('数量变化只标记 particleCount', changed.length === 1 && changed[0] === 'particleCount');
  check('数量变化不重写位置/颜色',
    buffers.positions.every((v, i) => v === beforeCount.positions[i]) &&
    buffers.colors.every((v, i) => v === beforeCount.colors[i]));

  const beforeSpeed = snapshot();
  changed = applyParams(buffers, baseData, current, { ...current, rotationSpeed: 2 });
  check('旋转速度变化不触碰任何缓冲', changed.length === 0 &&
    buffers.positions.every((v, i) => v === beforeSpeed.positions[i]) &&
    buffers.colors.every((v, i) => v === beforeSpeed.colors[i]));
}

console.log('\n[3] 更新调度：连续拖动不重复、不丢失');
{
  const applied: NebulaParams[] = [];
  const frameQueue: (() => void)[] = [];
  const scheduler = createUpdateScheduler(
    (cb) => frameQueue.push(cb),
    (params) => applied.push(copyParams(params))
  );
  const runFrame = () => {
    const callbacks = frameQueue.splice(0);
    callbacks.forEach((cb) => cb());
  };

  for (let i = 1; i <= 10; i++) {
    scheduler.push({ ...BASE_PARAMS, radius: 5 + i * 0.5 });
  }
  runFrame();
  check('一帧内 10 次拖动合并为 1 次应用', applied.length === 1);
  check('合并后应用的是最新值', applied[0].radius === 10);

  scheduler.push({ ...BASE_PARAMS, radius: 10 });
  runFrame();
  check('相同参数重复提交被去重', applied.length === 1);

  scheduler.push({ ...BASE_PARAMS, radius: 11 });
  runFrame();
  scheduler.push({ ...BASE_PARAMS, radius: 12 });
  runFrame();
  check('跨帧的每个新值都按序应用', applied.length === 3 &&
    applied[1].radius === 11 && applied[2].radius === 12);

  scheduler.push({ ...BASE_PARAMS, radius: 13 });
  scheduler.flush();
  runFrame();
  check('change 事件同步 flush 后，排队的帧回调不重复应用', applied.length === 4 &&
    applied[3].radius === 13);

  check('最终应用值与面板最终值一致（无丢失）',
    paramsEqual(applied[applied.length - 1], { ...BASE_PARAMS, radius: 13 }));
}

console.log('\n[4] 动画状态与参数快照互不干扰');
{
  const baseData = generateBaseData(MAX_PARTICLES);
  const buffers = createBuffers(baseData);
  let current = copyParams(BASE_PARAMS);
  applyParams(buffers, baseData, { ...BASE_PARAMS, particleCount: 0 }, current);

  const animation = createAnimationState();
  advanceAnimation(animation, 0.016, current.rotationSpeed, 1.0);
  advanceAnimation(animation, 0.016, current.rotationSpeed, 1.016);
  const angleAfterTwoFrames = animation.rotationAngle;

  const paramsBefore = copyParams(current);
  const buffersBefore = buffers.positions.slice();
  advanceAnimation(animation, 0.016, current.rotationSpeed, 1.032);
  check('动画推进不修改参数快照', paramsEqual(current, paramsBefore));
  check('动画推进不修改粒子缓冲', buffers.positions.every((v, i) => v === buffersBefore[i]));

  const animationBefore = { ...animation };
  applyParams(buffers, baseData, current, { ...current, hueOffset: 200, radius: 8 });
  current = { ...current, hueOffset: 200, radius: 8 };
  check('参数更新不修改动画状态',
    animation.rotationAngle === animationBefore.rotationAngle &&
    animation.time === animationBefore.time);

  advanceAnimation(animation, 0.016, current.rotationSpeed, 1.048);
  check('参数变化后动画从原角度继续累积',
    Math.abs(animation.rotationAngle - (angleAfterTwoFrames + 0.5 * 0.016 * 2)) < 1e-12);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) {
  throw new Error(`离线验证失败：${failed} 项未通过`);
}
