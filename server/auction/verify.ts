/**
 * 竞拍推演链路离线验证入口
 *
 *   npm run verify:auction
 *
 * 使用内存 SQLite（createDatabase(':memory:')），不触碰 auction.db，
 * 可离线运行。覆盖：
 *   1. 同一输入在列表 / 详情 / 出价响应等入口推演结论一致；
 *   2. 连续（含并发提交）出价后的最终状态 = 按时间顺序逐条重放；
 *   3. 同一时刻出价的结果与写入顺序无关；
 *   4. 局部重推（只重推受影响藏品）与全量重推结果一致；
 *   5. 竞拍结束 / 无人出价等边界结论明确且重复查询稳定。
 */

import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { createDatabase } from '../database.js';
import {
  deriveAuction,
  displayOrder,
  type DerivedAuction
} from './engine.js';
import {
  getBidsForItem,
  placeBid,
  readAuction,
  recomputeAll,
  recomputeItem
} from './projection.js';
import type { BidRecord } from '../../shared/types.js';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const SECOND = 1000;

let passed = 0;
function scenario(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function freshDb(): Database.Database {
  return createDatabase(':memory:');
}

function snapshotProjections(db: Database.Database): unknown {
  return {
    states: db
      .prepare('SELECT itemId, endTime, isActive, winnerId FROM auction_states ORDER BY itemId')
      .all(),
    prices: db.prepare('SELECT id, currentPrice FROM items ORDER BY id').all()
  };
}

function viewOf(auction: DerivedAuction | null): unknown {
  if (!auction) return null;
  return {
    itemId: auction.itemId,
    endTime: auction.endTime,
    isActive: auction.isActive,
    winnerId: auction.winnerId,
    currentHighest: auction.currentHighest,
    bids: auction.bids.map(b => b.id)
  };
}

console.log('竞拍推演链路离线验证\n');

// ---------------------------------------------------------------------------
// 1. 入口一致性：同一输入在任意入口得到相同结论
// ---------------------------------------------------------------------------
await scenario('同一藏品在列表 / 详情 / 出价响应入口的状态、最高价、结束时间一致', () => {
  const db = freshDb();
  const itemId = 'bronze-jue';

  // 通过出价入口制造状态
  const r1 = placeBid(db, itemId, { userId: 'u1', username: '甲', amount: 6000 }, T0);
  const r2 = placeBid(db, itemId, { userId: 'u2', username: '乙', amount: 7000 }, T0 + 5 * SECOND);
  assert.ok(r1.ok && r2.ok);

  const now = T0 + 10 * SECOND;
  // 列表入口与详情入口读取
  const fromList = readAuction(db, itemId, now, { ensure: true });
  const fromDetail = readAuction(db, itemId, now, { ensure: true });
  // 出价响应中返回的状态（r2 时刻）与同时刻重新读取一致
  const atBidTime = readAuction(db, itemId, T0 + 5 * SECOND);

  assert.deepEqual(viewOf(fromList), viewOf(fromDetail));
  assert.deepEqual(viewOf(atBidTime), viewOf(r2.auction));
  // 详情接口的 bids 与状态中的 bids 来自同一推演
  assert.deepEqual(
    getBidsForItem(db, itemId).map(b => b.id),
    fromDetail!.bids.map(b => b.id)
  );
  // 推演是纯函数：同输入重复推演结果相同
  const input = {
    itemId,
    basePrice: 5000,
    endTime: fromList!.endTime,
    bids: getBidsForItem(db, itemId)
  };
  assert.deepEqual(deriveAuction(input, now), deriveAuction(input, now));
  db.close();
});

// ---------------------------------------------------------------------------
// 2. 连续 / 并发出价：最终状态 = 按时间顺序逐条重放
// ---------------------------------------------------------------------------
await scenario('连续出价的最终状态与全量重放一致，后到较低出价不覆盖高价', () => {
  const db = freshDb();
  const itemId = 'ru-yao-vase';

  const accepted: BidRecord[] = [];
  const amounts = [3000, 4000, 3500, 5000, 4500, 8000];
  amounts.forEach((amount, i) => {
    const result = placeBid(
      db,
      itemId,
      { userId: `u${i}`, username: `用户${i}`, amount },
      T0 + i * SECOND
    );
    if (result.ok) accepted.push(result.newBid);
  });

  // 3500、4500 低于当时最高价，必须被拒绝
  assert.equal(accepted.length, 4);
  assert.deepEqual(accepted.map(b => b.amount), [3000, 4000, 5000, 8000]);

  const now = T0 + 10 * SECOND;
  const finalState = readAuction(db, itemId, now)!;

  // 与「按时间顺序逐条重放全部已存出价」的全量推演一致
  const replayed = deriveAuction(
    { itemId, basePrice: 2500, endTime: finalState.endTime, bids: getBidsForItem(db, itemId) },
    now
  );
  assert.deepEqual(viewOf(finalState), viewOf(replayed));
  assert.equal(finalState.currentHighest, 8000);
  assert.equal(finalState.highestBid!.userId, 'u5');

  // 投影列与推演一致（出价时已局部重推）
  const price = db.prepare('SELECT currentPrice FROM items WHERE id = ?').get(itemId) as any;
  assert.equal(price.currentPrice, 8000);
  db.close();
});

await scenario('并发提交同一藏品出价等价于某种串行顺序，且与重放一致', async () => {
  // placeBid 为同步事务，Promise.all 仅模拟并发提交语义
  const db = freshDb();
  const itemId = 'roman-gold-coin';
  const offers = [3100, 3200, 3150, 4000, 3900, 5000];

  await Promise.all(
    offers.map((amount, i) =>
      Promise.resolve().then(() =>
        placeBid(db, itemId, { userId: `c${i}`, username: `并发${i}`, amount }, T0 + i * 100)
      )
    )
  );

  const now = T0 + SECOND;
  const finalState = readAuction(db, itemId, now)!;
  const storedBids = getBidsForItem(db, itemId);

  // 被接受的出价金额严格递增（后到较低出价必然被拒绝）
  const acceptedAmounts = [...storedBids]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map(b => b.amount);
  for (let i = 1; i < acceptedAmounts.length; i += 1) {
    assert.ok(acceptedAmounts[i] > acceptedAmounts[i - 1]);
  }

  // 最终状态 = 已存出价的全量重放；最高价不被任何较低出价覆盖
  const replayed = deriveAuction(
    { itemId, basePrice: 3000, endTime: finalState.endTime, bids: storedBids },
    now
  );
  assert.deepEqual(viewOf(finalState), viewOf(replayed));
  assert.equal(finalState.currentHighest, Math.max(...acceptedAmounts));
  db.close();
});

// ---------------------------------------------------------------------------
// 3. 同一时刻出价：结果与写入顺序无关
// ---------------------------------------------------------------------------
await scenario('同一时刻的出价顺序不影响最高价与获胜者判定', () => {
  const mkBids = (): BidRecord[] => [
    { id: 'bid-a', itemId: 'x', userId: 'u-a', username: 'A', amount: 6000, timestamp: new Date(T0).toISOString() },
    { id: 'bid-b', itemId: 'x', userId: 'u-b', username: 'B', amount: 6000, timestamp: new Date(T0).toISOString() },
    { id: 'bid-c', itemId: 'x', userId: 'u-c', username: 'C', amount: 7000, timestamp: new Date(T0).toISOString() }
  ];

  const endTime = new Date(T0 + 30 * SECOND).toISOString();
  const afterEnd = T0 + 60 * SECOND;

  const orders = [mkBids(), mkBids().reverse(), [mkBids()[1], mkBids()[2], mkBids()[0]]];
  const results = orders.map(bids =>
    deriveAuction({ itemId: 'x', basePrice: 5000, endTime, bids }, afterEnd)
  );

  // 任意写入顺序：获胜者都是出价最高的 u-c
  for (const r of results) {
    assert.equal(r.winnerId, 'u-c');
    assert.equal(r.currentHighest, 7000);
    assert.equal(r.isActive, false);
  }
  // 展示顺序也与写入顺序无关
  assert.deepEqual(
    displayOrder(orders[0]).map(b => b.id),
    displayOrder(orders[1]).map(b => b.id)
  );

  // 同刻同额：按规范化次序（id 升序）先到者得，与插入顺序无关
  const tieA = deriveAuction(
    { itemId: 'x', basePrice: 5000, endTime, bids: [mkBids()[0], mkBids()[1]] },
    afterEnd
  );
  const tieB = deriveAuction(
    { itemId: 'x', basePrice: 5000, endTime, bids: [mkBids()[1], mkBids()[0]] },
    afterEnd
  );
  assert.equal(tieA.winnerId, tieB.winnerId);
});

// ---------------------------------------------------------------------------
// 4. 局部重推与全量重推一致
// ---------------------------------------------------------------------------
await scenario('只重推受影响藏品与全量重推结果一致', () => {
  const db = freshDb();

  // 多件藏品在不同时刻产生出价
  placeBid(db, 'bronze-jue', { userId: 'u1', username: '甲', amount: 6000 }, T0);
  placeBid(db, 'bronze-jue', { userId: 'u2', username: '乙', amount: 7000 }, T0 + SECOND);
  placeBid(db, 'ru-yao-vase', { userId: 'u3', username: '丙', amount: 3000 }, T0 + 2 * SECOND);
  placeBid(db, 'ming-vase', { userId: 'u4', username: '丁', amount: 6500 }, T0 + 3 * SECOND);

  // 全量重推一次，得到基准投影
  const baseline = T0 + 10 * SECOND;
  recomputeAll(db, baseline);
  const fullSnapshot = snapshotProjections(db);

  // 只重推受影响藏品（含一次新出价触发的局部重推）
  const db2 = freshDb();
  placeBid(db2, 'bronze-jue', { userId: 'u1', username: '甲', amount: 6000 }, T0);
  placeBid(db2, 'bronze-jue', { userId: 'u2', username: '乙', amount: 7000 }, T0 + SECOND);
  placeBid(db2, 'ru-yao-vase', { userId: 'u3', username: '丙', amount: 3000 }, T0 + 2 * SECOND);
  placeBid(db2, 'ming-vase', { userId: 'u4', username: '丁', amount: 6500 }, T0 + 3 * SECOND);
  // 对未产生出价的藏品做局部重推（等价于 ensure + 推演写回）
  for (const row of db2.prepare('SELECT id FROM items').all() as { id: string }[]) {
    recomputeItem(db2, row.id, baseline);
  }
  const partialSnapshot = snapshotProjections(db2);

  assert.deepEqual(partialSnapshot, fullSnapshot);

  // 单件局部重推不影响其他藏品的投影
  const before = snapshotProjections(db);
  recomputeItem(db, 'bronze-jue', baseline);
  const after = snapshotProjections(db) as typeof before;
  assert.deepEqual(after, before);
  db.close();
  db2.close();
});

// ---------------------------------------------------------------------------
// 5. 边界：结束 / 无人出价 / 重复查询稳定
// ---------------------------------------------------------------------------
await scenario('竞拍结束与无人出价边界结论明确，重复查询稳定', () => {
  const db = freshDb();

  // 有出价且已结束
  placeBid(db, 'han-jade-dress', { userId: 'u1', username: '甲', amount: 9000 }, T0);
  placeBid(db, 'han-jade-dress', { userId: 'u2', username: '乙', amount: 9500 }, T0 + SECOND);
  const afterEnd = T0 + 60 * SECOND;

  const ended1 = readAuction(db, 'han-jade-dress', afterEnd)!;
  const ended2 = readAuction(db, 'han-jade-dress', afterEnd + 3600 * SECOND)!;
  assert.equal(ended1.isActive, false);
  assert.equal(ended1.winnerId, 'u2');
  assert.equal(ended1.currentHighest, 9500);
  // 重复查询（任意更晚时刻）结论稳定
  assert.deepEqual(viewOf(ended2), viewOf(ended1));

  // 结束后出价被拒绝，且状态不被改变
  const rejected = placeBid(db, 'han-jade-dress', { userId: 'u3', username: '丙', amount: 99999 }, afterEnd);
  assert.equal(rejected.ok, false);
  if (rejected.ok === false) assert.equal(rejected.reason, 'ended');
  assert.deepEqual(viewOf(readAuction(db, 'han-jade-dress', afterEnd)), viewOf(ended1));

  // 无人出价且已结束：无获胜者，当前价回落到底价
  // （状态在 T0 首次查询时创建，截止 T0+30s，之后查询即结束）
  readAuction(db, 'tang-sancai', T0, { ensure: true });
  const noBid = readAuction(db, 'tang-sancai', afterEnd, { ensure: true })!;
  assert.equal(noBid.isActive, false);
  assert.equal(noBid.winnerId, null);
  assert.equal(noBid.highestBid, null);
  assert.equal(noBid.currentHighest, 4500);
  assert.deepEqual(noBid.bids, []);

  // 未结束：活跃且无获胜者
  const live = readAuction(db, 'sung-scroll', T0, { ensure: true })!;
  assert.equal(live.isActive, true);
  assert.equal(live.winnerId, null);

  // 不存在的藏品：明确返回 null
  assert.equal(readAuction(db, 'no-such-item', T0), null);
  db.close();
});

await scenario('结束时间延长与出价写入保持同一结果', () => {
  const db = freshDb();
  const itemId = 'zhou-bronze-ding';

  const r = placeBid(db, itemId, { userId: 'u1', username: '甲', amount: 13000 }, T0 + 7 * SECOND);
  assert.ok(r.ok);

  // 返回状态中的结束时间 = 出价时刻 + 30 秒，且已写库
  const expectedEnd = new Date(T0 + 7 * SECOND + 30 * SECOND).toISOString();
  assert.equal(r.ok && r.auction.endTime, expectedEnd);
  const row = db.prepare('SELECT endTime FROM auction_states WHERE itemId = ?').get(itemId) as any;
  assert.equal(row.endTime, expectedEnd);
  // 写入的出价立即反映到状态
  assert.equal(r.ok && r.auction.currentHighest, 13000);
  assert.equal(r.ok && r.auction.bids.length, 1);
  db.close();
});

console.log(`\n全部 ${passed} 个场景验证通过`);
