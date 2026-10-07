import express, { Request, Response } from 'express';
import cors from 'cors';
import { FanRib, Order, OrderStatus } from '../src/types';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const fanRibs: FanRib[] = Array.from({ length: 12 }, (_, i) => ({
  id: `rib-${i + 1}`,
  number: i + 1,
  material: (['bamboo', 'sandalwood', 'ebony', 'jade'] as const)[i % 4],
  color: '#a67c52',
  inStock: true,
  used: false,
  quantity: i % 4 === 0 ? 20 : 5,
}));

const orders: Order[] = [
  {
    id: 'order-1',
    orderNo: 'SZ20260601001',
    customerName: '唐伯虎',
    fanSurfaceId: '',
    fanRibIds: [],
    status: 'pending',
    thumbnail: '',
    submittedAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
  },
  {
    id: 'order-2',
    orderNo: 'SZ20260602002',
    customerName: '祝枝山',
    fanSurfaceId: '',
    fanRibIds: [],
    status: 'in_progress',
    thumbnail: '',
    submittedAt: new Date('2026-06-02'),
    updatedAt: new Date('2026-06-03'),
  },
  {
    id: 'order-3',
    orderNo: 'SZ20260603003',
    customerName: '文徵明',
    fanSurfaceId: 'surface-3',
    fanRibIds: ['rib-1', 'rib-2', 'rib-3', 'rib-4', 'rib-5', 'rib-6', 'rib-7', 'rib-8', 'rib-9', 'rib-10', 'rib-11', 'rib-12'],
    status: 'completed',
    thumbnail: '',
    submittedAt: new Date('2026-05-28'),
    updatedAt: new Date('2026-06-01'),
  },
];

const RIB_MATERIAL_LABELS: Record<string, string> = {
  bamboo: '湘妃竹',
  sandalwood: '檀香木',
  ebony: '乌木',
  jade: '玉骨',
};

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'pending', 'cancelled'],
  completed: ['shipped'],
  shipped: [],
  cancelled: [],
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: '待制作',
  in_progress: '制作中',
  completed: '已完成',
  shipped: '已发货',
  cancelled: '已作废',
};

const ribLabel = (rib: FanRib) =>
  `扇骨#${rib.number}（${RIB_MATERIAL_LABELS[rib.material] || rib.material}）`;

const syncRibFlags = (rib: FanRib) => {
  rib.inStock = rib.quantity > 0;
  rib.used = rib.quantity === 0;
};

// 统计订单实际占用的各扇骨数量
const countRibsNeeded = (ribIds: string[]): Map<string, number> => {
  const needed = new Map<string, number>();
  for (const ribId of ribIds) {
    needed.set(ribId, (needed.get(ribId) || 0) + 1);
  }
  return needed;
};

// 原子地校验并占用订单所需扇骨：任一扇骨不足则整笔不生效
const reserveOrderRibs = (order: Order): { ok: true } | { ok: false; error: string; ribId?: string } => {
  const needed = countRibsNeeded(order.fanRibIds);
  for (const [ribId, count] of needed) {
    const rib = fanRibs.find(r => r.id === ribId);
    if (!rib) {
      return { ok: false, error: `订单占用的扇骨 ${ribId} 不存在，整笔操作未生效`, ribId };
    }
    if (rib.quantity < count) {
      return {
        ok: false,
        error: `${ribLabel(rib)}库存不足：需要 ${count} 件，仅剩 ${rib.quantity} 件，整笔操作未生效`,
        ribId,
      };
    }
  }
  for (const [ribId, count] of needed) {
    const rib = fanRibs.find(r => r.id === ribId)!;
    rib.quantity -= count;
    syncRibFlags(rib);
  }
  order.reservedRibs = Object.fromEntries(needed);
  return { ok: true };
};

// 原子地归还订单已占用的扇骨，重复调用不会重复归还
const releaseOrderRibs = (order: Order): void => {
  const reserved = order.reservedRibs || {};
  for (const [ribId, count] of Object.entries(reserved)) {
    const rib = fanRibs.find(r => r.id === ribId);
    if (rib) {
      rib.quantity += count;
      syncRibFlags(rib);
    }
  }
  order.reservedRibs = {};
};

const withRibs = (order: Order) => ({ ...order, fanRibs });

app.get('/api/orders', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 100;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedOrders = orders.slice(start, end);
    res.json({
      data: paginatedOrders,
      total: orders.length,
      page,
      pageSize,
    });
  } catch {
    res.status(500).json({ error: '获取订单列表失败' });
  }
});

app.get('/api/orders/:id', (req: Request, res: Response) => {
  try {
    const order = orders.find(o => o.id === req.params.id);
    if (!order) {
      return res.status(404).json({ error: '订单不存在' });
    }
    res.json(order);
  } catch {
    res.status(500).json({ error: '获取订单详情失败' });
  }
});

app.post('/api/orders', (req: Request, res: Response) => {
  try {
    const { fanRibIds } = req.body;

    for (const ribId of fanRibIds || []) {
      const rib = fanRibs.find(r => r.id === ribId);
      if (!rib || rib.quantity <= 0) {
        return res.status(400).json({
          error: rib ? `${ribLabel(rib)} 库存不足` : `扇骨 ${ribId} 不存在`,
          ribId,
        });
      }
    }

    const newOrder: Order = {
      id: `order-${Date.now()}`,
      orderNo: `SZ${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(orders.length + 1).padStart(3, '0')}`,
      customerName: req.body.customerName || '匿名客户',
      fanSurfaceId: req.body.fanSurfaceId || '',
      fanRibIds: req.body.fanRibIds || [],
      status: req.body.status || 'pending',
      thumbnail: req.body.thumbnail || '',
      submittedAt: new Date(),
      updatedAt: new Date(),
      reservedRibs: {},
    };

    orders.unshift(newOrder);
    res.status(201).json(newOrder);
  } catch {
    res.status(500).json({ error: '创建订单失败' });
  }
});

app.put('/api/orders/:id', (req: Request, res: Response) => {
  try {
    const index = orders.findIndex(o => o.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: '订单不存在' });
    }

    const order = orders[index];
    const oldStatus = order.status;
    const newStatus = req.body.status as OrderStatus | undefined;

    if (newStatus && newStatus !== oldStatus) {
      if (!VALID_TRANSITIONS[oldStatus].includes(newStatus)) {
        return res.status(400).json({
          error: `非法的状态流转：不能从「${STATUS_LABELS[oldStatus]}」变为「${STATUS_LABELS[newStatus] || newStatus}」`,
          code: 'INVALID_TRANSITION',
          from: oldStatus,
          to: newStatus,
        });
      }

      // 进入制作中：一次性校验并扣减订单占用的全部扇骨，任一不足则整笔不生效
      if (newStatus === 'in_progress') {
        const result = reserveOrderRibs(order);
        if (!result.ok) {
          return res.status(400).json({
            error: result.error,
            code: 'INSUFFICIENT_STOCK',
            ribId: result.ribId,
          });
        }
      }

      // 从制作中回退或作废：把已占用的数量原样归还
      if (oldStatus === 'in_progress' && (newStatus === 'pending' || newStatus === 'cancelled')) {
        releaseOrderRibs(order);
      }

      order.status = newStatus;
    }

    const rest = { ...req.body } as Record<string, unknown>;
    delete rest.status;
    delete rest.reservedRibs;
    orders[index] = {
      ...order,
      ...rest,
      updatedAt: new Date(),
    };

    res.json(withRibs(orders[index]));
  } catch {
    res.status(500).json({ error: '更新订单失败' });
  }
});

app.delete('/api/orders/:id', (req: Request, res: Response) => {
  try {
    const index = orders.findIndex(o => o.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: '订单不存在' });
    }
    // 删除（作废）订单时归还其已占用的扇骨
    releaseOrderRibs(orders[index]);
    orders.splice(index, 1);
    res.json({ success: true, fanRibs });
  } catch {
    res.status(500).json({ error: '删除订单失败' });
  }
});

app.get('/api/inventory/ribs', (req: Request, res: Response) => {
  try {
    res.json(fanRibs);
  } catch {
    res.status(500).json({ error: '获取扇骨库存失败' });
  }
});

app.put('/api/inventory/ribs/:id', (req: Request, res: Response) => {
  try {
    const index = fanRibs.findIndex(r => r.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: '扇骨不存在' });
    }
    fanRibs[index] = {
      ...fanRibs[index],
      ...req.body,
      inStock: (req.body.quantity ?? fanRibs[index].quantity) > 0,
    };
    res.json({ ...fanRibs[index], fanRibs });
  } catch {
    res.status(500).json({ error: '更新扇骨失败' });
  }
});

app.post('/api/inventory/ribs/:id/use', (req: Request, res: Response) => {
  try {
    const rib = fanRibs.find(r => r.id === req.params.id);
    if (!rib) {
      return res.status(404).json({ error: '扇骨不存在' });
    }
    if (rib.quantity <= 0) {
      return res.status(400).json({ error: `${ribLabel(rib)} 库存不足` });
    }
    rib.quantity -= 1;
    syncRibFlags(rib);
    res.json({ ...rib, fanRibs });
  } catch {
    res.status(500).json({ error: '使用扇骨失败' });
  }
});

app.post('/api/inventory/ribs/:id/restock', (req: Request, res: Response) => {
  try {
    const { quantity } = req.body;
    const rib = fanRibs.find(r => r.id === req.params.id);
    if (!rib) {
      return res.status(404).json({ error: '扇骨不存在' });
    }
    rib.quantity += quantity || 5;
    rib.inStock = true;
    rib.used = false;
    res.json({ ...rib, fanRibs });
  } catch {
    res.status(500).json({ error: '补充库存失败' });
  }
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[Server] 绢扇工坊后端服务运行在 http://localhost:${PORT}`);
  console.log(`[Server] API 文档:`);
  console.log(`[Server]   GET    /api/orders              - 获取订单列表`);
  console.log(`[Server]   GET    /api/orders/:id          - 获取订单详情`);
  console.log(`[Server]   POST   /api/orders              - 创建订单`);
  console.log(`[Server]   PUT    /api/orders/:id          - 更新订单（状态流转与库存占用原子生效）`);
  console.log(`[Server]   DELETE /api/orders/:id          - 删除订单（自动归还已占用扇骨）`);
  console.log(`[Server]   GET    /api/inventory/ribs      - 获取扇骨库存`);
  console.log(`[Server]   PUT    /api/inventory/ribs/:id  - 更新扇骨`);
  console.log(`[Server]   POST   /api/inventory/ribs/:id/use     - 使用扇骨`);
  console.log(`[Server]   POST   /api/inventory/ribs/:id/restock - 补充库存`);
});
