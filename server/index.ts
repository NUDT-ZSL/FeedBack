import express from 'express';
import cors from 'cors';
import type { Goods, Transaction, Currency, CurrencyHoldings, ExchangeRate } from '../src/types';
import { initialGoods, generateId } from '../src/utils/mock';
import { exchangeRate } from '../src/utils/currency';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

let goods: Goods[] = JSON.parse(JSON.stringify(initialGoods));
let transactions: Transaction[] = [];
let holdings: CurrencyHoldings = {
  copper: 50000,
  silver: 50,
  silk: 10
};

const rate: ExchangeRate = exchangeRate;

function convertToCopper(amount: number, currency: Currency): number {
  return amount * rate[currency];
}

function convertFromCopper(copperAmount: number, targetCurrency: Currency): number {
  return copperAmount / rate[targetCurrency];
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/goods', (_req, res) => {
  res.json(goods);
});

app.get('/api/goods/:id', (req, res) => {
  const item = goods.find(g => g.id === req.params.id);
  if (!item) {
    res.status(404).json({ error: '货物不存在' });
    return;
  }
  res.json(item);
});

app.put('/api/goods/:id/stock', (req, res) => {
  const { amount, type } = req.body;
  const item = goods.find(g => g.id === req.params.id);
  if (!item) {
    res.status(404).json({ error: '货物不存在' });
    return;
  }
  if (type === 'out' && item.stock < amount) {
    res.status(400).json({ error: '库存不足' });
    return;
  }
  item.stock = type === 'in' ? item.stock + amount : item.stock - amount;
  res.json(item);
});

app.get('/api/transactions', (_req, res) => {
  res.json(transactions);
});

app.post('/api/transactions', (req, res) => {
  const transaction: Transaction = {
    ...req.body,
    id: generateId(),
    timestamp: Date.now()
  };
  transactions.unshift(transaction);

  const item = goods.find(g => g.id === transaction.goodsId);
  if (item) {
    if (transaction.type === 'sale') {
      item.saleRecords.push({
        id: generateId(),
        quantity: transaction.quantity,
        revenue: transaction.totalAmount,
        timestamp: transaction.timestamp,
        traderName: transaction.traderName,
        traderOrigin: transaction.traderOrigin
      });
    } else if (transaction.type === 'purchase') {
      item.purchaseRecords.push({
        id: generateId(),
        quantity: transaction.quantity,
        cost: transaction.totalAmount,
        timestamp: transaction.timestamp
      });
    }
  }

  res.status(201).json(transaction);
});

app.get('/api/exchange-rate', (_req, res) => {
  res.json(rate);
});

app.get('/api/holdings', (_req, res) => {
  res.json(holdings);
});

app.post('/api/exchange', (req, res) => {
  const { from, to, amount } = req.body as { from: Currency; to: Currency; amount: number };

  if (from === to) {
    res.status(400).json({ error: '源货币与目标货币相同' });
    return;
  }

  if (holdings[from] < amount) {
    res.status(400).json({ error: '余额不足' });
    return;
  }

  const copperValue = convertToCopper(amount, from);
  const targetAmount = convertFromCopper(copperValue, to);

  holdings[from] -= amount;
  holdings[to] += targetAmount;

  const exchangeTx: Transaction = {
    id: generateId(),
    goodsId: 'exchange',
    goodsName: '货币兑换',
    type: 'exchange',
    quantity: targetAmount,
    unitPrice: 1,
    totalAmount: copperValue,
    currency: to,
    timestamp: Date.now(),
    exchangeFrom: from,
    exchangeTo: to,
    exchangeAmount: amount
  };
  transactions.unshift(exchangeTx);

  res.json({ success: true, holdings, exchangeTx });
});

app.post('/api/purchase', (req, res) => {
  const { goodsId, quantity, cost } = req.body as { goodsId: string; quantity: number; cost: number };
  const item = goods.find(g => g.id === goodsId);
  if (!item) {
    res.status(404).json({ error: '货物不存在' });
    return;
  }
  if (holdings.copper < cost) {
    res.status(400).json({ error: '铜钱不足' });
    return;
  }

  item.stock += quantity;
  holdings.copper -= cost;

  item.purchaseRecords.push({
    id: generateId(),
    quantity,
    cost,
    timestamp: Date.now()
  });

  const purchaseTx: Transaction = {
    id: generateId(),
    goodsId,
    goodsName: item.name,
    type: 'purchase',
    quantity,
    unitPrice: cost / quantity,
    totalAmount: cost,
    currency: 'copper',
    timestamp: Date.now()
  };
  transactions.unshift(purchaseTx);

  res.json({ success: true, goods: item, holdings, transaction: purchaseTx });
});

app.listen(PORT, () => {
  console.log(`🏪 长安西市粟特商号后端服务已启动: http://localhost:${PORT}`);
});
