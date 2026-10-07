import express from 'express';
import cors from 'cors';
import { createDatabase, defaultDbPath } from './database.js';
import type { ArtifactItem, AuctionState } from '../shared/types.js';
import { getBidsForItem, placeBid, readAuction } from './auction/projection.js';
import type { DerivedAuction } from './auction/engine.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const db = createDatabase(defaultDbPath);

function parseItem(row: any): ArtifactItem {
  return {
    ...row,
    energyData: JSON.parse(row.energyData),
    backgroundStories: JSON.parse(row.backgroundStories)
  };
}

/** 接口出参视图：字段与既有 AuctionState 完全一致 */
function toAuctionStateView(auction: DerivedAuction): AuctionState {
  return {
    itemId: auction.itemId,
    endTime: auction.endTime ?? '',
    isActive: auction.isActive,
    winnerId: auction.winnerId,
    bids: auction.bids
  };
}

app.get('/api/items', (_req, res) => {
  try {
    const nowMs = Date.now();
    const items = db.prepare('SELECT * FROM items ORDER BY createdAt DESC').all() as any[];
    const parsedItems: ArtifactItem[] = items.map(parseItem);

    const auctionStates: AuctionState[] = parsedItems.map(item => {
      const auction = readAuction(db, item.id, nowMs, { ensure: true })!;
      return toAuctionStateView(auction);
    });

    res.json({
      items: parsedItems,
      auctionStates
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/items/:id', (req, res) => {
  try {
    const { id } = req.params;
    const nowMs = Date.now();

    const itemRow = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as any;

    if (!itemRow) {
      return res.status(404).json({ error: '藏品不存在' });
    }

    const item: ArtifactItem = parseItem(itemRow);
    const bids = getBidsForItem(db, id);
    const auction = readAuction(db, id, nowMs, { ensure: true })!;

    res.json({
      item,
      bids,
      auctionState: toAuctionStateView(auction)
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bid/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { userId, username, amount } = req.body;

    if (!userId || !username || !amount) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数',
        auctionState: null as any
      });
    }

    const itemRow = db.prepare('SELECT id FROM items WHERE id = ?').get(id) as any;

    if (!itemRow) {
      return res.status(404).json({
        success: false,
        error: '藏品不存在',
        auctionState: null as any
      });
    }

    const result = placeBid(db, id, { userId, username, amount }, Date.now());

    if (result.ok === false) {
      const error =
        result.reason === 'ended'
          ? '竞拍已结束'
          : `出价必须高于当前最高价 ${result.currentHighest}`;
      return res.status(400).json({
        success: false,
        error,
        auctionState: toAuctionStateView(result.auction)
      });
    }

    res.json({
      success: true,
      newBid: result.newBid,
      auctionState: toAuctionStateView(result.auction)
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      auctionState: null as any
    });
  }
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
