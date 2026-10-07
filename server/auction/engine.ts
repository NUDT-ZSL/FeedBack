/**
 * 竞拍推演引擎（纯函数，无 IO）
 *
 * 同一份「藏品 + 全部出价 + 截止时间 + 当前时刻」输入，无论从哪个入口
 * （列表、详情、出价接口、局部/全量重推）推演，得到的竞拍状态、当前
 * 最高价、获胜者与结束时间必须完全一致，因此所有入口都只允许调用
 * 本模块的函数，不得自行拼装结论。
 *
 * 规则（沿用现有约定）：
 * - 每次有效出价把截止时间重置为「出价时刻 + 30 秒」。
 * - 出价必须严格高于当前最高价；无出价时当前最高价为藏品底价。
 * - 当前时刻早于截止时间即活跃；否则结束，结束后最高价出价者获胜。
 * - 出价按 (timestamp 升序, id 升序) 构成确定的先后次序，同刻出价不
 *   依赖写入顺序；金额相同时先到者获胜。
 */

import type { BidRecord } from '../../shared/types.js';

export const BID_EXTENSION_MS = 30 * 1000;

export interface AuctionInput {
  itemId: string;
  basePrice: number;
  endTime: string | null;
  bids: BidRecord[];
}

export type BidRejectReason = 'missing' | 'ended' | 'too-low';

export interface BidValidation {
  ok: boolean;
  reason?: BidRejectReason;
  currentHighest: number;
}

export interface DerivedAuction {
  itemId: string;
  endTime: string | null;
  /** now < endTime 的纯推演结果 */
  isActive: boolean;
  /** 已结束且有出价时为最高价出价者，否则为 null */
  winnerId: string | null;
  highestBid: BidRecord | null;
  /** 当前最高价：无出价时回落到藏品底价 */
  currentHighest: number;
  /** 与接口展示一致：时间倒序，同刻按 id 倒序 */
  bids: BidRecord[];
}

/** 规范化的时间戳（ISO 字符串按字典序即可与时间顺序一致） */
function bidTime(bid: BidRecord): number {
  return new Date(bid.timestamp).getTime();
}

/**
 * 唯一定义的出价先后次序：时间升序，同一时刻按 id 升序。
 * 与数据库写入顺序无关，保证并发/同刻出价结论确定。
 */
export function canonicalOrder(bids: BidRecord[]): BidRecord[] {
  return [...bids].sort((a, b) => {
    const timeDiff = bidTime(a) - bidTime(b);
    if (timeDiff !== 0) return timeDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 接口展示顺序：与 canonicalOrder 恰好相反的确定顺序 */
export function displayOrder(bids: BidRecord[]): BidRecord[] {
  return canonicalOrder(bids).reverse();
}

/** 最高出价：金额最大者，平手时按规范化先后次序先到者得 */
export function selectWinningBid(bids: BidRecord[]): BidRecord | null {
  if (bids.length === 0) return null;
  return canonicalOrder(bids).reduce((best, bid) => {
    if (best === null || bid.amount > best.amount) return bid;
    return best;
  }, null as BidRecord | null);
}

/** 有效出价后的新截止时间：出价时刻 + 30 秒 */
export function extendEndTime(bidTimeMs: number): string {
  return new Date(bidTimeMs + BID_EXTENSION_MS).toISOString();
}

/**
 * 竞拍推演链路的唯一入口：由可信输入一次性推出
 * 活跃状态 / 最高价 / 获胜者 / 展示用出价集合。
 */
export function deriveAuction(input: AuctionInput, nowMs: number): DerivedAuction {
  const ordered = canonicalOrder(input.bids);
  const highestBid = selectWinningBid(ordered);
  const currentHighest = highestBid ? highestBid.amount : input.basePrice;
  const endTimeMs = input.endTime ? new Date(input.endTime).getTime() : null;
  const isActive = endTimeMs !== null && nowMs < endTimeMs;

  return {
    itemId: input.itemId,
    endTime: input.endTime,
    isActive,
    winnerId: !isActive && highestBid ? highestBid.userId : null,
    highestBid,
    currentHighest,
    bids: ordered.reverse()
  };
}

/**
 * 出价校验：与最高价推导共用同一份推演结果。
 * amount 必须为有效数值，否则按缺少参数处理，由路由层先行拦截。
 */
export function validateBid(
  auction: DerivedAuction,
  amount: number
): BidValidation {
  if (!auction.isActive) {
    return { ok: false, reason: 'ended', currentHighest: auction.currentHighest };
  }
  if (!Number.isFinite(amount) || amount <= auction.currentHighest) {
    return { ok: false, reason: 'too-low', currentHighest: auction.currentHighest };
  }
  return { ok: true, currentHighest: auction.currentHighest };
}
