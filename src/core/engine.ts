/**
 * 编排台引擎：管理多场宴席的工作区。
 * 每场宴席独立保存宾客名单、菜品安排与座次，互不干扰；
 * 所有修改通过本模块入口进行，自动触发增量重推。
 */
import type {
  Arrangement,
  Banquet,
  ChangeEvent,
  Dish,
  Guest,
  Rank,
  Workspace,
} from './types';
import { emptyArrangement } from './types';
import { fullRearrange, rearrangeBanquet } from './rearrange';
import { validateArrangement } from './validate';
import { createSeedWorkspace } from './seed';

let counter = 0;
export const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;

export function createEmptyWorkspace(): Workspace {
  return { version: 1, banquets: [], activeBanquetId: null };
}

export function createDefaultWorkspace(): Workspace {
  return createSeedWorkspace();
}

function touchBanquet(
  ws: Workspace,
  banquetId: string,
  mutate: (b: Banquet) => Banquet,
): Workspace {
  return {
    ...ws,
    banquets: ws.banquets.map((b) => (b.id === banquetId ? mutate(b) : b)),
  };
}

function applyRearrange(
  ws: Workspace,
  banquetId: string,
  changes: ChangeEvent[],
): Workspace {
  return touchBanquet(ws, banquetId, (b) => {
    const result = rearrangeBanquet(b, changes);
    return {
      ...b,
      arrangement: result.arrangement,
      lastArchived: result.archived ?? b.lastArchived,
    };
  });
}

// —— 宴席管理 ——

export function addBanquet(ws: Workspace, name: string): Workspace {
  const banquet: Banquet = {
    id: uid('bq'),
    name: name.trim() || `宴席 ${ws.banquets.length + 1}`,
    createdAt: Date.now(),
    guests: [],
    tables: [],
    dishes: [],
    constraints: [],
    arrangement: emptyArrangement(),
    lastArchived: null,
  };
  return {
    ...ws,
    banquets: [...ws.banquets, banquet],
    activeBanquetId: banquet.id,
  };
}

export function removeBanquet(ws: Workspace, banquetId: string): Workspace {
  const banquets = ws.banquets.filter((b) => b.id !== banquetId);
  return {
    ...ws,
    banquets,
    activeBanquetId:
      ws.activeBanquetId === banquetId
        ? banquets[0]?.id ?? null
        : ws.activeBanquetId,
  };
}

export function renameBanquet(ws: Workspace, banquetId: string, name: string): Workspace {
  return touchBanquet(ws, banquetId, (b) => ({ ...b, name }));
}

/** 切换宴席：只切换焦点，不触碰任何一场的编排状态 */
export function switchBanquet(ws: Workspace, banquetId: string): Workspace {
  if (!ws.banquets.some((b) => b.id === banquetId)) return ws;
  return { ...ws, activeBanquetId: banquetId };
}

export function activeBanquet(ws: Workspace): Banquet | null {
  return ws.banquets.find((b) => b.id === ws.activeBanquetId) ?? null;
}

// —— 宾客 ——

export function addGuest(
  ws: Workspace,
  banquetId: string,
  input: { name: string; dietary?: string[]; rank?: Rank; entourage?: number },
): Workspace {
  const guest: Guest = {
    id: uid('g'),
    name: input.name.trim() || '未命名宾客',
    dietary: input.dietary ?? [],
    rank: input.rank ?? 3,
    entourage: Math.max(0, Math.floor(input.entourage ?? 0)),
  };
  const next = touchBanquet(ws, banquetId, (b) => ({
    ...b,
    guests: [...b.guests, guest],
  }));
  return applyRearrange(next, banquetId, [{ type: 'guest-added', guestId: guest.id }]);
}

export function removeGuest(ws: Workspace, banquetId: string, guestId: string): Workspace {
  const next = touchBanquet(ws, banquetId, (b) => ({
    ...b,
    guests: b.guests.filter((g) => g.id !== guestId),
    constraints: b.constraints.filter((c) => c.a !== guestId && c.b !== guestId),
  }));
  return applyRearrange(next, banquetId, [{ type: 'guest-removed', guestId }]);
}

export function updateGuest(
  ws: Workspace,
  banquetId: string,
  guestId: string,
  patch: Partial<Pick<Guest, 'name' | 'dietary' | 'rank' | 'entourage'>>,
): Workspace {
  const before = activeBanquet({ ...ws, activeBanquetId: banquetId });
  const old = before?.guests.find((g) => g.id === guestId);
  if (!old) return ws;
  const changes: ChangeEvent[] = [];
  if (patch.dietary && patch.dietary.join('|') !== old.dietary.join('|')) {
    changes.push({ type: 'guest-dietary-changed', guestId });
  }
  if (patch.rank !== undefined && patch.rank !== old.rank) {
    changes.push({ type: 'guest-rank-changed', guestId });
  }
  if (
    patch.entourage !== undefined &&
    Math.max(0, Math.floor(patch.entourage)) !== old.entourage
  ) {
    changes.push({ type: 'guest-entourage-changed', guestId });
  }
  const next = touchBanquet(ws, banquetId, (b) => ({
    ...b,
    guests: b.guests.map((g) =>
      g.id === guestId
        ? {
            ...g,
            ...patch,
            entourage:
              patch.entourage !== undefined
                ? Math.max(0, Math.floor(patch.entourage))
                : g.entourage,
          }
        : g,
    ),
  }));
  if (changes.length === 0) return next;
  return applyRearrange(next, banquetId, changes);
}

export function clearGuests(ws: Workspace, banquetId: string): Workspace {
  const next = touchBanquet(ws, banquetId, (b) => ({
    ...b,
    guests: [],
    constraints: [],
  }));
  return applyRearrange(next, banquetId, []);
}

// —— 桌次 ——

export function addTable(
  ws: Workspace,
  banquetId: string,
  input: { name: string; capacity: number; isMain?: boolean; minRank?: Rank },
): Workspace {
  const table = {
    id: uid('t'),
    name: input.name.trim() || `桌 ${Date.now() % 100}`,
    capacity: Math.max(1, Math.floor(input.capacity)),
    isMain: input.isMain ?? false,
    minRank: input.minRank ?? (4 as Rank),
    dishIds: [] as string[],
  };
  const next = touchBanquet(ws, banquetId, (b) => ({
    ...b,
    tables: [...b.tables, table],
  }));
  return applyRearrange(next, banquetId, [{ type: 'table-added', tableId: table.id }]);
}

export function removeTable(ws: Workspace, banquetId: string, tableId: string): Workspace {
  const next = touchBanquet(ws, banquetId, (b) => ({
    ...b,
    tables: b.tables.filter((t) => t.id !== tableId),
  }));
  return applyRearrange(next, banquetId, [{ type: 'table-removed', tableId }]);
}

export function updateTable(
  ws: Workspace,
  banquetId: string,
  tableId: string,
  patch: Partial<{ name: string; capacity: number; isMain: boolean; minRank: Rank }>,
): Workspace {
  const banquet = ws.banquets.find((b) => b.id === banquetId);
  const old = banquet?.tables.find((t) => t.id === tableId);
  if (!old) return ws;
  const changes: ChangeEvent[] = [];
  if (patch.capacity !== undefined && Math.max(1, Math.floor(patch.capacity)) !== old.capacity) {
    changes.push({ type: 'table-capacity-changed', tableId });
  }
  if (
    (patch.isMain !== undefined && patch.isMain !== old.isMain) ||
    (patch.minRank !== undefined && patch.minRank !== old.minRank)
  ) {
    changes.push({ type: 'table-rank-changed', tableId });
  }
  const next = touchBanquet(ws, banquetId, (b) => ({
    ...b,
    tables: b.tables.map((t) =>
      t.id === tableId
        ? {
            ...t,
            ...patch,
            capacity:
              patch.capacity !== undefined
                ? Math.max(1, Math.floor(patch.capacity))
                : t.capacity,
          }
        : t,
    ),
  }));
  if (changes.length === 0) return next;
  return applyRearrange(next, banquetId, changes);
}

// —— 菜品 ——

export function addDish(
  ws: Workspace,
  banquetId: string,
  input: { name: string; tags?: string[] },
): Workspace {
  const dish: Dish = {
    id: uid('d'),
    name: input.name.trim() || '未命名菜品',
    tags: input.tags ?? [],
  };
  return touchBanquet(ws, banquetId, (b) => ({ ...b, dishes: [...b.dishes, dish] }));
}

export function removeDish(ws: Workspace, banquetId: string, dishId: string): Workspace {
  const next = touchBanquet(ws, banquetId, (b) => ({
    ...b,
    dishes: b.dishes.filter((d) => d.id !== dishId),
    tables: b.tables.map((t) => ({
      ...t,
      dishIds: t.dishIds.filter((id) => id !== dishId),
    })),
  }));
  return applyRearrange(next, banquetId, [{ type: 'dish-tags-changed', dishId }]);
}

export function updateDishTags(
  ws: Workspace,
  banquetId: string,
  dishId: string,
  tags: string[],
): Workspace {
  const next = touchBanquet(ws, banquetId, (b) => ({
    ...b,
    dishes: b.dishes.map((d) => (d.id === dishId ? { ...d, tags } : d)),
  }));
  return applyRearrange(next, banquetId, [{ type: 'dish-tags-changed', dishId }]);
}

/** 调整某桌的菜品安排 */
export function setTableDishes(
  ws: Workspace,
  banquetId: string,
  tableId: string,
  dishIds: string[],
): Workspace {
  const next = touchBanquet(ws, banquetId, (b) => ({
    ...b,
    tables: b.tables.map((t) => (t.id === tableId ? { ...t, dishIds } : t)),
  }));
  return applyRearrange(next, banquetId, [{ type: 'table-dishes-changed', tableId }]);
}

// —— 不宜同桌约束 ——

export function addConstraint(
  ws: Workspace,
  banquetId: string,
  a: string,
  b: string,
  note?: string,
): Workspace {
  if (a === b) return ws;
  const banquet = ws.banquets.find((x) => x.id === banquetId);
  if (!banquet) return ws;
  const exists = banquet.constraints.some(
    (c) => (c.a === a && c.b === b) || (c.a === b && c.b === a),
  );
  if (exists) return ws;
  const constraint = { id: uid('c'), a, b, note };
  const next = touchBanquet(ws, banquetId, (x) => ({
    ...x,
    constraints: [...x.constraints, constraint],
  }));
  return applyRearrange(next, banquetId, [
    { type: 'constraint-added', constraintId: constraint.id },
  ]);
}

export function removeConstraint(
  ws: Workspace,
  banquetId: string,
  constraintId: string,
): Workspace {
  const next = touchBanquet(ws, banquetId, (b) => ({
    ...b,
    constraints: b.constraints.filter((c) => c.id !== constraintId),
  }));
  return applyRearrange(next, banquetId, [
    { type: 'constraint-removed', constraintId },
  ]);
}

// —— 编排入口 ——

/** 对单场宴席执行整体编排 */
export function arrangeBanquet(ws: Workspace, banquetId: string): Workspace {
  return touchBanquet(ws, banquetId, (b) => {
    const result = fullRearrange(b);
    return {
      ...b,
      arrangement: result.arrangement,
      lastArchived: result.archived ?? b.lastArchived,
    };
  });
}

/** 统一的批量编排入口：对多场宴席一次性核对结果 */
export function arrangeAll(ws: Workspace): Workspace {
  let next = ws;
  for (const b of ws.banquets) {
    next = arrangeBanquet(next, b.id);
  }
  return next;
}

/** 确认当前座次（确认后不会被无关改动冲掉） */
export function confirmArrangement(ws: Workspace, banquetId: string): Workspace {
  return touchBanquet(ws, banquetId, (b) =>
    b.arrangement.status === 'arranged'
      ? { ...b, arrangement: { ...b.arrangement, confirmed: true } }
      : b,
  );
}

export function unconfirmArrangement(ws: Workspace, banquetId: string): Workspace {
  return touchBanquet(ws, banquetId, (b) => ({
    ...b,
    arrangement: { ...b.arrangement, confirmed: false },
  }));
}

// —— 核对 ——

export interface BanquetAudit {
  banquetId: string;
  banquetName: string;
  status: Arrangement['status'];
  issues: string[];
  conflictCount: number;
}

/** 对多场宴席一次性核对：校验座次合法性并汇总状态 */
export function auditWorkspace(ws: Workspace): BanquetAudit[] {
  return ws.banquets.map((b) => ({
    banquetId: b.id,
    banquetName: b.name,
    status: b.arrangement.status,
    issues:
      b.arrangement.status === 'arranged'
        ? validateArrangement(
            b.guests,
            b.tables,
            b.dishes,
            b.constraints,
            b.arrangement.assignments,
          ).map((i) => i.message)
        : [],
    conflictCount:
      (b.arrangement.conflicts?.core.length ?? 0) +
      (b.arrangement.conflicts?.cycles.length ?? 0),
  }));
}
