import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer,
  api,
  createEvent,
  registerParticipant,
  type TestServer,
} from './helpers.js';

// 签到核验接口的外部行为验证：通过 HTTP 黑盒调用真实服务。
let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(() => {
  server.stop();
});

async function createEventWithRegistration() {
  const event = await createEvent(server.baseUrl, { maxCapacity: 10 });
  const regRes = await registerParticipant(server.baseUrl, event.id);
  assert.equal(regRes.status, 201, `准备测试数据失败：报名应成功，实际 ${regRes.status}`);
  return { event, registration: regRes.body.registration };
}

test('正常签到：返回 success:true 与签到时间，报名记录变为已签到', async () => {
  const { event, registration } = await createEventWithRegistration();

  const res = await api(server.baseUrl, '/verify', {
    method: 'POST',
    body: { registrationId: registration.id, eventId: event.id },
  });
  assert.equal(res.status, 200, `正常签到应返回 200，实际 ${res.status}`);
  assert.equal(res.body?.success, true, '正常签到应 success:true');
  assert.equal(res.body?.message, '签到成功', '签到成功文案应为“签到成功”');
  assert.equal(res.body?.registration?.checkedIn, true, '返回的报名记录应为已签到');
  assert.ok(res.body?.registration?.checkedInAt, '返回的报名记录应包含签到时间');

  const fetched = await api(server.baseUrl, `/registrations/${registration.id}`);
  assert.equal(fetched.body.checkedIn, true, '签到后查询报名记录应为已签到');
  assert.equal(
    fetched.body.checkedInAt,
    res.body.registration.checkedInAt,
    '签到时间应与核验响应一致',
  );
});

test('签到缺少必填字段：返回 400 且 success:false', async () => {
  const { event, registration } = await createEventWithRegistration();
  const cases: Array<[string, Record<string, unknown>]> = [
    ['缺少 registrationId', { eventId: event.id }],
    ['缺少 eventId', { registrationId: registration.id }],
  ];
  for (const [label, body] of cases) {
    const res = await api(server.baseUrl, '/verify', { method: 'POST', body });
    assert.equal(res.status, 400, `${label} 时应返回 400，实际 ${res.status}`);
    assert.equal(res.body?.success, false, `${label} 时应 success:false`);
    assert.equal(res.body?.message, '缺少必填字段', `${label} 时文案应为“缺少必填字段”`);
  }

  const fetched = await api(server.baseUrl, `/registrations/${registration.id}`);
  assert.equal(fetched.body.checkedIn, false, '非法请求不应产生签到记录');
});

test('签到不存在的报名ID：返回 success:false（报名ID不存在）', async () => {
  const { event } = await createEventWithRegistration();
  const res = await api(server.baseUrl, '/verify', {
    method: 'POST',
    body: { registrationId: 'registration-does-not-exist', eventId: event.id },
  });
  assert.equal(res.status, 200, `核验不存在的报名应返回 200，实际 ${res.status}`);
  assert.equal(res.body?.success, false, '核验不存在的报名应 success:false');
  assert.equal(res.body?.message, '报名ID不存在', '文案应为“报名ID不存在”');
});

test('跨活动核验：报名记录不属于当前活动时应拒绝且不产生签到', async () => {
  const { event: eventA, registration } = await createEventWithRegistration();
  const eventB = await createEvent(server.baseUrl, { maxCapacity: 10 });

  const cross = await api(server.baseUrl, '/verify', {
    method: 'POST',
    body: { registrationId: registration.id, eventId: eventB.id },
  });
  assert.equal(cross.status, 200, `跨活动核验应返回 200，实际 ${cross.status}`);
  assert.equal(cross.body?.success, false, '跨活动核验应 success:false');
  assert.equal(cross.body?.message, '该报名不属于当前活动', '文案应为“该报名不属于当前活动”');

  const fetched = await api(server.baseUrl, `/registrations/${registration.id}`);
  assert.equal(fetched.body.checkedIn, false, '跨活动核验不应产生签到记录');

  const correct = await api(server.baseUrl, '/verify', {
    method: 'POST',
    body: { registrationId: registration.id, eventId: eventA.id },
  });
  assert.equal(correct.body?.success, true, '使用正确的活动 id 应仍可正常签到');
});

test('重复签到：第二次核验返回 success:false 且 checkedInAt 不变', async () => {
  const { event, registration } = await createEventWithRegistration();

  const first = await api(server.baseUrl, '/verify', {
    method: 'POST',
    body: { registrationId: registration.id, eventId: event.id },
  });
  assert.equal(first.body?.success, true, '首次签到应成功');
  const firstCheckedInAt = first.body.registration.checkedInAt;

  const second = await api(server.baseUrl, '/verify', {
    method: 'POST',
    body: { registrationId: registration.id, eventId: event.id },
  });
  assert.equal(second.status, 200, `重复签到应返回 200，实际 ${second.status}`);
  assert.equal(second.body?.success, false, '重复签到应 success:false');
  assert.equal(second.body?.message, '该参与者已签到', '文案应为“该参与者已签到”');

  const fetched = await api(server.baseUrl, `/registrations/${registration.id}`);
  assert.equal(fetched.body.checkedIn, true, '重复签到后仍应为已签到');
  assert.equal(fetched.body.checkedInAt, firstCheckedInAt, '重复签到不应改变首次签到时间');
});

test('并发核验：同一报名记录并发提交多次，最终只记一次签到', async () => {
  const { event, registration } = await createEventWithRegistration();
  const concurrency = 10;

  const results = await Promise.all(
    Array.from({ length: concurrency }, () =>
      api(server.baseUrl, '/verify', {
        method: 'POST',
        body: { registrationId: registration.id, eventId: event.id },
      }),
    ),
  );

  const successes = results.filter((r) => r.body?.success === true);
  const failures = results.filter((r) => r.body?.success === false);
  assert.equal(successes.length, 1, `并发核验应恰好 1 次成功，实际 ${successes.length} 次`);
  assert.equal(failures.length, concurrency - 1, '其余并发请求应全部失败');
  for (const f of failures) {
    assert.equal(f.body?.message, '该参与者已签到', '并发下失败的请求应提示已签到');
  }

  const fetched = await api(server.baseUrl, `/registrations/${registration.id}`);
  assert.equal(fetched.body.checkedIn, true, '并发核验后报名记录应为已签到');
  assert.ok(fetched.body.checkedInAt, '并发核验后应有签到时间');

  const list = await api(server.baseUrl, `/registrations/event/${event.id}`);
  assert.equal(list.body.length, 1, '并发核验不应产生额外报名记录');
  assert.equal(
    list.body.filter((r: any) => r.checkedIn).length,
    1,
    '最终应只有一条已签到记录',
  );
});
