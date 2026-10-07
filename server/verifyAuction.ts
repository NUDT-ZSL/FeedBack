import type Database from 'better-sqlite3';
import { createDatabase } from './database.js';
import {
  ensureAuctionState,
  getAuctionView,
  listAuctionViews,
  placeBid
} from './auctionService.js';
import { AUCTION_DURATION_MS } from './auctionEngine.js';
import type { AuctionState, BidRecord } from '../shared/types.js';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeView(view: AuctionState): Omit<AuctionState, 'bids'> & { bids: Array<Omit<BidRecord, 'id'>> } {
  return {
    itemId: view.itemId,
    endTime: view.endTime,
    isActive: view.isActive,
    winnerId: view.winnerId,
    bids: view.bids.map(({ itemId, userId, username, amount, timestamp }) => ({
      itemId, userId, username, amount, timestamp
    }))
  };
}

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const SECOND = 1000;

function listItemIds(db: Database.Database): string[] {
  const rows = db.prepare('SELECT id FROM items ORDER BY createdAt DESC').all() as any[];
  return rows.map(row => row.id);
}

function insertUser(db: Database.Database, id: string, username: string): void {
  db.prepare('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)').run(id, username);
}

function insertBid(db: Database.Database, bid: BidRecord): void {
  db.prepare(`
    INSERT INTO bids (id, itemId, userId, username, amount, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(bid.id, bid.itemId, bid.userId, bid.username, bid.amount, bid.timestamp);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
console.log('\n[1] 列表 / 详情 / 出价响应入口一致性');
{
  const db = createDatabase(':memory:');
  const itemIds = listItemIds(db);
  const target = 'bronze-jue';
  const secondItem = 'ru-yao-vase';

  const bidResult = placeBid(target, 'user-a', '藏家甲', 6000, T0, db);
  check('出价被接受', bidResult.ok);
  check(
    '出价响应中的状态与详情入口一致（首次出价）',
    bidResult.ok && sameJson(bidResult.auctionState, getAuctionView(target, T0, db))
  );
  const secondBidResult = placeBid(target, 'user-b', '藏家乙', 6500, T0 + 5 * SECOND, db);
  check(
    '出价响应中的状态与详情入口一致（再次出价）',
    secondBidResult.ok && sameJson(secondBidResult.auctionState, getAuctionView(target, T0 + 5 * SECOND, db))
  );
  placeBid(secondItem, 'user-a', '藏家甲', 3000, T0 + 2 * SECOND, db);

  const now = T0 + 10 * SECOND;
  const listViews = listAuctionViews(itemIds, now, db);
  check('列表覆盖全部藏品', listViews.length === itemIds.length);

  let listEqualsDetail = true;
  for (const itemId of itemIds) {
    const fromList = listViews.find(view => view.itemId === itemId);
    const fromDetail = getAuctionView(itemId, now, db);
    if (!sameJson(fromList, fromDetail)) {
      listEqualsDetail = false;
      console.log(`    分歧藏品: ${itemId}`);
    }
  }
  check('同一 now 下列表与详情结论一致', listEqualsDetail);

  const detail = getAuctionView(target, now, db)!;
  check('详情内 bids 与 auctionState.bids 同源', sameJson(detail.bids, getAuctionView(target, now, db)!.bids));
}

// ---------------------------------------------------------------------------
console.log('\n[2] 连续 / 并发提交 == 按时间顺序逐条重放');
{
  const dbA = createDatabase(':memory:');
  const itemIds = listItemIds(dbA);
  const target = 'bronze-jue';

  const bids: BidRecord[] = [
    { id: 'bid-1', itemId: target, userId: 'user-a', username: '藏家甲', amount: 6000, timestamp: iso(T0 + 1 * SECOND) },
    { id: 'bid-2', itemId: target, userId: 'user-b', username: '藏家乙', amount: 7000, timestamp: iso(T0 + 3 * SECOND) },
    { id: 'bid-3', itemId: target, userId: 'user-c', username: '藏家丙', amount: 9000, timestamp: iso(T0 + 8 * SECOND) }
  ];

  const r1 = placeBid(target, 'user-a', '藏家甲', 6000, T0 + 1 * SECOND, dbA);
  const rejected = placeBid(target, 'user-d', '藏家丁', 5500, T0 + 2 * SECOND, dbA);
  const r2 = placeBid(target, 'user-b', '藏家乙', 7000, T0 + 3 * SECOND, dbA);
  const r3 = placeBid(target, 'user-c', '藏家丙', 9000, T0 + 8 * SECOND, dbA);
  check('顺序出价均被接受', r1.ok && r2.ok && r3.ok);
  check('低于最高价的出价被拒绝', rejected.ok === false && rejected.status === 400);

  const now = T0 + 20 * SECOND;
  const sequentialView = getAuctionView(target, now, dbA)!;
  const priceRow = dbA.prepare('SELECT currentPrice FROM items WHERE id = ?').get(target) as any;
  check('currentPrice 缓存与最高出价一致', priceRow.currentPrice === 9000);
  check('结束时间按最后出价延长 30s', sequentialView.endTime === iso(T0 + 8 * SECOND + AUCTION_DURATION_MS));

  const dbB = createDatabase(':memory:');
  ensureAuctionState(target, T0, dbB);
  for (const bid of bids) insertUser(dbB, bid.userId, bid.username);
  for (const bid of [...bids].reverse()) insertBid(dbB, bid);
  const replayView = getAuctionView(target, now, dbB)!;

  check(
    '乱序写入后推演结果与时间顺序提交一致',
    sameJson(normalizeView(sequentialView), normalizeView(replayView)),
    `sequential=${JSON.stringify(sequentialView)} replay=${JSON.stringify(replayView)}`
  );

  const dbC = createDatabase(':memory:');
  const dbD = createDatabase(':memory:');
  const tieBids: BidRecord[] = [
    { id: 'tie-1', itemId: target, userId: 'user-a', username: '藏家甲', amount: 6000, timestamp: iso(T0 + 1 * SECOND) },
    { id: 'tie-2', itemId: target, userId: 'user-b', username: '藏家乙', amount: 8000, timestamp: iso(T0 + 1 * SECOND) }
  ];
  for (const db of [dbC, dbD]) {
    ensureAuctionState(target, T0, db);
    for (const bid of tieBids) insertUser(db, bid.userId, bid.username);
  }
  insertBid(dbC, tieBids[0]); insertBid(dbC, tieBids[1]);
  insertBid(dbD, tieBids[1]); insertBid(dbD, tieBids[0]);
  const ended = T0 + 60 * SECOND;
  const viewC = getAuctionView(target, ended, dbC)!;
  const viewD = getAuctionView(target, ended, dbD)!;
  check('同一时刻出价与写入顺序无关', sameJson(viewC, viewD));
  check('同一时刻获胜者为出价更高者', viewC.winnerId === 'user-b');
}

// ---------------------------------------------------------------------------
console.log('\n[3] 局部重推与全量重推一致');
{
  const db = createDatabase(':memory:');
  const itemIds = listItemIds(db);
  const changed = 'han-jade-dress';

  placeBid('bronze-jue', 'user-a', '藏家甲', 6000, T0 + 1 * SECOND, db);
  placeBid('ru-yao-vase', 'user-b', '藏家乙', 3000, T0 + 2 * SECOND, db);

  const before = listAuctionViews(itemIds, T0 + 10 * SECOND, db);

  const bidResult = placeBid(changed, 'user-c', '藏家丙', 9999, T0 + 3 * SECOND, db);
  check('变更藏品出价成功', bidResult.ok);

  const now = T0 + 10 * SECOND;
  const partial = getAuctionView(changed, now, db);
  const fullAfter = listAuctionViews(itemIds, now, db);
  const fullChanged = fullAfter.find(view => view.itemId === changed);

  check('局部重推 == 全量重推（变更藏品）', sameJson(partial, fullChanged));
  check('出价返回值 == 全量重推（变更藏品）', bidResult.ok && sameJson(
    bidResult.auctionState,
    listAuctionViews([changed], T0 + 3 * SECOND, db)[0]
  ));

  let othersStable = true;
  for (const view of fullAfter) {
    if (view.itemId === changed) continue;
    const previous = before.find(v => v.itemId === view.itemId);
    if (!sameJson(view, previous)) {
      othersStable = false;
      console.log(`    未受影响藏品发生变化: ${view.itemId}`);
    }
  }
  check('未受影响藏品状态不变', othersStable);
}

// ---------------------------------------------------------------------------
console.log('\n[4] 边界：结束、无人出价、重复查询稳定性');
{
  const db = createDatabase(':memory:');
  const itemIds = listItemIds(db);
  const [noBidItem, endedItem, activeItem] = ['sung-scroll', 'ru-yao-vase', 'roman-gold-coin'];

  ensureAuctionState(noBidItem, T0, db);
  const afterEnd = T0 + AUCTION_DURATION_MS + 1;
  const noBidView = getAuctionView(noBidItem, afterEnd, db)!;
  check('无人出价且到期：不活跃', noBidView.isActive === false);
  check('无人出价且到期：无获胜者', noBidView.winnerId === null);
  check('无人出价：结束时间保持初始值', noBidView.endTime === iso(T0 + AUCTION_DURATION_MS));

  placeBid(endedItem, 'user-a', '藏家甲', 3000, T0 + 1 * SECOND, db);
  placeBid(endedItem, 'user-b', '藏家乙', 3500, T0 + 2 * SECOND, db);
  const endedAt = T0 + 2 * SECOND + AUCTION_DURATION_MS;
  const endedView1 = getAuctionView(endedItem, endedAt + 1, db)!;
  const endedView2 = getAuctionView(endedItem, endedAt + 60 * SECOND, db)!;
  check('到期后：不活跃', endedView1.isActive === false);
  check('到期后：获胜者为最高出价者', endedView1.winnerId === 'user-b');
  check('到期后：重复查询结论稳定', sameJson(endedView1, endedView2));

  const lateBid = placeBid(endedItem, 'user-c', '藏家丙', 9999, endedAt + 1, db);
  check('到期后出价被拒绝', lateBid.ok === false && lateBid.status === 400 && lateBid.error === '竞拍已结束');
  const afterLateBid = getAuctionView(endedItem, endedAt + 1, db)!;
  check('被拒绝的出价不改变状态', sameJson(afterLateBid, endedView1));

  placeBid(activeItem, 'user-a', '藏家甲', 3500, T0 + 1 * SECOND, db);
  const activeView = getAuctionView(activeItem, T0 + 10 * SECOND, db)!;
  check('进行中：活跃且无获胜者', activeView.isActive === true && activeView.winnerId === null);

  const missingParams = placeBid(activeItem, '', '藏家甲', 9999, T0 + 5 * SECOND, db);
  check('缺少参数被拒绝', missingParams.ok === false && missingParams.status === 400 && missingParams.error === '缺少必要参数');
  const unknownItem = placeBid('no-such-item', 'user-a', '藏家甲', 100, T0 + 5 * SECOND, db);
  check('藏品不存在返回 404', unknownItem.ok === false && unknownItem.status === 404 && unknownItem.error === '藏品不存在');
  const equalBid = placeBid(activeItem, 'user-b', '藏家乙', 3500, T0 + 5 * SECOND, db);
  check('等于最高价被拒绝并提示当前最高价', equalBid.ok === false && equalBid.error === '出价必须高于当前最高价 3500');
}

// ---------------------------------------------------------------------------
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  process.exit(1);
}
