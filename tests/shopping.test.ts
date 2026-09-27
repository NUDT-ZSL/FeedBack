// Shopping list aggregation: merge semantics, unit/category conflicts,
// decimals, partial selection, manual items, grouping, regeneration stability.

import { describe, it, assert, assertEqual, assertDeepEqual } from './harness';
import { startServer, api, makeRecipe, ing, TestServer } from './fixtures';
import { ShoppingItem } from '../src/server/app';

const rA = makeRecipe('Tomato Egg StirFry', [
  ing('tomato', 2, 'pcs', 'vegetable'),
  ing('egg', 3, 'pcs', 'other'),
  ing('scallion', 5, 'g', 'vegetable'),
  ing('tomato', 1.5, 'pcs', 'vegetable'), // duplicate name within one recipe
]);
const rB = makeRecipe('Tomato Beef Stew', [
  ing('tomato', 2, 'pcs', 'vegetable'),
  ing('beef', 500, 'g', 'meat'),
  ing('onion', 0.5, 'pcs', 'vegetable'),
]);
const rC = makeRecipe('Egg Drop Soup', [ing('egg', 200, 'g', 'other')]); // unit conflict with rA egg
const rD = makeRecipe('Scallion Pancake', [ing('scallion', 100, 'g', 'seasoning')]); // category conflict

let srv: TestServer;
const base = () => srv.baseUrl;

async function generate(body: unknown): Promise<ShoppingItem[]> {
  const { status, data } = await api<ShoppingItem[]>(base(), 'POST', '/api/shopping/generate', body);
  assertEqual(status, 200, 'generate status');
  return data;
}

const rowsOf = (list: ShoppingItem[], name: string) => list.filter((i) => i.name === name);

describe('shopping list aggregation', () => {
  it('merges same-name ingredients across recipes: sums amount, dedups sources', async () => {
    srv = await startServer({ recipes: [rA, rB] });
    try {
      const list = await generate({ recipeIds: [rA.id, rB.id] });
      const tomato = rowsOf(list, 'tomato');
      assertEqual(tomato.length, 1, 'tomato merged into a single row');
      assertEqual(tomato[0].amount, 5.5, 'tomato amount 2 + 1.5 + 2');
      assertEqual(tomato[0].unit, 'pcs', 'tomato unit');
      assertDeepEqual(
        [...tomato[0].sourceRecipes].sort(),
        [rA.id, rB.id].sort(),
        'tomato source recipes deduped (rA contributes tomato twice)',
      );
    } finally {
      await srv.close();
    }
  });

  it('keeps decimal amounts exact', async () => {
    srv = await startServer({ recipes: [rA, rB] });
    try {
      const list = await generate({ recipeIds: [rA.id, rB.id] });
      assertEqual(rowsOf(list, 'onion')[0].amount, 0.5, 'onion decimal amount');
      assertEqual(rowsOf(list, 'tomato')[0].amount, 5.5, 'tomato decimal sum');
    } finally {
      await srv.close();
    }
  });

  it('splits same-name different-unit into separate rows, larger amount first', async () => {
    srv = await startServer({ recipes: [rA, rC] });
    try {
      const list = await generate({ recipeIds: [rA.id, rC.id] });
      const eggs = rowsOf(list, 'egg');
      assertEqual(eggs.length, 2, 'egg appears once per unit');
      assertEqual(eggs[0].unit, 'g', 'larger amount unit first');
      assertEqual(eggs[0].amount, 200, 'egg grams');
      assertEqual(eggs[1].unit, 'pcs', 'smaller amount unit second');
      assertEqual(eggs[1].amount, 3, 'egg pieces');
      assertDeepEqual(eggs[0].sourceRecipes, [rC.id], 'gram egg source');
      assertDeepEqual(eggs[1].sourceRecipes, [rA.id], 'piece egg source');
    } finally {
      await srv.close();
    }
  });

  it('keeps first-seen category on conflict while still merging amounts', async () => {
    srv = await startServer({ recipes: [rA, rD] });
    try {
      const list = await generate({ recipeIds: [rA.id, rD.id] });
      const scallion = rowsOf(list, 'scallion');
      assertEqual(scallion.length, 1, 'scallion merged into one row');
      assertEqual(scallion[0].category, 'vegetable', 'first-seen category wins');
      assertEqual(scallion[0].amount, 105, 'amounts merged across recipes');
      assertDeepEqual(
        [...scallion[0].sourceRecipes].sort(),
        [rA.id, rD.id].sort(),
        'scallion sources',
      );
    } finally {
      await srv.close();
    }
  });

  it('partial selection includes only the checked ingredients', async () => {
    srv = await startServer({ recipes: [rA] });
    try {
      const list = await generate({
        selectedIngredients: [{ recipeId: rA.id, ingredientNames: ['egg'] }],
      });
      assertEqual(list.length, 1, 'only the selected ingredient is listed');
      assertEqual(list[0].name, 'egg', 'selected ingredient name');
      assertEqual(list[0].amount, 3, 'selected ingredient amount');
    } finally {
      await srv.close();
    }
  });

  it('merges manual items with recipe items of the same name (case-insensitive)', async () => {
    srv = await startServer({ recipes: [rA] });
    try {
      const list = await generate({
        recipeIds: [rA.id],
        manualItems: [{ name: 'Egg', amount: 2, unit: 'pcs', category: 'other' }],
      });
      const eggs = rowsOf(list, 'egg');
      assertEqual(eggs.length, 1, 'manual Egg merges into recipe egg row');
      assertEqual(eggs[0].amount, 5, 'manual amount added');
      assertDeepEqual(eggs[0].sourceRecipes, [rA.id], 'manual item adds no source recipe');
    } finally {
      await srv.close();
    }
  });

  it('lists manual-only items with an empty source set', async () => {
    srv = await startServer({ recipes: [rA] });
    try {
      const list = await generate({
        manualItems: [{ name: 'milk', amount: 1, unit: 'l', category: 'dairy' }],
      });
      assertEqual(list.length, 1, 'manual-only list length');
      assertEqual(list[0].name, 'milk', 'manual item name');
      assertDeepEqual(list[0].sourceRecipes, [], 'manual item has no sources');
    } finally {
      await srv.close();
    }
  });

  it('groups rows by the fixed category order', async () => {
    srv = await startServer({ recipes: [rA, rB] });
    try {
      const list = await generate({ recipeIds: [rA.id, rB.id] });
      const catOrder = ['vegetable', 'meat', 'grain', 'dairy', 'seasoning', 'other'];
      const ranks = list.map((i) => catOrder.indexOf(i.category));
      const sorted = [...ranks].sort((a, b) => a - b);
      assertDeepEqual(ranks, sorted, 'rows grouped by category order');
      assertEqual(list[0].category, 'vegetable', 'vegetables first');
      assertEqual(list[list.length - 1].category, 'other', 'other last');
    } finally {
      await srv.close();
    }
  });

  it('regeneration yields stable keys so client-side checked state survives', async () => {
    srv = await startServer({ recipes: [rA, rB] });
    try {
      const body = { recipeIds: [rA.id, rB.id] };
      const first = await generate(body);
      assert(first.every((i) => i.checked === false), 'server always returns unchecked rows');

      // client marks two rows as purchased
      const checkedNames = new Set(['tomato', 'egg']);

      const second = await generate(body);
      const keyOf = (i: ShoppingItem) => `${i.name.toLowerCase()}|${i.unit}`;
      assertDeepEqual(
        second.map(keyOf).sort(),
        first.map(keyOf).sort(),
        'name+unit key set is stable across regeneration',
      );
      assertDeepEqual(
        second.map((i) => [keyOf(i), i.amount]).sort(),
        first.map((i) => [keyOf(i), i.amount]).sort(),
        'amounts are stable across regeneration',
      );

      // replicate the client merge from src/client/ShoppingList.tsx
      const nameToChecked = new Map(
        first.map((i) => [i.name.toLowerCase(), checkedNames.has(i.name.toLowerCase())]),
      );
      const reapplied = second.map((i) => ({
        ...i,
        checked: nameToChecked.get(i.name.toLowerCase()) || false,
      }));
      const stillChecked = reapplied.filter((i) => i.checked).map((i) => i.name);
      assertDeepEqual(
        [...new Set(stillChecked)].sort(),
        ['egg', 'tomato'],
        'checked state re-applied by name after regeneration',
      );
    } finally {
      await srv.close();
    }
  });
});
