import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveQueue } from '../src/saveQueue.ts';
import type { SaveFields, SaveResponse, SaveStatus } from '../src/saveQueue.ts';

interface Call {
  id: string;
  body: SaveFields;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('快速连续保存被串行化：请求按发起顺序到达，最终状态为最后一次保存', async () => {
  const calls: Call[] = [];
  const gates: Array<ReturnType<typeof deferred<SaveResponse>>> = [];

  const statuses: SaveStatus[] = [];
  const q = createSaveQueue((id, body) => {
    calls.push({ id, body });
    const gate = deferred<SaveResponse>();
    gates.push(gate);
    return gate.promise;
  }, (_id, s) => statuses.push(s));

  q.save('ex1', { components: [{ id: 'a', x: 0 }] });
  q.save('ex1', { components: [{ id: 'a', x: 10 }] });
  q.save('ex1', { components: [{ id: 'a', x: 20 }] });

  // 第一个请求立即发出，其余在队列中等待（不会并发发出）
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.components, [{ id: 'a', x: 0 }]);

  // 第一个请求完成后，才发出下一个（合并为最新快照）
  gates[0].resolve({ version: 1 });
  await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.components, [{ id: 'a', x: 20 }]);
  assert.equal(calls[1].body.version, 1);

  gates[1].resolve({ version: 2 });
  await q.flush('ex1');
  assert.equal(q.getStatus('ex1'), 'saved');
  assert.deepEqual(statuses, ['saving', 'saved']);
});

test('保存失败进入 error 状态，重试成功后回到 saved，且重试发送的是最新快照', async () => {
  const calls: Call[] = [];
  let behavior: 'fail' | 'ok' = 'fail';

  const q = createSaveQueue(async (id, body) => {
    calls.push({ id, body });
    if (behavior === 'fail') throw new Error('network down');
    return { version: calls.length };
  });

  q.save('ex1', { components: [{ id: 'a' }] });
  await q.flush('ex1');
  assert.equal(q.getStatus('ex1'), 'error');

  // 失败期间继续修改，重试应携带最新快照
  q.save('ex1', { components: [{ id: 'a' }, { id: 'b' }] });
  await tick();
  assert.equal(q.getStatus('ex1'), 'error');

  behavior = 'ok';
  q.retry('ex1');
  await q.flush('ex1');
  assert.equal(q.getStatus('ex1'), 'saved');
  const last = calls[calls.length - 1];
  assert.deepEqual(last.body.components, [{ id: 'a' }, { id: 'b' }]);
});

test('flush 在保存进行中和失败时的行为：进行中等待，失败后不再阻塞', async () => {
  const gate = deferred<SaveResponse>();
  const q = createSaveQueue(() => gate.promise);

  q.save('ex1', { components: [] });
  let flushed = false;
  void q.flush('ex1').then(() => {
    flushed = true;
  });
  await tick();
  assert.equal(flushed, false);
  gate.resolve({ version: 1 });
  await tick();
  await tick();
  assert.equal(flushed, true);

  const q2 = createSaveQueue(async () => {
    throw new Error('boom');
  });
  q2.save('ex2', { components: [] });
  await q2.flush('ex2');
  assert.equal(q2.getStatus('ex2'), 'error');
});

test('版本线程：每次保存携带最近一次确认的服务端版本', async () => {
  const bodies: SaveFields[] = [];
  const q = createSaveQueue(async (_id, body) => {
    bodies.push(body);
    return { version: (body.version as number) + 1 };
  });

  q.setServerVersion('ex1', 5);
  q.save('ex1', { components: [{ id: 'a' }] });
  await q.flush('ex1');
  q.save('ex1', { components: [{ id: 'a' }, { id: 'b' }] });
  await q.flush('ex1');

  assert.equal(bodies[0].version, 5);
  assert.equal(bodies[1].version, 6);
  assert.equal(q.getServerVersion('ex1'), 7);
});
