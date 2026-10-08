import fs from 'fs';
import type { Server } from 'http';
import type { CheckResult, ApiResponse } from './types';

const DB_PATH = `${process.env.TEA_VERIFY_TMP_DIR ?? '/tmp'}/tea-verify-${process.pid}.db`;

export const startTestServer = async (): Promise<{ baseUrl: string; stop: () => Promise<void> }> => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(DB_PATH + suffix);
    } catch {
      // 临时库文件不存在时忽略
    }
  }
  process.env.TEA_DB_PATH = DB_PATH;
  const { app, db } = await import('../server/index');
  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve({
          baseUrl: `http://127.0.0.1:${address.port}`,
          stop: () =>
            new Promise<void>((r) => {
              server.close(() => {
                db.close();
                for (const suffix of ['', '-wal', '-shm']) {
                  try {
                    fs.unlinkSync(DB_PATH + suffix);
                  } catch {
                    // 临时库文件不存在时忽略
                  }
                }
                r();
              });
            }),
        });
      } else {
        reject(new Error('无法获取测试服务器端口'));
      }
    });
    server.on('error', reject);
  });
};

export class CheckCollector {
  results: CheckResult[] = [];

  forModule(module: string) {
    return (name: string, ok: boolean, detail = '') => {
      this.results.push({ module, name, ok, detail });
    };
  }

  get passed() {
    return this.results.filter((r) => r.ok).length;
  }

  get failed() {
    return this.results.filter((r) => !r.ok).length;
  }
}

export const jsonApi = async (
  baseUrl: string,
  method: string,
  path: string,
  opts: { userId?: string | null; body?: unknown } = {}
): Promise<ApiResponse> => {
  const headers: Record<string, string> = {};
  if (opts.userId !== null && opts.userId !== undefined) {
    headers['x-user-id'] = opts.userId;
  }
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await response.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
};
