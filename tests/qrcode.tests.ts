// 二维码核验风险验证（一）：合法基线、过期、签名篡改、越权生成
import { test, assert, assertEqual } from './framework';
import { api, registerUser, expiredQr, wrongSecretQr, tamperQr } from './helpers';
import { setup, genQr, checkin, bookingStatus, cleanPayload } from './qr-shared';

const GROUP = '二维码签到核验';

test(GROUP, '基线：合法凭证核销成功，预约状态同步为已签到', async (base) => {
  const { owner, staff, booking } = await setup(base);
  const qrToken = await genQr(base, owner.token, booking.id);

  const r = await checkin(base, staff.token, qrToken);
  assertEqual(r.status, 200, '合法凭证必须核销成功');
  assertEqual(r.data.booking.status, 'checked-in', '核销后预约状态应为checked-in');
  assertEqual(await bookingStatus(base, owner.token, booking.id), 'checked-in', '预约记录状态必须与签到结果一致');
});

test(GROUP, '过期凭证必须被拒绝且原因可区分', async (base) => {
  const { owner, staff, booking } = await setup(base);
  const qrToken = await genQr(base, owner.token, booking.id);

  const r = await checkin(base, staff.token, expiredQr(cleanPayload(qrToken)));
  assertEqual(r.status, 400, '过期凭证必须被拒绝');
  assert(String(r.data.message).includes('过期'), `过期失败应有明确提示，实际: ${r.data.message}`);
  assertEqual(await bookingStatus(base, owner.token, booking.id), 'booked', '过期核销不得改变预约状态');
});

test(GROUP, '签名被篡改或伪造密钥签发的凭证必须被拒绝', async (base) => {
  const { owner, staff, booking } = await setup(base);
  const qrToken = await genQr(base, owner.token, booking.id);

  const r1 = await checkin(base, staff.token, tamperQr(qrToken));
  assertEqual(r1.status, 400, '篡改签名的凭证必须被拒绝');
  assert(String(r1.data.message).includes('无效'), '篡改失败应提示无效二维码');

  const r2 = await checkin(base, staff.token, wrongSecretQr(cleanPayload(qrToken)));
  assertEqual(r2.status, 400, '伪造密钥签发的凭证必须被拒绝');

  assertEqual(await bookingStatus(base, owner.token, booking.id), 'booked', '非法凭证不得改变预约状态');
});

test(GROUP, '无权为他人预约生成签到二维码', async (base) => {
  const { booking } = await setup(base);
  const stranger = await registerUser(base, '陌生人');
  const r = await api(base, { method: 'POST', path: '/api/qrcode', token: stranger.token, body: { bookingId: booking.id } });
  assertEqual(r.status, 403, '为他人预约生成二维码必须返回403');
});
