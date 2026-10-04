import { test, assert, assertClose, assertVec3Close } from './harness';
import {
  createViewTween,
  sampleViewTween,
  easeInOutCubic,
  DEFAULT_TWEEN_DURATION_MS
} from '../src/core/tween';

const start = [1, 2, 3] as [number, number, number];
const end = [4, -2, 6] as [number, number, number];
const startTarget = [0.5, 0, 0] as [number, number, number];
const endTarget = [0, 0, 0] as [number, number, number];

test('缓动函数: 端点与中点取值正确', () => {
  assertClose(easeInOutCubic(0), 0, 1e-12, 't=0');
  assertClose(easeInOutCubic(1), 1, 1e-12, 't=1');
  assertClose(easeInOutCubic(0.5), 0.5, 1e-12, 't=0.5');
  assertClose(easeInOutCubic(0.25), 4 * 0.25 ** 3, 1e-12, 't=0.25 前半段三次曲线');
});

test('补间端点: 进度0在起点, 进度时长处在终点且标记完成', () => {
  const tween = createViewTween(start, end, startTarget, endTarget);
  const s0 = sampleViewTween(tween, 0);
  assertVec3Close(s0.position, start, 1e-12, '起点位置');
  assertVec3Close(s0.target, startTarget, 1e-12, '起点目标');
  assert(!s0.done, '起点未完成');

  const s1 = sampleViewTween(tween, DEFAULT_TWEEN_DURATION_MS);
  assertVec3Close(s1.position, end, 1e-12, '终点位置');
  assertVec3Close(s1.target, endTarget, 1e-12, '终点目标');
  assert(s1.done, '终点完成');
});

test('补间中点: 相机位置与目标各走一半', () => {
  const tween = createViewTween(start, end, startTarget, endTarget);
  const mid = sampleViewTween(tween, DEFAULT_TWEEN_DURATION_MS / 2);
  assertVec3Close(mid.position, [2.5, 0, 4.5], 1e-12, '中点位置');
  assertVec3Close(mid.target, [0.25, 0, 0], 1e-12, '中点目标');
  assertClose(mid.eased, 0.5, 1e-12, '中点缓动值');
});

test('同一进度多次求值结果稳定', () => {
  const tween = createViewTween(start, end, startTarget, endTarget);
  for (const t of [0, 100, 333.3, 1000, 1999.9, 2000, 5000]) {
    const a = sampleViewTween(tween, t);
    const b = sampleViewTween(tween, t);
    assert(JSON.stringify(a) === JSON.stringify(b), `t=${t} 两次求值一致`);
  }
});

test('超出时长的进度被钳制到终点', () => {
  const tween = createViewTween(start, end, startTarget, endTarget);
  const over = sampleViewTween(tween, 99999);
  assertVec3Close(over.position, end, 1e-12, '超时位置收敛到终点');
  assert(over.done, '超时标记完成');
  const neg = sampleViewTween(tween, -50);
  assertVec3Close(neg.position, start, 1e-12, '负进度钳制到起点');
});

test('默认时长为2000ms, 与现有2秒视角动画一致', () => {
  assertClose(DEFAULT_TWEEN_DURATION_MS, 2000, 0, '默认补间时长');
  const tween = createViewTween(start, end, startTarget, endTarget);
  assertClose(tween.durationMs, 2000, 0, '实例时长');
});
