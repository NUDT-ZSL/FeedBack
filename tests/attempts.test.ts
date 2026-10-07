import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { initDatabase, createApp } from '../src/server/index.ts';

const MAZE_ID = 'maze-under-test';

interface AttemptRow {
  id: number;
  maze_id: string;
  username: string;
  time_seconds: number;
  created_at: string;
}

interface TestServer {
  db: DatabaseSync;
  server: Server;
  baseUrl: string;
}

interface HttpResult {
  status: number;
  body: any;
}

async function startTestServer(): Promise<TestServer> {
  const db = initDatabase(':memory:');
  db.prepare(
    "INSERT INTO mazes (id, user_id, name, style, grid, markers, thumbnail) VALUES (?, NULL, 'test', '{}', '[]', '[]', '')"
  ).run(MAZE_ID);
  const app = createApp(db);
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { db, server, baseUrl: `http://127.0.0.1:${port}` };
}

function stopTestServer(ctx: TestServer): Promise<void> {
  return new Promise((resolve, reject) => {
    ctx.server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function postAttempt(
  ctx: TestServer,
  mazeId: string,
  payload: unknown,
  path: 'attempt' | 'attempts' = 'attempts'
): Promise<HttpResult> {
  const res = await fetch(`${ctx.baseUrl}/api/mazes/${mazeId}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

async function getAttempts(ctx: TestServer, mazeId: string): Promise<HttpResult> {
  const res = await fetch(`${ctx.baseUrl}/api/mazes/${mazeId}/attempts`);
  return { status: res.status, body: await res.json() };
}

function assertCompleteRow(row: AttemptRow): void {
  assert.equal(typeof row.id, 'number', 'id 必须是数字');
  assert.equal(row.maze_id, MAZE_ID, 'maze_id 必须属于目标迷宫');
  assert.equal(typeof row.username, 'string', 'username 必须是字符串');
  assert.ok(row.username.length > 0, 'username 不能为空');
  assert.equal(typeof row.time_seconds, 'number', 'time_seconds 必须是数字');
  assert.ok(Number.isFinite(row.time_seconds) && row.time_seconds >= 0, 'time_seconds 必须非负');
  assert.equal(typeof row.created_at, 'string', 'created_at 必须存在');
}

function assertSorted(rows: AttemptRow[]): void {
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];
    const ordered =
      prev.time_seconds < curr.time_seconds ||
      (prev.time_seconds === curr.time_seconds &&
        (prev.created_at < curr.created_at ||
          (prev.created_at === curr.created_at && prev.id < curr.id)));
    assert.ok(
      ordered,
      `排行顺序必须按 (time_seconds, created_at, id) 升序: 第 ${i} 行乱序 (${JSON.stringify(prev)} vs ${JSON.stringify(curr)})`
    );
  }
}

test('同一用户连续/并发提交多次成绩：排行不重复、不丢失', async (t) => {
  const ctx = await startTestServer();
  t.after(() => stopTestServer(ctx));

  const sequentialIds: number[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await postAttempt(ctx, MAZE_ID, { username: 'alice', time_seconds: 10 + i });
    assert.equal(res.status, 201, `第 ${i + 1} 次提交应成功`);
    sequentialIds.push(res.body.id);
  }

  const concurrent = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      postAttempt(ctx, MAZE_ID, { username: 'alice', time_seconds: 100 + i })
    )
  );
  for (const res of concurrent) {
    assert.equal(res.status, 201, '并发提交应全部成功');
  }
  const concurrentIds = concurrent.map((r) => r.body.id);
  assert.equal(new Set(concurrentIds).size, 10, '并发提交的成绩 id 不应重复');

  const allSubmitted = [...sequentialIds, ...concurrentIds];
  const leaderboard = await getAttempts(ctx, MAZE_ID);
  assert.equal(leaderboard.status, 200);
  const rows = leaderboard.body as AttemptRow[];
  const aliceRows = rows.filter((r) => r.username === 'alice');

  assert.equal(aliceRows.length, allSubmitted.length, '提交次数与排行条数必须一致（不丢失）');
  assert.deepEqual(
    [...aliceRows.map((r) => r.id)].sort((a, b) => a - b),
    [...allSubmitted].sort((a, b) => a - b),
    '排行中的 id 集合必须与提交返回的 id 集合完全一致（不重复、不丢失）'
  );
});

test('提交与读取交错并发：每次读到的都是一致且完整的快照', async (t) => {
  const ctx = await startTestServer();
  t.after(() => stopTestServer(ctx));

  const ackedIds = new Set<number>();
  const rounds = 30;

  for (let i = 0; i < rounds; i++) {
    const baseline = new Set(ackedIds);
    const [getRes, postRes] = await Promise.all([
      getAttempts(ctx, MAZE_ID),
      postAttempt(ctx, MAZE_ID, { username: `user-${i}`, time_seconds: (i * 37) % 50 }),
    ]);

    assert.equal(getRes.status, 200, '并发读取应成功');
    assert.equal(postRes.status, 201, '并发提交应成功');
    ackedIds.add(postRes.body.id);

    const rows = getRes.body as AttemptRow[];
    const snapshotIds = new Set(rows.map((r) => r.id));

    for (const row of rows) {
      assertCompleteRow(row);
    }
    assertSorted(rows);

    for (const id of baseline) {
      assert.ok(snapshotIds.has(id), `读取发起前已确认的成绩 ${id} 必须出现在快照中（不能读到半截状态）`);
    }
    for (const id of snapshotIds) {
      assert.ok(ackedIds.has(id), `快照中的成绩 ${id} 必须来自已确认的提交（不能出现幻影数据）`);
    }
  }

  const finalRes = await getAttempts(ctx, MAZE_ID);
  const finalIds = new Set((finalRes.body as AttemptRow[]).map((r) => r.id));
  assert.deepEqual(finalIds, ackedIds, '最终排行必须恰好包含全部已确认提交');
});

test('非法输入：提交与读取两端错误语义一致且可判定', async (t) => {
  const ctx = await startTestServer();
  t.after(() => stopTestServer(ctx));

  const assertErrorShape = (res: HttpResult, expectedStatus: number, label: string) => {
    assert.equal(res.status, expectedStatus, `${label}: 状态码应为 ${expectedStatus}，实际 ${res.status}`);
    assert.equal(typeof res.body?.error, 'string', `${label}: 错误响应必须包含字符串字段 error`);
    assert.ok(res.body.error.length > 0, `${label}: error 不能为空`);
  };

  const invalidPosts: Array<[string, unknown]> = [
    ['缺少 username', { time_seconds: 10 }],
    ['username 为空字符串', { username: '', time_seconds: 10 }],
    ['username 为纯空白', { username: '   ', time_seconds: 10 }],
    ['username 非字符串', { username: 123, time_seconds: 10 }],
    ['缺少 time_seconds', { username: 'bob' }],
    ['time_seconds 为负数', { username: 'bob', time_seconds: -5 }],
    ['time_seconds 为字符串数字', { username: 'bob', time_seconds: '12' }],
    ['time_seconds 为非数字字符串', { username: 'bob', time_seconds: 'abc' }],
    ['time_seconds 为 null', { username: 'bob', time_seconds: null }],
    ['请求体为空对象', {}],
  ];

  for (const path of ['attempts', 'attempt'] as const) {
    for (const [label, payload] of invalidPosts) {
      const res = await postAttempt(ctx, MAZE_ID, payload, path);
      assertErrorShape(res, 400, `POST /${path} ${label}`);
    }
  }

  const notFoundPost = await postAttempt(ctx, 'no-such-maze', { username: 'bob', time_seconds: 10 });
  assertErrorShape(notFoundPost, 404, 'POST 不存在的迷宫');

  const notFoundGet = await getAttempts(ctx, 'no-such-maze');
  assertErrorShape(notFoundGet, 404, 'GET 不存在的迷宫');

  const malformed = await fetch(`${ctx.baseUrl}/api/mazes/${MAZE_ID}/attempts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not-json',
  });
  assertErrorShape({ status: malformed.status, body: await malformed.json() }, 400, '非法 JSON 请求体');

  const leaderboard = await getAttempts(ctx, MAZE_ID);
  assert.equal(leaderboard.status, 200, '非法提交后读取排行应正常');
  assert.deepEqual(leaderboard.body, [], '非法提交不得写入排行');

  const valid = await postAttempt(ctx, MAZE_ID, { username: 'bob', time_seconds: 0 });
  assert.equal(valid.status, 201, '边界值 0 秒应判定为合法');
  assert.equal(typeof valid.body.id, 'number');
  assert.ok(!('error' in valid.body), '成功响应不应包含 error 字段');
});

test('排行顺序稳定：相同用时的先后次序可复现', async (t) => {
  const submissions: Array<[string, number]> = [
    ['u1', 30],
    ['u2', 10],
    ['u3', 20],
    ['u4', 10],
    ['u5', 30],
    ['u6', 10],
  ];

  const runScenario = async (): Promise<string[]> => {
    const ctx = await startTestServer();
    t.after(() => stopTestServer(ctx));
    for (const [username, time_seconds] of submissions) {
      const res = await postAttempt(ctx, MAZE_ID, { username, time_seconds });
      assert.equal(res.status, 201);
    }
    const first = (await getAttempts(ctx, MAZE_ID)).body as AttemptRow[];
    const second = (await getAttempts(ctx, MAZE_ID)).body as AttemptRow[];
    assert.deepEqual(
      second.map((r) => r.id),
      first.map((r) => r.id),
      '同一状态下两次读取的顺序必须一致'
    );
    return first.map((r) => r.username);
  };

  const expected = ['u2', 'u4', 'u6', 'u3', 'u1', 'u5'];
  const run1 = await runScenario();
  assert.deepEqual(run1, expected, '相同用时必须按提交先后排序（先到先排）');

  const run2 = await runScenario();
  assert.deepEqual(run2, run1, '全新数据库上重放相同提交序列，排行顺序必须可复现');
});
