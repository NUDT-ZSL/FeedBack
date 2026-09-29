import { v4 as uuidv4 } from 'uuid';
import type {
  Order,
  InventoryItem,
  ProductStyle,
  LeatherType,
  PresetColor,
  OrderStatus,
  StageProgress,
  OrderStage,
} from './types';
import {
  PRODUCT_STYLES,
  LEATHER_TYPES,
  PRESET_COLORS,
  SIZE_OPTIONS,
  STAGE_ORDER,
  STAGE_NAMES,
  STATUS_FLOW,
  STYLE_CONSUMPTION,
} from './constants';

const CUSTOMER_NAMES = [
  '张伟', '王芳', '李娜', '刘洋', '陈静',
  '杨磊', '赵敏', '孙强', '周丽', '吴昊',
  '郑悦', '王梓', '冯超', '陈曦', '褚瑶',
  '卫明', '蒋晨', '沈悦', '韩雪', '杨帆',
];

const REMARKS = [
  '希望刻字"Forever', '做旧效果', '金属扣用金色',
  '内衬用柔软材质', '内袋多做两个卡位',
  '腰带加长2cm', '送人生日礼物包装', 'LOGO压印',
  '五金用银色', '加急订单请尽快', '缝线用对比色',
  '简单大方款', '加一个钥匙圈', '肩带可调节',
  '内里撞色设计', '复古风做旧处理', '包装附上保养油',
  '加一个笔插位', '五金防刮处理', '手提带加宽',
];

const PHONE_PREFIX = ['138', '139', '158', '186', '188', '136', '137', '150'];

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10;
}

function pad(num: number, len = 2): string {
  return String(num).padStart(len, '0');
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function generateOrderId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function generatePhone(): string {
  let phone = randomPick(PHONE_PREFIX);
  for (let i = 0; i < 8; i++) {
    phone += randomInt(0, 9);
  }
  return phone;
}

function buildStages(statusIdx: number): StageProgress[] {
  const stages: StageProgress[] = [];
  const now = Date.now();
  let stageStart = now - randomInt(2, 10) * 24 * 60 * 60 * 1000;

  STAGE_ORDER.forEach((stageKey: OrderStage, idx: number) => {
    let st: 'pending' | 'current' | 'completed' = 'pending';
    let startedAt: string | undefined;
    let completedAt: string | undefined;
    let durationMinutes: number | undefined;

    if (statusIdx >= 2) {
      if (idx < statusIdx - 1) {
        st = 'completed';
        startedAt = formatDateTime(new Date(stageStart));
        const dur = randomInt(30, 240);
        durationMinutes = dur;
        stageStart += dur * 60 * 1000 + randomInt(1, 4) * 60 * 60 * 1000;
        completedAt = formatDateTime(new Date(stageStart));
      } else if (idx === statusIdx - 2) {
        st = 'current';
        startedAt = formatDateTime(new Date(stageStart));
      }
    }

    stages.push({
      stage: stageKey,
      name: STAGE_NAMES[stageKey],
      status: st,
      startedAt,
      completedAt,
      durationMinutes,
      note: st === 'completed' && Math.random() > 0.6 ? undefined : undefined,
    });
  });

  return stages;
}

function buildStages.name = 'buildStages';

export function generateOrders(count = 500): Order[] {
  const orders: Order[] = [];
  const usedIds = new Set<string>();

  for (let i = 0; i < count; i++) {
    let id: string;
    do {
      id = generateOrderId();
    } while (usedIds.add(id));

    const style: ProductStyle = randomPick(PRODUCT_STYLES);
    const leather: LeatherType = randomPick(LEATHER_TYPES);
    const color: PresetColor = randomPick(PRESET_COLORS);
    const sizes = SIZE_OPTIONS[style];
    const size: string = randomPick(sizes);
    const statusIdx: number = randomInt(0, STATUS_FLOW.length - 1);
    const status: OrderStatus = STATUS_FLOW[statusIdx];

    const createdDaysAgo = randomInt(0, 45);
    const createdAt = new Date(Date.now() - createdDaysAgo * 24 * 60 * 60 * 1000 - randomInt(0, 12) * 60 * 60 * 1000);
    const updatedAt = new Date(createdAt.getTime() + randomInt(1, createdDaysAgo > 0 ? randomInt(1, createdDaysAgo) : 1) * 60 * 60 * 1000);
    const estDays = status === 'completed' ? randomInt(3, 15) : randomInt(5, 20);
    const estimatedCompletionDate = new Date(createdAt.getTime() + estDays * 24 * 60 * 60 * 1000);

    orders.push({
      id,
      customerName: randomPick(CUSTOMER_NAMES),
      customerPhone: generatePhone(),
      style,
      leatherType: leather,
      color,
      size,
      remark: Math.random() > 0.4 ? randomPick(REMARKS) : '',
      status,
      stages: buildStages(statusIdx),
      createdAt: formatDateTime(createdAt),
      updatedAt: formatDateTime(updatedAt),
      estimatedCompletionDate: formatDate(estimatedCompletionDate),
    });
  }

  return orders.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

generateOrders.name = 'generateOrders';

export function generateInventory(count = 200): InventoryItem[] {
  const items: InventoryItem[] = [];
  const combos = new Set<string>();

  let attempts = 0;
  while (items.length < count && attempts < count * 3) {
    attempts++;
    const leatherType: LeatherType = randomPick(LEATHER_TYPES);
    const color: PresetColor = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
    const key = `${leatherType}-${color}`;
    if (combos.has(key)) continue;
    combos.add(key);

    const style: ProductStyle = randomPick(PRODUCT_STYLES);
    const safe = STYLE_CONSUMPTION[style] * 2;
    const area = randomFloat(safe * 0.3, safe * 6);
    const purchaseDaysAgo = randomInt(1, 90);
    const purchaseDate = new Date(Date.now() - purchaseDaysAgo * 24 * 60 * 60 * 1000);

    items.push({
      id: uuidv4(),
      leatherType,
      color,
      areaSqft: area,
      purchaseDate: formatDate(purchaseDate),
      safeThreshold: Number(safe.toFixed(1)),
      recentConsumption: randomFloat(0, safe * 3),
    });
  }
  return items;
}

generateInventory.name = 'generateInventory';

export function resetMockData(): { orders: Order[]; inventory: InventoryItem[] } {
  return {
    orders: generateOrders(500),
    inventory: generateInventory(200),
  };
}

resetMockData.name = 'resetMockData';
