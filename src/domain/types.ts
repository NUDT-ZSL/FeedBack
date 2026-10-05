// 领域模型：书籍、销售流水、换位记录、争议裁决均为可持久化的原始数据。
// 陈列归属、库存、售罄时点、汇总等全部由 engine.ts 从原始数据推导，不直接存储。

export const CATEGORIES = ['经', '史', '子', '集'] as const;
export const CHANNELS = ['门市', '书摊', '批发', '邮购'] as const;
export const SLOTS = [
  '甲一', '甲二', '甲三',
  '乙一', '乙二', '乙三',
  '丙一', '丙二', '丙三',
] as const;

export interface Book {
  id: string;
  title: string; // 书名
  edition: string; // 版式，如 刻本 / 抄本 / 活字本
  category: string; // 类别：经史子集
  costPrice: number; // 进价（文）
  listPrice: number; // 当前标价（文）；历史成交价以销售流水为准
  initialStock: number; // 期初库存
  slot: string; // 初始陈列位（自营业起始即占该位）
}

export interface Sale {
  id: string;
  time: string; // 时刻 ISO，如 2026-10-01T10:00
  bookId: string;
  quantity: number; // 售出为正，退货为负
  price: number; // 成交单价（文）
  channel: string; // 渠道
}

export interface SlotMove {
  id: string;
  bookId: string;
  slot: string; // 换位后陈列位
  effectiveAt: string; // 生效时刻 ISO
}

// 对陈列位归属争议的人工裁决：判定某位置在 [start, end) 归属某本书
export interface Adjudication {
  id: string;
  slot: string;
  start: string; // ISO
  end: string; // ISO
  bookId: string; // 裁决归属的书
  note?: string;
}

export interface ShopData {
  books: Book[];
  sales: Sale[];
  moves: SlotMove[];
  adjudications: Adjudication[];
}
