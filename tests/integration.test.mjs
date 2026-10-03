import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { createSaveQueue } from '../src/saveQueue.ts';

let server;
let baseUrl;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const api = async (method, path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

test('端到端：保存队列 + 真实服务端，连续修改序列（含乱序网络延迟）最终一致', async () => {
  const created = await api('POST', '/api/exhibitions', {
    name: '一致性测试',
    themeColor: { id: 'minimal' },
    description: ''
  });
  const id = created.body.id;

  // 模拟不稳定网络：每个请求随机延迟 0-50ms，
  // 若不串行化，先发的请求可能后到达覆盖新数据。
  const saver = createSaveQueue(async (exId, body) => {
    await new Promise((r) => setTimeout(r, Math.random() * 50));
    const res = await fetch(`${baseUrl}/api/exhibitions/${exId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`save failed: ${res.status}`);
    return res.json();
  });
  saver.setServerVersion(id, created.body.version);

  // 模拟搭建器里的连续操作序列：新增 -> 拖动 -> 缩放 -> 再新增 -> 删除
  let comps = [];
  const apply = (mutate) => {
    comps = mutate(comps);
    saver.save(id, { components: comps });
  };

  apply((c) => [...c, { id: 'img1', type: 'image', x: 0, y: 0 }]);
  apply((c) => c.map((x) => (x.id === 'img1' ? { ...x, x: 120, y: 80 } : x)));
  apply((c) => c.map((x) => (x.id === 'img1' ? { ...x, width: 300 } : x)));
  apply((c) => [...c, { id: 'txt1', type: 'text', x: 400, y: 100 }]);
  apply((c) => c.filter((x) => x.id !== 'img1'));
  apply((c) => c.map((x) => (x.id === 'txt1' ? { ...x, content: '最终文字' } : x)));

  // 预览页加载前的动作：等待未完成的保存落盘
  await saver.flush(id);
  assert.equal(saver.getStatus(id), 'saved');

  const final = await api('GET', `/api/exhibitions/${id}`);
  assert.deepEqual(final.body.components, [
    { id: 'txt1', type: 'text', x: 400, y: 100, content: '最终文字' }
  ]);

  // 模拟刷新后重新进入：服务端数据即最近一次确认的修改
  const refetched = await api('GET', `/api/exhibitions/${id}`);
  assert.deepEqual(refetched.body.components, final.body.components);
});

test('端到端：保存失败可观察，重试成功后状态与数据恢复一致', async () => {
  const created = await api('POST', '/api/exhibitions', {
    name: '失败重试测试',
    themeColor: { id: 'minimal' },
    description: ''
  });
  const id = created.body.id;

  let failNext = true;
  const statuses = [];
  const saver = createSaveQueue(
    async (exId, body) => {
      if (failNext) {
        failNext = false;
        throw new Error('simulated network failure');
      }
      const res = await fetch(`${baseUrl}/api/exhibitions/${exId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      return res.json();
    },
    (_id, s) => statuses.push(s)
  );
  saver.setServerVersion(id, created.body.version);

  saver.save(id, { components: [{ id: 'a' }] });
  await saver.flush(id);
  assert.equal(saver.getStatus(id), 'error');
  assert.ok(statuses.includes('error'));

  saver.retry(id);
  await saver.flush(id);
  assert.equal(saver.getStatus(id), 'saved');

  const final = await api('GET', `/api/exhibitions/${id}`);
  assert.deepEqual(final.body.components, [{ id: 'a' }]);
});
