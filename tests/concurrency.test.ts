import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer,
  stopServer,
  api,
  createEvent,
  registerAttendee,
  uniqueEmail,
} from './helpers';

before(startServer);
after(stopServer);

test('并发签到：同一报名记录被并发核验多次，最终只记一次签到', async () => {
  const event = await createEvent();
  const reg = await registerAttendee(event.id, '并发者', uniqueEmail('conc'));
  assert.equal(reg.status, 201);
  const registrationId = reg.body.registration.id;

  const CONCURRENT = 12;
  const results = await Promise.all(
    Array.from({ length: CONCURRENT }, () =>
      api('POST', '/api/verify', { registrationId, eventId: event.id }),
    ),
  );

  const successes = results.filter((r) => r.body?.success === true);
  assert.equal(
    successes.length,
    1,
    `并发 ${CONCURRENT} 次核验应恰好成功 1 次，实际成功 ${successes.length} 次`,
  );
  for (const r of results) {
    assert.equal(r.status, 200, `核验响应状态异常: ${r.status}`);
    if (r.body?.success !== true) {
      assert.equal(r.body?.message, '该参与者已签到', '并发下的失败原因应为已签到');
    }
  }

  const list = await api('GET', `/api/registrations/event/${event.id}`);
  const checked = list.body.filter((r: any) => r.checkedIn);
  assert.equal(checked.length, 1, '最终应只有一条已签到记录');
  assert.equal(checked[0].id, registrationId);
});

test('并发报名：多人同时抢最后一个名额，只有一人成功', async () => {
  const event = await createEvent({ maxCapacity: 1 });

  const CONCURRENT = 8;
  const results = await Promise.all(
    Array.from({ length: CONCURRENT }, (_, i) =>
      registerAttendee(event.id, `抢名额${i}`, uniqueEmail(`race${i}`)),
    ),
  );

  const succeeded = results.filter((r) => r.status === 201);
  const rejected = results.filter((r) => r.status === 400);
  assert.equal(succeeded.length, 1, `最后名额应恰好 1 人成功，实际 ${succeeded.length} 人`);
  assert.equal(rejected.length, CONCURRENT - 1, '其余并发报名应被满员拒绝');
  for (const r of rejected) {
    assert.equal(r.body?.error, '活动已满员', '并发下满员错误语义被改变');
  }

  const detail = await api('GET', `/api/events/${event.id}`);
  assert.equal(detail.body.registeredCount, 1, '并发报名后人数不应超过容量');
  assert.equal(detail.body.isFull, true);
});
