// 预约链路风险验证：容量上限、并发占用、VIP优先边界
import { test, assert, assertEqual } from './framework';
import { api, registerUser, makeVip, createCourse, book, getCourse, login } from './helpers';

const GROUP = '预约容量与并发';

test(GROUP, '并发预约同一课程：成功数不超过容量上限', async (base) => {
  const admin = await registerUser(base, '管理员');
  const course = await createCourse(base, admin.token, { capacity: 5, startInMinutes: 120 });
  const users = await Promise.all(Array.from({ length: 12 }, () => registerUser(base)));

  const results = await Promise.all(users.map((u) => book(base, u.token, course.id)));

  const ok = results.filter((r) => r.status === 200);
  const rejected = results.filter((r) => r.status !== 200);
  assertEqual(ok.length, 5, '并发预约成功数必须等于容量');
  assert(rejected.every((r) => r.status === 400), '超出容量的请求必须返回400');

  const view = await getCourse(base, admin.token, course.id);
  assertEqual(view.currentBookings, 5, '课程已约人数不能超过容量');
});

test(GROUP, '并发预约：同一用户不能重复占用名额', async (base) => {
  const admin = await registerUser(base);
  const course = await createCourse(base, admin.token, { capacity: 5, startInMinutes: 120 });
  const users = await Promise.all(Array.from({ length: 8 }, () => registerUser(base)));

  const results = await Promise.all(users.map((u) => book(base, u.token, course.id)));
  const bookedIds = results.filter((r) => r.status === 200).map((r) => r.data.booking.userId);
  assertEqual(new Set(bookedIds).size, bookedIds.length, '成功预约中不得出现重复用户');

  for (const u of users) {
    const mine = await api(base, { path: '/api/bookings', token: u.token });
    const active = (mine.data.bookings as any[]).filter((b) => b.status !== 'cancelled');
    assert(active.length <= 1, `用户${u.user.id}出现多条有效预约`);
    const session = await login(base, u.email, u.password);
    assert(session.user.bookingCount <= 1, '预约次数被重复累加');
  }
});

test(GROUP, 'VIP优先：满员后普通会员被拒而VIP可继续预约，VIP预留名额也有上限', async (base) => {
  const admin = await registerUser(base);
  const course = await createCourse(base, admin.token, { capacity: 3, startInMinutes: 120 });

  // 普通会员填满容量
  for (let i = 0; i < 3; i++) {
    const u = await registerUser(base);
    const r = await book(base, u.token, course.id);
    assertEqual(r.status, 200, `第${i + 1}个普通会员应预约成功`);
  }

  // 容量边界：普通会员被拒
  const normalExtra = await registerUser(base);
  const rNormal = await book(base, normalExtra.token, course.id);
  assertEqual(rNormal.status, 400, '满员后普通会员必须被拒绝');
  assert(String(rNormal.data.message).includes('名额已满'), '拒绝原因应为名额已满');

  // 相同状态下VIP可以预约 —— 与普通会员形成可区分的差异
  const vip1 = await makeVip(base, await registerUser(base));
  const rVip1 = await book(base, vip1.token, course.id);
  assertEqual(rVip1.status, 200, '满员后VIP会员应仍可预约（VIP优先）');

  // VIP占用预留名额期间，普通会员依然被拒
  const normalExtra2 = await registerUser(base);
  const rNormal2 = await book(base, normalExtra2.token, course.id);
  assertEqual(rNormal2.status, 400, 'VIP占用预留名额期间普通会员仍应被拒');

  // VIP预留名额（5个）同样有限：容量3 + 预留5 = 8
  for (let i = 0; i < 4; i++) {
    const vip = await makeVip(base, await registerUser(base));
    const r = await book(base, vip.token, course.id);
    assertEqual(r.status, 200, `第${i + 2}个VIP应预约成功`);
  }
  const vipOverflow = await makeVip(base, await registerUser(base));
  const rOverflow = await book(base, vipOverflow.token, course.id);
  assertEqual(rOverflow.status, 400, 'VIP预留名额用完后VIP也必须被拒绝');

  const view = await getCourse(base, admin.token, course.id);
  assertEqual(view.currentBookings, 8, '最终预约数应等于容量+VIP预留名额');
});
