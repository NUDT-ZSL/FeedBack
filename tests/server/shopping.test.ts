import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api, makeRecipe, ing, TestServer } from './helpers';
import { ShoppingItem, Recipe } from '../../src/server/app';
import { preserveCheckedState } from '../../src/shared/shoppingList';

const CAT_ORDER = ['vegetable', 'meat', 'grain', 'dairy', 'seasoning', 'other'];

let server: TestServer;
let recipes: Recipe[];

before(async () => {
  recipes = [
    // 番茄炒蛋：鸡蛋 2 个；与"土豆炖牛腩"共享番茄
    makeRecipe('番茄炒蛋', [
      ing('番茄', 2, '个', 'vegetable'),
      ing('鸡蛋', 2, '个', 'other'),
      ing('盐', 2, '克', 'seasoning'),
      ing('盐', 3, '克', 'seasoning'), // 同一食谱内重复食材
    ]),
    // 土豆炖牛腩：番茄 1.5 个（小数）、鸡蛋 50 克（同名不同单位）
    makeRecipe('土豆炖牛腩', [
      ing('牛腩', 500, '克', 'meat'),
      ing('番茄', 1.5, '个', 'vegetable'),
      ing('鸡蛋', 50, '克', 'other'),
    ]),
    // 第三道：番茄以"克"计、类别标成 other（同名不同单位/类别）
    makeRecipe('番茄蛋汤', [
      ing('番茄', 100, '克', 'other'),
      ing('豆腐', 0.5, '块', 'other'),
    ]),
  ];
  server = await startTestServer({ recipes });
});

after(async () => {
  await server.close();
});

const byNameAndUnit = (list: ShoppingItem[], name: string, unit: string) =>
  list.find((i) => i.name === name && i.unit === unit);

test('跨食谱同名同单位食材合并：用量累加、来源食谱合并', async () => {
  const { data: list } = await api<ShoppingItem[]>(server, 'POST', '/api/shopping/generate', {
    recipeIds: recipes.map((r) => r.id),
  });
  const tomato = byNameAndUnit(list, '番茄', '个');
  assert.ok(tomato, '应存在番茄(个)条目');
  assert.equal(tomato!.amount, 3.5, '2 + 1.5 = 3.5，小数用量应正确累加');
  assert.deepEqual(
    [...tomato!.sourceRecipes].sort(),
    [recipes[0].id, recipes[1].id].sort(),
    '来源食谱应合并为两道食谱的集合'
  );
});

test('同名不同单位拆分为独立条目，同名不同类别时类别取首次出现', async () => {
  const { data: list } = await api<ShoppingItem[]>(server, 'POST', '/api/shopping/generate', {
    recipeIds: recipes.map((r) => r.id),
  });
  const eggGe = byNameAndUnit(list, '鸡蛋', '个');
  const eggGram = byNameAndUnit(list, '鸡蛋', '克');
  assert.ok(eggGe && eggGram, '鸡蛋应按单位拆成两条');
  assert.equal(eggGe!.amount, 2);
  assert.equal(eggGram!.amount, 50);
  assert.deepEqual(eggGram!.sourceRecipes, [recipes[1].id]);

  const tomatoGram = byNameAndUnit(list, '番茄', '克');
  assert.ok(tomatoGram, '番茄(克)应单独成条');
  assert.equal(tomatoGram!.amount, 100);
  // 番茄首次出现在"番茄炒蛋"中，类别为 vegetable
  assert.equal(tomatoGram!.category, 'vegetable', '同名食材类别应取首次出现的类别');
});

test('同一食谱内重复出现的食材用量累加且来源只计一次', async () => {
  const { data: list } = await api<ShoppingItem[]>(server, 'POST', '/api/shopping/generate', {
    recipeIds: [recipes[0].id],
  });
  const salt = byNameAndUnit(list, '盐', '克');
  assert.ok(salt);
  assert.equal(salt!.amount, 5, '2 + 3 = 5');
  assert.deepEqual(salt!.sourceRecipes, [recipes[0].id], '来源食谱不应重复');
});

test('只勾选部分食材时仅生成选中项，且名称匹配忽略大小写', async () => {
  const { data: list } = await api<ShoppingItem[]>(server, 'POST', '/api/shopping/generate', {
    selectedIngredients: [
      { recipeId: recipes[0].id, ingredientNames: ['番茄'] },
      { recipeId: recipes[1].id, ingredientNames: ['鸡蛋', '不存在的食材'] },
    ],
  });
  assert.equal(list.length, 2, '只应生成勾选的两种食材');
  assert.ok(byNameAndUnit(list, '番茄', '个'));
  assert.ok(byNameAndUnit(list, '鸡蛋', '克'));
  assert.ok(!byNameAndUnit(list, '盐', '克'), '未勾选的盐不应出现');
});

test('手动条目与食谱条目重名时合并用量，纯手动条目来源为空', async () => {
  const { data: list } = await api<ShoppingItem[]>(server, 'POST', '/api/shopping/generate', {
    recipeIds: [recipes[0].id],
    manualItems: [
      { name: '鸡蛋', amount: 3, unit: '个', category: 'other' },
      { name: '牛奶', amount: 250, unit: '毫升', category: 'dairy' },
    ],
  });
  const egg = byNameAndUnit(list, '鸡蛋', '个');
  assert.ok(egg);
  assert.equal(egg!.amount, 5, '食谱 2 个 + 手动 3 个 = 5');
  assert.deepEqual(egg!.sourceRecipes, [recipes[0].id], '手动条目不贡献来源食谱');

  const milk = byNameAndUnit(list, '牛奶', '毫升');
  assert.ok(milk);
  assert.equal(milk!.category, 'dairy');
  assert.deepEqual(milk!.sourceRecipes, [], '纯手动条目来源食谱应为空');
});

test('生成结果按类别分组顺序排列', async () => {
  const { data: list } = await api<ShoppingItem[]>(server, 'POST', '/api/shopping/generate', {
    recipeIds: recipes.map((r) => r.id),
  });
  const catIndexes = list.map((i) => CAT_ORDER.indexOf(i.category));
  const sorted = [...catIndexes].sort((a, b) => a - b);
  assert.deepEqual(catIndexes, sorted, '条目应按 vegetable→meat→…→other 的类别顺序排列');
});

test('重新生成后勾选状态按食材名保持，新条目默认未勾选', () => {
  const previous: ShoppingItem[] = [
    { id: 'a', name: '鸡蛋', amount: 2, unit: '个', category: 'other', checked: true, sourceRecipes: [] },
    { id: 'b', name: '番茄', amount: 2, unit: '个', category: 'vegetable', checked: false, sourceRecipes: [] },
  ];
  const regenerated: ShoppingItem[] = [
    { id: 'c', name: '鸡蛋', amount: 5, unit: '个', category: 'other', checked: false, sourceRecipes: [] },
    { id: 'd', name: '牛奶', amount: 250, unit: '毫升', category: 'dairy', checked: false, sourceRecipes: [] },
  ];
  const merged = preserveCheckedState(previous, regenerated);
  assert.equal(merged[0].checked, true, '同名食材重新生成后应保持勾选');
  assert.equal(merged[1].checked, false, '新出现的条目应默认未勾选');

  // 名称大小写不同也应保持
  const caseMerged = preserveCheckedState(
    [{ name: 'Egg', checked: true }],
    [{ name: 'egg', checked: false }]
  );
  assert.equal(caseMerged[0].checked, true, '勾选状态匹配应忽略大小写');
});
