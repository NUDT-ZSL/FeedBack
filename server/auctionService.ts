import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import { getDb } from './database.js';
import {
  AUCTION_DURATION_MS,
  deriveAuction,
  toAuctionState,
  validateBidAmount,
  type AuctionDerivation
} from './auctionEngine.js';
import type { AuctionState, BidRecord } from '../shared/types.js';

export function getBidsForItem(itemId: string, db: Database.Database = getDb()): BidRecord[] {
  const bids = db.prepare(`
    SELECT * FROM bids WHERE itemId = ? ORDER BY timestamp DESC
  `).all(itemId) as unknown as BidRecord[];
  return bids;
}

export function ensureAuctionState(
  itemId: string,
  now: number = Date.now(),
  db: Database.Database = getDb()
): void {
  const endTime = new Date(now + AUCTION_DURATION_MS).toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO auction_states (itemId, endTime, isActive, winnerId)
    VALUES (?, ?, 1, NULL)
  `).run(itemId, endTime);
}

export function deriveItemAuction(
  itemId: string,
  now: number = Date.now(),
  db: Database.Database = getDb()
): AuctionDerivation | null {
  const item = db.prepare('SELECT id, basePrice FROM items WHERE id = ?').get(itemId) as any;
  if (!item) {
    return null;
  }

  ensureAuctionState(itemId, now, db);

  const stored = db.prepare(`
    SELECT endTime, isActive FROM auction_states WHERE itemId = ?
  `).get(itemId) as any;

  return deriveAuction({
    itemId,
    basePrice: item.basePrice,
    bids: getBidsForItem(itemId, db),
    storedEndTime: stored?.endTime ?? null,
    storedIsActive: stored ? stored.isActive === 1 : false,
    now
  });
}

export function getAuctionView(
  itemId: string,
  now: number = Date.now(),
  db: Database.Database = getDb()
): AuctionState | null {
  const derivation = deriveItemAuction(itemId, now, db);
  return derivation ? toAuctionState(derivation) : null;
}

export function listAuctionViews(
  itemIds: string[],
  now: number = Date.now(),
  db: Database.Database = getDb()
): AuctionState[] {
  const views: AuctionState[] = [];
  for (const itemId of itemIds) {
    const view = getAuctionView(itemId, now, db);
    if (view) {
      views.push(view);
    }
  }
  return views;
}

export type PlaceBidResult =
  | { ok: true; newBid: BidRecord; auctionState: AuctionState }
  | { ok: false; status: number; error: string; auctionState: AuctionState | null };

export function placeBid(
  itemId: string,
  userId: string,
  username: string,
  amount: number,
  now: number = Date.now(),
  db: Database.Database = getDb()
): PlaceBidResult {
  if (!userId || !username || !amount) {
    return { ok: false, status: 400, error: '缺少必要参数', auctionState: null };
  }

  const executeBid = db.transaction((): PlaceBidResult => {
    const derivation = deriveItemAuction(itemId, now, db);

    if (!derivation) {
      return { ok: false, status: 404, error: '藏品不存在', auctionState: null };
    }

    if (!derivation.isActive) {
      return {
        ok: false,
        status: 400,
        error: '竞拍已结束',
        auctionState: toAuctionState(derivation)
      };
    }

    const validation = validateBidAmount(derivation, amount);
    if (!validation.accepted) {
      return {
        ok: false,
        status: 400,
        error: `出价必须高于当前最高价 ${validation.currentHighest}`,
        auctionState: toAuctionState(derivation)
      };
    }

    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as any;
    if (!userExists) {
      db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(userId, username);
    }

    const newBid: BidRecord = {
      id: uuidv4(),
      itemId,
      userId,
      username,
      amount,
      timestamp: new Date(now).toISOString()
    };

    db.prepare(`
      INSERT INTO bids (id, itemId, userId, username, amount, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newBid.id, itemId, userId, username, amount, newBid.timestamp);

    db.prepare('UPDATE items SET currentPrice = MAX(currentPrice, ?) WHERE id = ?').run(amount, itemId);

    const newEndTime = new Date(now + AUCTION_DURATION_MS).toISOString();
    db.prepare('UPDATE auction_states SET endTime = MAX(endTime, ?) WHERE itemId = ?').run(newEndTime, itemId);

    const updated = deriveItemAuction(itemId, now, db)!;
    return { ok: true, newBid, auctionState: toAuctionState(updated) };
  });

  return executeBid();
}
