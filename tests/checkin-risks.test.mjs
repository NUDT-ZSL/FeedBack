// 签到核销链路风险验证：
// 1. 有效凭证可正常核销，预约状态同步变为已签到
// 2. 过期凭证被拒绝
// 3. 签名被篡改的凭证被拒绝
// 4. 凭证归属其他用户 / 指向其他预约时被拒绝
// 5. 同一凭证重复核销被拒绝
// 6. 并发核销同一凭证只有一次成功，预约状态与签到结果一致
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, registerUser,
  createCourse, book, myBookings, makeQrToken, checkin,
  signQrToken, tamperSignature,
} from './harness.mjs';

before(startServer);
after(stopServer);

// 构造一个处于签到窗口内（10 分钟后开课）的有效预约及其二维码凭证
async function makeBookedQr(tag) {
  const admin = await registerUser(`admin-${tag}`);
  const course = await createCourse(admin.token, {
    name: `checkin-${tag}`, startOffsetMin: 10, maxCapacity: 10,
  });
  const member = await registerUser(`member-${tag}`);
  const r = await book(member.token, course.id);
  assert.equal(r.status, 200, '预约应成功');
  const qrToken = await makeQrToken(member.token, r.data.booking.id);
  return { admin, member, course, booking: r.data.booking, qrToken };
}

test('有效凭证：核销成功且预约状态变为已签到', async () => {
  const { member, booking, qrToken } = await makeBookedQr('valid');
  const coach = await registerUser('coach-valid');

  const r = await checkin(coach.token, qrToken);
  assert.equal(r.status, 200, `有效凭证核销应成功，实际 ${r.status}: ${JSON.stringify(r.data)}`);

  const bookings = await myBookings(member.token);
  const updated = bookings.find((b) => b.id === booking.id);
  assert.equal(updated.status, 'checked-in', '核销后预约状态应为 checked-in');
});

test('过期凭证：核验失败且预约状态保持未签到', async () => {
  const { member, booking } = await makeBookedQr('expired');
  const coach = await registerUser('coach-expired');
  const expiredToken = signQrToken(
    { bookingId: booking.id, userId: member.user.id, courseName: 'x', userName: 'x', coachName: 'x' },
    { expired: true }
  );

  const r = await checkin(coach.token, expiredToken);
  assert.equal(r.status, 400, '过期凭证必须被拒绝');
  assert.match(r.data.message, /过期/, '拒绝原因应为凭证过期');

  const updated = (await myBookings(member.token)).find((b) => b.id === booking.id);
  assert.equal(updated.status, 'booked', '过期核销不得改变预约状态');
});

test('篡改签名：核验失败且预约状态保持未签到', async () => {
  const { member, booking, qrToken } = await makeBookedQr('tampered');
  const coach = await registerUser('coach-tampered');

  const r = await checkin(coach.token, tamperSignature(qrToken));
  assert.equal(r.status, 400, '签名被篡改的凭证必须被拒绝');
  assert.match(r.data.message, /无效/, '拒绝原因应为凭证无效');

  const updated = (await myBookings(member.token)).find((b) => b.id === booking.id);
  assert.equal(updated.status, 'booked', '篡改凭证核销不得改变预约状态');
});

test('凭证归属：属于其他用户的凭证被拒绝', async () => {
  const { member, booking } = await makeBookedQr('owner');
  const other = await registerUser('other-user');
  const coach = await registerUser('coach-owner');

  // 签名有效，但凭证中的 userId 与预约归属用户不一致
  const foreignToken = signQrToken({
    bookingId: booking.id, userId: other.user.id,
    courseName: 'x', userName: 'x', coachName: 'x',
  });
  const r = await checkin(coach.token, foreignToken);
  assert.equal(r.status, 400, '归属其他用户的凭证必须被拒绝');
  assert.match(r.data.message, /不匹配/, '拒绝原因应为凭证与预约不匹配');

  const updated = (await myBookings(member.token)).find((b) => b.id === booking.id);
  assert.equal(updated.status, 'booked', '越权核销不得改变预约状态');
});

test('凭证归属：指向不存在预约的凭证被拒绝', async () => {
  const { member } = await makeBookedQr('ghost');
  const coach = await registerUser('coach-ghost');

  const ghostToken = signQrToken({
    bookingId: 'non-existent-booking-id', userId: member.user.id,
    courseName: 'x', userName: 'x', coachName: 'x',
  });
  const r = await checkin(coach.token, ghostToken);
  assert.equal(r.status, 404, '指向不存在预约的凭证必须被拒绝');
});

test('重复核销：同一凭证第二次使用被拒绝', async () => {
  const { member, booking, qrToken } = await makeBookedQr('reuse');
  const coach = await registerUser('coach-reuse');

  const first = await checkin(coach.token, qrToken);
  assert.equal(first.status, 200, '首次核销应成功');

  const second = await checkin(coach.token, qrToken);
  assert.equal(second.status, 400, '同一凭证重复核销必须被拒绝');
  assert.match(second.data.message, /已签到/, '拒绝原因应为已签到');

  const bookings = await myBookings(member.token);
  const updated = bookings.find((b) => b.id === booking.id);
  assert.equal(updated.status, 'checked-in', '预约状态应保持已签到');
  assert.equal(bookings.filter((b) => b.status === 'checked-in').length, 1,
    '不得产生多条已签到记录');
});

test('并发核销：同一凭证并发提交只有一次成功，状态与结果一致', async () => {
  const { member, booking, qrToken } = await makeBookedQr('race');
  const coach = await registerUser('coach-race');

  const results = await Promise.all(Array.from({ length: 8 }, () => checkin(coach.token, qrToken)));
  const succeeded = results.filter((r) => r.status === 200);
  const rejected = results.filter((r) => r.status !== 200);

  assert.equal(succeeded.length, 1,
    `并发核销同一凭证应只成功 1 次，实际 ${succeeded.length}`);
  assert.equal(rejected.length, 7, '其余并发核销必须全部被拒绝');
  for (const r of rejected) {
    assert.equal(r.status, 400, '并发竞争失败者应返回 400');
    assert.match(r.data.message, /已签到/, '竞争失败原因应为已签到');
  }

  const updated = (await myBookings(member.token)).find((b) => b.id === booking.id);
  assert.equal(updated.status, 'checked-in', '预约状态应与唯一一次成功核销一致');
});
