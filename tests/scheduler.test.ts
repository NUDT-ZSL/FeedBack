import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createParamScheduler } from '../src/nebula/scheduler.ts';
import type { NebulaParams } from '../src/nebula/params.ts';

function createManualSchedule(): {
  queue: Array<() => void>;
  schedule: (cb: () => void) => void;
  drain: () => number;
} {
  const queue: Array<() => void> = [];
  return {
    queue,
    schedule: (cb) => {
      queue.push(cb);
    },
    drain: () => {
      const pending = queue.splice(0);
      pending.forEach((cb) => cb());
      return pending.length;
    }
  };
}

const params = (hueOffset: number): NebulaParams => ({
  particleCount: 5000,
  hueOffset,
  radius: 12,
  rotationSpeed: 0.5
});

test('连续快速 push 只产生一次提交，且提交的是最新值', () => {
  const clock = createManualSchedule();
  const commits: NebulaParams[] = [];
  const scheduler = createParamScheduler((p) => commits.push(p), clock.schedule);

  scheduler.push(params(10));
  scheduler.push(params(20));
  scheduler.push(params(30));

  assert.equal(clock.queue.length, 1);
  assert.equal(commits.length, 0);

  clock.drain();

  assert.equal(commits.length, 1);
  assert.equal(commits[0].hueOffset, 30);
});

test('提交完成后再次 push 会重新调度，不丢更新', () => {
  const clock = createManualSchedule();
  const commits: NebulaParams[] = [];
  const scheduler = createParamScheduler((p) => commits.push(p), clock.schedule);

  scheduler.push(params(10));
  clock.drain();
  scheduler.push(params(40));
  clock.drain();

  assert.deepEqual(commits.map((p) => p.hueOffset), [10, 40]);
});

test('change 事件式 flush：有待处理更新时立即提交且随后不重复提交', () => {
  const clock = createManualSchedule();
  const commits: NebulaParams[] = [];
  const scheduler = createParamScheduler((p) => commits.push(p), clock.schedule);

  scheduler.push(params(55));
  scheduler.flush();

  assert.equal(commits.length, 1);
  assert.equal(commits[0].hueOffset, 55);

  clock.drain();

  assert.equal(commits.length, 1);
});

test('flush 在无待处理更新时不产生空提交', () => {
  const clock = createManualSchedule();
  const commits: NebulaParams[] = [];
  const scheduler = createParamScheduler((p) => commits.push(p), clock.schedule);

  scheduler.flush();
  assert.equal(commits.length, 0);
});

test('提交使用参数快照，提交方后续修改不影响已入队数据', () => {
  const clock = createManualSchedule();
  const commits: NebulaParams[] = [];
  const scheduler = createParamScheduler((p) => commits.push(p), clock.schedule);

  const live = params(15);
  scheduler.push(live);
  live.hueOffset = 999;
  clock.drain();

  assert.equal(commits[0].hueOffset, 15);
});
