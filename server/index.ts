import express, { Request, Response } from 'express';
import cors from 'cors';
import { FanRib, Order, OrderStatus } from '../src/types';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

let fanRibs: FanRib[] = Array.from({ length: 12 }, (_, i) => ({
  id: `rib-${i + 1}`,
  number: i + 1,
  material: '紫竹',
  color: '#a67c52',
  inStock: true,
  used: false,
  quantity: 5,
}));

let orders: Order[] = [
  {
    id: 'order-1',
    orderNo: 'SZ20260601001',
    customerName: '唐伯虎',
    fanSurfaceId: '',
    fanRibIds: [],
    status: 'pending',
    thumbnail: '',
    inventoryReserved: false,
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
    inventoryReserved: false,
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
    inventoryReserved: false,
    submittedAt: new Date('2026-05-28'),
    updatedAt: new Date('2026-06-01'),
  },
];


const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: '待制作',
  in_progress: '制作中',
  completed: '已完成',
  shipped: '已发货',
};

// 合法状态流转表：任何非法流转整笔拒绝
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['in_progress'],
  in_progress: ['pending', 'completed'],
  completed: ['shipped'],
  shipped: [],
};

// 按扇骨汇总订单的实际占用量（同一根扇骨可能被占用多件）
const countRibUsage = (ribIds: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const ribId of ribIds) {
    counts.set(ribId, (counts.get(ribId) || 0) + 1);
  }
  return counts;
};

// 把订单占用的扇骨原样归还；未占用则什么都不做，保证重复调用不重复归还
const returnReservedRibs = (order: Order): void => {
  if (!order.inventoryReserved) return;
  const counts = countRibUsage(order.fanRibIds);
  for (const [ribId, quantity] of counts) {
    const rib = fanRibs.find((r) => r.id === ribId);
    if (rib) {
      rib.quantity += quantity;
      rib.inStock = true;
      rib.used = false;
    }
  }
  order.inventoryReserved = false;
};

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
  } catch (error) {
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
  } catch (error) {
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
          error: `扇骨 #${rib?.number || ribId} 库存不足`,
          ribId 
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
    };
    
    orders.unshift(newOrder);
    res.status(201).json(newOrder);
  } catch (error) {
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
    const newStatus = req.body.status as OrderStatus | undefined;

    if (newStatus && newStatus !== order.status) {
      if (!ALLOWED_TRANSITIONS[order.status].includes(newStatus)) {
        return res.status(409).json({
          error: `订单 ${order.orderNo} 当前为「${STATUS_LABELS[order.status]}」，不能变更为「${STATUS_LABELS[newStatus]}」`,
          orderId: order.id,
          status: order.status,
        });
      }

      if (order.status === 'pending' && newStatus === 'in_progress') {
        // 先一次性校验订单实际占用的每一种扇骨，任一不足则整笔不生效
        const counts = countRibUsage(order.fanRibIds);
        const insufficient: { ribId: string; number: number | null; required: number; available: number }[] = [];
        for (const [ribId, required] of counts) {
          const rib = fanRibs.find(r => r.id === ribId);
          if (!rib) {
            insufficient.push({ ribId, number: null, required, available: 0 });
          } else if (rib.quantity < required) {
            insufficient.push({ ribId, number: rib.number, required, available: rib.quantity });
          }
        }
        if (insufficient.length > 0) {
          return res.status(409).json({
            error: insufficient
              .map(item => `扇骨 ${item.number ? `#${item.number}` : item.ribId} 库存不足（需 ${item.required} 件，仅剩 ${item.available} 件）`)
              .join('；'),
            orderId: order.id,
            insufficient,
          });
        }

        // 校验全部通过后才扣减，与状态更新在同一同步处理中整体生效
        for (const [ribId, required] of counts) {
          const rib = fanRibs.find(r => r.id === ribId);
          if (rib) {
            rib.quantity -= required;
            rib.inStock = rib.quantity > 0;
            if (rib.quantity === 0) {
              rib.used = true;
            }
          }
        }
        order.inventoryReserved = true;
      }

      // 从制作中回退到待制作：归还已占用的扇骨
      if (order.status === 'in_progress' && newStatus === 'pending') {
        returnReservedRibs(order);
      }
    }

    // 重复提交相同状态时整体幂等：库存不重复扣减/归还，只回显当前事实
    orders[index] = {
      ...order,
      ...req.body,
      id: order.id,
      fanRibIds: order.fanRibIds,
      inventoryReserved: order.inventoryReserved,
      status: newStatus ?? order.status,
      updatedAt: new Date(),
    };

    res.json(orders[index]);
  } catch (error) {
    res.status(500).json({ error: '更新订单失败' });
  }
});

app.delete('/api/orders/:id', (req: Request, res: Response) => {
  try {
    const index = orders.findIndex(o => o.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: '订单不存在' });
    }
    // 作废订单：若库存已占用则先原样归还，归还与删除整体生效
    returnReservedRibs(orders[index]);
    orders.splice(index, 1);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '删除订单失败' });
  }
});

app.get('/api/inventory/ribs', (req: Request, res: Response) => {
  try {
    res.json(fanRibs);
  } catch (error) {
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
    res.json(fanRibs[index]);
  } catch (error) {
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
      return res.status(400).json({ error: '扇骨库存不足' });
    }
    rib.quantity -= 1;
    rib.inStock = rib.quantity > 0;
    if (rib.quantity === 0) {
      rib.used = true;
    }
    res.json(rib);
  } catch (error) {
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
    res.json(rib);
  } catch (error) {
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
  console.log(`[Server]   PUT    /api/orders/:id          - 更新订单`);
  console.log(`[Server]   DELETE /api/orders/:id          - 删除订单`);
  console.log(`[Server]   GET    /api/inventory/ribs      - 获取扇骨库存`);
  console.log(`[Server]   PUT    /api/inventory/ribs/:id  - 更新扇骨`);
  console.log(`[Server]   POST   /api/inventory/ribs/:id/use     - 使用扇骨`);
  console.log(`[Server]   POST   /api/inventory/ribs/:id/restock - 补充库存`);
});
