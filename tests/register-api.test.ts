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

test('报名-正常输入：返回 201、未签到状态的报名记录和二维码', async () => {
  const event = await createEvent();
  const email = uniqueEmail('ok');
  const res = await registerAttendee(event.id, '张三', email);

  assert.equal(res.status, 201, `期望 201，实际 ${res.status}: ${JSON.stringify(res.body)}`);
  const reg = res.body?.registration;
  assert.ok(reg?.id, '响应应包含 registration.id');
  assert.equal(reg.eventId, event.id);
  assert.equal(reg.name, '张三');
  assert.equal(reg.email, email);
  assert.equal(reg.checkedIn, false, '新报名记录不应处于已签到状态');
  assert.ok(reg.createdAt, '报名记录应包含 createdAt');
  assert.ok(
    typeof res.body?.qrCodeDataUrl === 'string' && res.body.qrCodeDataUrl.startsWith('data:image/'),
    '响应应包含二维码 data URL',
  );

  const detail = await api('GET', `/api/events/${event.id}`);
  assert.equal(detail.body.registeredCount, 1, '报名成功后活动报名数应为 1');
});

test('报名-异常输入：缺少任一必填字段返回 400 与错误信息', async () => {
  const event = await createEvent();
  const cases: Array<[string, any]> = [
    ['缺少 eventId', { name: '李四', email: uniqueEmail('f1') }],
    ['缺少 name', { eventId: event.id, email: uniqueEmail('f2') }],
    ['缺少 email', { eventId: event.id, name: '李四' }],
  ];
  for (const [label, payload] of cases) {
    const res = await api('POST', '/api/register', payload);
    assert.equal(res.status, 400, `${label}：期望 400，实际 ${res.status}`);
    assert.equal(res.body?.error, '缺少必填字段', `${label}：错误信息语义被改变`);
  }
});

test('报名-异常输入：活动不存在返回 400 与错误信息', async () => {
  const res = await registerAttendee('no-such-event-id', '王五', uniqueEmail('ghost'));
  assert.equal(res.status, 400, `期望 400，实际 ${res.status}`);
  assert.equal(res.body?.error, '活动不存在', '活动不存在的错误语义被改变');
});

test('容量边界：最后一个名额报名成功，随后活动变为满员', async () => {
  const event = await createEvent({ maxCapacity: 2 });

  const first = await registerAttendee(event.id, '名额一', uniqueEmail('cap1'));
  assert.equal(first.status, 201, `第一个名额应报名成功，实际 ${first.status}`);

  const mid = await api('GET', `/api/events/${event.id}`);
  assert.equal(mid.body.isFull, false, '未满员时 isFull 应为 false');

  const last = await registerAttendee(event.id, '名额二', uniqueEmail('cap2'));
  assert.equal(last.status, 201, `最后一个名额应报名成功，实际 ${last.status}`);

  const full = await api('GET', `/api/events/${event.id}`);
  assert.equal(full.body.registeredCount, 2);
  assert.equal(full.body.isFull, true, '达到容量后 isFull 应为 true');
});

test('容量边界：超员报名返回 400 满员错误且不占用名额', async () => {
  const event = await createEvent({ maxCapacity: 1 });
  const first = await registerAttendee(event.id, '占位者', uniqueEmail('oc1'));
  assert.equal(first.status, 201);

  const overflow = await registerAttendee(event.id, '超员者', uniqueEmail('oc2'));
  assert.equal(overflow.status, 400, `超员报名期望 400，实际 ${overflow.status}`);
  assert.equal(overflow.body?.error, '活动已满员', '满员错误语义被改变');

  const list = await api('GET', `/api/registrations/event/${event.id}`);
  assert.equal(list.body.length, 1, '超员报名不应产生新的报名记录');
});

test('容量边界：满员后再次报名仍被拒绝且人数不变', async () => {
  const event = await createEvent({ maxCapacity: 1 });
  await registerAttendee(event.id, '占位者', uniqueEmail('full1'));

  for (let i = 0; i < 3; i += 1) {
    const res = await registerAttendee(event.id, `再来${i}`, uniqueEmail(`full${i + 2}`));
    assert.equal(res.status, 400, `满员后第 ${i + 1} 次报名期望 400，实际 ${res.status}`);
    assert.equal(res.body?.error, '活动已满员');
  }

  const detail = await api('GET', `/api/events/${event.id}`);
  assert.equal(detail.body.registeredCount, 1, '满员后报名人数不应再变化');
});

test('重复报名：同一邮箱对同一活动再次报名的行为基线', async () => {
  // 行为基线：当前接口不去重，重复报名会成功并生成独立记录、占用名额。
  // 若未来引入去重逻辑，本用例会失败，提示外部可见行为已变化。
  const event = await createEvent({ maxCapacity: 5 });
  const email = uniqueEmail('dup');

  const first = await registerAttendee(event.id, '重复者', email);
  assert.equal(first.status, 201);
  const second = await registerAttendee(event.id, '重复者', email);
  assert.equal(second.status, 201, '当前行为：同一邮箱重复报名应成功');
  assert.notEqual(
    second.body?.registration?.id,
    first.body?.registration?.id,
    '重复报名应生成独立的报名记录',
  );

  const detail = await api('GET', `/api/events/${event.id}`);
  assert.equal(detail.body.registeredCount, 2, '重复报名应占用额外名额');
});
