import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

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

const createExhibition = async () => {
  const { status, body } = await api('POST', '/api/exhibitions', {
    name: '测试展览',
    themeColor: { id: 'minimal', primary: '#000' },
    description: 'desc'
  });
  assert.equal(status, 201);
  return body;
};

test('创建展览：初始 version 为 0，未发布不出现在列表，但可按 id 读取', async () => {
  const ex = await createExhibition();
  assert.equal(ex.version, 0);
  assert.equal(ex.published, false);

  const list = await api('GET', '/api/exhibitions');
  assert.ok(!list.body.some((e) => e.id === ex.id));

  const byId = await api('GET', `/api/exhibitions/${ex.id}`);
  assert.equal(byId.status, 200);
  assert.equal(byId.body.id, ex.id);
});

test('部分更新：只更新请求中出现的字段，未提交字段保持不变', async () => {
  const ex = await createExhibition();
  const comp = { id: 'c1', type: 'text', x: 1, y: 2 };

  const r1 = await api('PUT', `/api/exhibitions/${ex.id}`, { components: [comp] });
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.body.components, [comp]);
  assert.equal(r1.body.name, '测试展览');
  assert.equal(r1.body.description, 'desc');
  assert.equal(r1.body.version, 1);

  const r2 = await api('PUT', `/api/exhibitions/${ex.id}`, { name: '改名' });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.name, '改名');
  assert.deepEqual(r2.body.components, [comp]);
  assert.equal(r2.body.version, 2);
});

test('更新不允许覆盖 id/createdAt/published 等受保护字段', async () => {
  const ex = await createExhibition();
  const r = await api('PUT', `/api/exhibitions/${ex.id}`, {
    id: 'hacked',
    published: true,
    createdAt: '1970-01-01',
    components: []
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, ex.id);
  assert.equal(r.body.published, false);
  assert.equal(r.body.createdAt, ex.createdAt);
});

test('版本冲突：携带过期 version 的保存被拒绝（409），后发起的保存不被先发起的覆盖', async () => {
  const ex = await createExhibition();

  const r1 = await api('PUT', `/api/exhibitions/${ex.id}`, {
    components: [{ id: 'newer' }],
    version: 0
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.version, 1);

  // 模拟“先发起但后到达”的旧保存：基于过期 version 0
  const stale = await api('PUT', `/api/exhibitions/${ex.id}`, {
    components: [{ id: 'stale' }],
    version: 0
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.currentVersion, 1);

  const current = await api('GET', `/api/exhibitions/${ex.id}`);
  assert.deepEqual(current.body.components, [{ id: 'newer' }]);
});

test('连续修改序列按发生顺序生效，最终组件集合等于最后一次保存', async () => {
  const ex = await createExhibition();
  let version = ex.version;

  const mutations = [
    [{ id: 'a' }],
    [{ id: 'a' }, { id: 'b' }],
    [{ id: 'a', x: 100 }, { id: 'b' }],
    [{ id: 'b' }],
    [{ id: 'b' }, { id: 'c' }]
  ];

  for (const components of mutations) {
    const r = await api('PUT', `/api/exhibitions/${ex.id}`, { components, version });
    assert.equal(r.status, 200);
    version = r.body.version;
  }

  const final = await api('GET', `/api/exhibitions/${ex.id}`);
  assert.deepEqual(final.body.components, mutations[mutations.length - 1]);
  assert.equal(final.body.version, mutations.length);
});

test('错误语义：更新/发布/读取不存在的展览返回 404 及错误信息', async () => {
  const put = await api('PUT', '/api/exhibitions/does-not-exist', { components: [] });
  assert.equal(put.status, 404);
  assert.ok(put.body.error);

  const publish = await api('POST', '/api/exhibitions/does-not-exist/publish');
  assert.equal(publish.status, 404);
  assert.ok(publish.body.error);

  const get = await api('GET', '/api/exhibitions/does-not-exist');
  assert.equal(get.status, 404);
  assert.ok(get.body.error);
});

test('发布后出现在展览列表，version 递增', async () => {
  const ex = await createExhibition();
  const pub = await api('POST', `/api/exhibitions/${ex.id}/publish`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.published, true);
  assert.equal(pub.body.version, ex.version + 1);

  const list = await api('GET', '/api/exhibitions');
  assert.ok(list.body.some((e) => e.id === ex.id));
});
