import './helper.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, resetStore, type TestServer } from './helper.js';

let server: TestServer;

before(async () => {
  server = await startServer();
});

after(async () => {
  await server.close();
});

beforeEach(() => {
  resetStore();
});

const PENDING_BAND = 'band-3'; // pending in seed data
const APPROVED_BAND = 'band-1'; // already approved in seed data
const REJECTED_BAND = 'band-5'; // already rejected in seed data

test('review: pending band can be approved', async () => {
  const res = await api(server.base, 'POST', `/api/bands/${PENDING_BAND}/review`, { status: 'approved' });
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'approved');

  const band = await api(server.base, 'GET', `/api/bands/${PENDING_BAND}`);
  assert.equal(band.data.status, 'approved');
});

test('review: pending band can be rejected', async () => {
  const res = await api(server.base, 'POST', `/api/bands/${PENDING_BAND}/review`, { status: 'rejected' });
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'rejected');
});

test('review: repeated submission does not overwrite the decided status', async () => {
  const first = await api(server.base, 'POST', `/api/bands/${PENDING_BAND}/review`, { status: 'approved' });
  assert.equal(first.status, 200);

  const second = await api(server.base, 'POST', `/api/bands/${PENDING_BAND}/review`, { status: 'approved' });
  assert.equal(second.status, 409, 're-reviewing a decided band must be rejected');
  assert.equal(second.data.status, 'approved', 'response reports the stable current status');

  const band = await api(server.base, 'GET', `/api/bands/${PENDING_BAND}`);
  assert.equal(band.data.status, 'approved');
});

test('review: a decided band cannot be flipped by a later opposite decision', async () => {
  await api(server.base, 'POST', `/api/bands/${PENDING_BAND}/review`, { status: 'rejected' });
  const flip = await api(server.base, 'POST', `/api/bands/${PENDING_BAND}/review`, { status: 'approved' });
  assert.equal(flip.status, 409);

  const band = await api(server.base, 'GET', `/api/bands/${PENDING_BAND}`);
  assert.equal(band.data.status, 'rejected', 'first decision wins, no overwrite');
});

test('review: concurrent approve/reject settle into exactly one final state', async () => {
  const [a, b] = await Promise.all([
    api(server.base, 'POST', `/api/bands/${PENDING_BAND}/review`, { status: 'approved' }),
    api(server.base, 'POST', `/api/bands/${PENDING_BAND}/review`, { status: 'rejected' })
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409], 'exactly one decision may win');

  const band = await api(server.base, 'GET', `/api/bands/${PENDING_BAND}`);
  const winner = a.status === 200 ? a.data.status : b.data.status;
  assert.equal(band.data.status, winner, 'stored state matches the single winning decision');
});

test('review: seed bands that are already decided return 409', async () => {
  const approved = await api(server.base, 'POST', `/api/bands/${APPROVED_BAND}/review`, { status: 'rejected' });
  assert.equal(approved.status, 409);
  const rejected = await api(server.base, 'POST', `/api/bands/${REJECTED_BAND}/review`, { status: 'approved' });
  assert.equal(rejected.status, 409);
});

test('review: invalid status value and unknown band are rejected', async () => {
  const bad = await api(server.base, 'POST', `/api/bands/${PENDING_BAND}/review`, { status: 'maybe' });
  assert.equal(bad.status, 400);
  const missing = await api(server.base, 'POST', '/api/bands/no-such-band/review', { status: 'approved' });
  assert.equal(missing.status, 404);
});

test('apply: duplicate submission with the same requestId does not create a second band', async () => {
  const payload = {
    name: '测试回声乐队',
    description: '用于验证幂等提交的乐队',
    genres: ['摇滚'],
    memberCount: 3,
    contact: 'echo@example.com',
    requestId: 'req-idem-001'
  };
  const first = await api(server.base, 'POST', '/api/bands', payload);
  assert.equal(first.status, 201);

  const retry = await api(server.base, 'POST', '/api/bands', payload);
  assert.equal(retry.status, 200, 'retry with same requestId returns the existing application');
  assert.equal(retry.data.id, first.data.id);

  const list = await api(server.base, 'GET', '/api/bands');
  const matches = list.data.filter((b: any) => b.name === payload.name);
  assert.equal(matches.length, 1, 'no duplicate band may be created');
});
