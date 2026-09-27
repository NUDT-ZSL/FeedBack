import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, makeRecipe, ing, TestServer } from './helpers';
import { Recipe } from '../../src/server/app';

let server: TestServer;
let recipes: Recipe[];

before(async () => {
  recipes = [
    makeRecipe('Tomato Egg Stir Fry', [ing('Tomato', 2, 'pcs', 'vegetable'), ing('Egg', 3, 'pcs', 'other')]),
    makeRecipe('红烧肉', [ing('五花肉', 500, '克', 'meat')]),
    makeRecipe('蒸蛋羹', [ing('鸡蛋', 2, '个', 'other')], { cuisine: 'Steamed' }),
  ];
  server = await startTestServer({ recipes });
});

after(async () => {
  await server.close();
});

const search = (q?: string) =>
  api<Recipe[]>(server, 'GET', q === undefined ? '/api/recipes/search' : `/api/recipes/search?q=${encodeURIComponent(q)}`);

test('搜索按菜名匹配且忽略大小写', async () => {
  for (const q of ['tomato', 'TOMATO', 'ToMaTo']) {
    const { data } = await search(q);
    assert.equal(data.length, 1, `查询 "${q}" 应命中 1 条`);
    assert.equal(data[0].name, 'Tomato Egg Stir Fry');
  }
});

test('搜索按食材匹配且忽略大小写', async () => {
  const { data } = await search('EGG');
  const names = data.map((r) => r.name);
  assert.ok(names.includes('Tomato Egg Stir Fry'), '食材 Egg 应命中');
  assert.ok(!names.includes('红烧肉'), '不含该食材的不应命中');
});

test('空查询返回全量列表，与 GET /api/recipes 一致', async () => {
  const full = (await api<Recipe[]>(server, 'GET', '/api/recipes')).data;
  for (const { data } of [await search(''), await search('   '), await search(undefined)]) {
    assert.deepEqual(
      data.map((r) => r.id),
      full.map((r) => r.id),
      '空查询结果应与全量列表同序同内容'
    );
  }
});

test('无结果查询返回空数组', async () => {
  const { data } = await search('绝不存在的菜名xyz');
  assert.deepEqual(data, []);
});

test('搜索结果与全量列表一致：均为全量子集且确实匹配查询词', async () => {
  const full = (await api<Recipe[]>(server, 'GET', '/api/recipes')).data;
  const fullIds = new Set(full.map((r) => r.id));
  const q = 'egg';
  const { data } = await search(q);
  assert.ok(data.length > 0);
  for (const r of data) {
    assert.ok(fullIds.has(r.id), '搜索结果必须来自全量列表');
    const qLower = q.toLowerCase();
    const matched =
      r.name.toLowerCase().includes(qLower) ||
      r.cuisine.toLowerCase().includes(qLower) ||
      r.ingredients.some((i) => i.name.toLowerCase().includes(qLower));
    assert.ok(matched, `结果 "${r.name}" 应确实匹配查询词`);
  }
  // 全量列表中所有匹配项都应出现在结果中（无遗漏）
  const expected = full.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.cuisine.toLowerCase().includes(q) ||
      r.ingredients.some((i) => i.name.toLowerCase().includes(q))
  );
  assert.deepEqual(
    data.map((r) => r.id).sort(),
    expected.map((r) => r.id).sort(),
    '搜索结果应与全量列表中的匹配集合完全一致'
  );
});
