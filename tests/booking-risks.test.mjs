// 预约链路风险验证：
// 1. 并发预约同一门容量有限的课程 —— 成功数不得超过容量，且同一用户不得重复占位
// 2. 同一用户并发/重复提交相同预约 —— 只产生一条有效预约，预约次数不重复累加
// 3. VIP 优先规则 —— 名额满时普通会员被拒、VIP 可订，VIP 预留名额同样存在上限
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, registerUser, login,
  createCourse, getCourse, book, myBookings,
} from './harness.mjs';

before(startServer);
after(stopServer);

test('并发预约：成功数不超过容量上限，且无重复用户占位', async () => {
  const CAPACITY = 3;
  const USERS = 10;
  const admin = await registerUser('admin');
  const course = await createCourse(admin.token, { name: 'conc-cap', maxCapacity: CAPACITY });

  const users = await Promise.all(Array.from({ length: USERS }, (_, i) => registerUser(`c${i}`)));
  const results = await Promise.all(users.map((u) => book(u.token, course.id)));

  const succeeded = results.filter((r) => r.status === 200);
  const failed = results.filter((r) => r.status !== 200);

  assert.equal(succeeded.length, CAPACITY,
    `成功预约数应等于容量 ${CAPACITY}，实际 ${succeeded.length}`);
  assert.equal(failed.length, USERS - CAPACITY,
    '超出容量的请求必须全部被拒绝');
  for (const f of failed) {
    assert.equal(f.status, 400, '容量不足时应返回 400');
  }

  // 每个成功用户只能占一个名额
  const bookedUserIds = succeeded.map((r) => r.data.booking.userId);
  assert.equal(new Set(bookedUserIds).size, bookedUserIds.length, '存在同一用户重复占用名额');

  // 服务端课程计数与容量一致，未超卖
  const after1 = await getCourse(admin.token, course.id);
  assert.equal(after1.currentBookings, CAPACITY,
    `课程已订数应为 ${CAPACITY}，实际 ${after1.currentBookings}（可能超卖）`);
});

test('幂等：同一用户并发提交相同预约只产生一条有效记录', async () => {
  const admin = await registerUser('admin');
  const course = await createCourse(admin.token, { name: 'idem-conc', maxCapacity: 10 });
  const user = await registerUser('dup');

  const results = await Promise.all(Array.from({ length: 6 }, () => book(user.token, course.id)));
  const succeeded = results.filter((r) => r.status === 200);
  assert.equal(succeeded.length, 1,
    `同一用户并发重复预约应只成功 1 次，实际 ${succeeded.length}`);

  const bookings = (await myBookings(user.token)).filter((b) => b.courseId === course.id);
  assert.equal(bookings.length, 1, '应只存在一条有效预约记录');

  // 预约次数不得重复累加
  const relogin = await login(user.email);
  assert.equal(relogin.user.bookingCount, 1,
    `预约次数应为 1，实际 ${relogin.user.bookingCount}（重复累加）`);

  const after1 = await getCourse(admin.token, course.id);
  assert.equal(after1.currentBookings, 1, '课程已订数应为 1');
});

test('幂等：重复提交相同预约请求不产生重复记录、不累加次数', async () => {
  const admin = await registerUser('admin');
  const course = await createCourse(admin.token, { name: 'idem-seq', maxCapacity: 10 });
  const user = await registerUser('seq');

  const first = await book(user.token, course.id);
  assert.equal(first.status, 200, '首次预约应成功');

  for (let i = 0; i < 3; i++) {
    const dup = await book(user.token, course.id);
    assert.equal(dup.status, 400, '重复预约必须被拒绝');
  }

  const bookings = (await myBookings(user.token)).filter((b) => b.courseId === course.id);
  assert.equal(bookings.length, 1, '重复提交后仍应只有一条预约记录');

  const relogin = await login(user.email);
  assert.equal(relogin.user.bookingCount, 1, '预约次数不得因重复提交而累加');

  const after1 = await getCourse(admin.token, course.id);
  assert.equal(after1.currentBookings, 1, '课程已订数不得因重复提交而增加');
});

test('VIP优先：名额满时普通会员被拒、VIP可订，VIP预留名额也有上限', async () => {
  const admin = await registerUser('admin');

  // 准备 6 个 VIP 用户：各完成 5 次预约触发自动升级，再重新登录换取含 vip 等级的令牌
  const upgradeCourses = [];
  for (let i = 0; i < 5; i++) {
    upgradeCourses.push(await createCourse(admin.token, { name: `upgrade-${i}`, maxCapacity: 20 }));
  }
  const vipCandidates = await Promise.all(Array.from({ length: 6 }, (_, i) => registerUser(`vip${i}`)));
  for (const u of vipCandidates) {
    for (const c of upgradeCourses) {
      const r = await book(u.token, c.id);
      assert.equal(r.status, 200, '升级用预约应成功');
    }
  }
  const vips = [];
  for (const u of vipCandidates) {
    const relogin = await login(u.email);
    assert.equal(relogin.user.level, 'vip', '预约满 5 次后应升级为 VIP');
    vips.push(relogin);
  }

  // 目标课程容量 1：普通会员占满后，普通会员被拒、VIP 仍可订
  const target = await createCourse(admin.token, { name: 'vip-target', maxCapacity: 1 });
  const normalA = await registerUser('normalA');
  const normalB = await registerUser('normalB');

  const rA = await book(normalA.token, target.id);
  assert.equal(rA.status, 200, '第一个普通会员应预约成功');

  const rB = await book(normalB.token, target.id);
  assert.equal(rB.status, 400, '名额满后普通会员必须被拒绝');
  assert.match(rB.data.message, /名额已满/, '拒绝原因应为名额已满');

  // VIP 预留名额为 5：前 5 个 VIP 成功，第 6 个被拒
  for (let i = 0; i < 5; i++) {
    const r = await book(vips[i].token, target.id);
    assert.equal(r.status, 200, `第 ${i + 1} 个 VIP 应可使用预留名额`);
  }
  const rVip6 = await book(vips[5].token, target.id);
  assert.equal(rVip6.status, 400, 'VIP 预留名额用完后第 6 个 VIP 必须被拒绝');
  assert.match(rVip6.data.message, /VIP预留名额也已满/, '拒绝原因应为 VIP 预留名额已满');

  const after1 = await getCourse(admin.token, target.id);
  assert.equal(after1.currentBookings, 6, '最终已订数应为 容量1 + VIP预留5 = 6');
});
