// Recipe search: case-insensitivity, empty/blank queries, no-result,
// consistency with the full list, and cache freshness after writes.

import { describe, it, assertEqual, assertDeepEqual } from './harness';
import { startServer, api, makeRecipe, ing, TestServer } from './fixtures';
import { Recipe } from '../src/server/app';

const s1 = makeRecipe('Tomato Egg StirFry', [ing('tomato', 2, 'pcs', 'vegetable'), ing('egg', 3, 'pcs', 'other')]);
const s2 = makeRecipe('Beef Stew', [ing('beef', 500, 'g', 'meat'), ing('potato', 2, 'pcs', 'vegetable')]);
const s3 = makeRecipe('Egg Fried Rice', [ing('egg', 2, 'pcs', 'other'), ing('rice', 300, 'g', 'grain')]);
const all = [s1, s2, s3];

let srv: TestServer;
const base = () => srv.baseUrl;

async function search(q?: string): Promise<Recipe[]> {
  const path = q === undefined ? '/api/recipes/search' : `/api/recipes/search?q=${encodeURIComponent(q)}`;
  const { status, data } = await api<Recipe[]>(base(), 'GET', path);
  assertEqual(status, 200, 'search status');
  return data;
}

const ids = (list: Recipe[]) => list.map((r) => r.id);

describe('recipe search', () => {
  it('empty or missing query returns the full list, identical to GET /api/recipes', async () => {
    srv = await startServer({ recipes: all });
    try {
      const { data: full } = await api<Recipe[]>(base(), 'GET', '/api/recipes');
      assertDeepEqual(ids(await search('')), ids(full), 'empty string query = full list');
      assertDeepEqual(ids(await search()), ids(full), 'missing query = full list');
      assertDeepEqual(ids(await search('   ')), ids(full), 'blank query = full list');
    } finally {
      await srv.close();
    }
  });

  it('matches recipe names case-insensitively', async () => {
    srv = await startServer({ recipes: all });
    try {
      assertDeepEqual(ids(await search('TOMATO')), [s1.id], 'uppercase name query');
      assertDeepEqual(ids(await search('tomato')), [s1.id], 'lowercase name query');
      assertDeepEqual(ids(await search('BeEF')), [s2.id], 'mixed-case name query');
    } finally {
      await srv.close();
    }
  });

  it('matches ingredient names case-insensitively', async () => {
    srv = await startServer({ recipes: all });
    try {
      const byEgg = ids(await search('EGG')).sort();
      assertDeepEqual(byEgg, [s1.id, s3.id].sort(), 'ingredient match across recipes');
      assertDeepEqual(ids(await search('POTATO')), [s2.id], 'ingredient-only match');
    } finally {
      await srv.close();
    }
  });

  it('returns an empty array when nothing matches', async () => {
    srv = await startServer({ recipes: all });
    try {
      assertDeepEqual(await search('zzz-no-such-thing'), [], 'no-result query');
    } finally {
      await srv.close();
    }
  });

  it('results are always consistent with filtering the full list', async () => {
    srv = await startServer({ recipes: all });
    try {
      const { data: full } = await api<Recipe[]>(base(), 'GET', '/api/recipes');
      const fullIds = new Set(ids(full));
      for (const q of ['egg', 'beef', 'tomato', 'rice', 'home-style', 'stirfry']) {
        const result = await search(q);
        const expected = full
          .filter(
            (r) =>
              r.name.toLowerCase().includes(q) ||
              r.cuisine.toLowerCase().includes(q) ||
              r.ingredients.some((i) => i.name.toLowerCase().includes(q)),
          )
          .map((r) => r.id);
        assertDeepEqual(ids(result), expected, `query "${q}" matches full-list filter`);
        for (const id of ids(result)) {
          if (!fullIds.has(id)) throw new Error(`query "${q}" returned id not in full list: ${id}`);
        }
      }
    } finally {
      await srv.close();
    }
  });

  it('does not serve stale cache after a recipe is created', async () => {
    srv = await startServer({ recipes: all });
    try {
      assertDeepEqual(await search('mushroom'), [], 'mushroom absent before create');
      const { status } = await api<Recipe>(base(), 'POST', '/api/recipes', {
        name: 'Mushroom Soup',
        ingredients: [ing('mushroom', 100, 'g', 'vegetable')],
      });
      assertEqual(status, 200, 'create status');
      const after = await search('mushroom');
      assertEqual(after.length, 1, 'new recipe found after cache invalidation');
      assertEqual(after[0].name, 'Mushroom Soup', 'new recipe name');
    } finally {
      await srv.close();
    }
  });
});
