// 样例数据：覆盖核心边界场景，便于核对推演结果自洽性。
// 场景设定：2026-10-01 临安府书坊一日经营。
//
// 覆盖的边界：
//  - 《东京梦华录》同日三个成交价（500/450/520），营收按成交价计
//  - 《漱玉词》库存 3，11:00 售罄，11:30 再卖 1 本 → 超卖异常
//  - 《花间集》12:00 退 2 本 → 正常退货；《梦溪笔谈》13:30 退 9 本 → 退货超量异常
//  - 甲二位：《梦溪笔谈》11:00 才迁往乙二，而《周易正义》10:00 即迁入甲二，
//    10:00–11:00 归属不清 → 保留双方待裁决；裁决后只重算这两书的归因

import type { ShopData } from './types';

export const SAMPLE_DATA: ShopData = {
  books: [
    { id: 'b1', title: '东京梦华录', edition: '刻本', category: '史', costPrice: 300, listPrice: 500, initialStock: 20, slot: '甲一' },
    { id: 'b2', title: '梦溪笔谈', edition: '刻本', category: '子', costPrice: 400, listPrice: 680, initialStock: 8, slot: '甲二' },
    { id: 'b3', title: '资治通鉴节本', edition: '刻本', category: '史', costPrice: 900, listPrice: 1500, initialStock: 5, slot: '甲三' },
    { id: 'b4', title: '花间集', edition: '抄本', category: '集', costPrice: 150, listPrice: 260, initialStock: 30, slot: '乙一' },
    { id: 'b5', title: '周易正义', edition: '刻本', category: '经', costPrice: 500, listPrice: 880, initialStock: 10, slot: '乙二' },
    { id: 'b6', title: '漱玉词', edition: '活字本', category: '集', costPrice: 200, listPrice: 360, initialStock: 3, slot: '乙三' },
  ],
  sales: [
    { id: 's01', time: '2026-10-01T09:00', bookId: 'b1', quantity: 2, price: 500, channel: '门市' },
    { id: 's02', time: '2026-10-01T09:30', bookId: 'b4', quantity: 5, price: 260, channel: '书摊' },
    { id: 's03', time: '2026-10-01T10:00', bookId: 'b2', quantity: 3, price: 680, channel: '门市' },
    { id: 's04', time: '2026-10-01T10:30', bookId: 'b5', quantity: 1, price: 880, channel: '门市' },
    { id: 's05', time: '2026-10-01T10:30', bookId: 'b1', quantity: 2, price: 450, channel: '门市' },
    { id: 's06', time: '2026-10-01T11:00', bookId: 'b6', quantity: 3, price: 360, channel: '门市' },
    { id: 's07', time: '2026-10-01T11:30', bookId: 'b6', quantity: 1, price: 360, channel: '门市' },
    { id: 's08', time: '2026-10-01T12:00', bookId: 'b4', quantity: -2, price: 260, channel: '书摊' },
    { id: 's09', time: '2026-10-01T12:30', bookId: 'b5', quantity: 1, price: 880, channel: '批发' },
    { id: 's10', time: '2026-10-01T13:00', bookId: 'b3', quantity: 2, price: 1500, channel: '门市' },
    { id: 's11', time: '2026-10-01T13:30', bookId: 'b2', quantity: -9, price: 680, channel: '门市' },
    { id: 's12', time: '2026-10-01T14:00', bookId: 'b1', quantity: 1, price: 520, channel: '邮购' },
    { id: 's13', time: '2026-10-01T14:30', bookId: 'b5', quantity: 2, price: 800, channel: '门市' },
  ],
  moves: [
    { id: 'm1', bookId: 'b5', slot: '甲二', effectiveAt: '2026-10-01T10:00' },
    { id: 'm2', bookId: 'b2', slot: '乙二', effectiveAt: '2026-10-01T11:00' },
    { id: 'm3', bookId: 'b1', slot: '丙一', effectiveAt: '2026-10-01T15:00' },
    { id: 'm4', bookId: 'b4', slot: '甲一', effectiveAt: '2026-10-01T15:00' },
  ],
  adjudications: [],
};
