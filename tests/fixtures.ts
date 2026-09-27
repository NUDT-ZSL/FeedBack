// Shared fixtures: start the real server in-process on an ephemeral port
// with fully controlled seed data. No external services involved.

import { Server } from 'http';
import { AddressInfo } from 'net';
import { createApp, SeedData, Recipe, Ingredient } from '../src/server/app';

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startServer(seed?: SeedData): Promise<TestServer> {
  const app = createApp(seed);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export async function api<T>(
  base: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

let idCounter = 0;

export function makeRecipe(
  name: string,
  ingredients: Ingredient[],
  extra?: Partial<Recipe>,
): Recipe {
  idCounter += 1;
  return {
    id: `test-recipe-${idCounter}`,
    name,
    ingredients,
    steps: [],
    seasonings: [],
    cookTime: 10,
    difficulty: 'easy',
    cuisine: 'home-style',
    createdAt: 1000000 + idCounter * 1000,
    ...extra,
  };
}

export function ing(
  name: string,
  amount: number,
  unit: string,
  category: Ingredient['category'],
): Ingredient {
  return { name, amount, unit, category };
}
