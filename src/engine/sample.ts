import type { Dataset } from "./types";

/**
 * 样例数据：开宝三年（0960 年）三月十五，临安书坊一日经营。
 * 覆盖边界：成交价≠当前售价、超卖、无货退货、换位与销售同时刻归属歧义、同位同时段冲突。
 */
export const sampleDataset: Dataset = {
  slots: [
    { id: "slot-jia1", name: "甲字一号" },
    { id: "slot-jia2", name: "甲字二号" },
    { id: "slot-jia3", name: "甲字三号" },
  ],
  books: [
    { id: "book-lunyu", title: "论语注疏", format: "浙刻本", category: "经", costPrice: 500, listPrice: 800, initialStock: 8 },
    { id: "book-shiji", title: "史记集解", format: "蜀刻本", category: "史", costPrice: 1000, listPrice: 1500, initialStock: 3 },
    { id: "book-dongpo", title: "东坡集", format: "活字本", category: "集", costPrice: 700, listPrice: 1200, initialStock: 5 },
    { id: "book-qimin", title: "齐民要术", format: "巾箱本", category: "子", costPrice: 400, listPrice: 700, initialStock: 4 },
  ],
  placements: [
    { id: "pl-init-lunyu", bookId: "book-lunyu", slotId: "slot-jia1", effectiveAt: "0960-03-15T08:00" },
    { id: "pl-init-qimin", bookId: "book-qimin", slotId: "slot-jia1", effectiveAt: "0960-03-15T08:00" },
    { id: "pl-init-shiji", bookId: "book-shiji", slotId: "slot-jia2", effectiveAt: "0960-03-15T08:00" },
    { id: "pl-init-dongpo", bookId: "book-dongpo", slotId: "slot-jia3", effectiveAt: "0960-03-15T08:00" },
    { id: "pl-move-dongpo", bookId: "book-dongpo", slotId: "slot-jia1", effectiveAt: "0960-03-15T10:00" },
    { id: "pl-move-qimin", bookId: "book-qimin", slotId: "slot-jia3", effectiveAt: "0960-03-15T12:00" },
  ],
  sales: [
    { id: "sale-1", at: "0960-03-15T08:30", bookId: "book-lunyu", qty: 2, price: 800, channel: "店内零售" },
    { id: "sale-2", at: "0960-03-15T09:00", bookId: "book-shiji", qty: 2, price: 1500, channel: "批发" },
    { id: "sale-3", at: "0960-03-15T10:00", bookId: "book-dongpo", qty: 1, price: 1200, channel: "预订" },
    { id: "sale-4", at: "0960-03-15T11:00", bookId: "book-shiji", qty: 2, price: 1500, channel: "店内零售" },
    { id: "sale-5", at: "0960-03-15T12:00", bookId: "book-qimin", qty: 1, price: 700, channel: "店内零售" },
    { id: "sale-6", at: "0960-03-15T13:00", bookId: "book-lunyu", qty: -1, price: 800, channel: "店内零售" },
    { id: "sale-7", at: "0960-03-15T14:00", bookId: "book-lunyu", qty: -8, price: 800, channel: "批发" },
    { id: "sale-8", at: "0960-03-15T15:00", bookId: "book-dongpo", qty: 1, price: 1100, channel: "店内零售" },
    { id: "sale-9", at: "0960-03-15T15:30", bookId: "book-dongpo", qty: 2, price: 1200, channel: "预订" },
  ],
  resolutions: {},
};

export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
