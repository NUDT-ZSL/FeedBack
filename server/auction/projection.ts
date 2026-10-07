/**
 * 竞拍状态投影层（数据库读写）
 *
 * 职责：
 * - 从 bids / items / auction_states 三张表组装可信输入，交给
 *   engine.deriveAuction 推演，任何入口不得绕过。
 * - 状态变更（出价、重推）只重推受影响藏品，把推演结论写回
 *   auction_states 与 items.currentPrice 投影列；recomputeAll 提供
 *   全量重推，二者结果必须一致（由 verify.ts 离线验证）。
 * - placeBid 在单事务内完成「校验 → 写出价 → 延长截止时间 → 重推」，
 *   better-sqlite3 为同步驱动，事务串行执行，因此并发/连续出价等价于
 *   按到达顺序逐条提交。
 */

import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { BidRecord } from '../../shared/types.js';
import {
  deriveAuction,
  displayOrder,
  extendEndTime,
  validateBid,
  type DerivedAuction
} from './engine.js';

export interface ItemRow {
  id: string;
  basePrice: number;
}

export interface AuctionStateRow {
  itemId: string;
  endTime: string | null;
  isActive: number;
  winnerId: string | null;
}

export interface PlaceBidInput {
  userId: string;
  username: string;
  amount: number;
}

export type PlaceBidResult =
  | { ok: true; newBid: BidRecord; auction: DerivedAuction }
  | { ok: false; reason: 'ended' | 'too-low'; currentHighest: number; auction: DerivedAuction };

export function getBidsForItem(db: Database.Database, itemId: string): BidRecord[] {
  const rows = db
    .prepare('SELECT * FROM bids WHERE itemId = ? ORDER BY timestamp DESC, id DESC')
    .all(itemId) as BidRecord[];
  // 展示顺序由引擎唯一定义，不依赖 SQL 排序细节
  return displayOrder(rows);
}

export function getItemRow(db: Database.Database, itemId: string): ItemRow | null {
  const row = db
    .prepare('SELECT id, basePrice FROM items WHERE id = ?')
    .get(itemId) as ItemRow | undefined;
  return row ?? null;
}

function getStateRow(db: Database.Database, itemId: string): AuctionStateRow | null {
  const row = db
    .prepare('SELECT * FROM auction_states WHERE itemId = ?')
    .get(itemId) as AuctionStateRow | undefined;
  return row ?? null;
}

/** 确保 auction_states 有记录；新建时截止时间为 now + 30 秒（沿用现有约定） */
export function ensureAuctionState(
  db: Database.Database,
  itemId: string,
  nowMs: number
): AuctionStateRow {
  const existing = getStateRow(db, itemId);
  if (existing) return existing;
  const endTime = extendEndTime(nowMs);
  db.prepare(
    'INSERT INTO auction_states (itemId, endTime, isActive, winnerId) VALUES (?, ?, 1, NULL)'
  ).run(itemId, endTime);
  return getStateRow(db, itemId)!;
}

/**
 * 读取某藏品的可信竞拍状态（纯推演，不写库）。
 * 列表、详情、出价响应都从这里取结论，保证入口间一致。
 */
export function readAuction(
  db: Database.Database,
  itemId: string,
  nowMs: number,
  options: { ensure?: boolean } = {}
): DerivedAuction | null {
  const item = getItemRow(db, itemId);
  if (!item) return null;
  const state = options.ensure
    ? ensureAuctionState(db, itemId, nowMs)
    : getStateRow(db, itemId);
  return deriveAuction(
    {
      itemId,
      basePrice: item.basePrice,
      endTime: state ? state.endTime : null,
      bids: getBidsForItem(db, itemId)
    },
    nowMs
  );
}

/**
 * 局部重推：只重算受影响藏品的投影列
 * （auction_states.isActive / winnerId 与 items.currentPrice）。
 */
export function recomputeItem(
  db: Database.Database,
  itemId: string,
  nowMs: number
): DerivedAuction | null {
  const auction = readAuction(db, itemId, nowMs, { ensure: true });
  if (!auction) return null;
  db.prepare('UPDATE auction_states SET isActive = ?, winnerId = ? WHERE itemId = ?').run(
    auction.isActive ? 1 : 0,
    auction.winnerId,
    itemId
  );
  db.prepare('UPDATE items SET currentPrice = ? WHERE id = ?').run(
    auction.currentHighest,
    itemId
  );
  return auction;
}

/** 全量重推：对每件藏品做与 recomputeItem 完全相同的推演 */
export function recomputeAll(db: Database.Database, nowMs: number): DerivedAuction[] {
  const items = db.prepare('SELECT id FROM items').all() as { id: string }[];
  return items.map((item) => recomputeItem(db, item.id, nowMs)!);
}

/**
 * 提交出价：校验、写出价、延长截止时间与重推在同一事务内完成，
 * 写入的出价必然反映到返回的竞拍状态中。
 */
export function placeBid(
  db: Database.Database,
  itemId: string,
  input: PlaceBidInput,
  nowMs: number
): PlaceBidResult {
  const tx = db.transaction((): PlaceBidResult => {
    const auction = readAuction(db, itemId, nowMs, { ensure: true });
    if (!auction) {
      throw new Error('藏品不存在');
    }

    const validation = validateBid(auction, input.amount);
    if (!validation.ok) {
      return {
        ok: false,
        reason: validation.reason as 'ended' | 'too-low',
        currentHighest: validation.currentHighest,
        auction
      };
    }

    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(input.userId);
    if (!userExists) {
      db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(
        input.userId,
        input.username
      );
    }

    const newBid: BidRecord = {
      id: uuidv4(),
      itemId,
      userId: input.userId,
      username: input.username,
      amount: input.amount,
      timestamp: new Date(nowMs).toISOString()
    };

    db.prepare(
      'INSERT INTO bids (id, itemId, userId, username, amount, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(newBid.id, itemId, input.userId, input.username, input.amount, newBid.timestamp);

    // 结束时间延长与出价写入同事务：截止时间 = 出价时刻 + 30 秒
    db.prepare('UPDATE auction_states SET endTime = ? WHERE itemId = ?').run(
      extendEndTime(nowMs),
      itemId
    );

    // 只重推当前藏品；重推基于刚写入的出价，结论与写库结果一致
    const updated = recomputeItem(db, itemId, nowMs)!;
    return { ok: true, newBid, auction: updated };
  });

  return tx();
}
