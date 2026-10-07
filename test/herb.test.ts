import { describe, it, assert, assertEqual, assertDeepEqual } from './harness';
import * as THREE from 'three';
import { Herb } from '../src/game/Herb';
import { createSeededRandom, createIdGenerator } from '../src/game/core/random';
import { ManualClock, ManualFrameRunner } from '../src/game/core/clock';

function makeDeterministicHerb(seed: number): ReturnType<Herb['getData']> {
  const rng = createSeededRandom(seed);
  const herb = new Herb(new THREE.Vector3(1.5, 0.1, -2.5), rng, createIdGenerator('herb', rng));
  return herb.getData();
}

describe('草药实例', () => {
  it('相同种子生成完全相同的草药数据（类型/药性/id/位置）', () => {
    assertDeepEqual(makeDeterministicHerb(77), makeDeterministicHerb(77), '同种子草药必须逐字段一致');
  });

  it('不同种子通常产生不同数据', () => {
    const a = makeDeterministicHerb(1);
    const b = makeDeterministicHerb(2);
    assert(JSON.stringify(a) !== JSON.stringify(b), '不同种子草药应有差异');
  });

  it('采集动画在手动时钟+手动帧调度下确定性跑完', () => {
    const rng = createSeededRandom(5);
    const herb = new Herb(new THREE.Vector3(0, 0, 0), rng, createIdGenerator('herb', rng));
    const clock = new ManualClock(1000);
    const frames = new ManualFrameRunner();
    let completed = 0;

    herb.collectAnimation(new THREE.Vector3(2, 0, 0), () => { completed++; }, clock, frames);
    // 初始帧已排队但尚未执行
    assertEqual(completed, 0, '未推进时间前动画不应完成');
    assert(frames.pendingCount > 0, '应已有帧在队列中');

    // 推进 500ms 后跑一帧：动画进行中，会继续排队下一帧
    clock.advance(500);
    frames.step();
    assertEqual(completed, 0, '500ms 时不应完成');

    // 推进到 1000ms：下一次帧回调必须完成动画且不再排队
    clock.advance(500);
    const hasNextFrame = frames.step();
    assertEqual(completed, 1, '1000ms 后动画必须恰好完成一次');
    assertEqual(hasNextFrame, false, '完成后不应再调度新帧');

    // 结束位置应为目标位置
    const pos = herb.getMesh().position;
    assert(Math.abs(pos.x - 2) < 1e-9, `动画终点 x 应为 2，实际 ${pos.x}`);
  });
});
