import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import db, { initDatabase } from './database.js';
import type { ArtifactItem, BidRecord, AuctionState } from '../shared/types.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

initDatabase();

function parseItem(row: any): ArtifactItem {
  return {
    ...row,
    energyData: JSON.parse(row.energyData),
    backgroundStories: JSON.parse(row.backgroundStories)
  };
}

function getBidsForItem(itemId: string): BidRecord[] {
  const bids = db.prepare(`
    SELECT * FROM bids WHERE itemId = ? ORDER BY timestamp DESC
  `).all(itemId) as any[];
  return bids as BidRecord[];
}

function getAuctionState(itemId: string): AuctionState | null {
  const state = db.prepare(`
    SELECT * FROM auction_states WHERE itemId = ?
  `).get(itemId) as any;

  if (!state) {
    return null;
  }

  const bids = getBidsForItem(itemId);

  return {
    itemId: state.itemId,
    endTime: state.endTime,
    isActive: state.isActive === 1,
    winnerId: state.winnerId,
    bids
  };
}

function createOrUpdateAuctionState(itemId: string): AuctionState {
  const existingState = getAuctionState(itemId);

  if (existingState) {
    return existingState;
  }

  const endTime = new Date(Date.now() + 30 * 1000).toISOString();

  db.prepare(`
    INSERT INTO auction_states (itemId, endTime, isActive, winnerId)
    VALUES (?, ?, 1, NULL)
  `).run(itemId, endTime);

  return getAuctionState(itemId)!;
}

function isAuctionActive(auctionState: AuctionState): boolean {
  if (!auctionState.isActive) return false;
  const now = new Date();
  const endTime = new Date(auctionState.endTime);
  return now < endTime;
}

app.get('/api/items', (_req, res) => {
  try {
    const items = db.prepare('SELECT * FROM items ORDER BY createdAt DESC').all() as any[];
    const parsedItems: ArtifactItem[] = items.map(parseItem);

    const auctionStates: AuctionState[] = parsedItems.map(item => {
      let state = getAuctionState(item.id);
      if (!state) {
        state = createOrUpdateAuctionState(item.id);
      }
      return state;
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

    const itemRow = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as any;

    if (!itemRow) {
      return res.status(404).json({ error: '藏品不存在' });
    }

    const item: ArtifactItem = parseItem(itemRow);
    const bids = getBidsForItem(id);
    let auctionState = getAuctionState(id);

    if (!auctionState) {
      auctionState = createOrUpdateAuctionState(id);
    }

    res.json({
      item,
      bids,
      auctionState
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

    const itemRow = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as any;

    if (!itemRow) {
      return res.status(404).json({
        success: false,
        error: '藏品不存在',
        auctionState: null as any
      });
    }

    let auctionState = getAuctionState(id);

    if (!auctionState) {
      auctionState = createOrUpdateAuctionState(id);
    }

    if (!isAuctionActive(auctionState)) {
      return res.status(400).json({
        success: false,
        error: '竞拍已结束',
        auctionState
      });
    }

    const currentHighest = Math.max(itemRow.currentPrice, ...auctionState.bids.map(b => b.amount), 0);

    if (amount <= currentHighest) {
      return res.status(400).json({
        success: false,
        error: `出价必须高于当前最高价 ${currentHighest}`,
        auctionState
      });
    }

    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as any;
    if (!userExists) {
      db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(userId, username);
    }

    const bidId = uuidv4();
    const timestamp = new Date().toISOString();

    db.prepare(`
      INSERT INTO bids (id, itemId, userId, username, amount, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(bidId, id, userId, username, amount, timestamp);

    db.prepare('UPDATE items SET currentPrice = ? WHERE id = ?').run(amount, id);

    const newEndTime = new Date(Date.now() + 30 * 1000).toISOString();
    db.prepare('UPDATE auction_states SET endTime = ? WHERE itemId = ?').run(newEndTime, id);

    const newBid: BidRecord = {
      id: bidId,
      itemId: id,
      userId,
      username,
      amount,
      timestamp
    };

    const updatedAuctionState = getAuctionState(id)!;

    res.json({
      success: true,
      newBid,
      auctionState: updatedAuctionState
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
