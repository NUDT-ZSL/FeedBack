/**
 * 座次求解器：确定性的约束满足搜索。
 *
 * 约束：
 *  - 每桌人头占用（含随行）不得超过容量；
 *  - 主桌仅允许身份等级 >= minRank 的宾客；
 *  - 宾客忌口不得与该桌菜品标签相交；
 *  - 不宜同桌的两位宾客不得同桌；
 *  - 随行人员随主宾同桌（整体作为一个分组参与分配）。
 *
 * 同一输入永远得到同一结果（确定性排序 + MRV 启发式），
 * 因此增量重推可以与整体重排进行等价校验。
 */
import type {
  AvoidConstraint,
  BanquetTable,
  ConflictReport,
  Dish,
  Guest,
  Rank,
  SeatingAssignment,
} from './types';

export interface SolveInput {
  guests: Guest[];
  tables: BanquetTable[];
  dishes: Dish[];
  constraints: AvoidConstraint[];
}

export type SolveOutcome =
  | { ok: true; assignments: SeatingAssignment[] }
  | { ok: false };

const NODE_LIMIT = 200_000;

export const groupSize = (guest: Guest): number => 1 + guest.entourage;

export function dishTagSet(table: BanquetTable, dishes: Dish[]): Set<string> {
  const tags = new Set<string>();
  for (const id of table.dishIds) {
    dishes.find((d) => d.id === id)?.tags.forEach((t) => tags.add(t));
  }
  return tags;
}

export function rankEligible(table: BanquetTable, guest: Guest): boolean {
  return !table.isMain || guest.rank >= (table.minRank as Rank);
}

export function dietaryEligible(
  table: BanquetTable,
  guest: Guest,
  dishes: Dish[],
): boolean {
  const tags = dishTagSet(table, dishes);
  return !guest.dietary.some((tag) => tags.has(tag));
}

export function avoidMapOf(constraints: AvoidConstraint[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const c of constraints) {
    if (!map.has(c.a)) map.set(c.a, new Set());
    if (!map.has(c.b)) map.set(c.b, new Set());
    map.get(c.a)!.add(c.b);
    map.get(c.b)!.add(c.a);
  }
  return map;
}

export function guestsAvoidEachOther(
  g1: Guest,
  g2: Guest,
  avoid: Map<string, Set<string>>,
): boolean {
  return avoid.get(g1.id)?.has(g2.id) ?? false;
}

interface Candidate {
  tableIdx: number;
}

/**
 * 带锁座（增量重推时不得移动的宾客）的求解。
 * lockedByTable 中的宾客与未列入 unsettled 的宾客等价：保持原桌。
 */
export function solve(
  input: SolveInput,
  lockedByTable?: Map<string, string[]>,
): SolveOutcome {
  const { guests, tables, dishes, constraints } = input;
  if (guests.length === 0) return { ok: true, assignments: [] };
  if (tables.length === 0) return { ok: false };

  const avoid = avoidMapOf(constraints);
  const placedAt = new Map<string, string[]>();
  const occupancy = new Map<string, number>();
  const lockedGuests = new Set<string>();
  for (const table of tables) {
    const locked = lockedByTable?.get(table.id) ?? [];
    placedAt.set(table.id, [...locked]);
    occupancy.set(table.id, locked.reduce((sum, gid) => {
      const g = guests.find((x) => x.id === gid);
      return sum + (g ? groupSize(g) : 0);
    }, 0));
    locked.forEach((gid) => lockedGuests.add(gid));
  }

  // 锁座自身必须合法
  for (const table of tables) {
    const seated = placedAt.get(table.id)!;
    const resolved = seated
      .map((gid) => guests.find((g) => g.id === gid))
      .filter((g): g is Guest => Boolean(g));
    if (occupancy.get(table.id)! > table.capacity) return { ok: false };
    for (const g of resolved) {
      if (!rankEligible(table, g) || !dietaryEligible(table, g, dishes)) {
        return { ok: false };
      }
    }
    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        if (guestsAvoidEachOther(resolved[i], resolved[j], avoid)) {
          return { ok: false };
        }
      }
    }
  }

  const unsettled = guests.filter((g) => !lockedGuests.has(g.id));

  const candidatesFor = (guest: Guest): Candidate[] => {
    const result: Candidate[] = [];
    for (let ti = 0; ti < tables.length; ti++) {
      const table = tables[ti];
      if (occupancy.get(table.id)! + groupSize(guest) > table.capacity) continue;
      if (!rankEligible(table, guest)) continue;
      if (!dietaryEligible(table, guest, dishes)) continue;
      const seated = placedAt.get(table.id)!;
      let conflict = false;
      for (const gid of seated) {
        if (avoid.get(guest.id)?.has(gid)) {
          conflict = true;
          break;
        }
      }
      if (conflict) continue;
      result.push({ tableIdx: ti });
    }
    return result;
  };

  let nodes = 0;

  const dfs = (remaining: Guest[]): boolean => {
    if (++nodes > NODE_LIMIT) return false;
    if (remaining.length === 0) return true;

    // MRV：候选桌最少的宾客优先
    let chosenIdx = 0;
    let chosenCandidates: Candidate[] | null = null;
    for (let i = 0; i < remaining.length; i++) {
      const cands = candidatesFor(remaining[i]);
      if (cands.length === 0) return false;
      if (
        chosenCandidates === null ||
        cands.length < chosenCandidates.length
      ) {
        chosenCandidates = cands;
        chosenIdx = i;
      }
    }
    const guest = remaining[chosenIdx];
    const next = remaining.filter((_, i) => i !== chosenIdx);

    // 桌的尝试顺序固定：主桌优先，其次按原配置顺序，保证确定性
    const ordered = [...chosenCandidates!].sort(
      (x, y) =>
        Number(tables[y.tableIdx].isMain) - Number(tables[x.tableIdx].isMain) ||
        x.tableIdx - y.tableIdx,
    );
    for (const cand of ordered) {
      const table = tables[cand.tableIdx];
      placedAt.get(table.id)!.push(guest.id);
      occupancy.set(table.id, occupancy.get(table.id)! + groupSize(guest));
      if (dfs(next)) return true;
      placedAt.set(table.id, placedAt.get(table.id)!.filter((id) => id !== guest.id));
      occupancy.set(table.id, occupancy.get(table.id)! - groupSize(guest));
    }
    return false;
  };

  // 大分组优先同样有助于尽早触发容量剪枝
  const orderedGuests = [...unsettled].sort(
    (a, b) =>
      groupSize(b) - groupSize(a) ||
      guests.indexOf(a) - guests.indexOf(b),
  );

  if (!dfs(orderedGuests)) return { ok: false };

  const assignments: SeatingAssignment[] = [];
  for (const table of tables) {
    for (const guestId of placedAt.get(table.id)!) {
      assignments.push({ guestId, tableId: table.id });
    }
  }
  // 确定性输出：按宾客在名单中的顺序
  assignments.sort(
    (x, y) =>
      guests.findIndex((g) => g.id === x.guestId) -
      guests.findIndex((g) => g.id === y.guestId),
  );
  return { ok: true, assignments };
}

/**
 * 在无向的不宜同桌图上枚举简单环（限制长度与数量），用于可追溯说明。
 * 例：甲-乙、乙-丙、丙-甲 => [["甲","乙","丙"]]
 */
export function detectAvoidCycles(
  constraints: AvoidConstraint[],
  guestNames?: Map<string, string>,
): string[][] {
  const adj = new Map<string, Set<string>>();
  for (const c of constraints) {
    if (!adj.has(c.a)) adj.set(c.a, new Set());
    if (!adj.has(c.b)) adj.set(c.b, new Set());
    adj.get(c.a)!.add(c.b);
    adj.get(c.b)!.add(c.a);
  }
  const cycles: string[][] = [];
  const seenKeys = new Set<string>();
  const MAX_CYCLES = 20;
  const MAX_LEN = 8;

  const label = (id: string) => guestNames?.get(id) ?? id;

  const dfs = (start: string, current: string, path: string[], visited: Set<string>) => {
    if (cycles.length >= MAX_CYCLES) return;
    for (const next of [...(adj.get(current) ?? [])].sort()) {
      if (next === start && path.length >= 3) {
        const nodes = [...path];
        // 规范旋转，使环从最小节点开始，避免同一环重复记录
        const minPos = nodes.reduce((mi, _, i) => (nodes[i] < nodes[mi] ? i : mi), 0);
        let rotated = [...nodes.slice(minPos), ...nodes.slice(0, minPos)];
        // 同一无向环的反向遍历也视为重复：固定第二节点小于末节点
        const reversed = [rotated[0], ...rotated.slice(1).reverse()];
        if (reversed[1] < rotated[1]) rotated = reversed;
        const key = rotated.join('|');
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          cycles.push(rotated.map(label));
        }
        continue;
      }
      if (visited.has(next)) continue;
      if (path.length >= MAX_LEN) continue;
      visited.add(next);
      path.push(next);
      dfs(start, next, path, visited);
      path.pop();
      visited.delete(next);
    }
  };

  for (const start of [...adj.keys()].sort()) {
    if (cycles.length >= MAX_CYCLES) break;
    dfs(start, start, [start], new Set([start]));
  }
  return cycles;
}

/**
 * 不可满足分析：保留全部冲突，给出最小化的约束核心与人类可追溯说明。
 * 不静默忽略任何约束。
 */
export function analyzeUnsat(input: SolveInput): ConflictReport {
  const { guests, tables, dishes, constraints } = input;
  const nameOf = new Map(guests.map((g) => [g.id, g.name]));
  const tableName = (id: string) => tables.find((t) => t.id === id)?.name ?? id;
  const guestName = (id: string) => nameOf.get(id) ?? id;
  const core: string[] = [];
  const notes: string[] = [];

  if (guests.length === 0) {
    return { unsatisfiable: false, core: [], cycles: [], notes: [] };
  }
  if (tables.length === 0) {
    core.push('未配置任何桌次，宾客无处落座。');
    return { unsatisfiable: true, core, cycles: [], notes };
  }

  // 结构性检查（与不宜同桌约束无关的硬性不可行）
  let anyCapacity = false;
  for (const guest of guests) {
    const size = groupSize(guest);
    const capacityFit = tables.filter((t) => t.capacity >= size);
    const rankFit = capacityFit.filter((t) => rankEligible(t, guest));
    const dietaryFit = rankFit.filter((t) => dietaryEligible(t, guest, dishes));
    if (dietaryFit.length === 0) {
      let reason: string;
      if (capacityFit.length === 0) {
        reason = `所有桌容量均小于该宾客一行 ${size} 人`;
      } else if (rankFit.length === 0) {
        reason = `容量足够的桌次均为主桌，宾客等级 ${guest.rank} 低于主桌门槛`;
      } else {
        reason = `其忌口（${guest.dietary.join('、')}）在所有可容纳的桌次菜品中均出现`;
      }
      core.push(`宾客「${guest.name}」无任何可落座的桌次：${reason}。`);
    }
    if (capacityFit.length > 0) anyCapacity = true;
  }
  if (!anyCapacity && guests.some((g) => g.entourage > 0)) {
    notes.push('存在随行人数较多的分组，现有桌容无法容纳。');
  }

  // 容量总量检查
  const totalCapacity = tables.reduce((s, t) => s + t.capacity, 0);
  const totalPeople = guests.reduce((s, g) => s + groupSize(g), 0);
  if (totalPeople > totalCapacity) {
    core.push(
      `全部桌容量合计 ${totalCapacity} 人，宾客（含随行）合计 ${totalPeople} 人，容量不足 ${totalPeople - totalCapacity} 人。`,
    );
  }

  // 不宜同桌约束的最小核心：逐条尝试移除，若移除后可编排则该约束是核心成员
  const avoidCore: AvoidConstraint[] = [];
  for (const c of constraints) {
    const relaxed = constraints.filter((x) => x.id !== c.id);
    const outcome = solve({ ...input, constraints: relaxed });
    if (outcome.ok) avoidCore.push(c);
  }
  if (avoidCore.length > 0 && core.length === 0) {
    for (const c of avoidCore) {
      const note = c.note ? `（${c.note}）` : '';
      core.push(
        `约束「${guestName(c.a)} 不宜与 ${guestName(c.b)} 同桌」${note}无法与其余约束同时满足。`,
      );
    }
  } else if (avoidCore.length > 0) {
    notes.push('此外，以下不宜同桌约束也会单独导致无解：' +
      avoidCore
        .map((c) => `${guestName(c.a)}↔${guestName(c.b)}`)
        .join('、'));
  }

  const cycles = detectAvoidCycles(constraints, nameOf);
  if (cycles.length > 0) {
    for (const cycle of cycles.slice(0, 5)) {
      notes.push(
        `检测到不宜同桌约束环：${cycle.join(' → ')} → ${cycle[0]}（环本身不必然无解，但叠加桌容/等级限制时会相互牵制）。`,
      );
    }
  }

  if (core.length === 0) {
    core.push('在现有桌容、主桌等级门槛、忌口与不宜同桌约束的组合下不存在可行座次。');
  }

  return {
    unsatisfiable: true,
    core,
    cycles,
    notes: notes.map((n) => {
      // 将内部 id 替换为可读桌名/人名（保守替换）
      let text = n;
      for (const t of tables) text = text.split(t.id).join(tableName(t.id));
      return text;
    }),
  };
}
