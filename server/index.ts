import express, { Request, Response } from 'express';
import path from 'path';
import { fillingsData, moldsData } from './catalog';
import { OrderStore } from './orderStore';
import { createOrder, getOrder } from './orderService';

const app = express();
const PORT = 3001;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const store = new OrderStore(path.join(__dirname, '..', 'data'));

app.get('/api/fillings', (_req: Request, res: Response) => {
  res.json(fillingsData);
});

app.get('/api/molds', (_req: Request, res: Response) => {
  res.json(moldsData);
});

app.post('/api/orders', (req: Request, res: Response) => {
  try {
    const result = createOrder(store, req.body ?? {});

    if (result.status === 400) {
      return res.status(400).json({
        error: '订单校验失败',
        details: result.errors,
      });
    }

    const shareLink = `${req.protocol}://${req.get('host')}/card/${result.orderId}`;
    return res.json({
      orderId: result.orderId,
      shareLink,
      duplicated: result.duplicated,
    });
  } catch (err) {
    console.error('Failed to create order:', err);
    return res.status(500).json({ error: '保存订单失败' });
  }
});

app.get('/api/orders/:orderId', (req: Request, res: Response) => {
  try {
    const result = getOrder(store, req.params.orderId);

    if (result.status === 404 || result.status === 500) {
      return res.status(result.status).json({ code: result.code, error: result.error });
    }

    return res.json({
      orderId: result.orderId,
      createdAt: result.createdAt,
      snapshot: result.snapshot,
    });
  } catch (err) {
    console.error('Failed to query order:', err);
    return res.status(500).json({ error: '查询订单失败' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Database located at: ${store.filePath}`);
});
