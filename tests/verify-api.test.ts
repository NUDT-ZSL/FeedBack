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

async function makeRegistration() {
  const event = await createEvent();
  const res = await registerAttendee(event.id, '签到者', uniqueEmail('v'));
  assert.equal(res.status, 201, `前置报名失败: ${JSON.stringify(res.body)}`);
  return { event, registration: res.body.registration };
}

test('签到-正常：首次核验成功并记录签到状态与时间', async () => {
  const { event, registration } = await makeRegistration();
  const res = await api('POST', '/api/verify', {
    registrationId: registration.id,
    eventId: event.id,
  });

  assert.equal(res.status, 200, `期望 200，实际 ${res.status}`);
  assert.equal(res.body?.success, true, '首次核验应成功');
  assert.equal(res.body?.message, '签到成功', '签到成功的消息语义被改变');
  assert.equal(res.body?.registration?.checkedIn, true, '返回的记录应已签到');
  assert.ok(res.body?.registration?.checkedInAt, '返回的记录应包含签到时间');

  const check = await api('GET', `/api/registrations/${registration.id}`);
  assert.equal(check.body.checkedIn, true, '签到状态应持久化到报名记录');
});

test('签到-重复签到：第二次核验返回失败且保持已签到状态', async () => {
  const { event, registration } = await makeRegistration();
  const first = await api('POST', '/api/verify', {
    registrationId: registration.id,
    eventId: event.id,
  });
  assert.equal(first.body?.success, true);

  const second = await api('POST', '/api/verify', {
    registrationId: registration.id,
    eventId: event.id,
  });
  assert.equal(second.status, 200);
  assert.equal(second.body?.success, false, '重复签到应返回失败');
  assert.equal(second.body?.message, '该参与者已签到', '重复签到的消息语义被改变');
  assert.equal(
    second.body?.registration?.checkedIn,
    true,
    '重复签到返回的记录应保持已签到状态',
  );

  const list = await api('GET', `/api/registrations/event/${event.id}`);
  const checkedCount = list.body.filter((r: any) => r.checkedIn).length;
  assert.equal(checkedCount, 1, '名单中应只有一条已签到记录');
});

test('签到-异常输入：报名 ID 不存在返回失败', async () => {
  const event = await createEvent();
  const res = await api('POST', '/api/verify', {
    registrationId: 'no-such-registration-id',
    eventId: event.id,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body?.success, false);
  assert.equal(res.body?.message, '报名ID不存在', '报名不存在的消息语义被改变');
});

test('签到-跨活动核验：其他活动的报名记录在当前活动核验被拒绝', async () => {
  const eventA = await createEvent();
  const eventB = await createEvent();
  const reg = await registerAttendee(eventA.id, '跨活动者', uniqueEmail('cross'));
  assert.equal(reg.status, 201);
  const registrationId = reg.body.registration.id;

  const res = await api('POST', '/api/verify', {
    registrationId,
    eventId: eventB.id,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body?.success, false, '跨活动核验应被拒绝');
  assert.equal(res.body?.message, '该报名不属于当前活动', '跨活动核验的消息语义被改变');

  const check = await api('GET', `/api/registrations/${registrationId}`);
  assert.equal(check.body.checkedIn, false, '跨活动核验不应产生签到记录');

  const listB = await api('GET', `/api/registrations/event/${eventB.id}`);
  assert.equal(listB.body.length, 0, '活动 B 不应出现他人报名记录');
});

test('签到-异常输入：缺少必填字段返回 400 与失败消息', async () => {
  const { event, registration } = await makeRegistration();
  const cases: Array<[string, any]> = [
    ['缺少 registrationId', { eventId: event.id }],
    ['缺少 eventId', { registrationId: registration.id }],
  ];
  for (const [label, payload] of cases) {
    const res = await api('POST', '/api/verify', payload);
    assert.equal(res.status, 400, `${label}：期望 400，实际 ${res.status}`);
    assert.equal(res.body?.success, false, `${label}：应返回 success=false`);
    assert.equal(res.body?.message, '缺少必填字段', `${label}：错误消息语义被改变`);
  }

  const check = await api('GET', `/api/registrations/${registration.id}`);
  assert.equal(check.body.checkedIn, false, '非法请求不应改变签到状态');
});
