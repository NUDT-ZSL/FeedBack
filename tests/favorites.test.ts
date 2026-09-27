// Favorites ordering: contiguity on add/remove/re-add, idempotency,
// explicit reorder, and self-consistency under concurrent submissions.

import { describe, it, assert, assertEqual, assertDeepEqual } from './harness';
import { startServer, api, makeRecipe, TestServer } from './fixtures';
import { Favorite } from '../src/server/app';

const favRecipes = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((n) => makeRecipe(`Fav ${n}`, []));
const [f1, f2, f3, f4, f5, f6] = favRecipes;

const seedFavs = (ids: string[]): Favorite[] =>
  ids.map((id, i) => ({ recipeId: id, order: i, addedAt: 1000 + i }));

let srv: TestServer;
const base = () => srv.baseUrl;

async function getFavorites(): Promise<Favorite[]> {
  const { status, data } = await api<Favorite[]>(base(), 'GET', '/api/favorites');
  assertEqual(status, 200, 'GET /api/favorites status');
  return data;
}

const addFav = (id: string) => api<Favorite>(base(), 'POST', '/api/favorites', { recipeId: id });
const delFav = (id: string) => api<{ success: boolean }>(base(), 'DELETE', `/api/favorites/${id}`);

function assertContiguous(favs: Favorite[], msg: string): void {
  const orders = favs.map((f) => f.order).sort((a, b) => a - b);
  assertDeepEqual(orders, favs.map((_, i) => i), `${msg}: orders are 0..n-1 without gaps`);
  const ids = favs.map((f) => f.recipeId);
  assertEqual(new Set(ids).size, ids.length, `${msg}: no duplicate recipeIds`);
}

async function withServer(favs: Favorite[], fn: () => Promise<void>): Promise<void> {
  srv = await startServer({ recipes: favRecipes, favorites: favs });
  try {
    await fn();
  } finally {
    await srv.close();
  }
}

describe('favorites ordering', () => {
  it('returns favorites sorted by order', async () => {
    await withServer(seedFavs([f1.id, f2.id, f3.id]), async () => {
      const favs = await getFavorites();
      assertDeepEqual(favs.map((f) => f.recipeId), [f1.id, f2.id, f3.id], 'sorted by order');
      assertDeepEqual(favs.map((f) => f.order), [0, 1, 2], 'orders 0,1,2');
    });
  });

  it('appends new favorites at the end with a contiguous order', async () => {
    await withServer(seedFavs([f1.id, f2.id, f3.id]), async () => {
      const { status, data } = await addFav(f4.id);
      assertEqual(status, 200, 'add status');
      assertEqual(data.order, 3, 'new favorite appended at order = size');
      const favs = await getFavorites();
      assertContiguous(favs, 'after add');
      assertEqual(favs.length, 4, 'four favorites');
    });
  });

  it('adding an existing favorite is idempotent', async () => {
    await withServer(seedFavs([f1.id, f2.id, f3.id]), async () => {
      const { status, data } = await addFav(f2.id);
      assertEqual(status, 200, 're-add status');
      assertEqual(data.order, 1, 'existing favorite keeps its order');
      const favs = await getFavorites();
      assertEqual(favs.length, 3, 'no duplicate created');
      assertContiguous(favs, 'after idempotent re-add');
    });
  });

  it('delete reindexes the remaining favorites without gaps', async () => {
    await withServer(seedFavs([f1.id, f2.id, f3.id, f4.id]), async () => {
      const { status } = await delFav(f2.id);
      assertEqual(status, 200, 'delete status');
      const favs = await getFavorites();
      assertDeepEqual(favs.map((f) => f.recipeId), [f1.id, f3.id, f4.id], 'middle removed');
      assertContiguous(favs, 'after delete');
    });
  });

  it('re-adding after delete appends at the end, keeping order contiguous', async () => {
    await withServer(seedFavs([f1.id, f2.id, f3.id, f4.id]), async () => {
      await delFav(f2.id);
      const { data } = await addFav(f2.id);
      assertEqual(data.order, 3, 're-added favorite goes to the end');
      const favs = await getFavorites();
      assertDeepEqual(
        favs.map((f) => f.recipeId),
        [f1.id, f3.id, f4.id, f2.id],
        're-added at tail',
      );
      assertContiguous(favs, 'after delete + re-add');
    });
  });

  it('honors explicit reorder requests', async () => {
    await withServer(seedFavs([f1.id, f2.id, f3.id]), async () => {
      const { status } = await api<{ success: boolean }>(base(), 'PUT', '/api/favorites/order', {
        orders: [
          { recipeId: f3.id, order: 0 },
          { recipeId: f1.id, order: 1 },
          { recipeId: f2.id, order: 2 },
        ],
      });
      assertEqual(status, 200, 'reorder status');
      const favs = await getFavorites();
      assertDeepEqual(favs.map((f) => f.recipeId), [f3.id, f1.id, f2.id], 'reordered');
      assertContiguous(favs, 'after reorder');
    });
  });

  it('deleting a non-favorite returns 404 and keeps order intact', async () => {
    await withServer(seedFavs([f1.id, f2.id]), async () => {
      const { status } = await delFav(f5.id);
      assertEqual(status, 404, 'delete missing favorite is 404');
      const favs = await getFavorites();
      assertContiguous(favs, 'after failed delete');
      assertEqual(favs.length, 2, 'favorites unchanged');
    });
  });

  it('concurrent add/delete submissions converge to a self-consistent order', async () => {
    for (let round = 0; round < 3; round++) {
      await withServer(seedFavs([f1.id, f2.id, f3.id]), async () => {
        await Promise.all([
          addFav(f4.id),
          addFav(f5.id),
          delFav(f1.id),
          addFav(f6.id),
          delFav(f2.id),
          addFav(f4.id), // duplicate add racing with itself
        ]);
        const favs = await getFavorites();
        assertDeepEqual(
          [...favs.map((f) => f.recipeId)].sort(),
          [f3.id, f4.id, f5.id, f6.id].sort(),
          `round ${round}: final membership`,
        );
        assertContiguous(favs, `round ${round}: after concurrent burst`);
      });
    }
  });
});
