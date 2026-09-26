import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { createEvaluationsRouter } from './routes/evaluations.js';
import type { Evaluation, StatsResponse } from './types.js';

const validComment = '这是一段包含十个汉字的评价';

function makeEvaluation(id: string, overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id,
    courseName: `课程${id}`,
    teacher: '测试教师',
    rating: 4,
    comment: validComment,
    status: 'approved',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function withServer<T>(
  initialEvaluations: Evaluation[],
  run: (baseUrl: string) => Promise<T>
): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use('/api/evaluations', createEvaluationsRouter(initialEvaluations));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await closeServer(server);
  }
}

async function request<T>(
  baseUrl: string,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();

  return {
    status: response.status,
    body: (text ? JSON.parse(text) : undefined) as T,
  };
}

function postEvaluation(
  baseUrl: string,
  overrides: Record<string, unknown> = {}
): Promise<{ status: number; body: Evaluation }> {
  return request<Evaluation>(baseUrl, '/api/evaluations', {
    method: 'POST',
    body: {
      courseName: '测试课程',
      teacher: '测试教师',
      rating: 4,
      comment: validComment,
      ...overrides,
    },
  });
}

test('没有已通过评价时返回稳定的空统计结构', async () => {
  await withServer([], async (baseUrl) => {
    const response = await request<StatsResponse>(baseUrl, '/api/evaluations/stats');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      totalEvaluations: 0,
      averageScore: 0,
      topCourse: null,
      ratingDistribution: [
        { rating: 1, count: 0, percentage: 0 },
        { rating: 2, count: 0, percentage: 0 },
        { rating: 3, count: 0, percentage: 0 },
        { rating: 4, count: 0, percentage: 0 },
        { rating: 5, count: 0, percentage: 0 },
      ],
      courseAverages: [],
      recentApproved: [],
    });
  });
});

test('统计只计算已通过评价，并固定排序、截断和百分比口径', async () => {
  const approved = [
    makeEvaluation('a1', { courseName: '课程A', rating: 5, createdAt: '2024-01-01T00:00:00.000Z' }),
    makeEvaluation('a2', { courseName: '课程A', rating: 4, createdAt: '2024-01-02T00:00:00.000Z' }),
    makeEvaluation('b1', { courseName: '课程B', rating: 3, createdAt: '2024-01-03T00:00:00.000Z' }),
    makeEvaluation('b2', { courseName: '课程B', rating: 3, createdAt: '2024-01-04T00:00:00.000Z' }),
    makeEvaluation('c1', { courseName: '课程C', rating: 2, createdAt: '2024-01-05T00:00:00.000Z' }),
    makeEvaluation('d1', { courseName: '课程D', rating: 1, createdAt: '2024-01-06T00:00:00.000Z' }),
    makeEvaluation('e1', { courseName: '课程E', rating: 5, createdAt: '2024-01-07T00:00:00.000Z' }),
  ];
  const ignored = [
    makeEvaluation('pending-newer', {
      courseName: '待审核高分课程',
      rating: 5,
      status: 'pending',
      createdAt: '2024-01-08T00:00:00.000Z',
    }),
    makeEvaluation('rejected-newest', {
      courseName: '已驳回低分课程',
      rating: 1,
      status: 'rejected',
      createdAt: '2024-01-09T00:00:00.000Z',
    }),
  ];

  await withServer([...approved, ...ignored], async (baseUrl) => {
    const response = await request<StatsResponse>(baseUrl, '/api/evaluations/stats');

    assert.equal(response.status, 200);
    assert.equal(response.body.totalEvaluations, 7);
    assert.equal(response.body.averageScore, 3.3);
    assert.deepEqual(response.body.topCourse, { name: '课程E', score: 5 });
    assert.deepEqual(response.body.ratingDistribution, [
      { rating: 1, count: 1, percentage: 14.3 },
      { rating: 2, count: 1, percentage: 14.3 },
      { rating: 3, count: 2, percentage: 28.6 },
      { rating: 4, count: 1, percentage: 14.3 },
      { rating: 5, count: 2, percentage: 28.6 },
    ]);
    assert.deepEqual(response.body.courseAverages, [
      { courseName: '课程E', averageScore: 5 },
      { courseName: '课程A', averageScore: 4.5 },
      { courseName: '课程B', averageScore: 3 },
    ]);
    assert.deepEqual(
      response.body.recentApproved.map((evaluation) => evaluation.id),
      ['e1', 'd1', 'c1', 'b2', 'b1']
    );
    assert.equal(response.body.recentApproved.length, 5);
    assert.ok(response.body.recentApproved.every((evaluation) => evaluation.status === 'approved'));
  });
});

test('提交后先进入待审核，通过后立即进入统计', async () => {
  await withServer([], async (baseUrl) => {
    const created = await postEvaluation(baseUrl, { rating: 4 });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'pending');

    const beforeApproval = await request<StatsResponse>(baseUrl, '/api/evaluations/stats');
    assert.equal(beforeApproval.body.totalEvaluations, 0);
    assert.deepEqual(beforeApproval.body.recentApproved, []);

    const approved = await request<Evaluation>(
      baseUrl,
      `/api/evaluations/${created.body.id}/approve`,
      { method: 'PATCH' }
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'approved');

    const stats = await request<StatsResponse>(baseUrl, '/api/evaluations/stats');
    assert.equal(stats.body.totalEvaluations, 1);
    assert.equal(stats.body.averageScore, 4);
    assert.deepEqual(stats.body.topCourse, { name: '测试课程', score: 4 });
    assert.deepEqual(stats.body.ratingDistribution, [
      { rating: 1, count: 0, percentage: 0 },
      { rating: 2, count: 0, percentage: 0 },
      { rating: 3, count: 0, percentage: 0 },
      { rating: 4, count: 1, percentage: 100 },
      { rating: 5, count: 0, percentage: 0 },
    ]);
    assert.deepEqual(stats.body.courseAverages, [
      { courseName: '测试课程', averageScore: 4 },
    ]);
    assert.deepEqual(
      stats.body.recentApproved.map((evaluation) => evaluation.id),
      [created.body.id]
    );
  });
});

test('驳回会移除评价，未驳回的待审核评价仍可转入统计', async () => {
  await withServer([], async (baseUrl) => {
    const rejectedTarget = await postEvaluation(baseUrl, {
      courseName: '将被驳回的课程',
      rating: 5,
    });
    const kept = await postEvaluation(baseUrl, {
      courseName: '保留的课程',
      rating: 2,
    });

    const rejected = await request<{ success: boolean }>(
      baseUrl,
      `/api/evaluations/${rejectedTarget.body.id}/reject`,
      { method: 'PATCH' }
    );
    assert.equal(rejected.status, 200);
    assert.deepEqual(rejected.body, { success: true });

    const list = await request<Evaluation[]>(baseUrl, '/api/evaluations');
    assert.deepEqual(
      list.body.map((evaluation) => evaluation.id),
      [kept.body.id]
    );

    const statsBeforeApproval = await request<StatsResponse>(baseUrl, '/api/evaluations/stats');
    assert.equal(statsBeforeApproval.body.totalEvaluations, 0);

    await request<Evaluation>(baseUrl, `/api/evaluations/${kept.body.id}/approve`, {
      method: 'PATCH',
    });
    const statsAfterApproval = await request<StatsResponse>(baseUrl, '/api/evaluations/stats');
    assert.equal(statsAfterApproval.body.totalEvaluations, 1);
    assert.equal(statsAfterApproval.body.averageScore, 2);
    assert.deepEqual(
      statsAfterApproval.body.recentApproved.map((evaluation) => evaluation.id),
      [kept.body.id]
    );
  });
});

test('通过或驳回不存在的评价都返回未找到且不改变统计', async () => {
  const existing = makeEvaluation('existing', { rating: 5 });

  await withServer([existing], async (baseUrl) => {
    const before = await request<StatsResponse>(baseUrl, '/api/evaluations/stats');
    const missingApprove = await request<{ error: string }>(
      baseUrl,
      '/api/evaluations/not-found/approve',
      { method: 'PATCH' }
    );
    const missingReject = await request<{ error: string }>(
      baseUrl,
      '/api/evaluations/not-found/reject',
      { method: 'PATCH' }
    );
    const after = await request<StatsResponse>(baseUrl, '/api/evaluations/stats');

    assert.equal(missingApprove.status, 404);
    assert.equal(missingReject.status, 404);
    assert.deepEqual(after.body, before.body);
  });
});

test('提交接口校验必填字段、评分范围和评论汉字数量', async () => {
  await withServer([], async (baseUrl) => {
    const requiredFields = ['courseName', 'teacher', 'rating', 'comment'] as const;

    for (const field of requiredFields) {
      const payload: Record<string, unknown> = {
        courseName: '测试课程',
        teacher: '测试教师',
        rating: 4,
        comment: validComment,
      };
      delete payload[field];

      const response = await request<{ error: string }>(baseUrl, '/api/evaluations', {
        method: 'POST',
        body: payload,
      });
      assert.equal(response.status, 400, `缺少 ${field} 时应拒绝`);
    }

    for (const rating of [0, 6, '4']) {
      const response = await postEvaluation(baseUrl, { rating });
      assert.equal(response.status, 400, `评分 ${String(rating)} 应被拒绝`);
    }

    const tooShortComment = await postEvaluation(baseUrl, {
      comment: '一二三四五六七八九',
    });
    assert.equal(tooShortComment.status, 400);

    const exactlyTenChineseCharacters = await postEvaluation(baseUrl, {
      comment: '一二三四五六七八九十',
    });
    assert.equal(exactlyTenChineseCharacters.status, 201);
    assert.equal(exactlyTenChineseCharacters.body.status, 'pending');

    const list = await request<Evaluation[]>(baseUrl, '/api/evaluations');
    assert.deepEqual(
      list.body.map((evaluation) => evaluation.id),
      [exactlyTenChineseCharacters.body.id]
    );

    const stats = await request<StatsResponse>(baseUrl, '/api/evaluations/stats');
    assert.equal(stats.body.totalEvaluations, 0);
  });
});
