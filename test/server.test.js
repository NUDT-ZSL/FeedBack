const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-notes-'));
process.env.OFFLINE_NOTES_DATA = path.join(tmpDir, 'notes.json');

const { createServer } = require('../server');

let server;
let baseUrl;

test.before(async () => {
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function request(method, urlPath, body) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await response.json();
  return { status: response.status, json };
}

test('创建、版本冲突、手动解决构成完整同步链路', async () => {
  const created = await request('POST', '/api/notes', {
    opId: 'create-1',
    id: 'note-conflict',
    title: '现场笔记',
    content: 'v1'
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.note.version, 1);

  const remoteChange = await request('POST', '/api/notes/simulate-remote-change', {
    id: 'note-conflict',
    title: '现场笔记',
    content: '服务端 v2'
  });
  assert.equal(remoteChange.json.note.version, 2);

  const staleUpdate = await request('PATCH', '/api/notes/note-conflict', {
    opId: 'local-update-1',
    baseVersion: 1,
    title: '现场笔记',
    content: '本地 v2'
  });
  assert.equal(staleUpdate.status, 409);
  assert.equal(staleUpdate.json.conflict.server.version, 2);

  const resolved = await request('POST', '/api/notes/note-conflict/resolve', {
    opId: 'resolve-1',
    choice: 'manual',
    baseVersion: 2,
    title: '合并结果',
    content: '同时考虑本地和服务端',
    deleted: false
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.json.note.version, 3);
  assert.equal(resolved.json.note.title, '合并结果');
});

test('网络重试复用同一 opId 时不会重复提交', async () => {
  const payload = {
    opId: 'same-op-update',
    baseVersion: 3,
    title: '幂等标题',
    content: '第一次响应'
  };
  const first = await request('PATCH', '/api/notes/note-conflict', payload);
  assert.equal(first.status, 200);
  assert.equal(first.json.note.version, 4);

  const retry = await request('PATCH', '/api/notes/note-conflict', {
    ...payload,
    content: '重试时的请求体不应该再次增长版本'
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.json.note.version, 4);
  assert.equal(retry.json.note.content, '第一次响应');
});

test('冲突解决使用版本号防止覆盖期间再次变化的服务端内容', async () => {
  const stale = await request('POST', '/api/notes/note-conflict/resolve', {
    opId: 'stale-resolution',
    choice: 'server',
    baseVersion: 3
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.conflict.reason, 'server_changed_again_before_resolution');
});
