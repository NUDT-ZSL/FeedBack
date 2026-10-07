/**
 * 座次校验：任何编排结果在落盘前都通过同一套规则检查，
 * 确保不会出现同一宾客两桌、随行超容等非法状态。
 */
import type {
  AvoidConstraint,
  BanquetTable,
  Dish,
  Guest,
  SeatingAssignment,
  ValidationIssue,
} from './types';
import { dietaryEligible, groupSize, rankEligible, avoidMapOf } from './solver';

export function validateArrangement(
  guests: Guest[],
  tables: BanquetTable[],
  dishes: Dish[],
  constraints: AvoidConstraint[],
  assignments: SeatingAssignment[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const guestMap = new Map(guests.map((g) => [g.id, g]));
  const tableMap = new Map(tables.map((t) => [t.id, t]));
  const avoid = avoidMapOf(constraints);

  // 同一宾客两桌 / 未知宾客
  const seenGuests = new Set<string>();
  for (const a of assignments) {
    if (!guestMap.has(a.guestId)) {
      issues.push({
        kind: 'unknown-guest',
        message: `座次引用了名单中不存在的宾客 ${a.guestId}。`,
      });
    }
    if (seenGuests.has(a.guestId)) {
      issues.push({
        kind: 'duplicate-seating',
        message: `宾客「${guestMap.get(a.guestId)?.name ?? a.guestId}」被同时安排到多桌。`,
      });
    }
    seenGuests.add(a.guestId);
    if (!tableMap.has(a.tableId)) {
      issues.push({
        kind: 'capacity-exceeded',
        message: `座次引用了不存在的桌次 ${a.tableId}。`,
      });
    }
  }

  // 未落座宾客（仅提示，编排成功时不应出现）
  for (const g of guests) {
    if (!seenGuests.has(g.id)) {
      issues.push({
        kind: 'unseated-guest',
        message: `宾客「${g.name}」尚未落座。`,
      });
    }
  }

  const byTable = new Map<string, Guest[]>();
  for (const a of assignments) {
    const g = guestMap.get(a.guestId);
    if (!g || !tableMap.has(a.tableId)) continue;
    if (!byTable.has(a.tableId)) byTable.set(a.tableId, []);
    byTable.get(a.tableId)!.push(g);
  }

  for (const table of tables) {
    const seated = byTable.get(table.id) ?? [];
    const heads = seated.reduce((s, g) => s + groupSize(g), 0);
    if (heads > table.capacity) {
      issues.push({
        kind: 'capacity-exceeded',
        message: `「${table.name}」共 ${heads} 人（含随行），超出容量 ${table.capacity}。`,
      });
    }
    for (const g of seated) {
      if (!rankEligible(table, g)) {
        issues.push({
          kind: 'rank-violation',
          message: `宾客「${g.name}」等级 ${g.rank} 低于「${table.name}」主桌门槛 ${table.minRank}。`,
        });
      }
      if (!dietaryEligible(table, g, dishes)) {
        const tags = g.dietary.filter((tag) =>
          table.dishIds.some((did) => dishes.find((d) => d.id === did)?.tags.includes(tag)),
        );
        issues.push({
          kind: 'dietary-violation',
          message: `宾客「${g.name}」的忌口（${tags.join('、')}）出现在「${table.name}」的菜品中。`,
        });
      }
    }
    for (let i = 0; i < seated.length; i++) {
      for (let j = i + 1; j < seated.length; j++) {
        if (avoid.get(seated[i].id)?.has(seated[j].id)) {
          issues.push({
            kind: 'avoid-violation',
            message: `「${seated[i].name}」与「${seated[j].name}」被安排同桌，但存在不宜同桌约束。`,
          });
        }
      }
    }
  }
  return issues;
}

/** 校验通过 = 无任何问题（含未落座提示） */
export function isValidArrangement(
  guests: Guest[],
  tables: BanquetTable[],
  dishes: Dish[],
  constraints: AvoidConstraint[],
  assignments: SeatingAssignment[],
): boolean {
  return (
    validateArrangement(guests, tables, dishes, constraints, assignments).length === 0
  );
}
