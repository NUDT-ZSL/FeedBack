export type Category = "经" | "史" | "子" | "集";
export const CATEGORIES: Category[] = ["经", "史", "子", "集"];

export type Channel = "店内零售" | "批发" | "预订";
export const CHANNELS: Channel[] = ["店内零售", "批发", "预订"];

export interface Book {
  id: string;
  title: string;
  format: string; // 版式
  category: Category;
  costPrice: number; // 进价（文）
  listPrice: number; // 当前售价（文）
  initialStock: number; // 初始库存
}

export interface Placement {
  id: string;
  bookId: string;
  slotId: string;
  effectiveAt: string; // ISO 时刻，自该时刻起该书占据该陈列位
}

export interface Sale {
  id: string;
  at: string; // 交易时刻 ISO
  bookId: string;
  qty: number; // 正=售出，负=退货
  price: number; // 成交价（单件，文）
  channel: Channel;
}

export interface Slot {
  id: string;
  name: string; // 如 甲字一号
}

export interface Dataset {
  books: Book[];
  slots: Slot[];
  placements: Placement[];
  sales: Sale[];
  /** 归属裁决：saleId -> 选中的候选下标（0/1） */
  resolutions: Record<string, number>;
}

export type AnomalyType =
  | "oversell" // 超卖：库存不足仍成交
  | "return_without_stock" // 退货导致库存高于初始/账面
  | "ambiguous_attribution" // 换位与销售同时刻，归属不清
  | "slot_conflict" // 同一陈列位同一时刻放了多本书
  | "unattributed"; // 销售时刻该书不在任何陈列位

export interface Anomaly {
  type: AnomalyType;
  refType: "sale" | "placement";
  refId: string;
  message: string;
}

export interface AttributionCandidate {
  slotId: string | null;
  label: string;
}

export interface BookStat {
  bookId: string;
  soldQty: number; // 净销量（退货抵扣）
  grossSold: number; // 正向售出件数
  returnedQty: number; // 退货件数
  stock: number; // 当前库存
  soldOutAt: string | null; // 售罄时点（首次降到 0 的时刻）
  revenue: number; // 营收（按成交价，退货为负）
  cost: number; // 结转成本（净销量 × 进价）
  profit: number; // 利润
  anomalyCount: number;
}

export interface SaleRow {
  saleId: string;
  at: string;
  bookId: string;
  qty: number;
  price: number;
  amount: number;
  channel: Channel;
  period: string; // YYYY-MM-DD / 时辰
  candidates: AttributionCandidate[]; // 候选陈列位（歧义时为 2 个）
  slotId: string | null; // 最终归属陈列位
  resolved: boolean; // 歧义是否已裁决
  anomalies: AnomalyType[];
  stockAfter: number | null; // 成交后该书库存
}

export interface SlotInterval {
  slotId: string;
  bookId: string | null;
  start: string;
  end: string | null;
  placementId: string;
  disputed: boolean; // 该区间起点存在并列占位冲突
}

export interface PeriodCell {
  key: string; // slotId|period
  slotId: string;
  period: string;
  revenue: number;
  qty: number;
}

export interface Result {
  bookStats: Record<string, BookStat>;
  saleRows: SaleRow[];
  slotTimeline: Record<string, SlotInterval[]>;
  periodCells: Record<string, PeriodCell>;
  anomalies: Anomaly[];
  hasPendingAmbiguity: boolean;
}
