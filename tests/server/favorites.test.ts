import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, makeRecipe, TestServer } from './helpers';
import { Favorite, Recipe } from '../../src/server/app';

let server: TestServer;
let recipes: Recipe[];

/** 校验收藏顺序自洽：order 恰好是 0..n-1 的排列，无重复、无空洞 */
function assertOrdersConsistent(favs: Favorite[]) {
  const orders = favs.map((f) => f.order).sort((a, b) => a - b);
  assert.deepEqual(
    orders,
    orders.map((_, i) => i),
    `order 应为连续排列 0..${favs.length - 1}，实际: ${orders}`
  );
  const ids = favs.map((f) => f.recipeId);
  assert.equal(new Set(ids).size, ids.length, '收藏不应有重复食谱');
}

beforeEach(async () => {
  recipes = Array.from({ length: 6 }, (_, i) => makeRecipe(`测试菜${i + 1}`, []));
  server = await startTestServer({ recipes });
});

afterEach(async () => {
  await server.close();
});

const getFavorites = () => api<Favorite[]>(server, 'GET', '/api/favorites');
const addFavorite = (recipeId: string) =>
  api<Favorite>(server, 'POST', '/api/favorites', { recipeId });
const removeFavorite = (recipeId: string) =>
  api(server, 'DELETE', `/api/favorites/${recipeId}`);

test('新增收藏按加入顺序连续编号，列表按 order 升序返回', async () => {
  for (const r of recipes.slice(0, 3)) {
    await addFavorite(r.id);
  }
  const { data: favs } = await getFavorites();
  assert.equal(favs.length, 3);
  assert.deepEqual(
    favs.map((f) => f.recipeId),
    recipes.slice(0, 3).map((r) => r.id),
    '展示顺序应与加入顺序一致'
  );
  assertOrdersConsistent(favs);
});

test('取消中间项后剩余顺序重排保持连续，重新加入排到末尾', async () => {
  for (const r of recipes.slice(0, 3)) {
    await addFavorite(r.id);
  }
  await removeFavorite(recipes[1].id);

  let favs = (await getFavorites()).data;
  assert.deepEqual(
    favs.map((f) => f.recipeId),
    [recipes[0].id, recipes[2].id],
    '取消中间项后其余相对顺序不变'
  );
  assertOrdersConsistent(favs);

  await addFavorite(recipes[1].id);
  favs = (await getFavorites()).data;
  assert.deepEqual(
    favs.map((f) => f.recipeId),
    [recipes[0].id, recipes[2].id, recipes[1].id],
    '重新加入应排到末尾'
  );
  assertOrdersConsistent(favs);
});

test('重复收藏同一食谱是幂等的，不产生重复或顺序变化', async () => {
  await addFavorite(recipes[0].id);
  await addFavorite(recipes[1].id);
  const again = await addFavorite(recipes[0].id);
  assert.equal(again.data.order, 0, '重复收藏应返回原有顺序');
  const favs = (await getFavorites()).data;
  assert.equal(favs.length, 2);
  assertOrdersConsistent(favs);
});

test('并发提交多个收藏后最终顺序自洽', async () => {
  await Promise.all(recipes.map((r) => addFavorite(r.id)));
  const favs = (await getFavorites()).data;
  assert.equal(favs.length, recipes.length, '每个食谱只应出现一次');
  assertOrdersConsistent(favs);
});

test('并发提交收藏与取消后最终顺序自洽、无重复无空洞', async () => {
  for (const r of recipes.slice(0, 4)) {
    await addFavorite(r.id);
  }
  await Promise.all([
    removeFavorite(recipes[0].id),
    removeFavorite(recipes[2].id),
    addFavorite(recipes[4].id),
    addFavorite(recipes[5].id),
  ]);
  const favs = (await getFavorites()).data;
  assert.equal(favs.length, 4, '4 - 2 + 2 = 4 条收藏');
  assert.ok(!favs.some((f) => f.recipeId === recipes[0].id));
  assert.ok(!favs.some((f) => f.recipeId === recipes[2].id));
  assert.ok(favs.some((f) => f.recipeId === recipes[4].id));
  assert.ok(favs.some((f) => f.recipeId === recipes[5].id));
  assertOrdersConsistent(favs);
});
