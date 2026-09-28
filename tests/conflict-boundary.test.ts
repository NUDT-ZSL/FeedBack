import './helper.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkTimeConflict,
  checkBandConflict,
  resolveTimestamps
} from '../src/server/utils/conflict.js';
import type { Schedule } from '../src/server/types/index.js';

function sched(partial: Partial<Schedule>): Schedule {
  return {
    id: partial.id ?? 's1',
    bandId: partial.bandId ?? 'band-a',
    bandName: partial.bandName ?? 'Band A',
    stage: partial.stage ?? 'StageA',
    startTime: partial.startTime ?? '2026-07-01T18:00:00',
    endTime: partial.endTime ?? '2026-07-01T19:00:00',
    genres: []
  };
}

test('overlap: partially overlapping interval on same stage is a conflict', () => {
  const existing = [sched({})];
  const hit = checkTimeConflict(existing, 'StageA', '2026-07-01T18:30:00', '2026-07-01T19:30:00');
  assert.ok(hit, 'expected conflict');
  assert.equal(hit!.stage, 'StageA');
});

test('boundary: end == start (back-to-back) is NOT a conflict', () => {
  const existing = [sched({})];
  assert.equal(
    checkTimeConflict(existing, 'StageA', '2026-07-01T19:00:00', '2026-07-01T20:00:00'),
    null,
    'starting exactly when the previous show ends must be allowed'
  );
  assert.equal(
    checkTimeConflict(existing, 'StageA', '2026-07-01T17:00:00', '2026-07-01T18:00:00'),
    null,
    'ending exactly when the next show starts must be allowed'
  );
});

test('boundary: one minute into the slot IS a conflict', () => {
  const existing = [sched({})];
  assert.ok(checkTimeConflict(existing, 'StageA', '2026-07-01T18:59:00', '2026-07-01T20:00:00'));
  assert.ok(checkTimeConflict(existing, 'StageA', '2026-07-01T17:00:00', '2026-07-01T18:01:00'));
});

test('containment: fully contained and fully containing intervals conflict', () => {
  const existing = [sched({})];
  assert.ok(checkTimeConflict(existing, 'StageA', '2026-07-01T18:15:00', '2026-07-01T18:45:00'));
  assert.ok(checkTimeConflict(existing, 'StageA', '2026-07-01T17:00:00', '2026-07-01T20:00:00'));
});

test('stage isolation: same time on a different stage is not a stage conflict', () => {
  const existing = [sched({})];
  assert.equal(
    checkTimeConflict(existing, 'StageB', '2026-07-01T18:30:00', '2026-07-01T19:30:00'),
    null
  );
});

test('excludeId: a schedule does not conflict with itself', () => {
  const existing = [sched({ id: 's1' })];
  assert.equal(
    checkTimeConflict(existing, 'StageA', '2026-07-01T18:30:00', '2026-07-01T19:30:00', 's1'),
    null
  );
});

test('cross-midnight: end time earlier than start resolves to the next day', () => {
  const { start, end } = resolveTimestamps('2026-07-01T23:00:00', '2026-07-01T01:00:00');
  const startDate = new Date(start);
  const endDate = new Date(end);
  assert.equal(startDate.getDate(), 1);
  assert.equal(endDate.getDate(), 2, 'show crossing midnight belongs to the next day at its end');
  assert.equal(endDate.getHours(), 1);
  assert.ok(end > start);
});

test('cross-midnight: overnight show conflicts with early-morning show of next day', () => {
  const overnight = [sched({ startTime: '2026-07-01T23:00:00', endTime: '2026-07-01T01:00:00' })];
  assert.ok(
    checkTimeConflict(overnight, 'StageA', '2026-07-02T00:30:00', '2026-07-02T01:30:00'),
    '00:30 next day falls inside the 23:00-01:00 overnight show'
  );
  assert.equal(
    checkTimeConflict(overnight, 'StageA', '2026-07-02T01:00:00', '2026-07-02T02:00:00'),
    null,
    '01:00 next day is exactly the resolved end, so it is adjacent, not overlapping'
  );
});

test('band conflict: same band on two stages at the same time is detected', () => {
  const existing = [sched({ bandId: 'band-a', stage: 'StageA' })];
  const hit = checkBandConflict(existing, 'band-a', '2026-07-01T18:30:00', '2026-07-01T19:30:00');
  assert.ok(hit, 'same band overlapping on another stage must be a conflict');
  assert.equal(hit!.stage, 'StageA');
});

test('band conflict: adjacent slots for the same band are allowed', () => {
  const existing = [sched({ bandId: 'band-a' })];
  assert.equal(
    checkBandConflict(existing, 'band-a', '2026-07-01T19:00:00', '2026-07-01T20:00:00'),
    null
  );
});

test('band conflict: different bands at the same time do not trigger band conflict', () => {
  const existing = [sched({ bandId: 'band-a' })];
  assert.equal(
    checkBandConflict(existing, 'band-b', '2026-07-01T18:30:00', '2026-07-01T19:30:00'),
    null
  );
});
