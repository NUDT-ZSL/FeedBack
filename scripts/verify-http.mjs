/**
 * HTTP 冒烟验证：真实服务进程端到端闭环（离线可运行）。
 *
 * 运行：node scripts/verify-http.mjs
 *
 * 以 TIME_SCALE=0.001（60 分钟路程 ≈ 3.6 秒）、REST_COOLDOWN_MS=2000 启动真实 server.js，
 * 通过 HTTP 接口验证：抵达自动结算、冷却自动恢复、重复派单 409、删除在途信件 409、统计一致。
 */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}/api`;

const server = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT), TIME_SCALE: '0.001', REST_COOLDOWN_MS: '2000' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

let checks = 0;
function pass(label) { checks += 1; console.log(`  ✓ ${label}`); }

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

async function waitFor(cond, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) { pass(label); return; }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`超时未满足：${label}`);
}

try {
  await waitFor(async () => {
    try { return (await api('GET', '/horses')).json.success; } catch { return false; }
  }, '服务就绪');

  // 抵达结算：紧急信件到长安，逻辑 60 分钟，0.001 倍率 ≈ 3.6 秒
  const letter = (await api('POST', '/letters', {
    sender: '张三', receiver: '李四', destination: '长安', urgency: 'urgent', weight: 5,
  })).json.data;
  const task = (await api('POST', '/tasks', { letterId: letter.id, horseId: 'horse-1' })).json.data;
  assert.equal(task.status, 'in_progress');
  pass('派单成功，任务在途');

  // 重复派单被拒绝
  const dup = await api('POST', '/tasks', { letterId: letter.id, horseId: 'horse-2' });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, 'LETTER_NOT_PENDING');
  pass('重复派单被拒绝（409 LETTER_NOT_PENDING）');

  // 删除在途信件被拒绝
  const del = await api('DELETE', `/letters/${letter.id}`);
  assert.equal(del.status, 409);
  assert.equal(del.json.code, 'LETTER_IN_TRANSIT');
  pass('删除在途信件被拒绝（409 LETTER_IN_TRANSIT）');

  // 定时对账自动结算
  await waitFor(async () => (await api('GET', '/tasks')).json.data
    .find((t) => t.id === task.id)?.status === 'completed', '任务到点自动结算为 completed');
  await waitFor(async () => (await api('GET', '/letters')).json.data
    .find((l) => l.id === letter.id)?.status === 'delivered', '信件同步为 delivered');
  await waitFor(async () => (await api('GET', '/horses')).json.data
    .find((h) => h.id === 'horse-1')?.status === 'idle', '马匹同步回 idle');
  const stats = (await api('GET', '/statistics')).json.data;
  assert.ok(stats.todayDeliveries >= 1 && stats.overtimeRate === 0);
  pass(`统计一致：今日送达 ${stats.todayDeliveries}、超时率 ${stats.overtimeRate}%`);

  // 冷却到期自动恢复
  await api('POST', '/horses/horse-3/rest');
  const resting = (await api('GET', '/horses')).json.data.find((h) => h.id === 'horse-3');
  assert.equal(resting.status, 'resting');
  pass('马匹进入 resting');
  const blocked = await api('POST', '/tasks', { letterId: (await api('POST', '/letters', {
    sender: '王五', receiver: '赵六', destination: '洛阳', urgency: 'normal', weight: 3,
  })).json.data.id, horseId: 'horse-3' });
  assert.equal(blocked.status, 409);
  pass('冷却中派单被拒绝（409）');
  await waitFor(async () => (await api('GET', '/horses')).json.data
    .find((h) => h.id === 'horse-3')?.status === 'idle', '冷却到期自动恢复 idle');

  console.log(`\nHTTP 冒烟全部 ${checks} 项通过。`);
} finally {
  server.kill();
}
