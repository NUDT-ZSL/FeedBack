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

const BAND1 = 'band-1'; // approved in seed data
const BAND2 = 'band-2'; // approved in seed data
const BAND3 = 'band-3'; // pending in seed data

test('create: valid schedule is written and readable back', async () => {
  const created = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND2,
    stage: 'StageA',
    startTime: '2026-07-10T18:00:00',
    endTime: '2026-07-10T19:00:00'
  });
  assert.equal(created.status, 201);
  assert.ok(created.data.id);

  const list = await api(server.base, 'GET', '/api/schedule?stage=StageA');
  assert.ok(list.data.some((s: any) => s.id === created.data.id));
});

test('conflict: overlapping slot on the same stage is rejected with conflict info', async () => {
  await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND2, stage: 'StageA',
    startTime: '2026-07-10T18:00:00', endTime: '2026-07-10T19:00:00'
  });
  const dup = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND2, stage: 'StageA',
    startTime: '2026-07-10T18:30:00', endTime: '2026-07-10T19:30:00'
  });
  assert.equal(dup.status, 400);
  assert.ok(dup.data.conflict, 'response must carry conflict details');
  assert.equal(dup.data.conflict.stage, 'StageA');
});

test('boundary: back-to-back slots on the same stage are accepted', async () => {
  await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND2, stage: 'StageA',
    startTime: '2026-07-10T18:00:00', endTime: '2026-07-10T19:00:00'
  });
  const after_ = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND2, stage: 'StageA',
    startTime: '2026-07-10T19:00:00', endTime: '2026-07-10T20:00:00'
  });
  assert.equal(after_.status, 201, 'start == previous end must be accepted');
  const before_ = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND2, stage: 'StageA',
    startTime: '2026-07-10T17:00:00', endTime: '2026-07-10T18:00:00'
  });
  assert.equal(before_.status, 201, 'end == next start must be accepted');
});

test('cross-stage: same band overlapping on another stage is rejected', async () => {
  await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND1, stage: 'StageA',
    startTime: '2026-07-10T18:00:00', endTime: '2026-07-10T19:00:00'
  });
  const dup = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND1, stage: 'StageB',
    startTime: '2026-07-10T18:30:00', endTime: '2026-07-10T19:30:00'
  });
  assert.equal(dup.status, 400, 'one band cannot play two stages at once');
  assert.equal(dup.data.conflict.stage, 'StageA');
});

test('cross-stage: same band on another stage at a disjoint time is accepted', async () => {
  await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND1, stage: 'StageA',
    startTime: '2026-07-10T18:00:00', endTime: '2026-07-10T19:00:00'
  });
  const ok = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND1, stage: 'StageB',
    startTime: '2026-07-10T19:00:00', endTime: '2026-07-10T20:00:00'
  });
  assert.equal(ok.status, 201);
});

test('cross-stage: band conflict also applies against seed data on the main stage', async () => {
  // seed: band-1 plays the main stage 2026-07-01 18:00-19:00
  const dup = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND1, stage: 'StageC',
    startTime: '2026-07-01T18:30:00', endTime: '2026-07-01T19:30:00'
  });
  assert.equal(dup.status, 400);
});

test('cross-midnight: overnight show is stored and conflicts into the next day', async () => {
  const overnight = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND2, stage: 'StageA',
    startTime: '2026-07-10T23:00:00', endTime: '2026-07-10T01:00:00'
  });
  assert.equal(overnight.status, 201, 'end before start means the show runs past midnight');

  const clash = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND1, stage: 'StageA',
    startTime: '2026-07-11T00:30:00', endTime: '2026-07-11T01:30:00'
  });
  assert.equal(clash.status, 400, '00:30 next day lies inside the 23:00-01:00 show');

  const adjacent = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND1, stage: 'StageA',
    startTime: '2026-07-11T01:00:00', endTime: '2026-07-11T02:00:00'
  });
  assert.equal(adjacent.status, 201, '01:00 next day is exactly the resolved end');
});

test('idempotency: repeating a create with the same requestId does not duplicate the schedule', async () => {
  const payload = {
    bandId: BAND2, stage: 'StageA',
    startTime: '2026-07-10T18:00:00', endTime: '2026-07-10T19:00:00',
    requestId: 'sched-req-001'
  };
  const first = await api(server.base, 'POST', '/api/schedule', payload);
  assert.equal(first.status, 201);

  const retry = await api(server.base, 'POST', '/api/schedule', payload);
  assert.equal(retry.status, 200);
  assert.equal(retry.data.id, first.data.id);

  const list = await api(server.base, 'GET', '/api/schedule?stage=StageA');
  const matches = list.data.filter((s: any) => s.id === first.data.id);
  assert.equal(matches.length, 1);
  assert.equal(
    list.data.filter((s: any) => s.startTime === payload.startTime).length,
    1,
    'only one schedule may occupy the slot after a retry'
  );
});

test('validation: pending band cannot be scheduled', async () => {
  const res = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND3, stage: 'StageA',
    startTime: '2026-07-10T18:00:00', endTime: '2026-07-10T19:00:00'
  });
  assert.equal(res.status, 400);
});

test('validation: time not aligned to 15 minutes is rejected', async () => {
  const res = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND1, stage: 'StageA',
    startTime: '2026-07-10T18:07:00', endTime: '2026-07-10T19:00:00'
  });
  assert.equal(res.status, 400);
});

test('update: moving a schedule into a conflict is rejected, moving to a free slot works', async () => {
  await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND2, stage: 'StageA',
    startTime: '2026-07-10T18:00:00', endTime: '2026-07-10T19:00:00'
  });
  const b = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND2, stage: 'StageA',
    startTime: '2026-07-10T20:00:00', endTime: '2026-07-10T21:00:00'
  });
  const clash = await api(server.base, 'PUT', `/api/schedule/${b.data.id}`, {
    startTime: '2026-07-10T18:30:00', endTime: '2026-07-10T19:30:00'
  });
  assert.equal(clash.status, 400);

  const ok = await api(server.base, 'PUT', `/api/schedule/${b.data.id}`, {
    startTime: '2026-07-10T19:00:00', endTime: '2026-07-10T20:00:00'
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.startTime, '2026-07-10T19:00:00');
});

test('update: moving a schedule into the same band on another stage is rejected', async () => {
  await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND1, stage: 'StageA',
    startTime: '2026-07-10T18:00:00', endTime: '2026-07-10T19:00:00'
  });
  const b = await api(server.base, 'POST', '/api/schedule', {
    bandId: BAND1, stage: 'StageB',
    startTime: '2026-07-10T20:00:00', endTime: '2026-07-10T21:00:00'
  });
  const clash = await api(server.base, 'PUT', `/api/schedule/${b.data.id}`, {
    startTime: '2026-07-10T18:30:00', endTime: '2026-07-10T19:30:00'
  });
  assert.equal(clash.status, 400, 'band cannot be moved into itself across stages');
});

test('isolation: store resets between tests (no leftover from earlier tests)', async () => {
  const list = await api(server.base, 'GET', '/api/schedule?stage=StageA');
  assert.equal(list.data.length, 0, 'StageA schedules from previous tests must be gone');
});
