import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createApp, type CreateAppOptions } from '../server/app';
import type { AppState } from '../server/state';

export const FIXED_NOW = '2026-10-07T08:00:00.000Z';
export const FIXED_TODAY = '2026-10-07';
export const FIXED_MONTH = '2026-10';
export const DEFAULT_SEED = 73;

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

export interface Client {
  get<T = unknown>(path: string): Promise<ApiResponse<T>>;
  post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>;
  put<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>>;
}

export interface ServerHandle {
  baseUrl: string;
  client: Client;
  state: AppState;
  close: () => Promise<void>;
}

function makeClient(baseUrl: string): Client {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  };
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    put: (path, body) => call('PUT', path, body),
  };
}

export async function startServer(options: CreateAppOptions = {}): Promise<ServerHandle> {
  const { app, state } = createApp({ seed: DEFAULT_SEED, fixedNow: FIXED_NOW, ...options });
  const server: Server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    state,
    client: makeClient(baseUrl),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export class CheckFailure extends Error {}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new CheckFailure(message);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
  return `{${entries.join(',')}}`;
}

export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new CheckFailure(`${label}\n    期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`);
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, label: string): void {
  const actualJson = stableStringify(actual);
  const expectedJson = stableStringify(expected);
  if (actualJson !== expectedJson) {
    throw new CheckFailure(`${label}\n    期望: ${expectedJson}\n    实际: ${actualJson}`);
  }
}

export interface CheckContext {
  server: ServerHandle;
}

export interface Check {
  id: string;
  name: string;
  run: (ctx: CheckContext) => Promise<void>;
}

interface CheckResult {
  check: Check;
  error?: Error;
}

export async function runChecks(checks: Check[]): Promise<number> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    const server = await startServer();
    try {
      await check.run({ server });
      results.push({ check });
      console.log(`  ✓ ${check.id} ${check.name}`);
    } catch (error) {
      results.push({ check, error: error as Error });
      console.log(`  ✗ ${check.id} ${check.name}`);
      console.log(`      ${(error as Error).message}`);
    } finally {
      await server.close();
    }
  }

  const failed = results.filter((r) => r.error);
  console.log('');
  if (failed.length === 0) {
    console.log(`全部通过: ${results.length}/${results.length} 项检查`);
  } else {
    console.log(`通过 ${results.length - failed.length}/${results.length}，失败 ${failed.length} 项:`);
    for (const result of failed) {
      console.log(`  - ${result.check.id} ${result.check.name}`);
    }
  }
  return failed.length === 0 ? 0 : 1;
}
