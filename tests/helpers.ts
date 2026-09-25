import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(HERE, '..', 'src', 'server', 'server.ts');
const TSX_CLI = path.resolve(HERE, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export interface TestServer {
  baseUrl: string;
  stop: () => void;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('无法获取可用端口'));
      }
    });
  });
}

async function waitForHealth(baseUrl: string, child: ChildProcess, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`服务器进程提前退出，exitCode=${child.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`等待测试服务器就绪超时: ${String(lastError)}`);
}

// 以子进程方式启动真实后端（独立端口、独立内存数据），测试只通过 HTTP 观察外部行为。
export async function startTestServer(): Promise<TestServer> {
  const port = await getFreePort();
  const child = spawn(process.execPath, [TSX_CLI, SERVER_ENTRY], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLogs = '';
  child.stdout?.on('data', (d) => { serverLogs += d.toString(); });
  child.stderr?.on('data', (d) => { serverLogs += d.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, child);
  } catch (err) {
    child.kill();
    throw new Error(`${(err as Error).message}\n服务器日志:\n${serverLogs}`);
  }
  return {
    baseUrl,
    stop: () => { child.kill(); },
  };
}

export async function api<T = any>(
  baseUrl: string,
  pathName: string,
  options: { method?: string; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const res = await fetch(`${baseUrl}/api${pathName}`, {
    method: options.method ?? 'GET',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

let seq = 0;

export function uniqueEmail(prefix = 'user'): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}@test.example.com`;
}

export async function createEvent(baseUrl: string, overrides: Record<string, unknown> = {}): Promise<any> {
  const res = await api(baseUrl, '/events', {
    method: 'POST',
    body: {
      name: `自动化测试活动-${Date.now()}-${++seq}`,
      dateTime: new Date(Date.now() + 86400000).toISOString(),
      location: '自动化测试场地',
      maxCapacity: 5,
      description: '由自动化行为验证创建',
      ...overrides,
    },
  });
  if (res.status !== 201) {
    throw new Error(`创建测试活动失败: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function registerParticipant(
  baseUrl: string,
  eventId: string,
  overrides: Record<string, unknown> = {},
): Promise<ApiResponse> {
  return api(baseUrl, '/register', {
    method: 'POST',
    body: { eventId, name: '测试参与者', email: uniqueEmail(), ...overrides },
  });
}
