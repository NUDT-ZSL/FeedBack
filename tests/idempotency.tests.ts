// 重复提交幂等验证：同一预约请求重复提交不应产生多条记录或重复累加次数
import { test, assertEqual } from './framework';
import { api, registerUser, createCourse, book, getCourse, login } from './helpers';

const GROUP = '重复提交幂等';

test(GROUP, '顺序重复提交同一预约：只产生一条有效预约且次数不重复累加', async (base) => {
  const admin = await registerUser(base);
  const course = await createCourse(base, admin.token, { capacity: 5, startInMinutes: 120 });
  const user = await registerUser(base);

  const first = await book(base, user.token, course.id);
  assertEqual(first.status, 200, '首次预约应成功');
  const second = await book(base, user.token, course.id);
  assertEqual(second.status, 400, '重复提交必须被拒绝');

  const mine = await api(base, { path: '/api/bookings', token: user.token });
  const active = (mine.data.bookings as any[]).filter((b) => b.status !== 'cancelled');
  assertEqual(active.length, 1, '重复提交不得产生多条有效预约');

  const session = await login(base, user.email, user.password);
  assertEqual(session.user.bookingCount, 1, '预约次数不得重复累加');

  const view = await getCourse(base, admin.token, course.id);
  assertEqual(view.currentBookings, 1, '课程名额不得被重复占用');
});

test(GROUP, '并发重复提交同一预约：只有一次生效', async (base) => {
  const admin = await registerUser(base);
  const course = await createCourse(base, admin.token, { capacity: 5, startInMinutes: 120 });
  const user = await registerUser(base);

  const results = await Promise.all(Array.from({ length: 6 }, () => book(base, user.token, course.id)));
  const ok = results.filter((r) => r.status === 200);
  assertEqual(ok.length, 1, '并发重复提交只能成功一次');

  const mine = await api(base, { path: '/api/bookings', token: user.token });
  assertEqual((mine.data.bookings as any[]).length, 1, '并发重复提交不得产生多条预约记录');

  const session = await login(base, user.email, user.password);
  assertEqual(session.user.bookingCount, 1, '并发重复提交不得重复累加预约次数');

  const view = await getCourse(base, admin.token, course.id);
  assertEqual(view.currentBookings, 1, '课程名额只应被占用一次');
});
