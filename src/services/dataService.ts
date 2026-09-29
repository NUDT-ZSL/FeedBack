import { v4 as uuidv4 } from 'uuid';
import type {
  Order,
  InventoryItem,
  OrderStatus,
  OrderStage,
  ProductStyle,
  LeatherType,
  PresetColor,
  StageProgress,
} from '@/utils/types';
import {
  ASYNC_DELAY_MS,
  STAGE_ORDER,
  STAGE_NAMES,
  STYLE_CONSUMPTION,
  STATUS_FLOW,
} from '@/utils/constants';
import { generateOrders, generateInventory } from '@/utils/mockData';

interface DataState {
  orders: Order[];
  inventory: InventoryItem[];
}

let state: DataState = {
  orders: [],
  inventory: [],
};

let initialized = false;
let initPromise: Promise<void> | null = null;

async function delay<T>(value: T, ms = ASYNC_DELAY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

delay.name = 'delay';

export async function initData(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    state.orders = generateOrders(500);
    state.inventory = generateInventory(200);
    initialized = true;
  })();
  return initPromise;
}

initData.name = 'initData';

export function seedData(orders: Order[], inventory: InventoryItem[]): void {
  state.orders = orders;
  state.inventory = inventory;
  initialized = true;
}

seedData.name = 'seedData';

export async function getOrders(
  page = 1,
  pageSize = 50,
  statusFilter?: OrderStatus | 'all',
): Promise<{ data: Order[]; total: number }> {
  await initData();
  let list = state.orders;
  if (statusFilter && statusFilter !== 'all') {
    list = list.filter((o) => o.status === statusFilter);
  }
  const start = (page - 1) * pageSize;
  return delay({
    data: list.slice(start, start + pageSize),
    total: list.length,
  });
}

getOrders.name = 'getOrders';

export async function getOrderById(id: string): Promise<Order | null> {
  await initData();
  const order = state.orders.find((o) => o.id === id) || null;
  return delay(order);
}

getOrderById.name = 'getOrderById';

function pad(num: number, len = 2): string {
  return String(num).padStart(len, '0');
}

function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

formatDateTime.name = 'formatDateTime';

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

formatDate.name = 'formatDate';

export interface NewOrderInput {
  customerName: string;
  customerPhone: string;
  style: ProductStyle;
  leatherType: LeatherType;
  color: PresetColor;
  size: string;
  remark: string;
}

export async function createOrder(input: NewOrderInput): Promise<Order> {
  await initData();
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];

  const now = new Date();
  const stages: StageProgress[] = STAGE_ORDER.map(
    (s): StageProgress => ({
      stage: s,
      name: STAGE_NAMES[s],
      status: 'pending',
    }),
  );
  const est = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const order: Order = {
    id,
    ...input,
    status: 'pending',
    stages,
    createdAt: formatDateTime(now),
    updatedAt: formatDateTime(now),
    estimatedCompletionDate: formatDate(est),
  };
  state.orders.unshift(order);
  return delay(order);
}

createOrder.name = 'createOrder';

export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
): Promise<Order | null> {
  await initData();
  const order = state.orders.find((o) => o.id === id);
  if (!order) return delay(null);
  const prevStatus = order.status;
  order.status = status;
  order.updatedAt = formatDateTime(new Date());

  if (status === 'confirmed' && prevStatus !== 'confirmed') {
    deductInventory(order.leatherType, order.color, STYLE_CONSUMPTION[order.style]);
    order.stages[0].status = 'current';
    order.stages[0].startedAt = formatDateTime(new Date());
  }

  if (status === 'in_progress' && prevStatus !== 'in_progress') {
    if (order.stages[0].status === 'pending') {
      order.stages[0].status = 'current';
      order.stages[0].startedAt = formatDateTime(new Date());
    }
  }

  if (status === 'completed') {
    order.stages.forEach((s) => {
      if (s.status !== 'completed') {
        s.status = 'completed';
        if (!s.completedAt) s.completedAt = formatDateTime(new Date());
        if (!s.startedAt) s.startedAt = formatDateTime(new Date());
      }
    });
  }

  return delay({ ...order });
}

updateOrderStatus.name = 'updateOrderStatus';

export async function completeStage(
  orderId: string,
  stage: OrderStage,
  durationMinutes: number,
  note?: string,
): Promise<Order | null> {
  await initData();
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return delay(null);
  const stageIdx = STAGE_ORDER.indexOf(stage);
  if (stageIdx < 0) return delay(null);
  const sp = order.stages[stageIdx];
  const now = formatDateTime(new Date());
  sp.status = 'completed';
  sp.completedAt = now;
  sp.durationMinutes = durationMinutes;
  if (note) sp.note = note;
  if (!sp.startedAt) sp.startedAt = now;

  if (stageIdx + 1 < STAGE_ORDER.length) {
    const next = order.stages[stageIdx + 1];
    if (next.status === 'pending') {
      next.status = 'current';
      next.startedAt = now;
    }
  }

  if (order.status !== 'completed' && stageIdx + 1 >= STAGE_ORDER.length) {
    order.status = 'shipping';
  }
  order.updatedAt = now;
  return delay({ ...order });
}

completeStage.name = 'completeStage';

function deductInventory(
  leatherType: LeatherType,
  color: PresetColor,
  sqft: number,
): void {
  const item = state.inventory.find(
    (i) => i.leatherType === leatherType && i.color === color,
  );
  if (!item) return;
  item.areaSqft = Math.max(0, Number((item.areaSqft - sqft).toFixed(1)));
  item.recentConsumption = Number(
    (item.recentConsumption + sqft).toFixed(1),
  );
}

deductInventory.name = 'deductInventory';

export async function getInventory(): Promise<InventoryItem[]> {
  await initData();
  return delay([...state.inventory]);
}

getInventory.name = 'getInventory';

export async function getLowStockItems(): Promise<InventoryItem[]> {
  await initData();
  const low = state.inventory.filter((i) => i.areaSqft < i.safeThreshold);
  return delay([...low]);
}

getLowStockItems.name = 'getLowStockItems';

export function getNextStatus(
  current: OrderStatus,
  direction: 'left' | 'right',
): OrderStatus | null {
  const idx = STATUS_FLOW.indexOf(current);
  if (idx < 0) return null;
  const next = direction === 'right' ? idx + 1 : idx - 1;
  if (next < 0 || next >= STATUS_FLOW.length) return null;
  return STATUS_FLOW[next];
}

getNextStatus.name = 'getNextStatus';

export interface WorkerPayload {
  type: 'init';
  orders: Order[];
  inventory: InventoryItem[];
}

export interface WorkerInitMessage {
  type: 'generate';
  orderCount?: number;
  inventoryCount?: number;
}
