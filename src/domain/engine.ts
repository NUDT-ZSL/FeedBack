// 推演引擎：纯函数，输入原始经营数据，输出库存、售罄时点、动销、归因与汇总。
// 支持整体重算（recompute）与按受影响书籍的增量重算（recomputeAffected），
// 两者共用同一套归因/统计函数，verifyConsistency 可校验增量结果与整体重算一致。

import type { Adjudication, Book, Sale, ShopData, SlotMove } from './types';

export const ts = (iso: string): number => new Date(iso).getTime();

export interface Interval {
  bookId: string;
  slot: string;
  start: number; // -Infinity 表示营业起始
  end: number; // Infinity 表示至今
}

export interface ConflictRegion {
  id: string;
  slot: string;
  start: number;
  end: number;
  bookIds: string[]; // 争议双方（候选归属书）
  winnerId: string | null; // 裁决后归属，未裁决为 null
  adjudicationId: string | null;
}

export type SaleFlag = 'oversell' | 'return-overflow' | 'disputed';

export interface Attribution {
  saleId: string;
  bookId: string;
  slot: string | null; // null 表示该时刻该书不在任何陈列位（库中售出）
  slotLabel: string; // 陈列位 / 库中 / 待裁决
  periodStart: number; // 归属时段（占位区间或争议区间）
  periodEnd: number;
  disputed: boolean;
  conflictId: string | null;
  candidates: string[]; // 争议涉及的书
}

export interface BookStats {
  bookId: string;
  soldQty: number; // 净销量（含退货冲减）
  grossSold: number; // 累计售出（不含退货）
  returnedQty: number; // 累计退货
  finalStock: number;
  soldOutAt: string | null; // 售罄时点（库存首次归零/为负的销售时刻）
  firstSaleAt: string | null;
  lastSaleAt: string | null;
  revenue: number; // 按成交价累计
  cost: number;
  profit: number;
  status: '未动销' | '动销中' | '已售罄';
  anomalySaleIds: string[];
}

export interface AggRow {
  key: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface EngineResult {
  intervals: Interval[]; // 原始占位区间（未按裁决裁剪，供时间线展示）
  conflicts: ConflictRegion[];
  attributions: Record<string, Attribution>;
  saleFlags: Record<string, SaleFlag[]>;
  bookStats: Record<string, BookStats>;
  byCategory: AggRow[];
  byChannel: AggRow[];
  bySlot: AggRow[];
  totals: AggRow;
}

// ---------- 占位区间 ----------

export function buildIntervals(books: Book[], moves: SlotMove[]): Interval[] {
  const byBook = new Map<string, SlotMove[]>();
  for (const m of moves) {
    if (!byBook.has(m.bookId)) byBook.set(m.bookId, []);
    byBook.get(m.bookId)!.push(m);
  }
  const intervals: Interval[] = [];
  for (const book of books) {
    const bookMoves = (byBook.get(book.id) ?? [])
      .slice()
      .sort((a, b) => ts(a.effectiveAt) - ts(b.effectiveAt) || a.id.localeCompare(b.id));
    const points = [
      { slot: book.slot, at: -Infinity },
      ...bookMoves.map((m) => ({ slot: m.slot, at: ts(m.effectiveAt) })),
    ];
    for (let i = 0; i < points.length; i++) {
      intervals.push({
        bookId: book.id,
        slot: points[i].slot,
        start: points[i].at,
        end: i + 1 < points.length ? points[i + 1].at : Infinity,
      });
    }
  }
  return intervals;
}

// ---------- 冲突检测与裁决应用 ----------

export function detectConflicts(
  intervals: Interval[],
  adjudications: Adjudication[],
): ConflictRegion[] {
  const bySlot = new Map<string, Interval[]>();
  for (const iv of intervals) {
    if (!bySlot.has(iv.slot)) bySlot.set(iv.slot, []);
    bySlot.get(iv.slot)!.push(iv);
  }
  const regions: ConflictRegion[] = [];
  for (const [slot, list] of bySlot) {
    // 同一位置同一时段只能放一本书：两两区间重叠即冲突
    const sorted = list.slice().sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (b.start >= a.end) break;
        if (a.bookId === b.bookId) continue;
        const start = Math.max(a.start, b.start);
        const end = Math.min(a.end, b.end);
        if (start < end) {
          regions.push({
            id: `${slot}|${start}|${end}`,
            slot,
            start,
            end,
            bookIds: [],
            winnerId: null,
            adjudicationId: null,
          });
        }
      }
    }
  }
  // 合并同位置、时间相接/重叠的冲突区，并取候选书并集
  const merged: ConflictRegion[] = [];
  for (const r of regions.sort((a, b) => a.slot.localeCompare(b.slot) || a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && last.slot === r.slot && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
      last.id = `${last.slot}|${last.start}|${last.end}`;
    } else {
      merged.push({ ...r });
    }
  }
  for (const region of merged) {
    const involved = new Set<string>();
    for (const iv of bySlot.get(region.slot)!) {
      if (iv.start < region.end && iv.end > region.start) involved.add(iv.bookId);
    }
    region.bookIds = [...involved].sort();
    // 应用裁决：时间范围与冲突区重合的裁决生效
    const adj = adjudications.find(
      (a) =>
        a.slot === region.slot &&
        ts(a.start) <= region.start &&
        ts(a.end) >= region.end &&
        region.bookIds.includes(a.bookId),
    );
    if (adj) {
      region.winnerId = adj.bookId;
      region.adjudicationId = adj.id;
    }
  }
  return merged;
}

// ---------- 单笔销售归因 ----------

function attributeSale(
  sale: Sale,
  intervals: Interval[],
  conflicts: ConflictRegion[],
): Attribution {
  const t = ts(sale.time);
  const iv = intervals.find(
    (i) => i.bookId === sale.bookId && t >= i.start && t < i.end,
  );
  if (!iv) {
    return {
      saleId: sale.id,
      bookId: sale.bookId,
      slot: null,
      slotLabel: '库中',
      periodStart: t,
      periodEnd: t,
      disputed: false,
      conflictId: null,
      candidates: [],
    };
  }
  const region = conflicts.find(
    (c) =>
      c.slot === iv.slot &&
      t >= c.start &&
      t < c.end &&
      c.bookIds.includes(sale.bookId),
  );
  if (!region) {
    return {
      saleId: sale.id,
      bookId: sale.bookId,
      slot: iv.slot,
      slotLabel: iv.slot,
      periodStart: iv.start,
      periodEnd: iv.end,
      disputed: false,
      conflictId: null,
      candidates: [],
    };
  }
  if (!region.winnerId) {
    // 归属不清：保留双方，待裁决
    return {
      saleId: sale.id,
      bookId: sale.bookId,
      slot: iv.slot,
      slotLabel: `${iv.slot}（待裁决）`,
      periodStart: region.start,
      periodEnd: region.end,
      disputed: true,
      conflictId: region.id,
      candidates: region.bookIds,
    };
  }
  if (region.winnerId === sale.bookId) {
    return {
      saleId: sale.id,
      bookId: sale.bookId,
      slot: iv.slot,
      slotLabel: iv.slot,
      periodStart: region.start,
      periodEnd: region.end,
      disputed: false,
      conflictId: region.id,
      candidates: region.bookIds,
    };
  }
  // 裁决判定该时段位置不属于此书：视为库中售出
  return {
    saleId: sale.id,
    bookId: sale.bookId,
    slot: null,
    slotLabel: '库中',
    periodStart: region.start,
    periodEnd: region.end,
    disputed: false,
    conflictId: region.id,
    candidates: region.bookIds,
  };
}

// ---------- 单书库存/动销统计 ----------

function computeBookStats(book: Book, sales: Sale[]): BookStats {
  const mine = sales
    .filter((s) => s.bookId === book.id)
    .sort((a, b) => ts(a.time) - ts(b.time) || a.id.localeCompare(b.id));
  let stock = book.initialStock;
  let netSold = 0;
  let grossSold = 0;
  let returned = 0;
  let soldOutAt: string | null = null;
  const anomalySaleIds: string[] = [];
  for (const s of mine) {
    if (s.quantity > 0) {
      grossSold += s.quantity;
      netSold += s.quantity;
      stock -= s.quantity;
      if (stock < 0) anomalySaleIds.push(s.id); // 超卖：标记异常，不静默吞掉
      if (stock <= 0 && soldOutAt === null) soldOutAt = s.time;
    } else if (s.quantity < 0) {
      const ret = -s.quantity;
      returned += ret;
      netSold -= ret;
      stock += ret;
      if (ret > netSold + ret) anomalySaleIds.push(s.id); // 退货超过累计净售出
    }
  }
  const revenue = mine.reduce((sum, s) => sum + s.quantity * s.price, 0);
  const cost = mine.reduce((sum, s) => sum + s.quantity * book.costPrice, 0);
  const realSales = mine.filter((s) => s.quantity > 0);
  return {
    bookId: book.id,
    soldQty: netSold,
    grossSold,
    returnedQty: returned,
    finalStock: stock,
    soldOutAt,
    firstSaleAt: realSales.length ? realSales[0].time : null,
    lastSaleAt: realSales.length ? realSales[realSales.length - 1].time : null,
    revenue,
    cost,
    profit: revenue - cost,
    status: grossSold === 0 ? '未动销' : stock <= 0 ? '已售罄' : '动销中',
    anomalySaleIds,
  };
}

// ---------- 汇总 ----------

function emptyRow(key: string): AggRow {
  return { key, qty: 0, revenue: 0, cost: 0, profit: 0 };
}

function addTo(row: AggRow, qty: number, revenue: number, cost: number) {
  row.qty += qty;
  row.revenue += revenue;
  row.cost += cost;
  row.profit += revenue - cost;
}

function buildAggregates(
  data: ShopData,
  attributions: Record<string, Attribution>,
  bookStats: Record<string, BookStats>,
): Pick<EngineResult, 'byCategory' | 'byChannel' | 'bySlot' | 'totals'> {
  const bookById = new Map(data.books.map((b) => [b.id, b]));
  const catMap = new Map<string, AggRow>();
  const chanMap = new Map<string, AggRow>();
  const slotMap = new Map<string, AggRow>();
  const totals = emptyRow('全部');
  for (const sale of data.sales) {
    const book = bookById.get(sale.bookId);
    if (!book) continue;
    const revenue = sale.quantity * sale.price;
    const cost = sale.quantity * book.costPrice;
    const attr = attributions[sale.id];
    const slotKey = attr ? (attr.disputed ? '待裁决' : (attr.slot ?? '库中')) : '未知';
    for (const [map, key] of [
      [catMap, book.category],
      [chanMap, sale.channel],
      [slotMap, slotKey],
    ] as const) {
      if (!map.has(key)) map.set(key, emptyRow(key));
      addTo(map.get(key)!, sale.quantity, revenue, cost);
    }
    addTo(totals, sale.quantity, revenue, cost);
  }
  const byKey = (a: AggRow, b: AggRow) => a.key.localeCompare(b.key, 'zh');
  void bookStats;
  return {
    byCategory: [...catMap.values()].sort(byKey),
    byChannel: [...chanMap.values()].sort(byKey),
    bySlot: [...slotMap.values()].sort(byKey),
    totals,
  };
}

function buildSaleFlags(
  data: ShopData,
  attributions: Record<string, Attribution>,
  bookStats: Record<string, BookStats>,
): Record<string, SaleFlag[]> {
  const flags: Record<string, SaleFlag[]> = {};
  const anomalySet = new Set<string>();
  for (const st of Object.values(bookStats)) {
    for (const id of st.anomalySaleIds) anomalySet.add(id);
  }
  for (const sale of data.sales) {
    const list: SaleFlag[] = [];
    const attr = attributions[sale.id];
    if (attr?.disputed) list.push('disputed');
    if (anomalySet.has(sale.id)) {
      list.push(sale.quantity < 0 ? 'return-overflow' : 'oversell');
    }
    flags[sale.id] = list;
  }
  return flags;
}

// ---------- 整体重算 ----------

export function recompute(data: ShopData): EngineResult {
  const intervals = buildIntervals(data.books, data.moves);
  const conflicts = detectConflicts(intervals, data.adjudications);
  const attributions: Record<string, Attribution> = {};
  for (const sale of data.sales) {
    attributions[sale.id] = attributeSale(sale, intervals, conflicts);
  }
  const bookStats: Record<string, BookStats> = {};
  for (const book of data.books) {
    bookStats[book.id] = computeBookStats(book, data.sales);
  }
  const aggregates = buildAggregates(data, attributions, bookStats);
  return {
    intervals,
    conflicts,
    attributions,
    saleFlags: buildSaleFlags(data, attributions, bookStats),
    bookStats,
    ...aggregates,
  };
}

// ---------- 增量重算：只重算受影响的书与时段 ----------

export function affectedBooksOfAdjudication(
  data: ShopData,
  adjudication: Adjudication,
): string[] {
  const intervals = buildIntervals(data.books, data.moves);
  const conflicts = detectConflicts(intervals, data.adjudications);
  const start = ts(adjudication.start);
  const end = ts(adjudication.end);
  const hit = conflicts.find(
    (c) => c.slot === adjudication.slot && c.start >= start && c.end <= end,
  );
  return hit ? hit.bookIds : [adjudication.bookId];
}

export function recomputeAffected(
  data: ShopData,
  prev: EngineResult,
  affectedBookIds: string[],
): EngineResult {
  const affected = new Set(affectedBookIds);
  const intervals = buildIntervals(data.books, data.moves);
  const conflicts = detectConflicts(intervals, data.adjudications);
  // 只重算受影响书籍的销售归因，其余沿用上次结果
  const attributions: Record<string, Attribution> = { ...prev.attributions };
  for (const sale of data.sales) {
    if (affected.has(sale.bookId)) {
      attributions[sale.id] = attributeSale(sale, intervals, conflicts);
    }
  }
  // 只重算受影响书籍的库存/动销统计
  const bookStats: Record<string, BookStats> = { ...prev.bookStats };
  for (const book of data.books) {
    if (affected.has(book.id)) {
      bookStats[book.id] = computeBookStats(book, data.sales);
    }
  }
  const aggregates = buildAggregates(data, attributions, bookStats);
  return {
    intervals,
    conflicts,
    attributions,
    saleFlags: buildSaleFlags(data, attributions, bookStats),
    bookStats,
    ...aggregates,
  };
}

// ---------- 一致性校验：增量结果应与整体重算完全一致 ----------

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function verifyConsistency(data: ShopData, incremental: EngineResult): boolean {
  const full = recompute(data);
  return stableStringify(full) === stableStringify(incremental);
}
