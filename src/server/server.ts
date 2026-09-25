import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { getCategories, getDishesByCategory, getDishById, Order, OrderItem } from './data';

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

const orders: Order[] = [];

app.get('/api/categories', (_req, res) => {
  const categories = getCategories();
  res.json(categories);
});

app.get('/api/dishes', (req, res) => {
  const categoryId = req.query.categoryId as string;
  if (!categoryId) {
    return res.status(400).json({ error: 'categoryId is required' });
  }
  const dishes = getDishesByCategory(categoryId);
  res.json(dishes);
});

app.post('/api/orders', (req, res) => {
  const items: OrderItem[] = req.body.items;
  
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '订单菜品不能为空' });
  }

  let totalAmount = 0;
  for (const item of items) {
    const dish = getDishById(item.dishId);
    if (!dish) {
      return res.status(400).json({ error: `菜品 ${item.dishId} 不存在` });
    }
    if (item.quantity <= 0) {
      return res.status(400).json({ error: '菜品数量必须大于0' });
    }
    totalAmount += dish.price * item.quantity;
  }

  const waitTime = Math.floor(Math.random() * 10) + 1;
  
  const order: Order = {
    id: uuidv4().slice(0, 8).toUpperCase(),
    items,
    totalAmount,
    waitTime,
    createdAt: new Date()
  };

  orders.push(order);
  
  res.json({
    orderId: order.id,
    waitTime: order.waitTime,
    totalAmount: order.totalAmount
  });
});

app.get('/api/orders/:orderId', (req, res) => {
  const order = orders.find(o => o.id === req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: '订单不存在' });
  }
  res.json(order);
});

app.listen(PORT, () => {
  console.log(`Restaurant API server running on http://localhost:${PORT}`);
});
