import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { app } from '../src/server/server';

export interface ApiResult {
  status: number;
  body: any;
}

let server: Server | null = null;
let baseUrl = '';

export async function startServer(): Promise<void> {
  server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

export async function stopServer(): Promise<void> {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((resolve, reject) => {
    s.close((err) => (err ? reject(err) : resolve()));
  });
}

export async function api(
  method: string,
  path: string,
  payload?: unknown,
): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { __raw: text };
  }
  return { status: res.status, body };
}

let seq = 0;

export function uniqueEmail(tag: string): string {
  seq += 1;
  return `tester-${tag}-${Date.now()}-${seq}@example.com`;
}

export async function createEvent(
  overrides: Record<string, unknown> = {},
): Promise<any> {
  seq += 1;
  const payload = {
    name: `测试活动-${Date.now()}-${seq}`,
    dateTime: new Date(Date.now() + 86400000).toISOString(),
    location: '自动化测试场地',
    maxCapacity: 10,
    description: '由自动化行为验证创建，可安全忽略',
    ...overrides,
  };
  const res = await api('POST', '/api/events', payload);
  if (res.status !== 201) {
    throw new Error(`创建测试活动失败: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function registerAttendee(
  eventId: string,
  name: string,
  email: string,
): Promise<ApiResult> {
  return api('POST', '/api/register', { eventId, name, email });
}
