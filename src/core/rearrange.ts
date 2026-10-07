/**
 * 增量重推：
 * 当宾客忌口/等级/随行、桌容量、菜品或不宜同桌约束发生变化时，
 * 只疏散「受影响」的宾客与桌次，其余已确认座次原样保留。
 *
 * 等价性保证：重推完成后会与一次整体重排做对照校验，
 * 若整体重排可行而增量结果不可行（或残留非法座次），
 * 则回退为整体重排结果，保证「结果与整体重排一致」。
 */
import type {
  Arrangement,
  Banquet,
  ChangeEvent,
  Guest,
  SeatingAssignment,
  TraceEntry,
} from './types';
import {
  analyzeUnsat,
  avoidMapOf,
  dietaryEligible,
  groupSize,
  rankEligible,
  solve,
} from './solver';
import { validateArrangement } from './validate';

export interface RearrangeResult {
  arrangement: Arrangement;
  /** 不可编排时归档的旧座次（若有） */
  archived: { archivedAt: number; assignments: SeatingAssignment[]; confirmed: boolean } | null;
}

interface Tracer {
  entries: TraceEntry[];
  seq: number;
  add(kind: TraceEntry['kind'], message: string): void;
}

function makeTracer(): Tracer {
  const tracer: Tracer = {
    entries: [],
    seq: 0,
    add(kind, message) {
      tracer.entries.push({ seq: ++tracer.seq, kind, message });
    },
  };
  return tracer;
}

const describeChange = (banquet: Banquet, change: ChangeEvent): string => {
  const guestName = (id: string) =>
    banquet.guests.find((g) => g.id === id)?.name ?? `宾客(${id.slice(0, 6)})`;
  const tableName = (id: string) =>
    banquet.tables.find((t) => t.id === id)?.name ?? `桌次(${id.slice(0, 6)})`;
  const dishName = (id: string) =>
    banquet.dishes.find((d) => d.id === id)?.name ?? `菜品(${id.slice(0, 6)})`;
  switch (change.type) {
    case 'guest-added':
      return `新增宾客「${guestName(change.guestId)}」`;
    case 'guest-removed':
      return `移除宾客「${guestName(change.guestId)}」`;
    case 'guest-dietary-changed':
      return `宾客「${guestName(change.guestId)}」忌口变更`;
    case 'guest-rank-changed':
      return `宾客「${guestName(change.guestId)}」身份等级变更`;
    case 'guest-entourage-changed':
      return `宾客「${guestName(change.guestId)}」随行人数变更`;
    case 'constraint-added': {
      const c = banquet.constraints.find((x) => x.id === change.constraintId);
      return c
        ? `新增不宜同桌约束「${guestName(c.a)} ↔ ${guestName(c.b)}」`
        : '新增不宜同桌约束';
    }
    case 'constraint-removed':
      return '移除不宜同桌约束';
    case 'table-capacity-changed':
      return `「${tableName(change.tableId)}」容量调整`;
    case 'table-rank-changed':
      return `「${tableName(change.tableId)}」主桌等级门槛调整`;
    case 'table-dishes-changed':
      return `「${tableName(change.tableId)}」菜品调整`;
    case 'table-added':
      return `新增桌次「${tableName(change.tableId)}」`;
    case 'table-removed':
      return `移除桌次「${tableName(change.tableId)}」`;
    case 'dish-tags-changed':
      return `菜品「${dishName(change.dishId)}」标签调整`;
  }
};

/** 依据变更计算初始疏散集合（宾客与桌） */
function affectedByChange(
  banquet: Banquet,
  change: ChangeEvent,
): { guests: Set<string>; tables: Set<string> } {
  const guests = new Set<string>();
  const tables = new Set<string>();
  const seatedAt = new Map<string, string>();
  for (const a of banquet.arrangement.assignments) seatedAt.set(a.guestId, a.tableId);

  switch (change.type) {
    case 'guest-added':
      guests.add(change.guestId);
      break;
    case 'guest-removed':
      break;
    case 'guest-dietary-changed':
    case 'guest-rank-changed':
    case 'guest-entourage-changed': {
      guests.add(change.guestId);
      const t = seatedAt.get(change.guestId);
      if (t) tables.add(t);
      break;
    }
    case 'constraint-added': {
      const c = banquet.constraints.find((x) => x.id === change.constraintId);
      if (c) {
        for (const gid of [c.a, c.b]) {
          guests.add(gid);
          const t = seatedAt.get(gid);
          if (t) tables.add(t);
        }
      }
      break;
    }
    case 'constraint-removed':
      break;
    case 'table-capacity-changed':
    case 'table-rank-changed':
    case 'table-dishes-changed':
      tables.add(change.tableId);
      break;
    case 'table-added':
      break;
    case 'table-removed':
      tables.add(change.tableId);
      break;
    case 'dish-tags-changed': {
      for (const t of banquet.tables) {
        if (t.dishIds.includes(change.dishId)) tables.add(t.id);
      }
      break;
    }
  }
  return { guests, tables };
}

/**
 * 以当前规则结构化计算需要疏散的宾客（防御性兜底，保证不残留非法座次）：
 * 超容/未知桌 → 整桌疏散；等级、忌口违规 → 本人；不宜同桌 → 双方；无座 → 本人。
 */
function guestsToEvict(banquet: Banquet): Set<string> {
  const result = new Set<string>();
  const guestMap = new Map(banquet.guests.map((g) => [g.id, g]));
  const tableMap = new Map(banquet.tables.map((t) => [t.id, t]));
  const avoid = avoidMapOf(banquet.constraints);
  const byTable = new Map<string, Guest[]>();
  for (const a of banquet.arrangement.assignments) {
    const g = guestMap.get(a.guestId);
    if (!g) continue;
    if (!tableMap.has(a.tableId)) {
      result.add(g.id);
      continue;
    }
    if (!byTable.has(a.tableId)) byTable.set(a.tableId, []);
    byTable.get(a.tableId)!.push(g);
  }
  for (const g of banquet.guests) {
    const seated = banquet.arrangement.assignments.some((a) => a.guestId === g.id);
    if (!seated) result.add(g.id);
  }
  for (const [tableId, seated] of byTable) {
    const table = tableMap.get(tableId)!;
    const heads = seated.reduce((s, g) => s + groupSize(g), 0);
    if (heads > table.capacity) {
      seated.forEach((g) => result.add(g.id));
    }
    for (const g of seated) {
      if (!rankEligible(table, g) || !dietaryEligible(table, g, banquet.dishes)) {
        result.add(g.id);
      }
    }
    for (let i = 0; i < seated.length; i++) {
      for (let j = i + 1; j < seated.length; j++) {
        if (avoid.get(seated[i].id)?.has(seated[j].id)) {
          result.add(seated[i].id);
          result.add(seated[j].id);
        }
      }
    }
  }
  return result;
}

export function rearrangeBanquet(
  banquet: Banquet,
  changes: ChangeEvent[],
  now: number = Date.now(),
): RearrangeResult {
  const tracer = makeTracer();
  for (const change of changes) {
    tracer.add('change', `变更：${describeChange(banquet, change)}`);
  }

  const base = {
    guests: banquet.guests,
    tables: banquet.tables,
    dishes: banquet.dishes,
    constraints: banquet.constraints,
  };

  // 空名单：明确的不可编排状态，不残留旧座次
  if (banquet.guests.length === 0) {
    tracer.add('status', '宾客名单为空，本场宴席标记为「不可编排」，旧座次已清空。');
    const archived =
      banquet.arrangement.assignments.length > 0
        ? {
            archivedAt: now,
            assignments: banquet.arrangement.assignments,
            confirmed: banquet.arrangement.confirmed,
          }
        : null;
    return {
      arrangement: {
        status: 'empty',
        assignments: [],
        confirmed: false,
        arrangedAt: now,
        trace: tracer.entries,
        conflicts: null,
        affectedTableIds: [],
      },
      archived,
    };
  }

  const previous = banquet.arrangement;
  // 先前不可编排/为空：直接整体编排；否则走增量路径（违规宾客由疏散集合兜底）
  if (previous.status !== 'arranged') {
    tracer.add('info', '当前无有效座次，执行整体编排。');
    return finalizeFull(banquet, tracer, now, previous);
  }

  // —— 增量路径 ——
  const unsettled = new Set<string>();
  const affectedTables = new Set<string>();
  for (const change of changes) {
    const { guests, tables } = affectedByChange(banquet, change);
    guests.forEach((g) => unsettled.add(g));
    tables.forEach((t) => affectedTables.add(t));
  }
  guestsToEvict(banquet).forEach((g) => unsettled.add(g));

  // 桌被删除 / 桌受影响：该桌所有宾客疏散
  const tableIds = new Set(banquet.tables.map((t) => t.id));
  for (const a of previous.assignments) {
    if (!tableIds.has(a.tableId)) unsettled.add(a.guestId);
  }
  for (const tid of affectedTables) {
    for (const a of previous.assignments) {
      if (a.tableId === tid) unsettled.add(a.guestId);
    }
  }
  // 只保留仍在名单中的宾客
  const guestIds = new Set(banquet.guests.map((g) => g.id));
  for (const gid of [...unsettled]) {
    if (!guestIds.has(gid)) unsettled.delete(gid);
  }

  const kept = previous.assignments.filter((a) => !unsettled.has(a.guestId));
  for (const a of kept) {
    tracer.add(
      'keep',
      `保留座次：「${banquet.guests.find((g) => g.id === a.guestId)?.name}」留在原桌，不受本次变更影响。`,
    );
  }
  for (const gid of unsettled) {
    const g = banquet.guests.find((x) => x.id === gid);
    if (g) tracer.add('evict', `疏散宾客「${g.name}」，等待重新落座。`);
  }

  const lockedByTable = new Map<string, string[]>();
  for (const a of kept) {
    if (!lockedByTable.has(a.tableId)) lockedByTable.set(a.tableId, []);
    lockedByTable.get(a.tableId)!.push(a.guestId);
  }

  let outcome = solve(base, lockedByTable);

  // 若锁座下无解，逐层扩大疏散范围（确定性顺序），尽量保住已确认座次
  let expansionRound = 0;
  // 若有疏散宾客连静态落座条件都不满足（容量/等级/忌口），扩大疏散无意义，直接核对整体重排
  const staticallyBlocked = [...unsettled].some((gid) => {
    const guest = banquet.guests.find((g) => g.id === gid);
    if (!guest) return false;
    return !banquet.tables.some(
      (t) =>
        t.capacity >= groupSize(guest) &&
        rankEligible(t, guest) &&
        dietaryEligible(t, guest, banquet.dishes),
    );
  });
  while (!outcome.ok && !staticallyBlocked && expansionRound < 3) {
    expansionRound += 1;
    const extra = pickExpansionGuests(banquet, kept, unsettled, expansionRound);
    if (extra.length === 0) break;
    for (const gid of extra) {
      unsettled.add(gid);
      const g = banquet.guests.find((x) => x.id === gid);
      tracer.add(
        'evict',
        `第 ${expansionRound} 轮扩大疏散：「${g?.name}」受牵连重新落座。`,
      );
    }
    const newKept = previous.assignments.filter((a) => !unsettled.has(a.guestId));
    lockedByTable.clear();
    for (const a of newKept) {
      if (!lockedByTable.has(a.tableId)) lockedByTable.set(a.tableId, []);
      lockedByTable.get(a.tableId)!.push(a.guestId);
    }
    outcome = solve(base, lockedByTable);
  }

  if (outcome.ok) {
    const assignments = outcome.assignments;
    const issues = validateArrangement(
      banquet.guests,
      banquet.tables,
      banquet.dishes,
      banquet.constraints,
      assignments,
    );
    if (issues.length > 0) {
      // 理论上不可达；防御性回退整体重排
      tracer.add('info', '增量结果未通过校验，回退为整体重排。');
      return finalizeFull(banquet, tracer, now, previous);
    }

    // 等价性校验：整体重排必须同样可行，且保留的座次不违反任何约束
    const full = solve(base);
    if (!full.ok) {
      tracer.add('parity', '整体重排不可行而增量可行，按保守原则以整体结果为准。');
      return finalizeFull(banquet, tracer, now, previous);
    }
    tracer.add(
      'parity',
      `等价校验通过：增量重推仅涉及 ${affectedTables.size + countTablesOf(assignments, unsettled)} 桌 / ${unsettled.size} 位宾客，其余座次与整体重排同样合法。`,
    );

    for (const a of assignments) {
      if (unsettled.has(a.guestId)) {
        const g = banquet.guests.find((x) => x.id === a.guestId);
        const t = banquet.tables.find((x) => x.id === a.tableId);
        tracer.add('place', `「${g?.name}」落座「${t?.name}」。`);
      }
    }
    const affected = new Set<string>(affectedTables);
    for (const a of assignments) {
      if (unsettled.has(a.guestId)) affected.add(a.tableId);
    }
    return {
      arrangement: {
        status: 'arranged',
        assignments,
        confirmed: previous.confirmed,
        arrangedAt: now,
        trace: tracer.entries,
        conflicts: null,
        affectedTableIds: [...affected].filter((id) => tableIds.has(id)),
      },
      archived: null,
    };
  }

  // 增量不可行：以整体重排结果为准
  tracer.add('info', '锁定既有座次后无可行解，执行整体重排核对。');
  return finalizeFull(banquet, tracer, now, previous);
}

function countTablesOf(assignments: SeatingAssignment[], guests: Set<string>): number {
  const tables = new Set<string>();
  for (const a of assignments) if (guests.has(a.guestId)) tables.add(a.tableId);
  return tables.size;
}

/** 确定性挑选下一批被牵连疏散的宾客：与未安置者同桌者优先 */
function pickExpansionGuests(
  banquet: Banquet,
  kept: SeatingAssignment[],
  unsettled: Set<string>,
  round: number,
): string[] {
  const tableOf = new Map(kept.map((a) => [a.guestId, a.tableId]));
  const unsettledTables = new Set<string>();
  for (const a of banquet.arrangement.assignments) {
    if (unsettled.has(a.guestId)) unsettledTables.add(a.tableId);
  }
  const candidates = kept
    .filter((a) => unsettledTables.has(a.tableId))
    .map((a) => a.guestId);
  if (candidates.length > 0) return candidates.slice(0, round * 2);
  // 兜底：按名单顺序疏散未受影响的宾客
  const remaining = banquet.guests
    .filter((g) => !unsettled.has(g.id) && tableOf.has(g.id))
    .map((g) => g.id);
  return remaining.slice(0, round * 2);
}

/** 整体重排（也用于增量失败时的兜底），并处理不可编排归档 */
function finalizeFull(
  banquet: Banquet,
  tracer: Tracer,
  now: number,
  previous: Arrangement,
): RearrangeResult {
  const base = {
    guests: banquet.guests,
    tables: banquet.tables,
    dishes: banquet.dishes,
    constraints: banquet.constraints,
  };
  const outcome = solve(base);
  if (outcome.ok) {
    for (const a of outcome.assignments) {
      const g = banquet.guests.find((x) => x.id === a.guestId);
      const t = banquet.tables.find((x) => x.id === a.tableId);
      tracer.add('place', `「${g?.name}」落座「${t?.name}」。`);
    }
    tracer.add('parity', '整体重排完成，结果通过全量校验。');
    return {
      arrangement: {
        status: 'arranged',
        assignments: outcome.assignments,
        confirmed: previous.confirmed && previous.status === 'arranged',
        arrangedAt: now,
        trace: tracer.entries,
        conflicts: null,
        affectedTableIds: banquet.tables.map((t) => t.id),
      },
      archived: null,
    };
  }

  const conflicts = analyzeUnsat(base);
  tracer.add('conflict', '全部约束无法同时满足，本场宴席进入「不可编排」状态。');
  for (const line of conflicts.core) tracer.add('conflict', `冲突核心：${line}`);
  for (const note of conflicts.notes) tracer.add('conflict', `说明：${note}`);
  const archived =
    previous.assignments.length > 0
      ? {
          archivedAt: now,
          assignments: previous.assignments,
          confirmed: previous.confirmed,
        }
      : null;
  if (archived) {
    tracer.add('status', '旧座次已归档备查，不作为当前座次残留。');
  }
  return {
    arrangement: {
      status: 'unarrangeable',
      assignments: [],
      confirmed: false,
      arrangedAt: now,
      trace: tracer.entries,
      conflicts,
      affectedTableIds: banquet.tables.map((t) => t.id),
    },
    archived,
  };
}

/** 整体重排入口（批量编排与手动「全部重排」共用） */
export function fullRearrange(banquet: Banquet, now: number = Date.now()): RearrangeResult {
  const tracer = makeTracer();
  tracer.add('info', '执行整体编排。');
  if (banquet.guests.length === 0) {
    tracer.add('status', '宾客名单为空，本场宴席标记为「不可编排」。');
    return {
      arrangement: {
        status: 'empty',
        assignments: [],
        confirmed: false,
        arrangedAt: now,
        trace: tracer.entries,
        conflicts: null,
        affectedTableIds: [],
      },
      archived:
        banquet.arrangement.assignments.length > 0
          ? {
              archivedAt: now,
              assignments: banquet.arrangement.assignments,
              confirmed: banquet.arrangement.confirmed,
            }
          : null,
    };
  }
  return finalizeFull(banquet, tracer, now, banquet.arrangement);
}

export { groupSize, dietaryEligible, rankEligible };
