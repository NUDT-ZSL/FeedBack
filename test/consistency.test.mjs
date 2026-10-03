// Offline, repeatable verification of the exhibition save consistency chain.
// Run with: npm test
//
// Covers:
//  - saves for one exhibition are applied in mutation order (no later save
//    can be overwritten by an earlier one, even with out-of-order latency)
//  - queued saves are coalesced to the latest snapshot
//  - save failure exposes an observable error status and retry recovers
//  - server PUT is a partial update (absent fields are never cleared)
//  - update/publish/delete of a missing exhibition returns explicit 404
//  - public semantics stay: list returns published only, GET by id works for any

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Compile the TypeScript save manager so the pure ordering logic is tested
// directly, without a browser.
execSync(
  'npx tsc src/saveManager.ts --outDir test/.build --module esnext --target es2022 --moduleResolution bundler --skipLibCheck',
  { cwd: rootDir, stdio: 'inherit' }
);

const { createSaveManager } = await import('./.build/saveManager.js');
const { app, exhibitions } = await import('../server.js');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

const api = {
  create: (body) =>
    fetch(`${baseUrl}/api/exhibitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  get: (id) => fetch(`${baseUrl}/api/exhibitions/${id}`),
  list: () => fetch(`${baseUrl}/api/exhibitions`),
  put: (id, body) =>
    fetch(`${baseUrl}/api/exhibitions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
  publish: (id) => fetch(`${baseUrl}/api/exhibitions/${id}/publish`, { method: 'POST' }),
  remove: (id) => fetch(`${baseUrl}/api/exhibitions/${id}`, { method: 'DELETE' })
};

const createExhibition = async (components = []) => {
  const res = await api.create({
    name: '一致性测试展',
    description: 'desc',
    themeColor: { id: 'minimal', primary: '#000' },
    components
  });
  assert.equal(res.status, 201);
  return (await res.json()).id;
};

const httpTransport = async (id, payload) => {
  const res = await api.put(id, payload);
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
};

test('同一展览的连续保存按发生顺序生效，并发请求数不超过 1，旧快照被合并', async () => {
  const calls = [];
  const resolvers = [];
  const transport = (id, payload) =>
    new Promise((resolve) => {
      calls.push(payload);
      resolvers.push(resolve);
    });
  const manager = createSaveManager(transport);

  const v1 = { components: [{ id: 'a', x: 0 }] };
  const v2 = { components: [{ id: 'a', x: 10 }] };
  const v3 = { components: [{ id: 'a', x: 20 }, { id: 'b', x: 5 }] };

  const p1 = manager.enqueueSave('ex-order', v1);
  const p2 = manager.enqueueSave('ex-order', v2);
  const p3 = manager.enqueueSave('ex-order', v3);

  // Only the first save is in flight; later ones wait.
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], v1);

  resolvers[0]();
  await p1;
  await tick();

  // The two queued snapshots were coalesced: only the latest is sent,
  // and strictly after the first one completed.
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], v3);

  resolvers[1]();
  await Promise.all([p2, p3]);
  assert.equal(manager.getStatus('ex-order'), 'saved');
});

test('先发出的保存延迟到达时，最终结果仍是最后一次修改', async () => {
  const id = await createExhibition([{ id: 'c1', x: 0 }]);

  const sentOrder = [];
  let firstCall = true;
  const slowFirstTransport = async (exhibitionId, payload) => {
    sentOrder.push(payload);
    if (firstCall) {
      firstCall = false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await httpTransport(exhibitionId, payload);
  };
  const manager = createSaveManager(slowFirstTransport);

  const drag1 = { components: [{ id: 'c1', x: 50 }] };
  const drag2 = { components: [{ id: 'c1', x: 120 }] };
  const afterDelete = { components: [] };

  manager.enqueueSave(id, drag1).catch(() => {});
  manager.enqueueSave(id, drag2).catch(() => {});
  await manager.enqueueSave(id, afterDelete).catch(() => {});

  const status = await manager.flushSaves(id);
  assert.equal(status, 'saved');

  // Requests reached the server in mutation order, never interleaved.
  assert.deepEqual(sentOrder, [drag1, afterDelete]);

  const res = await api.get(id);
  const data = await res.json();
  assert.deepEqual(data.components, []);
});

test('保存失败暴露 error 状态，重试成功后回到 saved', async () => {
  const id = await createExhibition([]);
  let shouldFail = true;
  const received = [];
  const transport = async (exhibitionId, payload) => {
    if (shouldFail) throw new Error('network down');
    received.push(payload);
    await httpTransport(exhibitionId, payload);
  };
  const manager = createSaveManager(transport);

  const statuses = [];
  manager.subscribe(id, (s) => statuses.push(s));

  const payload = { components: [{ id: 'c1', x: 1 }] };
  await manager.enqueueSave(id, payload).catch(() => {});
  assert.equal(manager.getStatus(id), 'error');
  assert.deepEqual(statuses, ['saving', 'error']);
  assert.equal(received.length, 0);

  shouldFail = false;
  await manager.retrySave(id);
  assert.equal(manager.getStatus(id), 'saved');
  assert.deepEqual(statuses, ['saving', 'error', 'saving', 'saved']);
  assert.deepEqual(received, [payload]);

  const data = await (await api.get(id)).json();
  assert.deepEqual(data.components, payload.components);
});

test('保存失败后产生的新修改以最新快照恢复，状态回到 saved', async () => {
  const id = await createExhibition([]);
  let failNext = true;
  const transport = async (exhibitionId, payload) => {
    if (failNext) {
      failNext = false;
      throw new Error('boom');
    }
    await httpTransport(exhibitionId, payload);
  };
  const manager = createSaveManager(transport);

  manager.enqueueSave(id, { components: [{ id: 'c1' }] }).catch(() => {});
  await tick();
  await manager.enqueueSave(id, { components: [{ id: 'c2' }] }).catch(() => {});

  const status = await manager.flushSaves(id);
  assert.equal(status, 'saved');

  const data = await (await api.get(id)).json();
  assert.deepEqual(data.components, [{ id: 'c2' }]);
});

test('删除组件后立刻读取（预览路径）：flush 后读到的是删除后的集合', async () => {
  const id = await createExhibition([{ id: 'keep' }, { id: 'gone' }]);
  const manager = createSaveManager(httpTransport);

  manager.enqueueSave(id, { components: [{ id: 'keep' }] }).catch(() => {});

  // Simulates navigating to the preview page immediately after deleting.
  await manager.flushSaves(id);
  const data = await (await api.get(id)).json();
  assert.deepEqual(data.components, [{ id: 'keep' }]);
});

test('服务端 PUT 是部分更新：未提交的字段保持不变，受保护字段不可改写', async () => {
  const id = await createExhibition([{ id: 'c1' }]);
  const beforeData = await (await api.get(id)).json();

  const putComponents = await api.put(id, { components: [{ id: 'c9' }] });
  assert.equal(putComponents.status, 200);
  let data = await putComponents.json();
  assert.deepEqual(data.components, [{ id: 'c9' }]);
  assert.equal(data.name, beforeData.name);
  assert.equal(data.description, beforeData.description);
  assert.deepEqual(data.themeColor, beforeData.themeColor);
  assert.equal(data.createdAt, beforeData.createdAt);

  const putName = await api.put(id, { name: '新名字' });
  data = await putName.json();
  assert.equal(data.name, '新名字');
  assert.deepEqual(data.components, [{ id: 'c9' }]);

  const putProtected = await api.put(id, {
    id: 'hacked',
    createdAt: '1970-01-01',
    published: true,
    junk: 1
  });
  data = await putProtected.json();
  assert.equal(data.id, id);
  assert.equal(data.createdAt, beforeData.createdAt);
  assert.equal(data.published, false);
  assert.equal(data.junk, undefined);
});

test('更新/发布/删除不存在的展览返回 404 与明确错误码', async () => {
  const missing = 'does-not-exist';

  const putRes = await api.put(missing, { components: [] });
  assert.equal(putRes.status, 404);
  assert.equal((await putRes.json()).code, 'EXHIBITION_NOT_FOUND');

  const publishRes = await api.publish(missing);
  assert.equal(publishRes.status, 404);
  assert.equal((await publishRes.json()).code, 'EXHIBITION_NOT_FOUND');

  const deleteRes = await api.remove(missing);
  assert.equal(deleteRes.status, 404);
  assert.equal((await deleteRes.json()).code, 'EXHIBITION_NOT_FOUND');

  const getRes = await api.get(missing);
  assert.equal(getRes.status, 404);
});

test('对外语义不变：列表只含已发布展览，按 id 可读任意展览', async () => {
  const unpublishedId = await createExhibition([]);
  const publishedId = await createExhibition([]);
  const publishRes = await api.publish(publishedId);
  assert.equal(publishRes.status, 200);

  const list = await (await api.list()).json();
  const knownIds = new Set(exhibitions.filter((e) => e.published).map((e) => e.id));
  assert.ok(list.every((e) => e.published && knownIds.has(e.id)));
  assert.ok(list.some((e) => e.id === publishedId));
  assert.ok(!list.some((e) => e.id === unpublishedId));

  const byId = await api.get(unpublishedId);
  assert.equal(byId.status, 200);
  assert.equal((await byId.json()).id, unpublishedId);
});
