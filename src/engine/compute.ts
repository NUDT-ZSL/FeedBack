import type {
  Anomaly,
  AttributionCandidate,
  Book,
  BookStat,
  Dataset,
  PeriodCell,
  Placement,
  Result,
  Sale,
  SaleRow,
  SlotInterval,
} from "./types";

const SHICHEN = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

export function periodOf(iso: string): string {
  const d = new Date(iso);
  const date = `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return `${date} ${SHICHEN[Math.floor(d.getHours() / 2)]}时`;
}

export function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear()).padStart(4, "0")}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

function cmpTime(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

/** 某书在 t 时刻的陈列归属候选。并列时刻（换位与销售同时）返回 2 个候选。 */
function candidatesFor(placements: Placement[], t: string): AttributionCandidate[] {
  if (placements.length === 0) return [];
  const sorted = [...placements].sort((a, b) => cmpTime(a.effectiveAt, b.effectiveAt));
  const tMs = new Date(t).getTime();
  let idx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (new Date(sorted[i].effectiveAt).getTime() <= tMs) idx = i;
  }
  if (idx < 0) return [];
  const cur = sorted[idx];
  const cands: AttributionCandidate[] = [
    { slotId: cur.slotId, label: `${cur.slotId}（换位生效后）` },
  ];
  if (new Date(cur.effectiveAt).getTime() === tMs && idx > 0) {
    const prev = sorted[idx - 1];
    cands.push({ slotId: prev.slotId, label: `${prev.slotId}（换位生效前）` });
  }
  return cands;
}

function buildSlotIntervals(
  slotId: string,
  placements: Placement[],
  anomalies: Anomaly[]
): SlotInterval[] {
  const sorted = [...placements].sort((a, b) => cmpTime(a.effectiveAt, b.effectiveAt));
  const intervals: SlotInterval[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const startMs = new Date(p.effectiveAt).getTime();
    const prev = i > 0 ? sorted[i - 1] : null;
    const next = i + 1 < sorted.length ? sorted[i + 1] : null;
    const disputed =
      (prev !== null && new Date(prev.effectiveAt).getTime() === startMs) ||
      (next !== null && new Date(next.effectiveAt).getTime() === startMs);
    if (next && new Date(next.effectiveAt).getTime() === startMs) {
      anomalies.push({
        type: "slot_conflict",
        refType: "placement",
        refId: next.id,
        message: `陈列位「${slotId}」在 ${fmtTime(next.effectiveAt)} 同时被多本书占位（${p.id.slice(
          0,
          8
        )} 与 ${next.id.slice(0, 8)}），后录入记录优先`,
      });
    }
    intervals.push({
      slotId,
      bookId: p.bookId,
      start: p.effectiveAt,
      end: i + 1 < sorted.length ? sorted[i + 1].effectiveAt : null,
      placementId: p.id,
      disputed,
    });
  }
  return intervals;
}

interface BookLedger {
  stat: BookStat;
  stockAfterBySale: Record<string, number>;
  anomalies: Anomaly[];
}

function computeBookLedger(book: Book, sales: Sale[]): BookLedger {
  const sorted = [...sales].sort((a, b) => cmpTime(a.at, b.at) || a.id.localeCompare(b.id));
  let stock = book.initialStock;
  let soldOutAt: string | null = null;
  let revenue = 0;
  let grossSold = 0;
  let returnedQty = 0;
  const anomalies: Anomaly[] = [];
  const stockAfterBySale: Record<string, number> = {};

  for (const s of sorted) {
    stock -= s.qty;
    stockAfterBySale[s.id] = stock;
    revenue += s.qty * s.price;
    if (s.qty > 0) grossSold += s.qty;
    if (s.qty < 0) returnedQty += -s.qty;
    if (s.qty > 0 && stock < 0) {
      anomalies.push({
        type: "oversell",
        refType: "sale",
        refId: s.id,
        message: `《${book.title}》于 ${fmtTime(s.at)} 售出 ${s.qty} 件后库存为 ${stock}，发生超卖`,
      });
    }
    if (s.qty < 0 && stock > book.initialStock) {
      anomalies.push({
        type: "return_without_stock",
        refType: "sale",
        refId: s.id,
        message: `《${book.title}》于 ${fmtTime(s.at)} 退货 ${-s.qty} 件后库存 ${stock} 超过初始库存 ${
          book.initialStock
        }，疑似无货退货`,
      });
    }
    if (soldOutAt === null && stock <= 0) soldOutAt = s.at;
  }

  const soldQty = grossSold - returnedQty;
  const cost = soldQty * book.costPrice;
  return {
    stat: {
      bookId: book.id,
      soldQty,
      grossSold,
      returnedQty,
      stock,
      soldOutAt,
      revenue,
      cost,
      profit: revenue - cost,
      anomalyCount: 0,
    },
    stockAfterBySale,
    anomalies,
  };
}

export function computeAll(ds: Dataset): Result {
  const anomalies: Anomaly[] = [];
  const bookStats: Record<string, BookStat> = {};
  const stockAfterBySale: Record<string, number> = {};
  const salesByBook: Record<string, Sale[]> = {};
  for (const s of ds.sales) (salesByBook[s.bookId] ??= []).push(s);

  for (const book of ds.books) {
    const ledger = computeBookLedger(book, salesByBook[book.id] ?? []);
    bookStats[book.id] = ledger.stat;
    Object.assign(stockAfterBySale, ledger.stockAfterBySale);
    anomalies.push(...ledger.anomalies);
  }

  // 陈列位时间线 + 同位同时冲突
  const placementsBySlot: Record<string, Placement[]> = {};
  for (const p of ds.placements) (placementsBySlot[p.slotId] ??= []).push(p);
  const slotTimeline: Record<string, SlotInterval[]> = {};
  for (const slot of ds.slots) {
    slotTimeline[slot.id] = buildSlotIntervals(slot.id, placementsBySlot[slot.id] ?? [], anomalies);
  }

  const placementsByBook: Record<string, Placement[]> = {};
  for (const p of ds.placements) (placementsByBook[p.bookId] ??= []).push(p);

  // 销售行：归属 + 时段
  const saleRows: SaleRow[] = [];
  let hasPendingAmbiguity = false;
  for (const s of [...ds.sales].sort((a, b) => cmpTime(a.at, b.at) || a.id.localeCompare(b.id))) {
    const cands = candidatesFor(placementsByBook[s.bookId] ?? [], s.at);
    const rowAnomalies: Anomaly["type"][] = [];
    let slotId: string | null = null;
    let resolved = true;
    if (cands.length === 0) {
      rowAnomalies.push("unattributed");
      anomalies.push({
        type: "unattributed",
        refType: "sale",
        refId: s.id,
        message: `销售 ${s.id.slice(0, 8)} 成交时该书不在任何陈列位，无法归因`,
      });
    } else if (cands.length === 2) {
      const pick = ds.resolutions[s.id];
      if (pick === 0 || pick === 1) {
        slotId = cands[pick].slotId;
      } else {
        resolved = false;
        hasPendingAmbiguity = true;
        rowAnomalies.push("ambiguous_attribution");
        anomalies.push({
          type: "ambiguous_attribution",
          refType: "sale",
          refId: s.id,
          message: `销售 ${s.id.slice(0, 8)} 与换位同时刻（${fmtTime(
            s.at
          )}），陈列位归属不清，待裁决`,
        });
      }
    } else {
      slotId = cands[0].slotId;
    }
    saleRows.push({
      saleId: s.id,
      at: s.at,
      bookId: s.bookId,
      qty: s.qty,
      price: s.price,
      amount: s.qty * s.price,
      channel: s.channel,
      period: periodOf(s.at),
      candidates: cands,
      slotId,
      resolved,
      anomalies: rowAnomalies,
      stockAfter: stockAfterBySale[s.id] ?? null,
    });
  }

  // 陈列位 × 时段 聚合（未裁决的歧义销售不计入）
  const periodCells: Record<string, PeriodCell> = {};
  for (const row of saleRows) {
    if (!row.slotId || row.qty <= 0) continue;
    const key = `${row.slotId}|${row.period}`;
    const cell = (periodCells[key] ??= {
      key,
      slotId: row.slotId,
      period: row.period,
      revenue: 0,
      qty: 0,
    });
    cell.revenue += row.amount;
    cell.qty += row.qty;
  }

  // 每书异常计数
  for (const s of ds.sales) {
    const book = ds.books.find((b) => b.id === s.bookId);
    if (!book) continue;
  }
  for (const a of anomalies) {
    if (a.refType === "sale") {
      const sale = ds.sales.find((s) => s.id === a.refId);
      if (sale && bookStats[sale.bookId]) bookStats[sale.bookId].anomalyCount++;
    }
  }

  return { bookStats, saleRows, slotTimeline, periodCells, anomalies, hasPendingAmbiguity };
}

/**
 * 裁决后的局部重算：只重算受影响的销售行与「陈列位×时段」聚合，
 * 库存、售罄时点、类别/渠道汇总与裁决无关，保持原值。
 */
export function recomputeScoped(prev: Result, ds: Dataset, saleIds: string[]): Result {
  const scoped = new Set(saleIds);
  const placementsByBook: Record<string, Placement[]> = {};
  for (const p of ds.placements) (placementsByBook[p.bookId] ??= []).push(p);
  const saleById = new Map(ds.sales.map((s) => [s.id, s]));

  const saleRows = prev.saleRows.map((row) => {
    if (!scoped.has(row.saleId)) return row;
    const s = saleById.get(row.saleId);
    if (!s) return row;
    const cands = candidatesFor(placementsByBook[s.bookId] ?? [], s.at);
    const pick = ds.resolutions[s.id];
    const resolved = cands.length < 2 || pick === 0 || pick === 1;
    const slotId =
      cands.length === 0 ? null : cands.length === 2 ? (resolved ? cands[pick as number].slotId : null) : cands[0].slotId;
    return {
      ...row,
      candidates: cands,
      slotId,
      resolved,
      anomalies: resolved
        ? row.anomalies.filter((a) => a !== "ambiguous_attribution")
        : row.anomalies,
    };
  });

  // 仅重建受影响销售可能落入的「陈列位×时段」单元
  const affectedKeys = new Set<string>();
  for (const row of prev.saleRows) {
    if (scoped.has(row.saleId) && row.slotId) affectedKeys.add(`${row.slotId}|${row.period}`);
  }
  for (const row of saleRows) {
    if (scoped.has(row.saleId) && row.slotId) affectedKeys.add(`${row.slotId}|${row.period}`);
  }
  const periodCells: Record<string, PeriodCell> = {};
  for (const [k, v] of Object.entries(prev.periodCells)) {
    if (!affectedKeys.has(k)) periodCells[k] = v;
  }
  for (const row of saleRows) {
    if (!row.slotId || row.qty <= 0) continue;
    const key = `${row.slotId}|${row.period}`;
    if (!affectedKeys.has(key)) continue;
    const cell = (periodCells[key] ??= {
      key,
      slotId: row.slotId,
      period: row.period,
      revenue: 0,
      qty: 0,
    });
    cell.revenue += row.amount;
    cell.qty += row.qty;
  }

  const anomalies = prev.anomalies.filter(
    (a) => !(a.type === "ambiguous_attribution" && scoped.has(a.refId))
  );
  for (const row of saleRows) {
    if (scoped.has(row.saleId) && !row.resolved) {
      anomalies.push({
        type: "ambiguous_attribution",
        refType: "sale",
        refId: row.saleId,
        message: `销售 ${row.saleId.slice(0, 8)} 与换位同时刻（${fmtTime(
          row.at
        )}），陈列位归属不清，待裁决`,
      });
    }
  }

  // 每书异常计数随裁决结果重算（仅与异常列表相关）
  const bookStats: Record<string, BookStat> = {};
  for (const [id, s] of Object.entries(prev.bookStats)) {
    bookStats[id] = { ...s, anomalyCount: 0 };
  }
  for (const a of anomalies) {
    if (a.refType === "sale") {
      const sale = ds.sales.find((s) => s.id === a.refId);
      if (sale && bookStats[sale.bookId]) bookStats[sale.bookId].anomalyCount++;
    }
  }

  return {
    ...prev,
    saleRows,
    periodCells,
    anomalies,
    bookStats,
    hasPendingAmbiguity: saleRows.some((r) => !r.resolved),
  };
}

/** 一致性校验：局部重算结果应与整体重算一致。返回不一致的字段描述。 */
export function verifyConsistency(scoped: Result, full: Result): string[] {
  const diffs: string[] = [];
  const normRows = (r: Result) =>
    r.saleRows.map((x) => ({ ...x })).sort((a, b) => a.saleId.localeCompare(b.saleId));
  if (JSON.stringify(normRows(scoped)) !== JSON.stringify(normRows(full)))
    diffs.push("销售归因明细不一致");
  const normCells = (r: Result) =>
    Object.values(r.periodCells)
      .filter((c) => c.qty !== 0 || c.revenue !== 0)
      .sort((a, b) => a.key.localeCompare(b.key));
  if (JSON.stringify(normCells(scoped)) !== JSON.stringify(normCells(full)))
    diffs.push("陈列位×时段聚合不一致");
  const normAnom = (r: Result) =>
    [...r.anomalies].sort((a, b) => (a.refId + a.type).localeCompare(b.refId + b.type));
  if (JSON.stringify(normAnom(scoped)) !== JSON.stringify(normAnom(full)))
    diffs.push("异常列表不一致");
  if (JSON.stringify(scoped.bookStats) !== JSON.stringify(full.bookStats))
    diffs.push("书籍统计不一致");
  return diffs;
}
