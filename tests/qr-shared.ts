// 二维码用例共享夹具与工具
import jwt from 'jsonwebtoken';
import { assertEqual } from './framework';
import { api, registerUser, createCourse, book } from './helpers';

// 夹具：会员 + 10分钟后开始的课程 + 有效预约 + 工作人员账号
export const setup = async (base: string) => {
  const owner = await registerUser(base, '会员');
  const staff = await registerUser(base, '工作人员');
  const course = await createCourse(base, owner.token, { capacity: 5, startInMinutes: 10 });
  const b = await book(base, owner.token, course.id);
  assertEqual(b.status, 200, '夹具预约应成功');
  return { owner, staff, booking: b.data.booking };
};

export const genQr = async (base: string, token: string, bookingId: string): Promise<string> => {
  const r = await api(base, { method: 'POST', path: '/api/qrcode', token, body: { bookingId } });
  assertEqual(r.status, 200, '生成二维码夹具应成功');
  return r.data.qrToken as string;
};

export const checkin = (base: string, token: string, qrToken: string) =>
  api(base, { method: 'POST', path: '/api/checkin', token, body: { qrToken } });

export const bookingStatus = async (base: string, token: string, bookingId: string) => {
  const mine = await api(base, { path: '/api/bookings', token });
  const found = (mine.data.bookings as any[]).find((b) => b.id === bookingId);
  return found ? found.status : undefined;
};

// 解码真实二维码并去除时间声明，便于重新签造各类非法凭证
export const cleanPayload = (qrToken: string) => {
  const p: any = (jwt as any).decode(qrToken);
  delete p.exp;
  delete p.iat;
  return p;
};
