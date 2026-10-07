import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = 3001;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'orders.json');

interface Order {
  id: string;
  orderId: string;
  fillings: string;
  mold: string;
  drawingData: string;
  recipientName: string;
  blessing: string;
  createdAt: string;
}

function readOrders(): Order[] {
  if (!fs.existsSync(dbPath)) {
    return [];
  }
  try {
    const data = fs.readFileSync(dbPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeOrders(orders: Order[]): void {
  fs.writeFileSync(dbPath, JSON.stringify(orders, null, 2), 'utf-8');
}

function insertOrder(order: Order): void {
  const orders = readOrders();
  orders.push(order);
  writeOrders(orders);
}

function findOrderByOrderId(orderId: string): Order | undefined {
  const orders = readOrders();
  return orders.find(o => o.orderId === orderId);
}

const fillingsData = [
  {
    id: '1',
    name: '红豆沙',
    description: '江南红豆，细腻香甜',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=red%20bean%20paste%20close%20up%20macro%20food%20photography&image_size=square',
  },
  {
    id: '2',
    name: '莲蓉',
    description: '莲子清香，入口即化',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=lotus%20seed%20paste%20close%20up%20macro%20food%20photography&image_size=square',
  },
  {
    id: '3',
    name: '芝麻',
    description: '黑芝麻香，营养丰富',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=black%20sesame%20paste%20close%20up%20macro%20food%20photography&image_size=square',
  },
  {
    id: '4',
    name: '桂花',
    description: '金秋桂花，香气四溢',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=osmanthus%20flower%20jam%20close%20up%20macro%20food%20photography&image_size=square',
  },
  {
    id: '5',
    name: '枣泥',
    description: '红枣滋养，甜而不腻',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=red%20date%20paste%20close%20up%20macro%20food%20photography&image_size=square',
  },
  {
    id: '6',
    name: '抹茶',
    description: '日式抹茶，清香回甘',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=matcha%20green%20tea%20paste%20close%20up%20macro%20food%20photography&image_size=square',
  },
  {
    id: '7',
    name: '芒果',
    description: '热带芒果，鲜甜多汁',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=mango%20jam%20close%20up%20macro%20food%20photography&image_size=square',
  },
  {
    id: '8',
    name: '榴莲',
    description: '猫山王榴莲，香浓醇厚',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=durian%20paste%20close%20up%20macro%20food%20photography&image_size=square',
  },
  {
    id: '9',
    name: '巧克力',
    description: '比利时巧克力，丝滑浓郁',
    image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=chocolate%20ganache%20close%20up%20macro%20food%20photography&image_size=square',
  },
];

const moldsData = [
  { id: '1', name: '圆形', shape: 'circle' },
  { id: '2', name: '方形', shape: 'square' },
  { id: '3', name: '梅花形', shape: 'plum' },
  { id: '4', name: '扇形', shape: 'fan' },
  { id: '5', name: '寿桃形', shape: 'peach' },
  { id: '6', name: '动物形', shape: 'animal' },
];

function generateOrderId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `DS${year}${month}${day}${random}`;
}

app.get('/api/fillings', (_req: Request, res: Response) => {
  res.json(fillingsData);
});

app.get('/api/molds', (_req: Request, res: Response) => {
  res.json(moldsData);
});

app.post('/api/orders', (req: Request, res: Response) => {
  const { fillings, mold, drawingData, recipientName, blessing } = req.body;

  if (!fillings || !mold || !recipientName || !blessing) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  const id = uuidv4();
  const orderId = generateOrderId();

  try {
    const order: Order = {
      id,
      orderId,
      fillings: JSON.stringify(fillings),
      mold: JSON.stringify(mold),
      drawingData: drawingData || '',
      recipientName,
      blessing,
      createdAt: new Date().toISOString(),
    };

    insertOrder(order);

    const shareLink = `${req.protocol}://${req.get('host')}/card/${orderId}`;
    res.json({
      orderId,
      shareLink,
    });
  } catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({ error: '保存订单失败' });
  }
});

app.get('/api/orders/:orderId', (req: Request, res: Response) => {
  const { orderId } = req.params;

  try {
    const order = findOrderByOrderId(orderId);

    if (!order) {
      return res.status(404).json({ error: '订单不存在' });
    }

    res.json(order);
  } catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({ error: '查询订单失败' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Database located at: ${dbPath}`);
});
