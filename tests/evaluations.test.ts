import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createApp } from '../src/server/app.js';
import { Evaluation } from '../src/server/types.js';

type TestServer = {
  baseUrl: string;
  server: Server;
};

function evaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    courseName: overrides.courseName ?? '测试课程',
    teacher: overrides.teacher ?? '测试教师',
    rating: overrides.rating ?? 5,
    comment: overrides.comment ?? '这是一条足够十个汉字的有效课程评价。',
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z').toISOString(),
  };
}

async function startServer(initialEvaluations: Evaluation[] = []): Promise<TestServer> {
  const app = createApp(initialEvaluations.map((item) => ({ ...item })));

  const server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });

  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/evaluations`,
    server,
  };
}

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const emptyDistribution = [1, 2, 3, 4, 5].map((rating) => ({
  rating,
  count: 0,
  percentage: 0,
}));

const emptyStats = {
  totalEvaluations: 0,
  averageScore: 0,
  topCourse: null,
  ratingDistribution: emptyDistribution,
  courseAverages: [],
  recentApproved: [],
};

describe('评价统计口径', () => {
  afterEach(async () => {
    for (const server of activeServers) {
      await stopServer(server);
    }
    activeServers.length = 0;
  });

  const activeServers: Server[] = [];

  async function createServer(initialEvaluations: Evaluation[] = []) {
    const testServer = await startServer(initialEvaluations);
    activeServers.push(testServer.server);
    return testServer.baseUrl;
  }

  it('只统计已通过评价，并固定总数、均分、星级和课程口径', async () => {
    const approved = [
      evaluation({ id: 'approved-1', courseName: '前端开发', rating: 2, createdAt: '2026-01-01T00:00:00.000Z' }),
      evaluation({ id: 'approved-2', courseName: '后端开发', rating: 5, createdAt: '2026-01-02T00:00:00.000Z' }),
      evaluation({ id: 'approved-3', courseName: '后端开发', rating: 4, createdAt: '2026-01-03T00:00:00.000Z' }),
      evaluation({ id: 'approved-4', courseName: '数据库', rating: 4, createdAt: '2026-01-04T00:00:00.000Z' }),
      evaluation({ id: 'approved-5', courseName: '人工智能', rating: 5, createdAt: '2026-01-05T00:00:00.000Z' }),
      evaluation({ id: 'approved-6', courseName: '前端开发', rating: 5, createdAt: '2026-01-06T00:00:00.000Z' }),
    ].map((item) => ({ ...item, status: 'approved' as const }));

    const hiddenPending = evaluation({
      id: 'pending-should-not-count',
      rating: 1,
      status: 'pending',
      createdAt: '2026-01-07T00:00:00.000Z',
    });
    const hiddenRejected = evaluation({
      id: 'rejected-should-not-count',
      rating: 5,
      status: 'rejected',
      createdAt: '2026-01-08T00:00:00.000Z',
    });

    const baseUrl = await createServer([...approved, hiddenPending, hiddenRejected]);
    const response = await fetch(`${baseUrl}/stats`);
    const stats = await response.json();

    assert.equal(response.status, 200);
    assert.equal(stats.totalEvaluations, 6);
    assert.equal(stats.averageScore, 4.2);
    assert.deepEqual(stats.topCourse, { name: '人工智能', score: 5 });
    assert.deepEqual(stats.ratingDistribution, [
      { rating: 1, count: 0, percentage: 0 },
      { rating: 2, count: 1, percentage: 16.7 },
      { rating: 3, count: 0, percentage: 0 },
      { rating: 4, count: 2, percentage: 33.3 },
      { rating: 5, count: 3, percentage: 50 },
    ]);
    assert.deepEqual(stats.courseAverages, [
      { courseName: '人工智能', averageScore: 5 },
      { courseName: '后端开发', averageScore: 4.5 },
      { courseName: '数据库', averageScore: 4 },
    ]);
    assert.deepEqual(
      stats.recentApproved.map((item: Evaluation) => item.id),
      ['approved-6', 'approved-5', 'approved-4', 'approved-3', 'approved-2']
    );
  });

  it('没有已通过评价时返回五个零星级档位和空集合，不返回错误', async () => {
    const pending = evaluation({ id: 'pending-empty', status: 'pending' });
    const rejected = evaluation({ id: 'rejected-empty', status: 'rejected' });
    const baseUrl = await createServer([pending, rejected]);

    const response = await fetch(`${baseUrl}/stats`);
    const stats = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(stats, emptyStats);
  });
});

describe('审核状态流转', () => {
  afterEach(async () => {
    for (const server of activeServers) {
      await stopServer(server);
    }
    activeServers.length = 0;
  });

  const activeServers: Server[] = [];

  async function createServer(initialEvaluations: Evaluation[] = []) {
    const testServer = await startServer(initialEvaluations);
    activeServers.push(testServer.server);
    return testServer.baseUrl;
  }

  it('提交后的待审核评价不进统计，通过后立即进入统计，驳回后从数据中移除', async () => {
    const baseUrl = await createServer();
    const payload = {
      courseName: '新课程',
      teacher: '新教师',
      rating: 4,
      comment: '这是一条符合要求的课程评价内容。',
    };

    const submitResponse = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const created = await submitResponse.json();

    assert.equal(submitResponse.status, 201);
    assert.equal(created.status, 'pending');
    assert.deepEqual(await (await fetch(`${baseUrl}/stats`)).json(), emptyStats);

    const approveResponse = await fetch(`${baseUrl}/${created.id}/approve`, {
      method: 'PATCH',
    });
    const approved = await approveResponse.json();
    const statsAfterApproval = await (await fetch(`${baseUrl}/stats`)).json();

    assert.equal(approveResponse.status, 200);
    assert.equal(approved.status, 'approved');
    assert.equal(statsAfterApproval.totalEvaluations, 1);
    assert.equal(statsAfterApproval.averageScore, 4);
    assert.deepEqual(
      statsAfterApproval.ratingDistribution,
      [
        { rating: 1, count: 0, percentage: 0 },
        { rating: 2, count: 0, percentage: 0 },
        { rating: 3, count: 0, percentage: 0 },
        { rating: 4, count: 1, percentage: 100 },
        { rating: 5, count: 0, percentage: 0 },
      ]
    );
    assert.deepEqual(
      statsAfterApproval.recentApproved.map((item: Evaluation) => item.id),
      [created.id]
    );

    const rejectResponse = await fetch(`${baseUrl}/${created.id}/reject`, {
      method: 'PATCH',
    });
    const rejectionResult = await rejectResponse.json();
    const listAfterRejection = await (await fetch(baseUrl)).json();
    const statsAfterRejection = await (await fetch(`${baseUrl}/stats`)).json();

    assert.equal(rejectResponse.status, 200);
    assert.deepEqual(rejectionResult, { success: true });
    assert.deepEqual(listAfterRejection, []);
    assert.deepEqual(statsAfterRejection, emptyStats);
  });

  it('通过或驳回不存在的评价时返回404，并且不改变统计', async () => {
    const existing = evaluation({ id: 'existing-approved', status: 'approved', rating: 5 });
    const baseUrl = await createServer([existing]);

    for (const action of ['approve', 'reject'] as const) {
      const response = await fetch(`${baseUrl}/missing-evaluation/${action}`, {
        method: 'PATCH',
      });
      const body = await response.json();

      assert.equal(response.status, 404);
      assert.match(body.error, /不存在/);
    }

    const list = await (await fetch(baseUrl)).json();
    const stats = await (await fetch(`${baseUrl}/stats`)).json();

    assert.deepEqual(list.map((item: Evaluation) => item.id), ['existing-approved']);
    assert.equal(stats.totalEvaluations, 1);
    assert.equal(stats.averageScore, 5);
  });
});

describe('提交评价输入校验', () => {
  afterEach(async () => {
    for (const server of activeServers) {
      await stopServer(server);
    }
    activeServers.length = 0;
  });

  const activeServers: Server[] = [];

  async function createServer(initialEvaluations: Evaluation[] = []) {
    const testServer = await startServer(initialEvaluations);
    activeServers.push(testServer.server);
    return testServer.baseUrl;
  }

  async function submitEvaluation(baseUrl: string, body: unknown) {
    return fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const validPayload = {
    courseName: '有效课程',
    teacher: '有效教师',
    rating: 5,
    comment: '这是一条符合要求的课程评价内容。',
  };

  it('课程名、教师、评分、评论缺失或为空白时拒绝提交', async () => {
    const baseUrl = await createServer();
    const invalidPayloads = [
      ['缺少课程名', { ...validPayload, courseName: undefined }],
      ['课程名为空白', { ...validPayload, courseName: '   ' }],
      ['缺少教师', { ...validPayload, teacher: undefined }],
      ['教师为空白', { ...validPayload, teacher: '   ' }],
      ['缺少评分', { ...validPayload, rating: undefined }],
      ['缺少评论', { ...validPayload, comment: undefined }],
      ['评论为空白', { ...validPayload, comment: '   ' }],
    ] as const;

    for (const [name, payload] of invalidPayloads) {
      const response = await submitEvaluation(baseUrl, payload);
      const body = await response.json();

      assert.equal(response.status, 400, name);
      assert.match(body.error, /必填/, name);
    }

    const list = await (await fetch(baseUrl)).json();
    assert.deepEqual(list, []);
  });

  it('评分必须是1到5之间的整数', async () => {
    const baseUrl = await createServer();
    const invalidRatings = [0, 6, 2.5, '5', true, null];

    for (const rating of invalidRatings) {
      const response = await submitEvaluation(baseUrl, { ...validPayload, rating });
      const body = await response.json();

      assert.equal(response.status, 400, `评分 ${String(rating)} 必须被拒绝`);
      assert.ok(body.error, `评分 ${String(rating)} 应返回错误信息`);
    }

    const response = await submitEvaluation(baseUrl, validPayload);
    const created = await response.json();

    assert.equal(response.status, 201);
    assert.equal(created.status, 'pending');
  });

  it('评论汉字数量少于10个时拒绝提交', async () => {
    const baseUrl = await createServer();
    const response = await submitEvaluation(baseUrl, {
      ...validPayload,
      comment: '只有九个汉字的评价',
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /10个汉字/);
    assert.deepEqual(await (await fetch(baseUrl)).json(), []);
    assert.deepEqual(await (await fetch(`${baseUrl}/stats`)).json(), emptyStats);
  });
});
