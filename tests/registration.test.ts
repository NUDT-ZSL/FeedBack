import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer,
  api,
  createEvent,
  registerParticipant,
  uniqueEmail,
  type TestServer,
} from './helpers.js';

// 报名接口的外部行为验证：通过 HTTP 黑盒调用真实服务，不依赖界面与手工造数。
let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(() => {
  server.stop();
});

test('正常报名：返回 201、报名记录与签到二维码，并计入活动报名人数', async () => {
  const event = await createEvent(server.baseUrl, { maxCapacity: 3 });
  const email = uniqueEmail('normal');

  const res = await registerParticipant(server.baseUrl, event.id, { name: '张三', email });
  assert.equal(res.status, 201, `正常报名应返回 201，实际 ${res.status}: ${JSON.stringify(res.body)}`);

  const { registration, qrCodeDataUrl } = res.body;
  assert.ok(registration?.id, '响应应包含报名记录 id');
  assert.equal(registration.eventId, event.id, '报名记录应关联到目标活动');
  assert.equal(registration.email, email, '报名记录应保留报名者邮箱');
  assert.equal(registration.checkedIn, false, '新报名记录初始应为未签到');
  assert.ok(
    typeof qrCodeDataUrl === 'string' && qrCodeDataUrl.startsWith('data:image/png'),
    '报名成功应返回签到二维码 data URL',
  );

  const detail = await api(server.baseUrl, `/events/${event.id}`);
  assert.equal(detail.body.registeredCount, 1, '报名成功后活动报名人数应为 1');
  assert.equal(detail.body.isFull, false, '未满员时 isFull 应为 false');

  const list = await api(server.baseUrl, `/registrations/event/${event.id}`);
  assert.deepEqual(
    list.body.map((r: any) => r.id),
    [registration.id],
    '新报名记录应出现在活动报名名单中',
  );
});

test('报名缺少必填字段：返回 400 与“缺少必填字段”错误', async () => {
  const event = await createEvent(server.baseUrl);
  const cases: Array<[string, Record<string, unknown>]> = [
    ['缺少 eventId', { name: '张三', email: uniqueEmail('miss') }],
    ['缺少 name', { eventId: event.id, email: uniqueEmail('miss') }],
    ['缺少 email', { eventId: event.id, name: '张三' }],
  ];
  for (const [label, body] of cases) {
    const res = await api(server.baseUrl, '/register', { method: 'POST', body });
    assert.equal(res.status, 400, `${label} 时应返回 400，实际 ${res.status}`);
    assert.equal(res.body?.error, '缺少必填字段', `${label} 时错误文案应为“缺少必填字段”`);
  }
});

test('报名不存在的活动：返回 400 与“活动不存在”错误', async () => {
  const res = await registerParticipant(server.baseUrl, 'event-does-not-exist');
  assert.equal(res.status, 400, `报名不存在的活动应返回 400，实际 ${res.status}`);
  assert.equal(res.body?.error, '活动不存在', '错误文案应为“活动不存在”');
});

test('容量边界：最后一个名额可报名，超员与满员后再次报名均被拒绝', async () => {
  const event = await createEvent(server.baseUrl, { maxCapacity: 2 });

  const first = await registerParticipant(server.baseUrl, event.id);
  assert.equal(first.status, 201, `第 1 人报名应成功，实际 ${first.status}`);

  const last = await registerParticipant(server.baseUrl, event.id);
  assert.equal(last.status, 201, `最后一个名额（第 2 人）报名应成功，实际 ${last.status}`);

  const fullDetail = await api(server.baseUrl, `/events/${event.id}`);
  assert.equal(fullDetail.body.registeredCount, 2, '满员后报名人数应为 2');
  assert.equal(fullDetail.body.isFull, true, '达到容量后 isFull 应为 true');

  const overflow = await registerParticipant(server.baseUrl, event.id);
  assert.equal(overflow.status, 400, `超员报名应返回 400，实际 ${overflow.status}`);
  assert.equal(overflow.body?.error, '活动已满员', '超员报名错误文案应为“活动已满员”');

  const again = await registerParticipant(server.baseUrl, event.id);
  assert.equal(again.status, 400, `满员后再次报名应返回 400，实际 ${again.status}`);
  assert.equal(again.body?.error, '活动已满员', '满员后再次报名错误文案应为“活动已满员”');

  const finalDetail = await api(server.baseUrl, `/events/${event.id}`);
  assert.equal(finalDetail.body.registeredCount, 2, '被拒绝的报名不应计入报名人数');
  const list = await api(server.baseUrl, `/registrations/event/${event.id}`);
  assert.equal(list.body.length, 2, '被拒绝的报名不应出现在报名名单中');
});

test('同一邮箱对同一活动重复报名：当前接口允许并生成相互独立的报名记录', async () => {
  const event = await createEvent(server.baseUrl, { maxCapacity: 5 });
  const email = uniqueEmail('dup');

  const first = await registerParticipant(server.baseUrl, event.id, { email });
  assert.equal(first.status, 201, `首次报名应成功，实际 ${first.status}`);

  const second = await registerParticipant(server.baseUrl, event.id, { email });
  assert.equal(second.status, 201, `同一邮箱重复报名当前应成功（行为基线），实际 ${second.status}`);
  assert.notEqual(
    second.body.registration.id,
    first.body.registration.id,
    '重复报名应生成独立的报名记录 id',
  );

  const detail = await api(server.baseUrl, `/events/${event.id}`);
  assert.equal(detail.body.registeredCount, 2, '重复报名当前应计入报名人数');
  const list = await api(server.baseUrl, `/registrations/event/${event.id}`);
  const emails = list.body.map((r: any) => r.email).sort();
  assert.deepEqual(emails, [email, email], '两条报名记录都应保留该邮箱');
});
