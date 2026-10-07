import express from 'express';
import cors from 'cors';
import { getDb } from './database.js';
import { getAuctionView, listAuctionViews, placeBid } from './auctionService.js';
import type { ArtifactItem } from '../shared/types.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const db = getDb();

function parseItem(row: any): ArtifactItem {
  return {
    ...row,
    energyData: JSON.parse(row.energyData),
    backgroundStories: JSON.parse(row.backgroundStories)
  };
}

app.get('/api/items', (_req, res) => {
  try {
    const items = db.prepare('SELECT * FROM items ORDER BY createdAt DESC').all() as any[];
    const parsedItems: ArtifactItem[] = items.map(parseItem);

    const auctionStates = listAuctionViews(parsedItems.map(item => item.id), Date.now(), db);

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
    const auctionState = getAuctionView(id, Date.now(), db)!;

    res.json({
      item,
      bids: auctionState.bids,
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

    const result = placeBid(id, userId, username, amount, Date.now(), db);

    if (result.ok === false) {
      return res.status(result.status).json({
        success: false,
        error: result.error,
        auctionState: result.auctionState
      });
    }

    res.json({
      success: true,
      newBid: result.newBid,
      auctionState: result.auctionState
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
