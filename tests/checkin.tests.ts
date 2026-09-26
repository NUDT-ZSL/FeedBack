// 二维码核验风险验证（二）：凭证归属、重复核销、并发核销
import { test, assert, assertEqual } from './framework';
import { registerUser, createCourse, book, signQr } from './helpers';
import { setup, genQr, checkin, bookingStatus } from './qr-shared';

const GROUP = '二维码签到核验';

test(GROUP, '凭证归属不符（他人预约/他人身份）必须被拒绝', async (base) => {
  const { owner, staff, booking } = await setup(base);
  const other = await registerUser(base, '他人');
  const otherCourse = await createCourse(base, other.token, { capacity: 5, startInMinutes: 10 });
  const otherBooking = (await book(base, other.token, otherCourse.id)).data.booking;

  const payload = { bookingId: booking.id, userId: owner.user.id, courseName: 'x', userName: 'x', coachName: 'x' };

  // 凭证指向他人的预约
  const r1 = await checkin(base, staff.token, signQr({ ...payload, bookingId: otherBooking.id }));
  assertEqual(r1.status, 400, '指向他人预约的凭证必须被拒绝');
  assert(String(r1.data.message).includes('不匹配'), '归属不对应有明确提示');

  // 凭证携带他人的身份
  const r2 = await checkin(base, staff.token, signQr({ ...payload, userId: other.user.id }));
  assertEqual(r2.status, 400, '身份与预约不符的凭证必须被拒绝');

  assertEqual(await bookingStatus(base, owner.token, booking.id), 'booked', '归属不符的核销不得改变预约状态');
  assertEqual(await bookingStatus(base, other.token, otherBooking.id), 'booked', '他人预约不得被核销');
});

test(GROUP, '同一凭证重复核销：第二次必须被拒绝', async (base) => {
  const { owner, staff, booking } = await setup(base);
  const qrToken = await genQr(base, owner.token, booking.id);

  const first = await checkin(base, staff.token, qrToken);
  assertEqual(first.status, 200, '首次核销应成功');
  const second = await checkin(base, staff.token, qrToken);
  assertEqual(second.status, 400, '同一凭证不得重复核销');
  assert(String(second.data.message).includes('已签到'), '重复核销应有明确提示');
  assertEqual(await bookingStatus(base, owner.token, booking.id), 'checked-in', '预约状态应保持已签到');
});

test(GROUP, '并发核销同一凭证：只有一次成功，其余被拒绝', async (base) => {
  const { owner, staff, booking } = await setup(base);
  const qrToken = await genQr(base, owner.token, booking.id);

  const results = await Promise.all(Array.from({ length: 10 }, () => checkin(base, staff.token, qrToken)));
  const ok = results.filter((r) => r.status === 200);
  const rejected = results.filter((r) => r.status !== 200);
  assertEqual(ok.length, 1, '并发核销同一凭证只能成功一次');
  assertEqual(rejected.length, 9, '其余并发核销必须被拒绝');
  assert(rejected.every((r) => r.status === 400), '失败的核销必须返回400');
  assertEqual(await bookingStatus(base, owner.token, booking.id), 'checked-in', '预约状态必须与唯一成功的核销一致');
});
