// 测试辅助：HTTP客户端、夹具构造、非法二维码伪造工具
import jwt from 'jsonwebtoken';
import { QR_JWT_CONFIG } from '../src/server/middleware/auth';
import { updateUser } from '../src/server/data/store';

export interface ApiResult {
  status: number;
  data: any;
}

export const api = async (
  base: string,
  opts: { method?: string; path: string; token?: string; body?: any }
): Promise<ApiResult> => {
  const res = await fetch(base + opts.path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // 忽略非JSON响应
  }
  return { status: res.status, data };
};

let seq = 0;

export interface Account {
  token: string;
  user: any;
  email: string;
  password: string;
}

export const registerUser = async (base: string, name = '测试用户'): Promise<Account> => {
  const email = `t${Date.now()}_${seq++}@test.local`;
  const password = 'pass123';
  const r = await api(base, {
    method: 'POST',
    path: '/api/auth/register',
    body: { name: `${name}${seq}`, email, password },
  });
  if (r.status !== 200) throw new Error(`注册夹具失败: ${JSON.stringify(r.data)}`);
  return { token: r.data.token, user: r.data.user, email, password };
};

export const login = async (base: string, email: string, password: string) => {
  const r = await api(base, {
    method: 'POST',
    path: '/api/auth/login',
    body: { email, password },
  });
  if (r.status !== 200) throw new Error(`登录夹具失败: ${JSON.stringify(r.data)}`);
  return { token: r.data.token as string, user: r.data.user };
};

// 将会员升级为VIP并重新登录：预约逻辑读取的是JWT中的level，必须换发新token
export const makeVip = async (base: string, account: Account): Promise<Account> => {
  updateUser(account.user.id, { level: 'vip' });
  const { token, user } = await login(base, account.email, account.password);
  return { ...account, token, user };
};

export const createCourse = async (
  base: string,
  token: string,
  opts: { capacity: number; startInMinutes: number }
) => {
  const coach = await api(base, {
    method: 'POST',
    path: '/api/coaches',
    token,
    body: { name: '测试教练', specialty: '测试' },
  });
  if (coach.status !== 200) throw new Error('创建教练夹具失败');
  const start = new Date(Date.now() + opts.startInMinutes * 60000);
  const end = new Date(start.getTime() + 60 * 60000);
  const course = await api(base, {
    method: 'POST',
    path: '/api/courses',
    token,
    body: {
      name: '测试课程',
      coachId: coach.data.coach.id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      maxCapacity: opts.capacity,
      description: '自动化验证课程',
    },
  });
  if (course.status !== 200) {
    throw new Error(`创建课程夹具失败: ${JSON.stringify(course.data)}`);
  }
  return course.data.course;
};

export const book = (base: string, token: string, courseId: string) =>
  api(base, { method: 'POST', path: '/api/bookings', token, body: { courseId } });

export const getCourse = async (base: string, token: string, courseId: string) => {
  const r = await api(base, { path: '/api/courses/admin', token });
  return (r.data.courses as any[]).find((c) => c.id === courseId);
};

// ---- 二维码伪造工具：使用与服务端相同的密钥配置，模拟各类非法凭证 ----

export const signQr = (payload: any): string => (jwt as any).sign(payload, QR_JWT_CONFIG.secret);

export const expiredQr = (payload: any): string =>
  (jwt as any).sign(
    {
      ...payload,
      iat: Math.floor(Date.now() / 1000) - 600,
      exp: Math.floor(Date.now() / 1000) - 300,
    },
    QR_JWT_CONFIG.secret
  );

export const wrongSecretQr = (payload: any): string =>
  (jwt as any).sign(payload, 'forged-secret-key');

// 篡改签名段中间的字符（末字符可能只影响base64填充位，不可靠）
export const tamperQr = (token: string): string => {
  const parts = token.split('.');
  const sig = parts[2];
  const i = Math.floor(sig.length / 2);
  const replacement = sig[i] === 'a' ? 'b' : 'a';
  parts[2] = sig.slice(0, i) + replacement + sig.slice(i + 1);
  return parts.join('.');
};
