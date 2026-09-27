import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createApp, CreateAppOptions, Recipe, Ingredient, IngredientCategory } from '../../src/server/app';

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/** 在随机空闲端口上启动一个独立的服务端实例，数据完全由参数注入，不依赖外部服务。 */
export async function startTestServer(options: CreateAppOptions = {}): Promise<TestServer> {
  const app = createApp(options);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export async function api<T = unknown>(
  server: TestServer,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

let recipeSeq = 0;

export function makeRecipe(
  name: string,
  ingredients: Ingredient[],
  overrides: Partial<Recipe> = {}
): Recipe {
  recipeSeq += 1;
  return {
    id: `test-recipe-${recipeSeq}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    ingredients,
    steps: [],
    seasonings: [],
    cookTime: 15,
    difficulty: 'easy',
    cuisine: '测试菜系',
    createdAt: 1_700_000_000_000 + recipeSeq,
    ...overrides,
  };
}

export function ing(
  name: string,
  amount: number,
  unit: string,
  category: IngredientCategory = 'other'
): Ingredient {
  return { name, amount, unit, category };
}
