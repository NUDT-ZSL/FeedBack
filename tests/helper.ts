// Shared test setup. Must be imported first in every test file so that
// persistence is disabled before any server module writes data.
process.env.FESTIVAL_PERSIST = '0';

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server/app.js';
import { resetStore, store } from '../src/server/data/store.js';

export { resetStore, store };

export interface TestServer {
  base: string;
  close: () => Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
  };
}

export interface ApiResult {
  status: number;
  data: any;
}

export async function api(
  base: string,
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResult> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
