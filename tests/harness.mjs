// 测试基座：启动真实服务端进程、提供 API 客户端与二维码凭证构造工具。
// 所有用例通过 HTTP 调用真实接口，不 mock、不直连内存数据，
// 保证验证的是外部可见行为。每个测试文件独立启动一个服务进程，
// 用例之间通过唯一邮箱与独立课程隔离内存状态，互不污染。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 与服务端 middleware/auth.ts 中默认密钥保持一致（不设置 JWT_SECRET 环境变量）
export const QR_SECRET = 'gym-secret-key-2024-qr';

let serverProc = null;
let baseUrl = null;

export function getBaseUrl() {
  if (!baseUrl) throw new Error('server not started');
  return baseUrl;
}

export async function startServer() {
  const port = 4500 + Math.floor(Math.random() * 400);
  baseUrl = `http://127.0.0.1:${port}`;
  serverProc = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js'), path.join(ROOT, 'src', 'server', 'index.ts')],
    { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  serverProc.stderr.on('data', () => {});
  serverProc.stdout.on('data', () => {});

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server failed to start within 60s');
}

export async function stopServer() {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
}

// ---- API 客户端 ----
export async function api(pathName, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${getBaseUrl()}${pathName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

// ---- 数据构造工具：每个用例使用唯一邮箱与新建课程，避免状态污染 ----
let seq = 0;
const runId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export async function registerUser(tag) {
  seq += 1;
  const email = `t-${runId}-${seq}-${tag}@test.local`;
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: { name: `tester-${tag}-${seq}`, email, password: 'pass123456' },
  });
  if (r.status !== 200) throw new Error(`register failed: ${JSON.stringify(r.data)}`);
  return { token: r.data.token, user: r.data.user, email };
}

export async function login(email) {
  const r = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'pass123456' },
  });
  if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.data)}`);
  return { token: r.data.token, user: r.data.user };
}

export async function createCourse(token, { name, startOffsetMin = 120, durationMin = 60, maxCapacity = 10 }) {
  // 每门课程使用独立教练，避免教练时间冲突检测干扰用例
  const coachRes = await api('/api/coaches', {
    method: 'POST',
    token,
    body: { name: `coach-${runId}-${seq += 1}`, specialty: 'auto-test' },
  });
  if (coachRes.status !== 200) throw new Error(`createCoach failed: ${JSON.stringify(coachRes.data)}`);
  const start = new Date(Date.now() + startOffsetMin * 60000);
  const end = new Date(start.getTime() + durationMin * 60000);
  const r = await api('/api/courses', {
    method: 'POST',
    token,
    body: {
      name: `${name}-${runId}-${seq += 1}`,
      coachId: coachRes.data.coach.id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      maxCapacity,
      description: 'auto-test',
    },
  });
  if (r.status !== 200) throw new Error(`createCourse failed: ${JSON.stringify(r.data)}`);
  return r.data.course;
}

export async function getCourse(token, courseId) {
  const r = await api('/api/courses/admin', { token });
  return r.data.courses.find((c) => c.id === courseId);
}

export async function book(token, courseId) {
  return api('/api/bookings', { method: 'POST', token, body: { courseId } });
}

export async function myBookings(token) {
  return (await api('/api/bookings', { token })).data.bookings;
}

export async function makeQrToken(token, bookingId) {
  const r = await api('/api/qrcode', { method: 'POST', token, body: { bookingId } });
  if (r.status !== 200) throw new Error(`qrcode failed: ${JSON.stringify(r.data)}`);
  return r.data.qrToken;
}

export async function checkin(token, qrToken) {
  return api('/api/checkin', { method: 'POST', token, body: { qrToken } });
}

// ---- 二维码凭证构造（用于过期/篡改/越权等风险场景）----
export function signQrToken(payload, { expired = false } = {}) {
  const body = { ...payload, generatedAt: Date.now() };
  if (expired) {
    // 直接写入过去的 exp，使服务端 jwt.verify 抛出 TokenExpiredError
    body.exp = Math.floor(Date.now() / 1000) - 120;
    body.iat = Math.floor(Date.now() / 1000) - 600;
    return jwt.sign(body, QR_SECRET, { noTimestamp: true });
  }
  return jwt.sign(body, QR_SECRET, { expiresIn: '5m' });
}

export function tamperSignature(token) {
  const parts = token.split('.');
  const sig = parts[2];
  const flipped = sig.slice(0, -2) + (sig.endsWith('A') ? 'B' : 'A') + sig.slice(-1);
  return `${parts[0]}.${parts[1]}.${flipped}`;
}
