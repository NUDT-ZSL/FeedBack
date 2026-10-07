import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createApp, initDatabase, type AppDatabase } from '../src/server/app.ts';

interface AttemptRow {
  id: number;
  maze_id: string;
  username: string;
  time_seconds: number;
  created_at: string;
}

let db: AppDatabase;
let server: Server;
let baseUrl: string;
let tempDir: string;
let mazeSeq = 0;

before(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'maze-leaderboard-'));
  db = await initDatabase(join(tempDir, 'test.sqlite'));
  const app = createApp(db, 'test-secret');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('无法获取测试服务器端口');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  await once(server, 'close');
  await db.close();
  await rm(tempDir, { recursive: true, force: true });
});

async function createMaze(): Promise<string> {
  mazeSeq += 1;
  const id = `test-maze-${mazeSeq}`;
  await db.run(
    'INSERT INTO mazes (id, user_id, name, style, grid, markers, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    null,
    `迷宫${mazeSeq}`,
    JSON.stringify({}),
    JSON.stringify([[0]]),
    JSON.stringify([]),
    ''
  );
  return id;
}

async function postAttempt(
  mazeId: string,
  body: unknown
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}/api/mazes/${mazeId}/attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function getAttempts(
  mazeId: string
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}/api/mazes/${mazeId}/attempts`);
  return { status: response.status, body: await response.json() };
}

function assertAttemptShape(row: any): void {
  assert.equal(typeof row.id, 'number', 'id 应为数字');
  assert.equal(typeof row.maze_id, 'string', 'maze_id 应为字符串');
  assert.equal(typeof row.username, 'string', 'username 应为字符串');
  assert.equal(typeof row.time_seconds, 'number', 'time_seconds 应为数字');
  assert.equal(typeof row.created_at, 'string', 'created_at 应为字符串');
}

function assertSortedByLeaderboardOrder(rows: AttemptRow[]): void {
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const curr = rows[i];
    const ordered =
      prev.time_seconds < curr.time_seconds ||
      (prev.time_seconds === curr.time_seconds &&
        (prev.created_at < curr.created_at ||
          (prev.created_at === curr.created_at && prev.id < curr.id)));
    assert.ok(
      ordered,
      `排行顺序错误: 第 ${i} 项 ${JSON.stringify(prev)} 应排在 ${JSON.stringify(curr)} 之前`
    );
  }
}

test('同一用户连续提交多次成绩：排行不重复计入也不丢失', async () => {
  const mazeId = await createMaze();
  const times = [95, 42, 42, 128, 7];

  const posted: AttemptRow[] = [];
  for (const timeSeconds of times) {
    const { status, body } = await postAttempt(mazeId, {
      username: 'player-one',
      time_seconds: timeSeconds
    });
    assert.equal(status, 201, `提交应返回 201，实际 ${status}: ${JSON.stringify(body)}`);
    assertAttemptShape(body);
    posted.push(body);
  }

  const { status, body } = await getAttempts(mazeId);
  assert.equal(status, 200);
  assert.equal(body.length, times.length, '排行条数应等于提交次数，不得去重或丢失');

  const ids = body.map((row: AttemptRow) => row.id);
  assert.equal(new Set(ids).size, ids.length, '排行中不应出现重复记录');

  const postedIds = posted.map((row) => row.id).sort((a, b) => a - b);
  const readIds = [...ids].sort((a, b) => a - b);
  assert.deepEqual(readIds, postedIds, '读到的记录应与提交返回的记录一一对应');

  for (const row of body) {
    assertAttemptShape(row);
    assert.equal(row.maze_id, mazeId);
    assert.equal(row.username, 'player-one');
  }

  const sortedTimes = [...times].sort((a, b) => a - b);
  assert.deepEqual(
    body.map((row: AttemptRow) => row.time_seconds),
    sortedTimes,
    '排行应按用时升序返回全部成绩'
  );
});

test('提交与读取并发交错：每次读取都是一致状态', async () => {
  const mazeId = await createMaze();
  const total = 40;
  const readErrors: string[] = [];
  const seenCounts: number[] = [];
  let stopReading = false;

  const reader = (async () => {
    while (!stopReading) {
      const { status, body } = await getAttempts(mazeId);
      if (status !== 200) {
        readErrors.push(`读取排行应返回 200，实际 ${status}`);
        continue;
      }
      if (!Array.isArray(body)) {
        readErrors.push('读取排行应返回数组');
        continue;
      }
      seenCounts.push(body.length);
      const ids = new Set<number>();
      for (const row of body) {
        try {
          assertAttemptShape(row);
        } catch (error) {
          readErrors.push(`读到不完整记录: ${JSON.stringify(row)}`);
          break;
        }
        if (ids.has(row.id)) {
          readErrors.push(`读到重复记录 id=${row.id}`);
        }
        ids.add(row.id);
      }
      try {
        assertSortedByLeaderboardOrder(body);
      } catch (error) {
        readErrors.push(`读到未排序的排行: ${(error as Error).message}`);
      }
    }
  })();

  const writers = Array.from({ length: total }, (_, index) =>
    postAttempt(mazeId, {
      username: `concurrent-user-${index % 5}`,
      time_seconds: (index * 37) % 100
    }).then(({ status, body }) => {
      assert.equal(status, 201, `并发提交应成功: ${JSON.stringify(body)}`);
      return body as AttemptRow;
    })
  );

  const posted = await Promise.all(writers);
  stopReading = true;
  await reader;

  assert.ok(seenCounts.length > 0, '并发期间应至少完成一次读取');
  assert.deepEqual(readErrors, [], '并发读取不应出现半截数据或重复记录');

  const finalRead = await getAttempts(mazeId);
  assert.equal(finalRead.status, 200);
  assert.equal(finalRead.body.length, total, '全部提交完成后排行应包含所有成绩');

  const finalIds = new Set(finalRead.body.map((row: AttemptRow) => row.id));
  for (const attempt of posted) {
    assert.ok(finalIds.has(attempt.id), `提交成功的记录 id=${attempt.id} 不应丢失`);
  }
});

test('非法输入：提交与读取两端的错误语义一致且可判定', async () => {
  const mazeId = await createMaze();
  const missingMazeId = 'maze-that-does-not-exist';

  const postMissing = await postAttempt(missingMazeId, {
    username: 'player',
    time_seconds: 10
  });
  assert.equal(postMissing.status, 404, '向不存在的迷宫提交应返回 404');
  assert.equal(typeof postMissing.body.error, 'string', '404 响应应携带 error 字段');

  const getMissing = await getAttempts(missingMazeId);
  assert.equal(getMissing.status, 404, '读取不存在迷宫的排行应返回 404');
  assert.equal(typeof getMissing.body.error, 'string', '404 响应应携带 error 字段');
  assert.equal(
    postMissing.body.error,
    getMissing.body.error,
    '提交与读取对不存在迷宫的错误语义应一致'
  );

  const invalidPayloads: Array<{ name: string; payload: unknown }> = [
    { name: '用户名为空字符串', payload: { username: '', time_seconds: 10 } },
    { name: '用户名为空白字符', payload: { username: '   ', time_seconds: 10 } },
    { name: '缺少用户名', payload: { time_seconds: 10 } },
    { name: '用时为负数', payload: { username: 'player', time_seconds: -1 } },
    { name: '用时为非数字字符串', payload: { username: 'player', time_seconds: 'abc' } },
    { name: '用时为数字字符串', payload: { username: 'player', time_seconds: '10' } },
    { name: '用时为 NaN 语义(null)', payload: { username: 'player', time_seconds: null } },
    { name: '缺少用时', payload: { username: 'player' } }
  ];

  for (const { name, payload } of invalidPayloads) {
    const { status, body } = await postAttempt(mazeId, payload);
    assert.equal(status, 400, `${name} 应返回 400，实际 ${status}`);
    assert.equal(typeof body.error, 'string', `${name} 的响应应携带 error 字段`);
  }

  const { status, body } = await getAttempts(mazeId);
  assert.equal(status, 200);
  assert.equal(body.length, 0, '非法提交不应写入任何成绩');
});

test('排行顺序稳定：相同用时的先后次序可复现', async () => {
  const mazeId = await createMaze();
  const submissions = [
    { username: 'user-a', time_seconds: 60 },
    { username: 'user-b', time_seconds: 30 },
    { username: 'user-c', time_seconds: 60 },
    { username: 'user-d', time_seconds: 60 },
    { username: 'user-e', time_seconds: 90 },
    { username: 'user-f', time_seconds: 30 }
  ];

  for (const submission of submissions) {
    const { status } = await postAttempt(mazeId, submission);
    assert.equal(status, 201);
  }

  const snapshots: AttemptRow[][] = [];
  for (let i = 0; i < 3; i += 1) {
    const { status, body } = await getAttempts(mazeId);
    assert.equal(status, 200);
    snapshots.push(body);
  }

  for (let i = 1; i < snapshots.length; i += 1) {
    assert.deepEqual(
      snapshots[i].map((row) => row.id),
      snapshots[0].map((row) => row.id),
      '多次读取的排行顺序应完全一致'
    );
  }

  const snapshot = snapshots[0];
  assertSortedByLeaderboardOrder(snapshot);

  const byUsername = new Map(snapshot.map((row) => [row.username, row]));
  for (const submission of submissions) {
    assert.equal(
      byUsername.get(submission.username)?.time_seconds,
      submission.time_seconds,
      `${submission.username} 的用时应与提交一致`
    );
  }

  const tieOrder = snapshot
    .filter((row) => row.time_seconds === 60)
    .map((row) => row.username);
  assert.deepEqual(
    tieOrder,
    ['user-a', 'user-c', 'user-d'],
    '相同用时应按提交先后顺序排列'
  );
});
