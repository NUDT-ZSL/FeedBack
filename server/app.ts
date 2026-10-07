import express, { Express, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getCatalog } from './lib/catalog';
import { OrderStore } from './lib/store';
import { OrderValidationError, validateOrderPayload } from './lib/validation';
import { canonicalSnapshotHash, readSnapshot, SnapshotCorruptedError } from './lib/snapshot';
import { OrderSnapshot, StoredOrder } from './lib/types';

export interface AppOptions {
  dataDir: string;
}

interface CreateOrderResult {
  order: StoredOrder;
  duplicate: boolean;
}

function generateOrderId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `DS${year}${month}${day}${random}`;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  const store = new OrderStore(options.dataDir);
  const inFlight = new Map<string, Promise<CreateOrderResult>>();

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.get('/api/fillings', (_req: Request, res: Response) => {
    res.json(getCatalog(options.dataDir).fillings);
  });

  app.get('/api/molds', (_req: Request, res: Response) => {
    res.json(getCatalog(options.dataDir).molds);
  });

  const createOrder = (body: unknown, idempotencyKey: string | null): CreateOrderResult => {
    if (idempotencyKey) {
      const existing = store.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        return { order: existing, duplicate: true };
      }
    }

    const payload = validateOrderPayload(body, getCatalog(options.dataDir));
    const snapshot: OrderSnapshot = {
      version: 1,
      fillings: payload.fillings,
      mold: payload.mold,
      drawingData: payload.drawingData,
      recipientName: payload.recipientName,
      blessing: payload.blessing,
      createdAt: new Date().toISOString(),
    };
    const order: StoredOrder = {
      id: uuidv4(),
      orderId: generateOrderId(),
      idempotencyKey,
      snapshot,
      snapshotHash: canonicalSnapshotHash(snapshot),
      createdAt: snapshot.createdAt,
    };
    store.insert(order);
    return { order, duplicate: false };
  };

  app.post('/api/orders', async (req: Request, res: Response) => {
    const keyHeader = req.header('Idempotency-Key');
    const idempotencyKey = typeof keyHeader === 'string' && keyHeader.trim() ? keyHeader.trim() : null;

    try {
      let result: CreateOrderResult;
      if (idempotencyKey && inFlight.has(idempotencyKey)) {
        result = await inFlight.get(idempotencyKey)!;
      } else {
        const task = Promise.resolve().then(() => createOrder(req.body, idempotencyKey));
        if (idempotencyKey) {
          inFlight.set(idempotencyKey, task);
        }
        try {
          result = await task;
        } finally {
          if (idempotencyKey) {
            inFlight.delete(idempotencyKey);
          }
        }
      }

      const shareLink = `${req.protocol}://${req.get('host')}/card/${result.order.orderId}`;
      res.status(result.duplicate ? 200 : 201).json({
        orderId: result.order.orderId,
        shareLink,
        duplicate: result.duplicate,
      });
    } catch (err) {
      if (err instanceof OrderValidationError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      console.error('Failed to create order:', err);
      return res.status(500).json({ error: '保存订单失败，请稍后重试' });
    }
  });

  app.get('/api/orders/:orderId', (req: Request, res: Response) => {
    const { orderId } = req.params;
    const order = store.findByOrderId(orderId);
    if (!order) {
      return res.status(404).json({ error: `订单 ${orderId} 不存在`, code: 'ORDER_NOT_FOUND' });
    }
    try {
      const snapshot = readSnapshot(order);
      res.json({ orderId: order.orderId, snapshot });
    } catch (err) {
      if (err instanceof SnapshotCorruptedError) {
        return res.status(422).json({ error: err.message, code: 'SNAPSHOT_CORRUPTED' });
      }
      console.error('Failed to read order snapshot:', err);
      return res.status(500).json({ error: '读取订单快照失败' });
    }
  });

  return app;
}
